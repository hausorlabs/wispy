/**
 * Session Manager -- multi-session browser lifecycle management.
 *
 * Handles session creation (headless/headed, stealth, proxy, profiles),
 * session tracking, auto-cleanup, and resource management.
 */

import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { nanoid } from "nanoid";
import type { BrowserSession, SessionConfig, SessionInfo } from "../types.js";
import { DEFAULTS, USER_AGENTS } from "../config.js";
import { applyStealthPatches } from "./stealth-engine.js";
import { ProxyManager } from "./proxy-manager.js";
import { NetworkMonitor } from "./network-monitor.js";
import { ProfileStore } from "../profiles/profile-store.js";
import { exportCookies, importCookies, exportLocalStorage, importLocalStorage } from "../profiles/cookie-jar.js";

export class SessionManager {
  private sessions = new Map<string, BrowserSession>();
  private proxyManager = new ProxyManager();
  private profileStore: ProfileStore;
  private defaultSessionId: string | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(runtimeDir: string) {
    this.profileStore = new ProfileStore(runtimeDir);
    // Start idle cleanup timer (check every 60s)
    this.cleanupTimer = setInterval(() => this.cleanupIdleSessions(), 60_000);
  }

  /** Close sessions that have been idle longer than the timeout. */
  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const idleIds: string[] = [];

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > DEFAULTS.sessionIdleTimeout) {
        idleIds.push(id);
      }
    }

    for (const id of idleIds) {
      try {
        await this.closeSession(id);
      } catch {
        // Best-effort cleanup
        this.sessions.delete(id);
      }
    }
  }

  /** Create a new browser session */
  async createSession(config: SessionConfig = {}): Promise<BrowserSession> {
    if (this.sessions.size >= DEFAULTS.maxSessions) {
      // Close oldest idle session
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastActivity - b.lastActivity)[0];
      if (oldest) await this.closeSession(oldest.id);
    }

    const id = nanoid(8);
    const mergedConfig: SessionConfig = {
      headless: config.headless ?? DEFAULTS.headless,
      stealth: config.stealth ?? DEFAULTS.stealth,
      viewport: config.viewport ?? DEFAULTS.viewport,
      timeout: config.timeout ?? DEFAULTS.timeout,
      ...config,
    };

    let browser: Browser;
    if (mergedConfig.cdpUrl) {
      browser = await chromium.connectOverCDP(mergedConfig.cdpUrl);
    } else {
      const launchArgs = [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ];

      browser = await chromium.launch({
        headless: mergedConfig.headless,
        args: launchArgs,
      });
    }

    // Build context options
    const contextOpts: Record<string, unknown> = {
      viewport: mergedConfig.viewport,
      userAgent: mergedConfig.userAgent ?? USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      locale: mergedConfig.locale ?? "en-US",
      timezoneId: mergedConfig.timezone ?? "America/New_York",
      ignoreHTTPSErrors: true,
    };

    // Add proxy if configured
    const proxy = mergedConfig.proxy ?? this.proxyManager.getNext();
    if (proxy) {
      contextOpts.proxy = {
        server: proxy.server,
        username: proxy.username,
        password: proxy.password,
      };
    }

    const context: BrowserContext = await browser.newContext(contextOpts);

    // Apply stealth patches
    if (mergedConfig.stealth) {
      await applyStealthPatches(context, {
        userAgent: contextOpts.userAgent as string,
        timezone: mergedConfig.timezone,
        locale: mergedConfig.locale,
      });
    }

    // Load profile if specified (cookies + localStorage)
    if (mergedConfig.profileId) {
      const profile = this.profileStore.get(mergedConfig.profileId);
      if (profile) {
        await importCookies(context, profile.cookies);
        if (Object.keys(profile.localStorage).length > 0) {
          await importLocalStorage(context, profile.localStorage);
        }
      }
    }

    // Set default timeouts
    context.setDefaultTimeout(mergedConfig.timeout ?? DEFAULTS.timeout);
    context.setDefaultNavigationTimeout(DEFAULTS.navigationTimeout);

    const page: Page = await context.newPage();

    // Attach network monitor
    const networkMonitor = new NetworkMonitor();
    networkMonitor.attach(page);

    const session: BrowserSession = {
      id,
      browser,
      context,
      page,
      config: mergedConfig,
      profileId: mergedConfig.profileId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      networkLog: [],
    };

    // Store reference to network monitor on the session
    (session as SessionWithMonitor)._networkMonitor = networkMonitor;

    this.sessions.set(id, session);

    // Set as default if first session
    if (!this.defaultSessionId) {
      this.defaultSessionId = id;
    }

    return session;
  }

  /** Get a session by ID, or the default session */
  getSession(id?: string): BrowserSession | null {
    if (id) return this.sessions.get(id) ?? null;
    if (this.defaultSessionId) return this.sessions.get(this.defaultSessionId) ?? null;
    return null;
  }

  /** Get or auto-create default session */
  async getOrCreateSession(config?: SessionConfig): Promise<BrowserSession> {
    const existing = this.getSession();
    if (existing) {
      existing.lastActivity = Date.now();
      return existing;
    }
    return this.createSession(config);
  }

  /** Get the active page for a session (handles navigation to new tabs) */
  getActivePage(session: BrowserSession): Page {
    const pages = session.context.pages();
    if (pages.length === 0) return session.page;
    // Return the last active page
    return pages[pages.length - 1];
  }

  /** List all active sessions */
  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      url: s.page.url(),
      title: "",
      profileId: s.profileId,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }));
  }

  /** Close a session, optionally saving its profile */
  async closeSession(id: string, saveProfile?: boolean): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    // Save profile if requested
    if (saveProfile && session.profileId) {
      const cookies = await exportCookies(session.context);
      const localStorage = await exportLocalStorage(session.context);
      this.profileStore.update(session.profileId, { cookies, localStorage });
    }

    try {
      await session.context.close();
    } catch {
      // Context might already be closed
    }

    try {
      await session.browser.close();
    } catch {
      // Browser might already be closed
    }

    this.sessions.delete(id);

    if (this.defaultSessionId === id) {
      this.defaultSessionId = this.sessions.size > 0 ? [...this.sessions.keys()][0] : null;
    }
  }

  /** Close all sessions */
  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }

  /** Get network monitor for a session */
  getNetworkMonitor(session: BrowserSession): NetworkMonitor {
    return (session as SessionWithMonitor)._networkMonitor;
  }

  /** Get the profile store */
  getProfileStore(): ProfileStore {
    return this.profileStore;
  }

  /** Get proxy manager */
  getProxyManager(): ProxyManager {
    return this.proxyManager;
  }

  /** Cleanup resources */
  async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.closeAll();
    this.profileStore.close();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}

/** Internal type to attach network monitor to session */
interface SessionWithMonitor extends BrowserSession {
  _networkMonitor: NetworkMonitor;
}
