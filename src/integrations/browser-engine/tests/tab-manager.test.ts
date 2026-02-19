/**
 * Tab Manager tests.
 */

import { describe, it, expect, vi } from "vitest";
import { listTabs, switchTab, formatTabList } from "../core/tab-manager.js";
import type { BrowserContext, Page } from "playwright-core";

function createMockPage(url: string, title: string): Page {
  return {
    url: vi.fn(() => url),
    title: vi.fn(async () => title),
    close: vi.fn(),
  } as unknown as Page;
}

function createMockContext(pages: Page[]): BrowserContext {
  return {
    pages: vi.fn(() => pages),
    newPage: vi.fn(async () => createMockPage("about:blank", "")),
  } as unknown as BrowserContext;
}

describe("listTabs", () => {
  it("should list all tabs with active indicator", async () => {
    const page1 = createMockPage("https://google.com", "Google");
    const page2 = createMockPage("https://github.com", "GitHub");
    const context = createMockContext([page1, page2]);

    const tabs = await listTabs(context, page2);

    expect(tabs).toHaveLength(2);
    expect(tabs[0].isActive).toBe(false);
    expect(tabs[0].url).toBe("https://google.com");
    expect(tabs[1].isActive).toBe(true);
    expect(tabs[1].url).toBe("https://github.com");
  });

  it("should handle empty tab list", async () => {
    const context = createMockContext([]);
    const dummyPage = createMockPage("", "");
    const tabs = await listTabs(context, dummyPage);
    expect(tabs).toHaveLength(0);
  });
});

describe("switchTab", () => {
  it("should switch by index", () => {
    const page1 = createMockPage("https://google.com", "Google");
    const page2 = createMockPage("https://github.com", "GitHub");
    const context = createMockContext([page1, page2]);

    expect(switchTab(context, { index: 0 })).toBe(page1);
    expect(switchTab(context, { index: 1 })).toBe(page2);
    expect(switchTab(context, { index: 5 })).toBeNull();
  });

  it("should switch by URL pattern", () => {
    const page1 = createMockPage("https://google.com", "Google");
    const page2 = createMockPage("https://github.com", "GitHub");
    const context = createMockContext([page1, page2]);

    expect(switchTab(context, { urlPattern: "github" })).toBe(page2);
    expect(switchTab(context, { urlPattern: "google" })).toBe(page1);
    expect(switchTab(context, { urlPattern: "nonexistent" })).toBeNull();
  });

  it("should handle regex URL pattern", () => {
    const page1 = createMockPage("https://example.com/page/123", "Example");
    const context = createMockContext([page1]);

    expect(switchTab(context, { urlPattern: "page/\\d+" })).toBe(page1);
  });
});

describe("formatTabList", () => {
  it("should format tabs with active indicator", () => {
    const result = formatTabList([
      { index: 0, url: "https://google.com", title: "Google", isActive: false },
      { index: 1, url: "https://github.com", title: "GitHub", isActive: true },
    ]);

    expect(result).toContain("[0]");
    expect(result).toContain("[1]");
    expect(result).toContain("(active)");
    expect(result).toContain("GitHub");
  });

  it("should handle no tabs", () => {
    expect(formatTabList([])).toBe("No open tabs.");
  });
});
