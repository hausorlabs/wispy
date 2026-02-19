/**
 * Retry Engine tests.
 */

import { describe, it, expect, vi } from "vitest";
import {
  retryWithBackoff,
  isStaleElementError,
  isTransientError,
  CircuitBreaker,
} from "../core/retry-engine.js";

describe("retryWithBackoff", () => {
  it("should succeed on first attempt", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await retryWithBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and succeed", async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Error("fail");
      return "ok";
    });

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelay: 10,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw after max retries", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelay: 10 })
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("should respect retryOn filter", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent error");
    });

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelay: 10,
        retryOn: (err) => err.message.includes("transient"),
      })
    ).rejects.toThrow("permanent error");
    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });
});

describe("isStaleElementError", () => {
  it("should detect stale element errors", () => {
    expect(isStaleElementError(new Error("Element is not attached to the DOM"))).toBe(true);
    expect(isStaleElementError(new Error("stale element reference"))).toBe(true);
    expect(isStaleElementError(new Error("Execution context was destroyed"))).toBe(true);
  });

  it("should not match unrelated errors", () => {
    expect(isStaleElementError(new Error("click failed"))).toBe(false);
    expect(isStaleElementError(new Error("selector not found"))).toBe(false);
  });
});

describe("isTransientError", () => {
  it("should detect timeout errors", () => {
    expect(isTransientError(new Error("Timeout 30000ms exceeded"))).toBe(true);
    expect(isTransientError(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(true);
    expect(isTransientError(new Error("Navigation failed"))).toBe(true);
  });

  it("should include stale element errors", () => {
    expect(isTransientError(new Error("Element is not attached"))).toBe(true);
  });
});

describe("CircuitBreaker", () => {
  it("should be closed initially", () => {
    const cb = new CircuitBreaker(3, 100);
    expect(cb.isOpen).toBe(false);
  });

  it("should open after threshold failures", async () => {
    const cb = new CircuitBreaker(2, 100);

    for (let i = 0; i < 2; i++) {
      await cb.execute(async () => { throw new Error("fail"); }).catch(() => {});
    }

    expect(cb.isOpen).toBe(true);
    await expect(cb.execute(async () => "ok")).rejects.toThrow("Circuit breaker is open");
  });

  it("should reset on success", async () => {
    const cb = new CircuitBreaker(3, 100);

    // Fail once
    await cb.execute(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.isOpen).toBe(false);

    // Succeed -- resets counter
    await cb.execute(async () => "ok");
    expect(cb.isOpen).toBe(false);
  });

  it("should allow retry after reset timeout (half-open)", async () => {
    const cb = new CircuitBreaker(1, 50); // Very short reset timeout

    await cb.execute(async () => { throw new Error("fail"); }).catch(() => {});
    expect(cb.isOpen).toBe(true);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    // Should allow one attempt (half-open)
    const result = await cb.execute(async () => "recovered");
    expect(result).toBe("recovered");
    expect(cb.isOpen).toBe(false);
  });

  it("should reset manually", () => {
    const cb = new CircuitBreaker(1, 10_000);
    cb.reset();
    expect(cb.isOpen).toBe(false);
  });
});
