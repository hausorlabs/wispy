import Database from "better-sqlite3";
import { resolve } from "path";
import { statSync } from "fs";
import { ensureDir } from "../utils/file.js";
import { createLogger } from "../infra/logger.js";
import type { MemoryCategory, MemoryMetadata } from "./manager.js";

const log = createLogger("vector-store");

export interface StoredDocument {
  id: number;
  text: string;
  embedding: number[];
  source: string;
  sessionKey?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  accessCount?: number;
  lastAccessed?: string;
  decayFactor?: number;
}

export class VectorStore {
  private db: Database.Database;
  private dbPath: string;

  constructor(runtimeDir: string) {
    this.dbPath = resolve(runtimeDir, "memory", "embeddings.db");
    ensureDir(resolve(runtimeDir, "memory"));
    this.db = new Database(this.dbPath);
    // WAL mode allows concurrent reads from multiple processes
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init() {
    // Create table without expires_at first (for compatibility)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        source TEXT,
        session_key TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_source ON embeddings(source);
      CREATE INDEX IF NOT EXISTS idx_session ON embeddings(session_key);
    `);

    // Migration: Add expires_at column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE embeddings ADD COLUMN expires_at TEXT`);
    } catch {
      // Column already exists
    }

    // Migration: Add memory-bank columns
    try {
      this.db.exec(`ALTER TABLE embeddings ADD COLUMN access_count INTEGER DEFAULT 0`);
    } catch { /* already exists */ }
    try {
      this.db.exec(`ALTER TABLE embeddings ADD COLUMN last_accessed TEXT`);
    } catch { /* already exists */ }
    try {
      this.db.exec(`ALTER TABLE embeddings ADD COLUMN decay_factor REAL DEFAULT 1.0`);
    } catch { /* already exists */ }

    // Create expires index (safe now that column exists)
    try {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_expires ON embeddings(expires_at)`);
    } catch {
      // Index might already exist
    }

    log.info("Vector store initialized");
  }

  insert(
    text: string,
    embedding: number[],
    source: string,
    sessionKey?: string,
    metadata?: MemoryMetadata
  ) {
    const stmt = this.db.prepare(
      `INSERT INTO embeddings (text, embedding, source, session_key, metadata, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      text,
      JSON.stringify(embedding),
      source,
      sessionKey || null,
      metadata ? JSON.stringify(metadata) : null,
      metadata?.expiresAt || null
    );
  }

  search(queryEmbedding: number[], limit: number = 5): Array<{ text: string; score: number; source: string }> {
    // Cosine similarity search (brute force since sqlite-vec may not be available)
    const rows = this.db.prepare(`SELECT text, embedding, source FROM embeddings WHERE embedding != '[]'`).all() as Array<{
      text: string;
      embedding: string;
      source: string;
    }>;

    if (queryEmbedding.length === 0) {
      return [];
    }

    const results = rows.map((row) => {
      const emb = JSON.parse(row.embedding) as number[];
      const score = cosineSimilarity(queryEmbedding, emb);
      return { text: row.text, score, source: row.source };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  keywordSearch(query: string, limit: number = 5): Array<{ text: string; source: string }> {
    const stmt = this.db.prepare(
      `SELECT text, source FROM embeddings WHERE text LIKE ? LIMIT ?`
    );
    return stmt.all(`%${query}%`, limit) as Array<{ text: string; source: string }>;
  }

  /**
   * Get all documents for BM25 scoring.
   */
  getAllDocuments(): Array<{
    text: string;
    source: string;
    metadata?: Record<string, unknown>;
  }> {
    const stmt = this.db.prepare(`SELECT text, source, metadata FROM embeddings`);
    const rows = stmt.all() as Array<{
      text: string;
      source: string;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      text: row.text,
      source: row.source,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Get memory statistics.
   */
  getStats(): {
    totalMemories: number;
    categories: Record<MemoryCategory, number>;
    dbSizeBytes: number;
  } {
    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM embeddings`).get() as { count: number };

    // Count by category
    const categories: Record<MemoryCategory, number> = {
      conversation: 0,
      fact: 0,
      preference: 0,
      task: 0,
      code: 0,
      document: 0,
      other: 0,
    };

    try {
      const rows = this.db.prepare(`
        SELECT
          json_extract(metadata, '$.category') as category,
          COUNT(*) as count
        FROM embeddings
        WHERE metadata IS NOT NULL
        GROUP BY json_extract(metadata, '$.category')
      `).all() as Array<{ category: string | null; count: number }>;

      for (const row of rows) {
        const cat = row.category as MemoryCategory | null;
        if (cat && cat in categories) {
          categories[cat] = row.count;
        }
      }
    } catch {
      // Older SQLite without json_extract
    }

    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(this.dbPath).size;
    } catch { /* ignore */ }

    return {
      totalMemories: countRow.count,
      categories,
      dbSizeBytes,
    };
  }

  /**
   * Clean up expired memories.
   */
  cleanExpired(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      DELETE FROM embeddings
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `).run(now);
    return result.changes;
  }

  /**
   * Get memories by category.
   */
  getByCategory(category: MemoryCategory, limit: number = 10): Array<{
    text: string;
    source: string;
    createdAt: string;
  }> {
    try {
      const stmt = this.db.prepare(`
        SELECT text, source, created_at
        FROM embeddings
        WHERE json_extract(metadata, '$.category') = ?
        ORDER BY created_at DESC
        LIMIT ?
      `);
      return stmt.all(category, limit) as Array<{
        text: string;
        source: string;
        createdAt: string;
      }>;
    } catch {
      // Fallback for older SQLite
      return [];
    }
  }

  /**
   * Get memories by tag.
   */
  getByTag(tag: string, limit: number = 10): Array<{
    text: string;
    source: string;
    createdAt: string;
  }> {
    try {
      // SQLite doesn't have array contains, so we use LIKE with JSON
      const stmt = this.db.prepare(`
        SELECT text, source, created_at
        FROM embeddings
        WHERE metadata LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
      `);
      return stmt.all(`%"${tag}"%`, limit) as Array<{
        text: string;
        source: string;
        createdAt: string;
      }>;
    } catch {
      return [];
    }
  }

  /**
   * Delete memories by session.
   */
  deleteBySession(sessionKey: string): number {
    const result = this.db.prepare(`DELETE FROM embeddings WHERE session_key = ?`).run(sessionKey);
    return result.changes;
  }

  /**
   * Delete memories by source.
   */
  deleteBySource(source: string): number {
    const result = this.db.prepare(`DELETE FROM embeddings WHERE source = ?`).run(source);
    return result.changes;
  }

  // ── Memory Bank Methods ─────────────────────────────────────────────

  /**
   * Get a single document by ID.
   */
  getById(id: number): StoredDocument | null {
    const row = this.db.prepare(
      `SELECT id, text, embedding, source, session_key, metadata, created_at, access_count, last_accessed, decay_factor
       FROM embeddings WHERE id = ?`
    ).get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      text: row.text,
      embedding: JSON.parse(row.embedding),
      source: row.source,
      sessionKey: row.session_key,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      accessCount: row.access_count ?? 0,
      lastAccessed: row.last_accessed,
      decayFactor: row.decay_factor ?? 1.0,
    };
  }

  /**
   * Increment access count and update last_accessed timestamp.
   */
  incrementAccessCount(id: number): void {
    this.db.prepare(
      `UPDATE embeddings SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?`
    ).run(id);
  }

  /**
   * Update decay factor for a memory.
   */
  updateDecayFactor(id: number, factor: number): void {
    this.db.prepare(
      `UPDATE embeddings SET decay_factor = ? WHERE id = ?`
    ).run(factor, id);
  }

  /**
   * Delete memories by a list of IDs.
   */
  deleteByIds(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const result = this.db.prepare(
      `DELETE FROM embeddings WHERE id IN (${placeholders})`
    ).run(...ids);
    return result.changes;
  }

  /**
   * Find similar documents by cosine similarity above a threshold.
   * Returns pairs of (id, id, similarity) for deduplication.
   */
  findSimilar(threshold: number = 0.9): Array<{ idA: number; idB: number; similarity: number }> {
    const rows = this.db.prepare(
      `SELECT id, embedding FROM embeddings WHERE embedding != '[]'`
    ).all() as Array<{ id: number; embedding: string }>;

    const parsed = rows.map(r => ({
      id: r.id,
      embedding: JSON.parse(r.embedding) as number[],
    }));

    const pairs: Array<{ idA: number; idB: number; similarity: number }> = [];

    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const sim = cosineSimilarity(parsed[i].embedding, parsed[j].embedding);
        if (sim >= threshold) {
          pairs.push({ idA: parsed[i].id, idB: parsed[j].id, similarity: sim });
        }
      }
    }

    return pairs;
  }

  /**
   * Search with full document info (including IDs for reinforcement).
   */
  searchFull(queryEmbedding: number[], limit: number = 5): Array<StoredDocument & { score: number }> {
    const rows = this.db.prepare(
      `SELECT id, text, embedding, source, session_key, metadata, created_at, access_count, last_accessed, decay_factor
       FROM embeddings WHERE embedding != '[]'`
    ).all() as Array<any>;

    if (queryEmbedding.length === 0) return [];

    const results = rows.map((row) => {
      const emb = JSON.parse(row.embedding) as number[];
      const score = cosineSimilarity(queryEmbedding, emb);
      return {
        id: row.id,
        text: row.text,
        embedding: emb,
        source: row.source,
        sessionKey: row.session_key,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: row.created_at,
        accessCount: row.access_count ?? 0,
        lastAccessed: row.last_accessed,
        decayFactor: row.decay_factor ?? 1.0,
        score,
      };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Get all documents with their IDs (for decay processing).
   */
  getAllWithIds(): Array<{
    id: number;
    text: string;
    source: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
    accessCount: number;
    lastAccessed: string | null;
    decayFactor: number;
  }> {
    const rows = this.db.prepare(
      `SELECT id, text, source, metadata, created_at, access_count, last_accessed, decay_factor FROM embeddings`
    ).all() as Array<any>;

    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      source: row.source,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      accessCount: row.access_count ?? 0,
      lastAccessed: row.last_accessed,
      decayFactor: row.decay_factor ?? 1.0,
    }));
  }

  /**
   * Vacuum database to reclaim space.
   */
  vacuum(): void {
    this.db.exec("VACUUM");
  }

  close() {
    this.db.close();
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
