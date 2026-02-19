/**
 * Tab Manager -- multi-tab lifecycle within a browser session.
 *
 * Tracks open tabs, enables switching between them, and provides
 * tab listing with URLs and titles.
 */

import type { Page, BrowserContext } from "playwright-core";

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  isActive: boolean;
}

/**
 * List all open tabs in a browser context.
 */
export async function listTabs(context: BrowserContext, activePage: Page): Promise<TabInfo[]> {
  const pages = context.pages();
  const tabs: TabInfo[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    let title = "";
    try {
      title = await page.title();
    } catch {
      // Page might be closed or loading
    }
    tabs.push({
      index: i,
      url: page.url(),
      title,
      isActive: page === activePage,
    });
  }

  return tabs;
}

/**
 * Open a new tab in the context, optionally navigating to a URL.
 */
export async function openTab(
  context: BrowserContext,
  url?: string
): Promise<{ page: Page; index: number }> {
  const page = await context.newPage();
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  const index = context.pages().indexOf(page);
  return { page, index };
}

/**
 * Switch to a tab by index or URL pattern.
 */
export function switchTab(
  context: BrowserContext,
  target: { index?: number; urlPattern?: string }
): Page | null {
  const pages = context.pages();

  if (target.index !== undefined) {
    if (target.index >= 0 && target.index < pages.length) {
      return pages[target.index];
    }
    return null;
  }

  if (target.urlPattern) {
    try {
      const regex = new RegExp(target.urlPattern, "i");
      return pages.find((p) => regex.test(p.url())) ?? null;
    } catch {
      // Invalid regex, try plain substring match
      return pages.find((p) => p.url().includes(target.urlPattern!)) ?? null;
    }
  }

  return null;
}

/**
 * Close a tab by index. Returns true if closed.
 */
export async function closeTab(
  context: BrowserContext,
  index: number
): Promise<boolean> {
  const pages = context.pages();
  if (index < 0 || index >= pages.length) return false;

  try {
    await pages[index].close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Format tab list for LLM output.
 */
export function formatTabList(tabs: TabInfo[]): string {
  if (tabs.length === 0) return "No open tabs.";

  return tabs
    .map((t) => {
      const active = t.isActive ? " (active)" : "";
      const title = t.title ? ` "${t.title}"` : "";
      return `  [${t.index}] ${t.url}${title}${active}`;
    })
    .join("\n");
}
