/**
 * DOM Processor tests.
 */

import { describe, it, expect, vi } from "vitest";
import { processPage } from "../extraction/dom-processor.js";

describe("processPage", () => {
  it("should return a page snapshot with elements", async () => {
    // Create a mock page with evaluate returning element data
    const mockPage = {
      url: vi.fn(() => "https://example.com"),
      title: vi.fn(() => "Example Page"),
      evaluate: vi.fn(() => [
        {
          tag: "button",
          text: "Submit",
          attributes: { type: "submit" },
          isInteractive: true,
          isVisible: true,
          rect: { x: 100, y: 200, width: 80, height: 30 },
          xpath: "//button[1]",
        },
        {
          tag: "a",
          text: "About Us",
          attributes: { href: "/about" },
          isInteractive: true,
          isVisible: true,
          rect: { x: 50, y: 100, width: 100, height: 20 },
          xpath: "//a[1]",
        },
        {
          tag: "p",
          text: "Welcome to our website",
          attributes: {},
          isInteractive: false,
          isVisible: true,
          rect: { x: 0, y: 50, width: 500, height: 20 },
          xpath: "//p[1]",
        },
      ]),
    };

    const snapshot = await processPage(mockPage as never);

    expect(snapshot.url).toBe("https://example.com");
    expect(snapshot.title).toBe("Example Page");
    expect(snapshot.elements).toHaveLength(3);
    expect(snapshot.interactiveElements).toHaveLength(2);
    expect(snapshot.content).toContain("[0]");
    expect(snapshot.content).toContain("Submit");
    expect(snapshot.content).toContain("About Us");
    expect(snapshot.content).toContain("Welcome to our website");
  });

  it("should handle empty page", async () => {
    const mockPage = {
      url: vi.fn(() => "about:blank"),
      title: vi.fn(() => ""),
      evaluate: vi.fn(() => []),
    };

    const snapshot = await processPage(mockPage as never);
    expect(snapshot.elements).toHaveLength(0);
    expect(snapshot.interactiveElements).toHaveLength(0);
  });
});
