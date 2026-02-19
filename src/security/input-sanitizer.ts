/**
 * Input Sanitizer -- Prompt Injection Defense
 *
 * Provides multi-layer defense against prompt injection attacks:
 * 1. Control character stripping
 * 2. Length truncation
 * 3. Injection heuristic detection
 * 4. Tool parameter sanitization
 */

import { createLogger } from "../infra/logger.js";

const log = createLogger("input-sanitizer");

// ── Control Character Stripping ──────────────────────────────────

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Remove control characters that could be used for injection.
 * Preserves \n (0x0A), \r (0x0D), and \t (0x09).
 */
export function stripControlChars(input: string): string {
  return input.replace(CONTROL_CHAR_RE, "");
}

// ── Length Truncation ────────────────────────────────────────────

const DEFAULT_MAX_LENGTH = 10_000;

/**
 * Hard truncation to prevent excessively long inputs
 * from consuming context or hiding injections.
 */
export function truncateInput(
  input: string,
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  if (input.length <= maxLength) return input;
  log.warn("Input truncated from %d to %d chars", input.length, maxLength);
  return input.slice(0, maxLength);
}

// ── Injection Detection ──────────────────────────────────────────

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, label: "instruction_override" },
  { pattern: /forget\s+(all\s+)?previous\s+(instructions|context)/i, label: "context_wipe" },
  { pattern: /you\s+are\s+now\s+(a|an)\s/i, label: "role_reassignment" },
  { pattern: /system\s*:\s/i, label: "system_prefix" },
  { pattern: /\[SYSTEM\]/i, label: "system_bracket" },
  { pattern: /<<\s*SYSTEM\s*>>/i, label: "system_delimiter" },
  { pattern: /===\s*SYSTEM/i, label: "system_boundary_spoof" },
  { pattern: /act\s+as\s+(if\s+)?(you\s+are|you're)\s/i, label: "role_play_injection" },
  { pattern: /disregard\s+(any|all)\s+(prior|above)/i, label: "disregard_prior" },
  { pattern: /new\s+instructions?\s*:/i, label: "new_instructions" },
  { pattern: /\bdo\s+not\s+follow\s+(the\s+)?(above|previous)\b/i, label: "override_attempt" },
  { pattern: /\breturn\s+the\s+(system|initial)\s+prompt\b/i, label: "prompt_extraction" },
  { pattern: /\brepeat\s+(the\s+)?instructions\s+(above|given)\b/i, label: "instruction_leak" },
];

export interface InjectionDetectionResult {
  suspicious: boolean;
  indicators: string[];
}

/**
 * Heuristic detection of common prompt injection patterns.
 * Does NOT block -- only flags for logging/review.
 */
export function detectInjection(input: string): InjectionDetectionResult {
  const indicators: string[] = [];

  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      indicators.push(label);
    }
  }

  // Check for encoded injection attempts
  try {
    const decoded = Buffer.from(input, "base64").toString("utf-8");
    if (decoded.length > 20 && /ignore|system|instructions/i.test(decoded)) {
      indicators.push("base64_encoded_injection");
    }
  } catch {
    // Not valid base64, fine
  }

  if (indicators.length > 0) {
    log.warn("Injection indicators detected: %s", indicators.join(", "));
  }

  return {
    suspicious: indicators.length > 0,
    indicators,
  };
}

// ── Tool Parameter Sanitization ──────────────────────────────────

const PATH_TRAVERSAL_RE = /\.\.\//g;
const COMMAND_INJECTION_RE = /[;|&`$]/g;
const HTML_SCRIPT_RE = /<\s*\/?\s*script[^>]*>/gi;
const HTML_TAG_RE = /<[^>]*>/g;

/**
 * Sanitize individual string values in tool parameters.
 * Strips path traversal, command injection chars, and script tags.
 */
function sanitizeParamValue(value: unknown): unknown {
  if (typeof value !== "string") return value;

  let cleaned = value;

  // Strip script tags (most dangerous)
  cleaned = cleaned.replace(HTML_SCRIPT_RE, "");

  // Strip path traversal
  cleaned = cleaned.replace(PATH_TRAVERSAL_RE, "");

  // Strip command injection characters in values that look like paths or commands
  // Only apply to values that seem like they could be shell arguments
  if (cleaned.startsWith("/") || cleaned.startsWith("~") || cleaned.includes("&&")) {
    cleaned = cleaned.replace(COMMAND_INJECTION_RE, "");
  }

  return cleaned;
}

/**
 * Recursively sanitize all string values in a params object.
 */
export function sanitizeToolParams(
  params: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      sanitized[key] = sanitizeParamValue(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((v) =>
        typeof v === "object" && v !== null
          ? sanitizeToolParams(v as Record<string, unknown>)
          : sanitizeParamValue(v)
      );
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeToolParams(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ── Combined Pipeline ────────────────────────────────────────────

/**
 * Full sanitization pipeline for user input.
 * Strips control chars, truncates, and returns clean string.
 *
 * Does NOT block on injection detection -- that is logged separately
 * and can be checked by the caller.
 */
export function sanitizeUserInput(
  input: string,
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  let cleaned = stripControlChars(input);
  cleaned = truncateInput(cleaned, maxLength);
  return cleaned;
}
