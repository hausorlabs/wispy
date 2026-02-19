/**
 * Workflow Engine tests -- conditionals, retries, error branching, variables.
 */

import { describe, it, expect, vi } from "vitest";
import { executeWorkflow, formatWorkflowResult } from "../automation/workflow-engine.js";
import type { Page } from "playwright-core";

function createMockPage(): Page {
  return {
    url: vi.fn(() => "https://example.com"),
    title: vi.fn(async () => "Example"),
    goto: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    selectOption: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from("PNG")),
    keyboard: { press: vi.fn(async () => {}) },
    evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
      const fnStr = typeof fn === "string" ? fn : fn?.toString?.() ?? "";
      // Scroll handler
      if (fnStr.includes("scrollBy") || fnStr.includes("scrollTo")) return undefined;
      // Condition evaluation -- return true by default
      if (typeof args[0] === "string") {
        try {
          return eval(args[0] as string);
        } catch {
          return true;
        }
      }
      return [];
    }),
  } as unknown as Page;
}

describe("executeWorkflow", () => {
  it("should execute basic multi-step workflow", async () => {
    const page = createMockPage();
    const result = await executeWorkflow(page, [
      { action: "navigate", value: "https://example.com" },
      { action: "wait", value: "50" },
      { action: "scroll", value: "500" },
    ]);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.success)).toBe(true);
    expect(result.variables).toBeDefined();
  });

  it("should stop on error by default", async () => {
    const page = createMockPage();
    (page.click as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("element not found"));

    const result = await executeWorkflow(page, [
      { action: "click", target: "#missing" },
      { action: "wait", value: "50" },
    ]);

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(false);
  });

  it("should skip failed step when onError is 'skip'", async () => {
    const page = createMockPage();
    (page.click as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

    const result = await executeWorkflow(page, [
      { action: "click", target: "#missing", onError: "skip" },
      { action: "wait", value: "50" },
    ]);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[1].success).toBe(true);
  });

  it("should retry failed step when onError is 'retry'", async () => {
    const page = createMockPage();
    let attempts = 0;
    (page.click as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      attempts++;
      if (attempts < 3) throw new Error("flaky");
    });

    const result = await executeWorkflow(page, [
      { action: "click", target: "#flaky", onError: "retry", maxRetries: 3 },
    ]);

    expect(result.success).toBe(true);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].retries).toBe(2); // Succeeded on 3rd attempt
  });

  it("should try fallback target on failure", async () => {
    const page = createMockPage();
    let callCount = 0;
    (page.click as ReturnType<typeof vi.fn>).mockImplementation(async (sel: string) => {
      callCount++;
      if (sel === "#primary") throw new Error("not found");
      // Fallback succeeds
    });

    const result = await executeWorkflow(page, [
      { action: "click", target: "#primary", fallbackTarget: "#backup" },
    ]);

    expect(result.success).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(2); // Tried primary, then fallback
  });

  it("should skip step when condition is false", async () => {
    const page = createMockPage();
    (page.evaluate as ReturnType<typeof vi.fn>).mockImplementation(async (_fn: unknown, ...args: unknown[]) => {
      // For condition check, return false
      if (typeof args[0] === "string" && args[0] === "false") return false;
      return undefined;
    });

    const result = await executeWorkflow(page, [
      { action: "click", target: "#btn", condition: "false" },
      { action: "wait", value: "50" },
    ]);

    expect(result.success).toBe(true);
    expect(result.steps[0].skipped).toBe(true);
    expect(result.steps[1].success).toBe(true);
  });
});

describe("formatWorkflowResult", () => {
  it("should format success result", () => {
    const output = formatWorkflowResult({
      success: true,
      steps: [
        { step: 0, action: "navigate", success: true, duration: 100 },
        { step: 1, action: "click", success: true, duration: 50 },
      ],
      extracted: [],
      screenshots: [],
      variables: {},
      duration: 150,
    });

    expect(output).toContain("completed");
    expect(output).toContain("2 steps");
    expect(output).toContain("navigate");
  });

  it("should show skipped and retried steps", () => {
    const output = formatWorkflowResult({
      success: true,
      steps: [
        { step: 0, action: "click", success: true, retries: 2, duration: 500 },
        { step: 1, action: "wait", success: true, skipped: true, duration: 0 },
      ],
      extracted: [],
      screenshots: [],
      variables: { count: 5 },
      duration: 500,
    });

    expect(output).toContain("2 retries");
    expect(output).toContain("SKIP");
    expect(output).toContain("Variables:");
  });
});
