/**
 * Stealth Engine tests.
 */

import { describe, it, expect, vi } from "vitest";
import { applyStealthPatches, randomUserAgent } from "../core/stealth-engine.js";
import { USER_AGENTS } from "../config.js";

describe("Stealth Engine", () => {
  it("should apply stealth patches without error", async () => {
    const scripts: string[] = [];
    const mockContext = {
      addInitScript: vi.fn(async (fn: unknown, arg?: unknown) => {
        scripts.push("added");
      }),
    };

    await applyStealthPatches(mockContext as never);

    // Should have added 15 init scripts (10 original + 5 new: WebRTC, Audio, Battery, Bluetooth, iframe)
    expect(mockContext.addInitScript).toHaveBeenCalledTimes(15);
  });

  it("should apply patches with custom options", async () => {
    const mockContext = {
      addInitScript: vi.fn(),
    };

    await applyStealthPatches(mockContext as never, {
      userAgent: "CustomAgent/1.0",
      timezone: "Europe/London",
      locale: "en-GB",
    });

    expect(mockContext.addInitScript).toHaveBeenCalledTimes(15);
  });

  it("should return a valid random user agent", () => {
    const ua = randomUserAgent();
    expect(ua).toBeTruthy();
    expect(USER_AGENTS).toContain(ua);
  });
});
