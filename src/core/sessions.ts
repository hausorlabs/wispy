/**
 * Session Manager
 *
 * Manages multiple named agent sessions with isolated context.
 * Each session maintains its own conversation history, system prompt,
 * and model configuration. Supports session switching, persistence,
 * and daily auto-reset.
 *
 * OpenClaw parity: sessions system with named contexts,
 * daily reset, idle window, and session switching.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { resolve } from "path";
import { createLogger } from "../infra/logger.js";

const log = createLogger("sessions");

export interface SessionMessage {
  role: "user" | "model" | "system";
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  name: string;
  instruction?: string;
  model?: string;
  messages: SessionMessage[];
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
  active: boolean;
}

export interface SessionSummary {
  id: string;
  name: string;
  messageCount: number;
  createdAt: string;
  lastActiveAt: string;
  active: boolean;
  uptime: string;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private activeSessionId: string = "default";
  private readonly sessionsDir: string;
  private readonly dailyReset: boolean;
  private readonly resetHour: number;
  private readonly idleWindowMinutes: number;

  constructor(
    runtimeDir: string,
    options?: {
      dailyReset?: boolean;
      resetHour?: number;
      idleWindowMinutes?: number;
    }
  ) {
    this.sessionsDir = resolve(runtimeDir, "sessions");
    this.dailyReset = options?.dailyReset ?? false;
    this.resetHour = options?.resetHour ?? 4; // 4 AM
    this.idleWindowMinutes = options?.idleWindowMinutes ?? 30;

    mkdirSync(this.sessionsDir, { recursive: true });

    // Load persisted sessions
    this.loadPersistedSessions();

    // Ensure default session exists
    if (!this.sessions.has("default")) {
      this.createSession("default");
    }

    // Check daily reset
    if (this.dailyReset) {
      this.checkDailyReset();
    }
  }

  /**
   * Create a new named session.
   */
  createSession(
    name: string,
    instruction?: string,
    model?: string
  ): Session {
    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    if (this.sessions.has(id)) {
      log.warn("Session '%s' already exists, returning existing", name);
      return this.sessions.get(id)!;
    }

    const session: Session = {
      id,
      name,
      instruction,
      model,
      messages: [],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      messageCount: 0,
      active: false,
    };

    this.sessions.set(id, session);
    this.persistSession(session);
    log.info("Created session: %s", name);
    return session;
  }

  /**
   * Switch to a named session.
   */
  switchTo(name: string): Session {
    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const session = this.sessions.get(id);

    if (!session) {
      throw new Error(`Session '${name}' not found. Create it first.`);
    }

    // Deactivate current
    const current = this.sessions.get(this.activeSessionId);
    if (current) {
      current.active = false;
      this.persistSession(current);
    }

    // Activate new
    session.active = true;
    session.lastActiveAt = new Date().toISOString();
    this.activeSessionId = id;
    this.persistSession(session);

    log.info("Switched to session: %s", name);
    return session;
  }

  /**
   * Get the currently active session.
   */
  getActive(): Session {
    return this.sessions.get(this.activeSessionId) ?? this.createSession("default");
  }

  /**
   * Add a message to the active session.
   */
  addMessage(role: "user" | "model" | "system", content: string): void {
    const session = this.getActive();
    session.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    session.messageCount++;
    session.lastActiveAt = new Date().toISOString();

    // Keep message buffer reasonable (last 200 messages)
    if (session.messages.length > 200) {
      session.messages = session.messages.slice(-200);
    }

    this.persistSession(session);
  }

  /**
   * Get recent messages from the active session.
   */
  getMessages(limit: number = 50): SessionMessage[] {
    const session = this.getActive();
    return session.messages.slice(-limit);
  }

  /**
   * List all sessions.
   */
  listSessions(): SessionSummary[] {
    const now = Date.now();
    return Array.from(this.sessions.values()).map((s) => {
      const created = new Date(s.createdAt).getTime();
      const uptimeMs = now - created;
      const hours = Math.floor(uptimeMs / 3600000);
      const minutes = Math.floor((uptimeMs % 3600000) / 60000);

      return {
        id: s.id,
        name: s.name,
        messageCount: s.messageCount,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        active: s.id === this.activeSessionId,
        uptime: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
      };
    });
  }

  /**
   * Clear a session (delete messages, optionally delete entirely).
   */
  clearSession(name: string): boolean {
    if (name === "all") {
      for (const [id] of this.sessions) {
        if (id !== "default") {
          this.deleteSessionFile(id);
          this.sessions.delete(id);
        }
      }
      // Reset default session
      const def = this.sessions.get("default");
      if (def) {
        def.messages = [];
        def.messageCount = 0;
        this.persistSession(def);
      }
      this.activeSessionId = "default";
      log.info("Cleared all sessions");
      return true;
    }

    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const session = this.sessions.get(id);
    if (!session) return false;

    if (id === this.activeSessionId) {
      this.activeSessionId = "default";
    }

    this.deleteSessionFile(id);
    this.sessions.delete(id);
    log.info("Cleared session: %s", name);
    return true;
  }

  // ── Persistence ────────────────────────────────────────────

  private persistSession(session: Session): void {
    try {
      const path = resolve(this.sessionsDir, `${session.id}.json`);
      writeFileSync(path, JSON.stringify(session, null, 2), "utf-8");
    } catch (err) {
      log.warn("Failed to persist session %s: %s", session.id, err);
    }
  }

  private deleteSessionFile(id: string): void {
    try {
      const path = resolve(this.sessionsDir, `${id}.json`);
      if (existsSync(path)) rmSync(path);
    } catch {}
  }

  private loadPersistedSessions(): void {
    try {
      const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const raw = readFileSync(resolve(this.sessionsDir, file), "utf-8");
        const session = JSON.parse(raw) as Session;
        session.active = false; // Reset active on load
        this.sessions.set(session.id, session);
      }
      log.debug("Loaded %d persisted sessions", files.length);
    } catch {
      // First run, no sessions yet
    }
  }

  private checkDailyReset(): void {
    const now = new Date();
    const lastResetKey = resolve(this.sessionsDir, ".last-reset");

    try {
      if (existsSync(lastResetKey)) {
        const lastReset = readFileSync(lastResetKey, "utf-8").trim();
        const lastDate = lastReset.slice(0, 10);
        const today = now.toISOString().slice(0, 10);

        if (lastDate === today) return; // Already reset today
      }

      if (now.getHours() >= this.resetHour) {
        log.info("Daily session reset triggered");
        this.clearSession("all");
        writeFileSync(lastResetKey, now.toISOString(), "utf-8");
      }
    } catch {}
  }
}
