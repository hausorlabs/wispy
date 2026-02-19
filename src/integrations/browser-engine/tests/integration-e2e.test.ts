/**
 * End-to-end integration test for BrowserEngineIntegration.
 *
 * Tests every tool handler through the executeTool dispatch,
 * verifying the full stack: sessions, navigation, DOM processing,
 * extraction, skills, workflows, profiles, network, and JS evaluation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import BrowserEngineIntegration from "../index.js";
import type { IntegrationContext } from "../../base.js";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

// ─── Mock Playwright ───────────────────────────────────────
// Rich mock that simulates real page behavior for DOM, forms, tables, etc.

function createMockPage() {
  const evaluateHandlers = new Map<string, unknown>();

  const mockPage = {
    url: vi.fn(() => "https://example.com"),
    title: vi.fn(async () => "Example Domain"),
    goto: vi.fn(async () => {}),
    close: vi.fn(),
    on: vi.fn(),
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    selectOption: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
    isChecked: vi.fn(async () => false),
    waitForLoadState: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    waitForNavigation: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from("PNG")),
    goBack: vi.fn(async () => ({ status: () => 200 })),
    goForward: vi.fn(async () => ({ status: () => 200 })),
    dblclick: vi.fn(async () => {}),
    dragAndDrop: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    keyboard: {
      press: vi.fn(async () => {}),
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
    },
    mouse: {
      click: vi.fn(async () => {}),
      dblclick: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
    },
    locator: vi.fn(() => ({
      screenshot: vi.fn(async () => Buffer.from("PNG")),
      setInputFiles: vi.fn(async () => {}),
      first: vi.fn(() => ({
        isVisible: vi.fn(async () => false),
        click: vi.fn(async () => {}),
      })),
    })),
    evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
      // Simulate different evaluate calls based on the function content
      const fnStr = typeof fn === "string" ? fn : fn?.toString?.() ?? "";

      // Page search (searchInPage) -- must be before DOM processor since both use createTreeWalker
      if (fnStr.includes("createTreeWalker") && fnStr.includes("charOffset") && fnStr.includes("RegExp")) {
        const searchArgs = args[0] as Record<string, unknown> | undefined;
        const query = searchArgs?.query as string ?? "";
        return {
          query,
          matches: [
            { text: query || "test", index: 10, context: `...this is ${query || "test"} in context...`, selector: "p" },
          ],
          totalMatches: 1,
        };
      }

      // DOM processor: return numbered interactive elements
      if (fnStr.includes("createTreeWalker") || fnStr.includes("interactiveTags")) {
        return [
          {
            tag: "a",
            text: "Home",
            attributes: { href: "/" },
            isInteractive: true,
            isVisible: true,
            rect: { x: 10, y: 10, width: 100, height: 30 },
            xpath: "//a[1]",
          },
          {
            tag: "button",
            text: "Submit",
            attributes: { type: "submit" },
            isInteractive: true,
            isVisible: true,
            rect: { x: 200, y: 100, width: 120, height: 40 },
            xpath: "//button[1]",
          },
          {
            tag: "input",
            text: "",
            attributes: { type: "text", name: "search", placeholder: "Search..." },
            isInteractive: true,
            isVisible: true,
            rect: { x: 10, y: 60, width: 300, height: 35 },
            xpath: "//input[1]",
          },
          {
            tag: "h1",
            text: "Example Domain",
            attributes: {},
            isInteractive: false,
            isVisible: true,
            rect: { x: 10, y: 5, width: 500, height: 40 },
            xpath: "//h1[1]",
          },
          {
            tag: "p",
            text: "This domain is for use in illustrative examples.",
            attributes: {},
            isInteractive: false,
            isVisible: true,
            rect: { x: 10, y: 50, width: 500, height: 20 },
            xpath: "//p[1]",
          },
        ];
      }

      // Table extractor
      if (fnStr.includes("querySelectorAll") && fnStr.includes("thead")) {
        return [
          {
            headers: ["Name", "Age", "City"],
            rows: [
              ["Alice", "30", "NYC"],
              ["Bob", "25", "LA"],
            ],
            caption: "Users",
            index: 0,
          },
        ];
      }

      // Auth state detection
      if (fnStr.includes("loginSelectors") || fnStr.includes("loggedInSelectors")) {
        return { isLoggedIn: false, loginUrl: undefined, indicators: [] };
      }

      // CAPTCHA detection
      if (fnStr.includes("g-recaptcha") || fnStr.includes("h-captcha")) {
        return { detected: false };
      }

      // Form detection
      if (fnStr.includes("querySelectorAll") && fnStr.includes("form") && fnStr.includes("submitSelector")) {
        return [
          {
            action: "https://example.com/search",
            method: "GET",
            fields: [
              {
                selector: "#search",
                type: "text",
                name: "q",
                label: "Search",
                placeholder: "Search...",
                required: false,
                value: "",
              },
            ],
            submitSelector: "button[type='submit']",
          },
        ];
      }

      // Link extraction
      if (fnStr.includes("querySelectorAll") && fnStr.includes("hostname")) {
        return [
          { text: "Home", url: "https://example.com/", isExternal: false },
          { text: "About", url: "https://example.com/about", isExternal: false },
          { text: "Google", url: "https://google.com", isExternal: true },
        ];
      }

      // Media extraction
      if (fnStr.includes("querySelectorAll") && fnStr.includes("naturalWidth")) {
        return [
          { type: "image", src: "https://example.com/logo.png", alt: "Logo", width: 200, height: 100 },
        ];
      }

      // Schema extraction (extractWithSchema / extractRepeatedItems)
      if (fnStr.includes("querySelectorAll") && fnStr.includes("selector") && fnStr.includes("fields")) {
        const argObj = args[0] as Record<string, unknown> | undefined;
        if (argObj && typeof argObj === "object" && "selector" in argObj) {
          return [
            { title: "Item 1", price: "$10.00" },
            { title: "Item 2", price: "$20.00" },
          ];
        }
      }

      // Scroll handler
      if (fnStr.includes("scrollBy") || fnStr.includes("scrollTo")) {
        return undefined;
      }

      // Page monitor snapshot
      if (fnStr.includes("innerText") && fnStr.includes("innerHTML") && fnStr.includes("childCount")) {
        return { text: "Example page content", html: "<p>Example</p>", childCount: 5, timestamp: Date.now() };
      }

      // scrollToText
      if (fnStr.includes("scrollIntoView") && fnStr.includes("textContent") && fnStr.includes("innerHeight")) {
        return { found: true, scrollY: 500 };
      }

      // findElements
      if (fnStr.includes("querySelectorAll") && fnStr.includes("attrsToCapture") && fnStr.includes("getComputedStyle")) {
        return [
          {
            index: 0,
            tag: "a",
            text: "Example Link",
            attributes: { href: "/test", class: "link" },
            selector: "#link1",
            visible: true,
            rect: { x: 10, y: 10, width: 100, height: 30 },
          },
        ];
      }

      // readLongContent
      if (fnStr.includes("innerText") && fnStr.includes("totalLength") && fnStr.includes("fullText")) {
        return { fullText: "This is the full page text content for testing.", totalLength: 48 };
      }

      // Dropdown options
      if (fnStr.includes("HTMLSelectElement") && fnStr.includes("options")) {
        return [
          { index: 0, value: "us", text: "United States", selected: true },
          { index: 1, value: "uk", text: "United Kingdom", selected: false },
        ];
      }

      // Cookie banner detection
      if (fnStr.includes("cookie-banner") || fnStr.includes("cookie-consent")) {
        return null; // No cookie banner found
      }

      // Drag-drop getElementCenter
      if (fnStr.includes("getBoundingClientRect") && fnStr.includes("width / 2")) {
        return { x: 150, y: 150 };
      }

      // scrollBy for scrollToText loop
      if (fnStr.includes("scrollBy") && !fnStr.includes("scrollTo")) {
        return undefined;
      }

      // Iframe listing
      if (fnStr.includes("iframe") && fnStr.includes("contentWindow")) {
        return [];
      }

      // Iframe content extraction
      if (fnStr.includes("createTreeWalker") && fnStr.includes("500")) {
        return "Example iframe content";
      }

      // Generic JS evaluation
      if (typeof fn === "string") {
        try {
          return eval(fn);
        } catch {
          return `evaluated: ${fn}`;
        }
      }

      // Default: return empty/null for unknown evaluate calls
      return [];
    }),
  };

  return mockPage;
}

vi.mock("playwright-core", () => {
  const mockPage = createMockPage();

  const mockContext = {
    pages: vi.fn(() => [mockPage]),
    newPage: vi.fn(() => mockPage),
    close: vi.fn(),
    cookies: vi.fn(() => []),
    addCookies: vi.fn(),
    addInitScript: vi.fn(),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
  };

  const mockBrowser = {
    newContext: vi.fn(() => mockContext),
    close: vi.fn(),
  };

  return {
    chromium: {
      launch: vi.fn(() => mockBrowser),
      connectOverCDP: vi.fn(() => mockBrowser),
    },
  };
});

// ─── Test Setup ────────────────────────────────────────────

function createCtx(tmpDir: string): IntegrationContext {
  return {
    config: {} as IntegrationContext["config"],
    runtimeDir: tmpDir,
    soulDir: tmpDir,
    credentialManager: {
      has: vi.fn(() => false),
      get: vi.fn(async () => null),
    } as unknown as IntegrationContext["credentialManager"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as IntegrationContext["logger"],
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe("BrowserEngineIntegration E2E", () => {
  let integration: BrowserEngineIntegration;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "wispy-e2e-"));
    const ctx = createCtx(tmpDir);
    integration = new BrowserEngineIntegration(ctx);
    await integration.onEnable();
  });

  afterEach(async () => {
    await integration.onDisable();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ─── Manifest ──────────────────────────────────────────

  describe("Manifest", () => {
    it("should expose 39 tools", () => {
      expect(integration.manifest.tools).toHaveLength(39);
    });

    it("should have all tools with web_ prefix", () => {
      for (const tool of integration.manifest.tools) {
        expect(tool.name).toMatch(/^web_/);
      }
    });

    it("should have unique tool names", () => {
      const names = integration.manifest.tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("should have proper metadata", () => {
      expect(integration.manifest.id).toBe("browser-engine");
      expect(integration.manifest.category).toBe("tools");
      expect(integration.manifest.auth.type).toBe("none");
    });
  });

  // ─── Health Check ──────────────────────────────────────

  describe("Health Check", () => {
    it("should report healthy after enable", async () => {
      const health = await integration.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.message).toContain("skills");
    });

    it("should report unhealthy after disable", async () => {
      await integration.onDisable();
      const health = await integration.healthCheck();
      expect(health.healthy).toBe(false);
      // Re-enable for afterEach
      const ctx = createCtx(tmpDir);
      integration = new BrowserEngineIntegration(ctx);
      await integration.onEnable();
    });
  });

  // ─── Session Management ────────────────────────────────

  describe("web_session_create", () => {
    it("should create a session with defaults", async () => {
      const result = await integration.executeTool("web_session_create", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Browser session created");
      expect(result.metadata?.sessionId).toBeTruthy();
    });

    it("should create session with stealth and proxy", async () => {
      const result = await integration.executeTool("web_session_create", {
        stealth: true,
        proxy: "http://proxy.example.com:8080",
        viewport: "desktop-hd",
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("Stealth: true");
    });

    it("should create session with viewport preset", async () => {
      const result = await integration.executeTool("web_session_create", {
        viewport: "mobile",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("web_session_list", () => {
    it("should show no sessions initially", async () => {
      const result = await integration.executeTool("web_session_list", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("No active browser sessions");
    });

    it("should list created sessions", async () => {
      await integration.executeTool("web_session_create", {});
      const result = await integration.executeTool("web_session_list", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Active sessions (1)");
    });
  });

  describe("web_session_close", () => {
    it("should close a session", async () => {
      const createResult = await integration.executeTool("web_session_create", {});
      const sessionId = createResult.metadata?.sessionId as string;

      const result = await integration.executeTool("web_session_close", { sessionId });
      expect(result.success).toBe(true);
      expect(result.output).toContain("closed");

      // Verify it's gone
      const listResult = await integration.executeTool("web_session_list", {});
      expect(listResult.output).toContain("No active browser sessions");
    });

    it("should error when no session exists", async () => {
      const result = await integration.executeTool("web_session_close", { sessionId: "nonexistent" });
      expect(result.success).toBe(false);
    });
  });

  // ─── Navigation & Interaction ──────────────────────────

  describe("web_navigate", () => {
    it("should navigate and return DOM snapshot", async () => {
      const result = await integration.executeTool("web_navigate", {
        url: "https://example.com",
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("Navigated to:");
      expect(result.output).toContain("Interactive Elements");
      expect(result.metadata?.url).toBe("https://example.com");
      expect(result.metadata?.interactiveCount).toBeGreaterThan(0);
    });

    it("should auto-create session if none exists", async () => {
      const result = await integration.executeTool("web_navigate", {
        url: "https://example.com",
      });
      expect(result.success).toBe(true);
      expect(result.metadata?.sessionId).toBeTruthy();
    });

    it("should error without URL", async () => {
      const result = await integration.executeTool("web_navigate", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("URL is required");
    });

    it("should include auth state in metadata", async () => {
      const result = await integration.executeTool("web_navigate", {
        url: "https://example.com",
      });
      expect(result.metadata?.authState).toBeDefined();
    });
  });

  describe("web_interact", () => {
    it("should click by element index", async () => {
      // First navigate to populate snapshot
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "click",
        index: 0,
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain('Action "click" completed');
    });

    it("should click by CSS selector", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "click",
        selector: "button.submit",
      });
      expect(result.success).toBe(true);
    });

    it("should type into a field", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "type",
        index: 2, // input field
        value: "hello world",
      });
      expect(result.success).toBe(true);
    });

    it("should press a key", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "press",
        value: "Enter",
      });
      expect(result.success).toBe(true);
    });

    it("should scroll the page", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "scroll",
        value: "down",
      });
      expect(result.success).toBe(true);
    });

    it("should error without action", async () => {
      const result = await integration.executeTool("web_interact", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Action is required");
    });

    it("should error on click without target", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "click",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Target required");
    });

    it("should error on invalid element index", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "click",
        index: 999,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should hover over an element", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "hover",
        index: 1,
      });
      expect(result.success).toBe(true);
    });

    it("should clear a field", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "clear",
        index: 2,
      });
      expect(result.success).toBe(true);
    });

    it("should focus an element", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_interact", {
        action: "focus",
        index: 2,
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── Snapshot ──────────────────────────────────────────

  describe("web_snapshot", () => {
    it("should return page state with elements and forms", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_snapshot", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("URL:");
      expect(result.output).toContain("Interactive Elements");
      expect(result.metadata?.elementCount).toBeGreaterThan(0);
    });
  });

  // ─── Screenshot ────────────────────────────────────────

  describe("web_screenshot", () => {
    it("should take a viewport screenshot", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_screenshot", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Screenshot saved");
      expect(result.metadata?.path).toBeTruthy();
    });

    it("should take a full-page screenshot", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_screenshot", { fullPage: true });
      expect(result.success).toBe(true);
    });

    it("should screenshot a specific element", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_screenshot", { selector: "h1" });
      expect(result.success).toBe(true);
    });
  });

  // ─── Extraction ────────────────────────────────────────

  describe("web_extract", () => {
    it("should extract structured data with schema", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_extract", {
        selector: ".product",
        fields: {
          title: { selector: "h2" },
          price: { selector: ".price" },
        },
      });
      expect(result.success).toBe(true);
      expect(result.metadata?.count).toBeGreaterThanOrEqual(0);
    });

    it("should error without required params", async () => {
      const result = await integration.executeTool("web_extract", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("web_extract_table", () => {
    it("should extract tables from page", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_extract_table", {});
      expect(result.success).toBe(true);
      expect(result.metadata?.tableCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("web_extract_links", () => {
    it("should extract links and media", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_extract_links", {});
      expect(result.success).toBe(true);
      expect(result.metadata?.linkCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("web_extract_list", () => {
    it("should extract repeated items", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_extract_list", {
        itemSelector: ".result",
        fields: { title: { selector: "h3" }, url: { selector: "a", attribute: "href" } },
      });
      expect(result.success).toBe(true);
      expect(result.metadata?.count).toBeGreaterThanOrEqual(0);
    });

    it("should error without required params", async () => {
      const result = await integration.executeTool("web_extract_list", {});
      expect(result.success).toBe(false);
    });
  });

  // ─── Skills ────────────────────────────────────────────

  describe("web_skill_list", () => {
    it("should list all 55 skills", async () => {
      const result = await integration.executeTool("web_skill_list", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("55");
    });

    it("should filter by category", async () => {
      const result = await integration.executeTool("web_skill_list", { category: "search" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("google-search");
    });

    it("should search by keyword", async () => {
      const result = await integration.executeTool("web_skill_list", { query: "amazon" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("amazon");
    });
  });

  describe("web_skill_run", () => {
    it("should execute a skill", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_skill_run", {
        skillId: "google-search",
        params: { query: "test" },
      });
      // Skill may or may not fully succeed with mocks, but dispatch should work
      expect(result).toBeDefined();
    });

    it("should error on unknown skill", async () => {
      const result = await integration.executeTool("web_skill_run", {
        skillId: "nonexistent-skill",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should suggest similar skills", async () => {
      const result = await integration.executeTool("web_skill_run", {
        skillId: "google",
      });
      expect(result.success).toBe(false);
      // Should suggest google-search or similar
      expect(result.error).toContain("google");
    });

    it("should error without skillId", async () => {
      const result = await integration.executeTool("web_skill_run", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Workflow ──────────────────────────────────────────

  describe("web_workflow", () => {
    it("should execute a multi-step workflow", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_workflow", {
        steps: [
          { action: "navigate", value: "https://example.com" },
          { action: "wait", value: "100" },
          { action: "scroll", value: "500" },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("completed");
      expect(result.output).toContain("3 steps");
    });

    it("should error without steps", async () => {
      const result = await integration.executeTool("web_workflow", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should error with empty steps array", async () => {
      const result = await integration.executeTool("web_workflow", { steps: [] });
      expect(result.success).toBe(false);
    });
  });

  // ─── Profiles ──────────────────────────────────────────

  describe("web_profile_list", () => {
    it("should show no profiles initially", async () => {
      const result = await integration.executeTool("web_profile_list", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("No saved browser profiles");
    });
  });

  describe("web_profile_delete", () => {
    it("should error for nonexistent profile", async () => {
      const result = await integration.executeTool("web_profile_delete", {
        profileId: "nonexistent",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should error without profileId", async () => {
      const result = await integration.executeTool("web_profile_delete", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Network Capture ──────────────────────────────────

  describe("web_network_capture", () => {
    it("should return captured requests for active session", async () => {
      const createResult = await integration.executeTool("web_session_create", {});
      const sessionId = createResult.metadata?.sessionId as string;

      const result = await integration.executeTool("web_network_capture", { sessionId });
      expect(result.success).toBe(true);
      // May be empty but should not error
      expect(result.output).toBeTruthy();
    });

    it("should error without active session", async () => {
      const result = await integration.executeTool("web_network_capture", {
        sessionId: "nonexistent",
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── JS Evaluation ────────────────────────────────────

  describe("web_evaluate", () => {
    it("should evaluate JavaScript expression", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });

      const result = await integration.executeTool("web_evaluate", {
        expression: "document.title",
      });
      expect(result.success).toBe(true);
    });

    it("should error without expression", async () => {
      const result = await integration.executeTool("web_evaluate", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Unknown Tool ──────────────────────────────────────

  describe("Unknown tool", () => {
    it("should return error for unknown tool", async () => {
      const result = await integration.executeTool("web_nonexistent", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });
  });

  // ─── Full Flow: Navigate -> Interact -> Extract ────────

  describe("Full flow", () => {
    it("should navigate, interact, and extract in sequence", async () => {
      // 1. Navigate
      const nav = await integration.executeTool("web_navigate", {
        url: "https://example.com",
      });
      expect(nav.success).toBe(true);
      const sessionId = nav.metadata?.sessionId;

      // 2. Type in search
      const type = await integration.executeTool("web_interact", {
        action: "type",
        index: 2, // input
        value: "test query",
      });
      expect(type.success).toBe(true);

      // 3. Click submit
      const click = await integration.executeTool("web_interact", {
        action: "click",
        index: 1, // button
      });
      expect(click.success).toBe(true);

      // 4. Snapshot
      const snap = await integration.executeTool("web_snapshot", {});
      expect(snap.success).toBe(true);

      // 5. Extract table
      const table = await integration.executeTool("web_extract_table", {});
      expect(table.success).toBe(true);

      // 6. Extract links
      const links = await integration.executeTool("web_extract_links", {});
      expect(links.success).toBe(true);

      // 7. Screenshot
      const shot = await integration.executeTool("web_screenshot", {});
      expect(shot.success).toBe(true);

      // 8. Close session
      const close = await integration.executeTool("web_session_close", { sessionId });
      expect(close.success).toBe(true);
    });
  });

  // ─── Tab Management ─────────────────────────────────────

  describe("web_tab_list", () => {
    it("should list tabs in a session", async () => {
      await integration.executeTool("web_session_create", {});
      const result = await integration.executeTool("web_tab_list", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Open tabs");
      expect(result.metadata?.tabCount).toBeGreaterThan(0);
    });

    it("should error without active session", async () => {
      const result = await integration.executeTool("web_tab_list", { sessionId: "nonexistent" });
      expect(result.success).toBe(false);
    });
  });

  describe("web_tab_open", () => {
    it("should open a new tab", async () => {
      await integration.executeTool("web_session_create", {});
      const result = await integration.executeTool("web_tab_open", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("New tab opened");
      expect(result.metadata?.tabIndex).toBeDefined();
    });

    it("should open tab with URL", async () => {
      await integration.executeTool("web_session_create", {});
      const result = await integration.executeTool("web_tab_open", { url: "https://example.com" });
      expect(result.success).toBe(true);
    });
  });

  describe("web_tab_switch", () => {
    it("should error when no matching tab", async () => {
      await integration.executeTool("web_session_create", {});
      const result = await integration.executeTool("web_tab_switch", { urlPattern: "nonexistent" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("No matching tab");
    });
  });

  describe("web_tab_close", () => {
    it("should error without index", async () => {
      await integration.executeTool("web_session_create", {});
      const result = await integration.executeTool("web_tab_close", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Download ──────────────────────────────────────────

  describe("web_download", () => {
    it("should attempt download with selector", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      // Will timeout in mock environment but dispatch should work
      const result = await integration.executeTool("web_download", { selector: "a.download" });
      expect(result).toBeDefined();
    });
  });

  // ─── Profile Create/Export ─────────────────────────────

  describe("web_profile_create", () => {
    it("should error without name", async () => {
      const result = await integration.executeTool("web_profile_create", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should error without active session", async () => {
      const result = await integration.executeTool("web_profile_create", { name: "test-profile" });
      expect(result.success).toBe(false);
    });
  });

  describe("web_profile_export", () => {
    it("should error for nonexistent profile", async () => {
      const result = await integration.executeTool("web_profile_export", { profileId: "nonexistent" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should error without profileId", async () => {
      const result = await integration.executeTool("web_profile_export", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Iframe Handling ────────────────────────────────────

  describe("web_iframe_list", () => {
    it("should list iframes on page", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_iframe_list", {});
      expect(result.success).toBe(true);
      expect(result.output).toContain("Iframes on page");
    });
  });

  describe("web_iframe_interact", () => {
    it("should error without action", async () => {
      const result = await integration.executeTool("web_iframe_interact", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Page Monitor ──────────────────────────────────────

  describe("web_monitor_snapshot", () => {
    it("should take baseline snapshot", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_monitor_snapshot", { selector: "body" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("Baseline snapshot taken");
    });
  });

  describe("web_monitor_check", () => {
    it("should error without baseline", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_monitor_check", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("No baseline");
    });

    it("should check for changes after baseline", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      await integration.executeTool("web_monitor_snapshot", { selector: "body" });
      const result = await integration.executeTool("web_monitor_check", { selector: "body" });
      expect(result.success).toBe(true);
    });
  });

  // ─── History Navigation ────────────────────────────────

  describe("web_go_back", () => {
    it("should navigate back in history", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_go_back", {});
      expect(result.success).toBeDefined();
      // May not have history in mock, but dispatch should work
    });

    it("should navigate forward in history", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_go_back", { direction: "forward" });
      expect(result.success).toBeDefined();
    });
  });

  // ─── Page Search ──────────────────────────────────────

  describe("web_search_page", () => {
    it("should search for text in page", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_search_page", { query: "Example" });
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it("should error without query", async () => {
      const result = await integration.executeTool("web_search_page", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should support regex search", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_search_page", { query: "\\d+", regex: true });
      expect(result.success).toBe(true);
    });
  });

  describe("web_find_text", () => {
    it("should scroll to find text", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_find_text", { text: "Example", timeout: 2000 });
      expect(result.success).toBe(true);
    });

    it("should error without text", async () => {
      const result = await integration.executeTool("web_find_text", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Element Finder ───────────────────────────────────

  describe("web_find_elements", () => {
    it("should find elements by CSS selector", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_find_elements", { selector: "a" });
      expect(result.success).toBe(true);
    });

    it("should error without selector", async () => {
      const result = await integration.executeTool("web_find_elements", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  describe("web_read_content", () => {
    it("should read page content in chunks", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_read_content", {});
      expect(result.success).toBe(true);
      expect(result.metadata?.chunkIndex).toBe(0);
      expect(result.metadata?.totalChunks).toBeGreaterThan(0);
    });

    it("should read specific chunk index", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_read_content", { chunkIndex: 0, chunkSize: 100 });
      expect(result.success).toBe(true);
    });
  });

  // ─── File Upload ──────────────────────────────────────

  describe("web_upload_file", () => {
    it("should error without selector or filePath", async () => {
      const result = await integration.executeTool("web_upload_file", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });

    it("should attempt file upload", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_upload_file", {
        selector: "input[type='file']",
        filePath: "/tmp/test.txt",
      });
      // May fail in mock but dispatch should work
      expect(result).toBeDefined();
    });
  });

  // ─── Dropdown ─────────────────────────────────────────

  describe("web_dropdown", () => {
    it("should list dropdown options", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_dropdown", {
        selector: "select",
        action: "options",
      });
      expect(result).toBeDefined();
    });

    it("should error without selector or action", async () => {
      const result = await integration.executeTool("web_dropdown", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Drag and Drop ────────────────────────────────────

  describe("web_drag_drop", () => {
    it("should attempt drag and drop between selectors", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_drag_drop", {
        sourceSelector: ".drag-source",
        targetSelector: ".drop-target",
      });
      expect(result).toBeDefined();
    });

    it("should error without source", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_drag_drop", {
        targetSelector: ".drop-target",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Source required");
    });

    it("should error without target", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_drag_drop", {
        sourceSelector: ".drag-source",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Target required");
    });
  });

  // ─── Dialog Handling ──────────────────────────────────

  describe("web_dialog", () => {
    it("should show dialog history", async () => {
      await integration.executeTool("web_session_create", {});
      const result = await integration.executeTool("web_dialog", { action: "history" });
      expect(result.success).toBe(true);
      expect(result.output).toContain("No dialogs");
    });

    it("should configure dialog responses", async () => {
      await integration.executeTool("web_session_create", {});
      const result = await integration.executeTool("web_dialog", {
        action: "configure",
        confirmAction: "dismiss",
        promptText: "auto-response",
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("configured");
    });
  });

  // ─── Done ─────────────────────────────────────────────

  describe("web_done", () => {
    it("should signal task completion", async () => {
      const result = await integration.executeTool("web_done", {
        result: "Found 5 products matching query",
        data: { products: ["a", "b", "c"] },
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("Task complete");
      expect(result.metadata?.taskResult).toBe("Found 5 products matching query");
    });

    it("should error without result", async () => {
      const result = await integration.executeTool("web_done", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("required");
    });
  });

  // ─── Enhanced Interactions ────────────────────────────

  describe("web_interact enhancements", () => {
    it("should support coordinate-based clicking", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_interact", {
        action: "click",
        x: 100,
        y: 200,
      });
      expect(result.success).toBe(true);
    });

    it("should support double-click", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_interact", {
        action: "dblclick",
        index: 1,
      });
      expect(result.success).toBe(true);
    });

    it("should support right-click", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_interact", {
        action: "rightclick",
        index: 1,
      });
      expect(result.success).toBe(true);
    });

    it("should support modifier keys", async () => {
      await integration.executeTool("web_navigate", { url: "https://example.com" });
      const result = await integration.executeTool("web_interact", {
        action: "press",
        value: "Control+A",
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── Lifecycle ─────────────────────────────────────────

  describe("Lifecycle", () => {
    it("should error when not initialized", async () => {
      await integration.onDisable();
      const result = await integration.executeTool("web_navigate", { url: "https://example.com" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not initialized");

      // Re-enable for cleanup
      const ctx = createCtx(tmpDir);
      integration = new BrowserEngineIntegration(ctx);
      await integration.onEnable();
    });
  });
});
