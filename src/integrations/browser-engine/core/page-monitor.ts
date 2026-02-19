/**
 * Page Monitor -- watch for DOM changes, content updates, and element appearance.
 *
 * Enables reactive automations: wait for order status changes, monitor live feeds,
 * detect when content loads dynamically.
 */

import type { Page } from "playwright-core";

export interface MonitorConfig {
  /** CSS selector to watch (default: body). */
  selector?: string;
  /** What to watch: "content" (text changes), "attributes", "children" (new/removed nodes), "all". */
  watch?: "content" | "attributes" | "children" | "all";
  /** Poll interval in ms for polling-based detection (default: 2000). */
  interval?: number;
}

export interface DOMChange {
  type: "content" | "attribute" | "childAdded" | "childRemoved";
  selector: string;
  oldValue?: string;
  newValue?: string;
  timestamp: number;
}

export interface MonitorSnapshot {
  text: string;
  html: string;
  childCount: number;
  timestamp: number;
}

/**
 * Take a snapshot of the monitored element's current state.
 */
export async function takeMonitorSnapshot(
  page: Page,
  selector = "body"
): Promise<MonitorSnapshot> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return { text: "", html: "", childCount: 0, timestamp: Date.now() };

    return {
      text: (el as HTMLElement).innerText?.trim()?.substring(0, 50_000) ?? "",
      html: el.innerHTML.substring(0, 10_000),
      childCount: el.children.length,
      timestamp: Date.now(),
    };
  }, selector);
}

/**
 * Compare two snapshots and return the differences.
 */
export function diffSnapshots(
  before: MonitorSnapshot,
  after: MonitorSnapshot,
  selector: string
): DOMChange[] {
  const changes: DOMChange[] = [];

  if (before.text !== after.text) {
    changes.push({
      type: "content",
      selector,
      oldValue: before.text.substring(0, 500),
      newValue: after.text.substring(0, 500),
      timestamp: after.timestamp,
    });
  }

  if (before.childCount !== after.childCount) {
    const type = after.childCount > before.childCount ? "childAdded" : "childRemoved";
    changes.push({
      type,
      selector,
      oldValue: `${before.childCount} children`,
      newValue: `${after.childCount} children`,
      timestamp: after.timestamp,
    });
  }

  return changes;
}

/**
 * Wait for a specific element to appear on the page.
 */
export async function waitForElement(
  page: Page,
  selector: string,
  timeout = 30_000
): Promise<{ found: boolean; elapsed: number }> {
  const start = Date.now();

  try {
    await page.waitForSelector(selector, { state: "visible", timeout });
    return { found: true, elapsed: Date.now() - start };
  } catch {
    return { found: false, elapsed: Date.now() - start };
  }
}

/**
 * Wait for text content to change within a selector.
 */
export async function waitForContentChange(
  page: Page,
  selector: string,
  currentText: string,
  timeout = 30_000,
  pollInterval = 2_000
): Promise<{ changed: boolean; newText?: string; elapsed: number }> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const snapshot = await takeMonitorSnapshot(page, selector);

    if (snapshot.text !== currentText) {
      return {
        changed: true,
        newText: snapshot.text,
        elapsed: Date.now() - start,
      };
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  return { changed: false, elapsed: Date.now() - start };
}

/**
 * Watch for any DOM changes using polling.
 * Returns changes detected since the baseline snapshot.
 */
export async function pollForChanges(
  page: Page,
  baseline: MonitorSnapshot,
  selector = "body"
): Promise<DOMChange[]> {
  const current = await takeMonitorSnapshot(page, selector);
  return diffSnapshots(baseline, current, selector);
}

/**
 * Format DOM changes for LLM output.
 */
export function formatChanges(changes: DOMChange[]): string {
  if (changes.length === 0) return "No changes detected.";

  return changes
    .map((c) => {
      switch (c.type) {
        case "content":
          return `Content changed in ${c.selector}:\n  Before: "${c.oldValue?.substring(0, 200)}"\n  After: "${c.newValue?.substring(0, 200)}"`;
        case "childAdded":
          return `New children added in ${c.selector}: ${c.oldValue} -> ${c.newValue}`;
        case "childRemoved":
          return `Children removed in ${c.selector}: ${c.oldValue} -> ${c.newValue}`;
        case "attribute":
          return `Attribute changed on ${c.selector}: "${c.oldValue}" -> "${c.newValue}"`;
        default:
          return `Change in ${c.selector}: ${c.type}`;
      }
    })
    .join("\n\n");
}
