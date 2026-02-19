/**
 * Profile Store -- SQLite-backed persistent browser profiles.
 *
 * Stores cookies, localStorage, user agent, viewport per profile.
 * Reuses existing better-sqlite3 dependency.
 */

import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import path from "node:path";
import type { BrowserProfile, SerializedCookie } from "../types.js";
import { DEFAULTS } from "../config.js";

export class ProfileStore {
  private db: Database.Database;

  constructor(runtimeDir: string) {
    const dbPath = path.join(runtimeDir, DEFAULTS.profileDbName);
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cookies TEXT NOT NULL DEFAULT '[]',
        local_storage TEXT NOT NULL DEFAULT '{}',
        user_agent TEXT,
        viewport_width INTEGER,
        viewport_height INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /** Create a new profile */
  create(name: string, data?: Partial<BrowserProfile>): BrowserProfile {
    const now = Date.now();
    const profile: BrowserProfile = {
      id: nanoid(12),
      name,
      cookies: data?.cookies ?? [],
      localStorage: data?.localStorage ?? {},
      userAgent: data?.userAgent,
      viewport: data?.viewport,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO profiles (id, name, cookies, local_storage, user_agent, viewport_width, viewport_height, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.id,
        profile.name,
        JSON.stringify(profile.cookies),
        JSON.stringify(profile.localStorage),
        profile.userAgent ?? null,
        profile.viewport?.width ?? null,
        profile.viewport?.height ?? null,
        profile.createdAt,
        profile.updatedAt
      );

    return profile;
  }

  /** Get a profile by ID */
  get(id: string): BrowserProfile | null {
    const row = this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | undefined;
    if (!row) return null;
    return this.rowToProfile(row);
  }

  /** List all profiles */
  list(): BrowserProfile[] {
    const rows = this.db.prepare("SELECT * FROM profiles ORDER BY updated_at DESC").all() as ProfileRow[];
    return rows.map((r) => this.rowToProfile(r));
  }

  /** Update profile cookies and localStorage */
  update(
    id: string,
    data: {
      cookies?: SerializedCookie[];
      localStorage?: Record<string, Record<string, string>>;
      userAgent?: string;
    }
  ): boolean {
    const profile = this.get(id);
    if (!profile) return false;

    const cookies = data.cookies ?? profile.cookies;
    const storage = data.localStorage ?? profile.localStorage;
    const ua = data.userAgent ?? profile.userAgent;

    this.db
      .prepare(
        `UPDATE profiles SET cookies = ?, local_storage = ?, user_agent = ?, updated_at = ? WHERE id = ?`
      )
      .run(JSON.stringify(cookies), JSON.stringify(storage), ua ?? null, Date.now(), id);

    return true;
  }

  /** Delete a profile */
  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** Close the database */
  close(): void {
    this.db.close();
  }

  private rowToProfile(row: ProfileRow): BrowserProfile {
    return {
      id: row.id,
      name: row.name,
      cookies: JSON.parse(row.cookies) as SerializedCookie[],
      localStorage: JSON.parse(row.local_storage) as Record<string, Record<string, string>>,
      userAgent: row.user_agent ?? undefined,
      viewport:
        row.viewport_width && row.viewport_height
          ? { width: row.viewport_width, height: row.viewport_height }
          : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface ProfileRow {
  id: string;
  name: string;
  cookies: string;
  local_storage: string;
  user_agent: string | null;
  viewport_width: number | null;
  viewport_height: number | null;
  created_at: number;
  updated_at: number;
}
