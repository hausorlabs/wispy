/**
 * Proxy Manager -- HTTP/SOCKS5 proxy pool with rotation and health tracking.
 */

import type { ProxyConfig, ProxyEntry } from "../types.js";

export class ProxyManager {
  private proxies: ProxyEntry[] = [];
  private currentIndex = 0;

  /** Add a proxy to the pool */
  addProxy(server: string, opts?: { username?: string; password?: string }): void {
    const protocol = server.startsWith("socks5")
      ? "socks5"
      : server.startsWith("https")
        ? "https"
        : "http";

    this.proxies.push({
      server,
      username: opts?.username,
      password: opts?.password,
      protocol: protocol as ProxyEntry["protocol"],
      failCount: 0,
      lastUsed: 0,
    });
  }

  /** Add multiple proxies from a list of server strings */
  addProxies(servers: string[]): void {
    for (const s of servers) {
      // Format: protocol://user:pass@host:port or protocol://host:port
      const url = new URL(s);
      this.addProxy(`${url.protocol}//${url.hostname}:${url.port}`, {
        username: url.username || undefined,
        password: url.password || undefined,
      });
    }
  }

  /** Get the next proxy in rotation (round-robin, skipping failed) */
  getNext(): ProxyConfig | null {
    if (this.proxies.length === 0) return null;

    const maxAttempts = this.proxies.length;
    for (let i = 0; i < maxAttempts; i++) {
      const idx = (this.currentIndex + i) % this.proxies.length;
      const entry = this.proxies[idx];

      // Skip proxies that have failed 5+ times recently
      if (entry.failCount >= 5) continue;

      this.currentIndex = (idx + 1) % this.proxies.length;
      entry.lastUsed = Date.now();

      return {
        server: entry.server,
        username: entry.username,
        password: entry.password,
      };
    }

    // All proxies are failing -- reset fail counts and try again
    for (const p of this.proxies) p.failCount = 0;
    return this.proxies.length > 0
      ? { server: this.proxies[0].server, username: this.proxies[0].username, password: this.proxies[0].password }
      : null;
  }

  /** Mark a proxy as failed */
  markFailed(server: string): void {
    const entry = this.proxies.find((p) => p.server === server);
    if (entry) entry.failCount++;
  }

  /** Mark a proxy as successful (resets fail count) */
  markSuccess(server: string): void {
    const entry = this.proxies.find((p) => p.server === server);
    if (entry) entry.failCount = 0;
  }

  /** Get pool statistics */
  getStats(): { total: number; healthy: number; failed: number } {
    const failed = this.proxies.filter((p) => p.failCount >= 5).length;
    return {
      total: this.proxies.length,
      healthy: this.proxies.length - failed,
      failed,
    };
  }

  /** Remove all proxies */
  clear(): void {
    this.proxies = [];
    this.currentIndex = 0;
  }

  get size(): number {
    return this.proxies.length;
  }
}
