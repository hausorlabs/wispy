/**
 * Wait Strategies -- DOM ready, network idle, selector, custom function waits.
 */

import type { Page } from "playwright-core";
import type { WaitStrategy } from "../types.js";

/**
 * Execute a wait strategy on a page.
 */
export async function executeWait(page: Page, strategy: WaitStrategy): Promise<void> {
  switch (strategy.type) {
    case "domready":
      await page.waitForLoadState("domcontentloaded");
      break;

    case "networkidle":
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
      break;

    case "selector":
      await page.waitForSelector(strategy.value, {
        state: "visible",
        timeout: strategy.timeout ?? 10_000,
      });
      break;

    case "delay":
      await new Promise((resolve) => setTimeout(resolve, strategy.ms));
      break;

    case "function":
      await page.waitForFunction(strategy.expression, {}, {
        timeout: 30_000,
      });
      break;
  }
}

/**
 * Smart wait -- tries multiple strategies in order, succeeds on first one.
 */
export async function smartWait(
  page: Page,
  strategies: WaitStrategy[],
  timeoutMs = 30_000
): Promise<{ strategy: string; elapsed: number }> {
  const start = Date.now();

  for (const strategy of strategies) {
    try {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) break;

      // Apply a per-strategy timeout cap
      const strategyTimeout = Math.min(
        remaining,
        strategy.type === "delay" ? strategy.ms : 10_000
      );

      await Promise.race([
        executeWait(page, strategy),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), strategyTimeout)
        ),
      ]);

      return { strategy: strategy.type, elapsed: Date.now() - start };
    } catch {
      // Try next strategy
      continue;
    }
  }

  // Fallback: just wait for domcontentloaded
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 });
  } catch {
    // Page is ready enough
  }

  return { strategy: "fallback", elapsed: Date.now() - start };
}

/**
 * Wait for page to be fully interactive (no pending network, DOM stable).
 */
export async function waitForPageReady(page: Page, timeout = 15_000): Promise<void> {
  await smartWait(page, [
    { type: "domready" },
    { type: "networkidle" },
    { type: "delay", ms: 500 },
  ], timeout);
}
