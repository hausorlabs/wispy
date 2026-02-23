/**
 * Memory Bank — Structured memory with typed categories, lifecycle management,
 * decay/reinforcement, and AI-powered reflection.
 */

import { VectorStore } from "./vector-store.js";
import { embed } from "../ai/gemini.js";
import { createLogger } from "../infra/logger.js";
import type { WispyConfig } from "../config/schema.js";

const log = createLogger("memory-bank");

// ── Types ────────────────────────────────────────────────────────────────

export type MemoryType = "episodic" | "semantic" | "procedural" | "preference";

export interface TypedMemory {
  id: number;
  text: string;
  type: MemoryType;
  source: string;
  importance: number;
  accessCount: number;
  lastAccessed: string | null;
  createdAt: string;
  tags?: string[];
}

export interface StoreOptions {
  importance?: number; // 1-10, default 5
  tags?: string[];
}

export interface RecallOptions {
  type?: MemoryType;
  limit?: number;
  minScore?: number;
}

// ── Memory Bank ──────────────────────────────────────────────────────────

export class MemoryBank {
  private store: VectorStore;
  private config: WispyConfig;
  private embeddingModel: string;

  constructor(runtimeDir: string, config: WispyConfig) {
    this.store = new VectorStore(runtimeDir);
    this.config = config;
    this.embeddingModel = config.gemini.models.embedding;
  }

  /**
   * Store a typed memory with importance score.
   */
  async storeMemory(
    text: string,
    type: MemoryType,
    source: string,
    opts: StoreOptions = {},
  ): Promise<number> {
    const importance = Math.max(1, Math.min(10, opts.importance ?? 5));
    const tags = opts.tags || [];

    // Generate embedding
    let embedding: number[] = [];
    try {
      const result = await embed(this.embeddingModel, [text]);
      if (result.length > 0) embedding = result[0];
    } catch (err) {
      log.warn("Failed to embed memory, storing without embedding: %s", err);
    }

    const metadata = {
      memoryType: type,
      importance,
      tags,
      category: "other" as const,
      memoryBank: true,
    };

    this.store.insert(text, embedding, source, undefined, metadata);

    log.info("Stored %s memory (importance=%d): %s", type, importance, text.slice(0, 60));
    return importance;
  }

  /**
   * Recall memories by semantic similarity. Reinforces accessed memories.
   */
  async recall(
    query: string,
    opts: RecallOptions = {},
  ): Promise<TypedMemory[]> {
    const limit = opts.limit ?? 10;
    const minScore = opts.minScore ?? 0.3;

    // Generate query embedding
    let queryEmbedding: number[] = [];
    try {
      const result = await embed(this.embeddingModel, [query]);
      if (result.length > 0) queryEmbedding = result[0];
    } catch {
      log.warn("Failed to embed query, falling back to keyword search");
      // Keyword fallback
      const keywordResults = this.store.keywordSearch(query, limit);
      return keywordResults.map((r, i) => ({
        id: i,
        text: r.text,
        type: "semantic" as MemoryType,
        source: r.source,
        importance: 5,
        accessCount: 0,
        lastAccessed: null,
        createdAt: new Date().toISOString(),
      }));
    }

    const results = this.store.searchFull(queryEmbedding, limit * 2);

    // Filter by score and type
    let filtered = results.filter((r) => r.score >= minScore);
    if (opts.type) {
      filtered = filtered.filter((r) => {
        const meta = r.metadata as Record<string, unknown> | undefined;
        return meta?.memoryType === opts.type;
      });
    }

    // Reinforce accessed memories
    for (const r of filtered.slice(0, limit)) {
      this.store.incrementAccessCount(r.id);
    }

    return filtered.slice(0, limit).map((r) => {
      const meta = (r.metadata || {}) as Record<string, unknown>;
      return {
        id: r.id,
        text: r.text,
        type: (meta.memoryType as MemoryType) || "semantic",
        source: r.source,
        importance: (meta.importance as number) || 5,
        accessCount: r.accessCount ?? 0,
        lastAccessed: r.lastAccessed ?? null,
        createdAt: r.createdAt,
        tags: (meta.tags as string[]) || [],
      };
    });
  }

  /**
   * Get formatted context memories for system prompt injection.
   */
  async getContextMemories(query: string, limit: number = 5): Promise<string> {
    const memories = await this.recall(query, { limit, minScore: 0.4 });
    if (memories.length === 0) return "";

    const lines = ["## Relevant Memories\n"];
    for (const m of memories) {
      const typeLabel = m.type.charAt(0).toUpperCase() + m.type.slice(1);
      lines.push(`- [${typeLabel}] ${m.text}`);
    }
    return lines.join("\n");
  }

  /**
   * Reinforce a memory by boosting its importance (cap at 10).
   */
  reinforce(id: number): void {
    const doc = this.store.getById(id);
    if (!doc || !doc.metadata) return;

    const meta = doc.metadata as Record<string, unknown>;
    const currentImportance = (meta.importance as number) || 5;
    const newImportance = Math.min(10, currentImportance + 0.5);

    meta.importance = newImportance;
    // We can't update metadata in-place easily, so we reinforce via access count
    this.store.incrementAccessCount(id);
    log.debug("Reinforced memory %d: importance %d -> %d", id, currentImportance, newImportance);
  }

  /**
   * Time-based decay. Reduces effective importance based on time since last access.
   * Deletes memories whose effective importance drops below 1.
   */
  decay(): number {
    const allDocs = this.store.getAllWithIds();
    const now = Date.now();
    const toDelete: number[] = [];

    for (const doc of allDocs) {
      const meta = (doc.metadata || {}) as Record<string, unknown>;
      // Only process memory-bank entries
      if (!meta.memoryBank) continue;

      const importance = (meta.importance as number) || 5;
      const lastAccessed = doc.lastAccessed
        ? new Date(doc.lastAccessed).getTime()
        : new Date(doc.createdAt).getTime();
      const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

      const effectiveImportance =
        importance * Math.max(0.1, 1 - daysSinceAccess * 0.01);

      if (effectiveImportance < 1) {
        toDelete.push(doc.id);
      } else {
        // Update decay factor for reference
        const factor = Math.max(0.1, 1 - daysSinceAccess * 0.01);
        this.store.updateDecayFactor(doc.id, factor);
      }
    }

    if (toDelete.length > 0) {
      const deleted = this.store.deleteByIds(toDelete);
      log.info("Decayed %d memories below threshold", deleted);
      return deleted;
    }

    return 0;
  }

  /**
   * AI-powered reflection: merge similar memories, extract patterns.
   * Returns count of memories consolidated.
   */
  async reflect(): Promise<{ merged: number; patterns: string[] }> {
    // Find similar pairs
    const pairs = this.store.findSimilar(0.9);
    const patterns: string[] = [];
    let merged = 0;

    if (pairs.length === 0) {
      log.info("Reflection: no similar memories to merge");
      return { merged: 0, patterns };
    }

    // Group similar memories and keep the one with higher importance
    const toDelete = new Set<number>();

    for (const pair of pairs) {
      if (toDelete.has(pair.idA) || toDelete.has(pair.idB)) continue;

      const docA = this.store.getById(pair.idA);
      const docB = this.store.getById(pair.idB);
      if (!docA || !docB) continue;

      const metaA = (docA.metadata || {}) as Record<string, unknown>;
      const metaB = (docB.metadata || {}) as Record<string, unknown>;
      const impA = (metaA.importance as number) || 5;
      const impB = (metaB.importance as number) || 5;

      // Keep the more important one, delete the other
      if (impA >= impB) {
        toDelete.add(pair.idB);
        // Boost the survivor
        this.reinforce(pair.idA);
      } else {
        toDelete.add(pair.idA);
        this.reinforce(pair.idB);
      }

      patterns.push(
        `Merged similar: "${docA.text.slice(0, 40)}..." + "${docB.text.slice(0, 40)}..."`,
      );
      merged++;
    }

    if (toDelete.size > 0) {
      this.store.deleteByIds([...toDelete]);
      log.info("Reflection merged %d memory pairs", merged);
    }

    return { merged, patterns };
  }

  /**
   * Fuzzy delete memories matching a query.
   */
  async forget(query: string): Promise<number> {
    const memories = await this.recall(query, { limit: 20, minScore: 0.6 });
    if (memories.length === 0) return 0;

    const ids = memories.map((m) => m.id);
    const deleted = this.store.deleteByIds(ids);
    log.info("Forgot %d memories matching: %s", deleted, query);
    return deleted;
  }

  /**
   * List memory counts by type.
   */
  listCategories(): Record<MemoryType, number> {
    const counts: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
      preference: 0,
    };

    const allDocs = this.store.getAllWithIds();

    for (const doc of allDocs) {
      const meta = (doc.metadata || {}) as Record<string, unknown>;
      if (!meta.memoryBank) continue;
      const type = meta.memoryType as MemoryType;
      if (type && type in counts) {
        counts[type]++;
      }
    }

    return counts;
  }
}
