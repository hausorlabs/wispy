/**
 * Retry Engine -- exponential backoff, circuit breaker, and stale element recovery.
 *
 * Wraps Playwright operations with intelligent retry logic to handle
 * flaky networks, stale DOM references, and transient failures.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryOn?: (error: Error) => boolean;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 5_000,
  backoffFactor: 2,
  retryOn: () => true,
};

/** Retry an async operation with exponential backoff. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const config = { ...DEFAULT_RETRY, ...opts };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= config.maxRetries || !config.retryOn(lastError)) {
        throw lastError;
      }

      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffFactor, attempt),
        config.maxDelay
      );
      // Add jitter (+-25%)
      const jitter = delay * (0.75 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }

  throw lastError ?? new Error("Retry exhausted");
}

/** Check if an error is a stale element error (element detached from DOM). */
export function isStaleElementError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes("element is not attached") ||
    msg.includes("stale element") ||
    msg.includes("target closed") ||
    msg.includes("execution context was destroyed") ||
    msg.includes("frame was detached")
  );
}

/** Check if an error is a timeout / network error. */
export function isTransientError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("net::err_") ||
    msg.includes("navigation failed") ||
    msg.includes("connection refused") ||
    msg.includes("econnreset") ||
    isStaleElementError(error)
  );
}

/** Standard retry config for navigation operations. */
export const NAV_RETRY: RetryOptions = {
  maxRetries: 2,
  baseDelay: 1_000,
  retryOn: isTransientError,
};

/** Standard retry config for interaction operations. */
export const INTERACT_RETRY: RetryOptions = {
  maxRetries: 2,
  baseDelay: 300,
  retryOn: (err) => isStaleElementError(err) || isTransientError(err),
};

// ─── Circuit Breaker ────────────────────────────────────

export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private threshold = 3,
    private resetTimeout = 30_000
  ) {}

  /** Execute a function through the circuit breaker. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = "half-open";
      } else {
        throw new Error("Circuit breaker is open -- too many recent failures. Try again later.");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "open";
    }
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  reset(): void {
    this.failures = 0;
    this.state = "closed";
    this.lastFailure = 0;
  }
}
