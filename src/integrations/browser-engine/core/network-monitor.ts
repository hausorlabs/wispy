/**
 * Network Monitor -- request interception, API call discovery, response capture.
 */

import type { Page, Request, Response } from "playwright-core";
import type { CapturedRequest, NetworkFilter } from "../types.js";
import { API_CONTENT_TYPES, NETWORK_IGNORE_PATTERNS, DEFAULTS } from "../config.js";

export interface NetworkMonitorConfig {
  maxEntries?: number;
  /** Max response body size to capture in bytes (default: 50KB). */
  maxBodySize?: number;
  /** Capture response body for non-API requests too (default: false). */
  captureAllBodies?: boolean;
}

export class NetworkMonitor {
  private log: CapturedRequest[] = [];
  private maxEntries: number;
  private maxBodySize: number;
  private captureAllBodies: boolean;

  constructor(config?: NetworkMonitorConfig) {
    this.maxEntries = config?.maxEntries ?? DEFAULTS.maxNetworkLog;
    this.maxBodySize = config?.maxBodySize ?? 50_000;
    this.captureAllBodies = config?.captureAllBodies ?? false;
  }

  /** Attach listeners to a page */
  attach(page: Page): void {
    page.on("response", async (response: Response) => {
      const request = response.request();

      // Skip ignored patterns
      const url = request.url();
      if (NETWORK_IGNORE_PATTERNS.some((p) => p.test(url))) return;

      const contentType = response.headers()["content-type"] ?? "";
      const isApi = API_CONTENT_TYPES.some((t) => contentType.includes(t));

      const entry: CapturedRequest = {
        url,
        method: request.method(),
        status: response.status(),
        contentType,
        requestHeaders: request.headers(),
        responseHeaders: response.headers(),
        timestamp: Date.now(),
        isApi,
      };

      // Capture response body for API calls (or all if configured)
      if (isApi || this.captureAllBodies) {
        try {
          const body = await response.text();
          if (body.length <= this.maxBodySize) {
            entry.responseBody = body;
          } else {
            // Truncate large responses but still capture partial data
            entry.responseBody = body.substring(0, this.maxBodySize) + `\n... [truncated, ${body.length} bytes total]`;
          }
        } catch {
          // Response body might not be available
        }
      }

      // Capture POST request body
      if (request.method() === "POST") {
        entry.body = request.postData() ?? undefined;
      }

      this.log.push(entry);

      // Trim log if over limit
      if (this.log.length > this.maxEntries) {
        this.log = this.log.slice(-this.maxEntries);
      }
    });
  }

  /** Get captured requests with optional filters */
  getRequests(filter?: NetworkFilter): CapturedRequest[] {
    let results = [...this.log];

    if (filter?.apiOnly) {
      results = results.filter((r) => r.isApi);
    }

    if (filter?.urlPattern) {
      const re = new RegExp(filter.urlPattern, "i");
      results = results.filter((r) => re.test(r.url));
    }

    if (filter?.method) {
      const m = filter.method.toUpperCase();
      results = results.filter((r) => r.method === m);
    }

    if (filter?.contentType) {
      results = results.filter((r) => r.contentType?.includes(filter.contentType!));
    }

    if (filter?.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /** Get discovered API endpoints (unique URL+method combos) */
  getDiscoveredApis(): { method: string; url: string; count: number }[] {
    const apiMap = new Map<string, { method: string; url: string; count: number }>();

    for (const req of this.log) {
      if (!req.isApi) continue;
      // Normalize URL by removing query params
      const baseUrl = req.url.split("?")[0];
      const key = `${req.method}:${baseUrl}`;
      const existing = apiMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        apiMap.set(key, { method: req.method, url: baseUrl, count: 1 });
      }
    }

    return [...apiMap.values()].sort((a, b) => b.count - a.count);
  }

  /** Get network stats summary. */
  getStats(): {
    total: number;
    apiCalls: number;
    methods: Record<string, number>;
    statusCodes: Record<string, number>;
    topDomains: { domain: string; count: number }[];
  } {
    const methods: Record<string, number> = {};
    const statusCodes: Record<string, number> = {};
    const domains: Record<string, number> = {};
    let apiCalls = 0;

    for (const req of this.log) {
      methods[req.method] = (methods[req.method] ?? 0) + 1;
      if (req.status) {
        const group = `${Math.floor(req.status / 100)}xx`;
        statusCodes[group] = (statusCodes[group] ?? 0) + 1;
      }
      if (req.isApi) apiCalls++;

      try {
        const domain = new URL(req.url).hostname;
        domains[domain] = (domains[domain] ?? 0) + 1;
      } catch {
        // Invalid URL
      }
    }

    const topDomains = Object.entries(domains)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total: this.log.length,
      apiCalls,
      methods,
      statusCodes,
      topDomains,
    };
  }

  /** Clear the log */
  clear(): void {
    this.log = [];
  }

  get size(): number {
    return this.log.length;
  }
}
