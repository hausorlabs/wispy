/**
 * Claude Engine — full Claude AI engine parallel to gemini.ts
 *
 * Uses @anthropic-ai/sdk for native tool use, extended thinking,
 * streaming, and agentic loops.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlockParam,
  ToolUseBlock,
  TextBlock,
  ThinkingBlock,
  ToolResultBlockParam,
  Tool,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages.js";
import { createLogger } from "../infra/logger.js";
import type { ThinkingLevel, GenerateOptions, GenerateResult } from "./gemini.js";

const log = createLogger("claude");

let client: Anthropic | null = null;

// ── Retry Logic (mirrors gemini.ts) ──────────────────────────────────────

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: Set<number>;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableErrors: new Set([429, 500, 502, 503, 504, 529]),
};

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const statusCode = extractStatusCode(error);
      const isRetryable =
        statusCode !== null && config.retryableErrors.has(statusCode);

      if (!isRetryable || attempt === config.maxRetries) {
        throw lastError;
      }

      const baseDelay = config.baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 0.3 * baseDelay;
      const delay = Math.min(baseDelay + jitter, config.maxDelayMs);

      const retryAfter = extractRetryAfter(error);
      const actualDelay = retryAfter
        ? Math.max(retryAfter * 1000, delay)
        : delay;

      log.warn(
        "Claude API call failed with %d, retrying in %dms (attempt %d/%d)",
        statusCode,
        Math.round(actualDelay),
        attempt + 1,
        config.maxRetries,
      );

      await sleep(actualDelay);
    }
  }

  throw lastError!;
}

function extractStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const err = error as Record<string, unknown>;
  if (typeof err.status === "number") return err.status;
  if (typeof err.statusCode === "number") return err.statusCode;
  const message = String(err.message || "");
  const match = message.match(/\b(429|500|502|503|504|529)\b/);
  if (match) return parseInt(match[1], 10);
  return null;
}

function extractRetryAfter(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const err = error as Record<string, unknown>;
  if (err.headers && typeof err.headers === "object") {
    const headers = err.headers as Record<string, unknown>;
    const retryAfter = headers["retry-after"] || headers["Retry-After"];
    if (typeof retryAfter === "string") {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Initialization ───────────────────────────────────────────────────────

export function initClaude(apiKey: string): Anthropic {
  client = new Anthropic({ apiKey });
  log.info("Claude SDK initialized");
  return client;
}

export function getClaudeClient(): Anthropic {
  if (!client) throw new Error("Claude not initialized. Call initClaude() first.");
  return client;
}

// ── Thinking Budget Mapping ──────────────────────────────────────────────

function thinkingBudgetTokens(level: ThinkingLevel): number {
  switch (level) {
    case "minimal":
      return 1024;
    case "low":
      return 4096;
    case "medium":
      return 8192;
    case "high":
      return 16384;
    case "ultra":
      return 32768;
    default:
      return 0;
  }
}

// ── Tool Format Conversion ───────────────────────────────────────────────

/**
 * Convert Gemini-style functionDeclarations to Claude tool format.
 */
function convertToolsForClaude(geminiTools: unknown[]): Tool[] {
  if (!geminiTools || geminiTools.length === 0) return [];

  const declarations =
    (geminiTools[0] as any)?.functionDeclarations || [];
  if (declarations.length === 0) return [];

  return declarations.map((t: any) => ({
    name: t.name,
    description: t.description || "",
    input_schema: {
      type: "object" as const,
      properties: t.parameters?.properties || {},
      required: t.parameters?.required || [],
    },
  }));
}

// ── Message Format Conversion ────────────────────────────────────────────

/**
 * Convert Wispy messages (role: "user"/"model") to Claude format (role: "user"/"assistant").
 */
function convertMessages(
  messages: Array<{ role: "user" | "model"; content: string }>,
): MessageParam[] {
  const result: MessageParam[] = [];

  for (const m of messages) {
    const role = m.role === "model" ? "assistant" : "user";

    // Claude requires alternating user/assistant messages.
    // If we have two consecutive messages with the same role, merge them.
    if (result.length > 0 && result[result.length - 1].role === role) {
      const prev = result[result.length - 1];
      if (typeof prev.content === "string") {
        prev.content = prev.content + "\n\n" + m.content;
      }
    } else {
      result.push({ role, content: m.content });
    }
  }

  // Claude requires the first message to be from the user
  if (result.length > 0 && result[0].role === "assistant") {
    result.unshift({ role: "user", content: "[Conversation resumed]" });
  }

  return result;
}

// ── Generate (single-shot) ───────────────────────────────────────────────

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const anthropic = getClaudeClient();
  const tools = opts.tools ? convertToolsForClaude(opts.tools) : [];
  const messages = convertMessages(opts.messages);

  // Build request params
  const params: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens || 8192,
    messages,
  };

  if (opts.systemPrompt) {
    params.system = opts.systemPrompt;
  }

  if (tools.length > 0) {
    params.tools = tools;
  }

  if (opts.temperature !== undefined) {
    params.temperature = opts.temperature;
  }

  // Extended thinking
  const budgetTokens =
    opts.thinkingLevel && opts.thinkingLevel !== "none"
      ? thinkingBudgetTokens(opts.thinkingLevel)
      : 0;

  if (budgetTokens > 0) {
    params.thinking = {
      type: "enabled",
      budget_tokens: budgetTokens,
    };
    // Thinking requires higher max_tokens
    params.max_tokens = Math.max(
      (opts.maxTokens || 8192),
      budgetTokens + 4096,
    );
  }

  const response = await withRetry(() =>
    anthropic.messages.create(params as unknown as MessageCreateParamsNonStreaming),
  );

  // Extract text, thinking, and tool calls
  let text = "";
  let thinking: string | undefined;
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for (const block of response.content) {
    if (block.type === "text") {
      text += (block as TextBlock).text;
    } else if (block.type === "thinking") {
      thinking = (block as ThinkingBlock).thinking;
    } else if (block.type === "tool_use") {
      const tu = block as ToolUseBlock;
      toolCalls.push({
        name: tu.name,
        args: (tu.input as Record<string, unknown>) || {},
      });
    }
  }

  return {
    text,
    thinking,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    },
  };
}

// ── Agentic Generate (tool loop) ─────────────────────────────────────────

export async function generateAgentic(
  opts: GenerateOptions,
  executeToolFn: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ success: boolean; output: string; error?: string }>,
): Promise<
  GenerateResult & {
    allToolResults: Array<{
      name: string;
      success: boolean;
      output: string;
      error?: string;
    }>;
  }
> {
  const anthropic = getClaudeClient();
  const tools = opts.tools ? convertToolsForClaude(opts.tools) : [];
  const MAX_LOOPS = 50;

  let allToolResults: Array<{
    name: string;
    success: boolean;
    output: string;
    error?: string;
  }> = [];
  let finalText = "";
  let finalThinking: string | undefined;
  let totalUsage = { inputTokens: 0, outputTokens: 0 };

  // Working copy of messages in Claude format
  const messages: MessageParam[] = convertMessages(opts.messages);

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const params: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens || 8192,
      messages,
    };

    if (opts.systemPrompt) params.system = opts.systemPrompt;
    if (tools.length > 0) params.tools = tools;
    if (opts.temperature !== undefined) params.temperature = opts.temperature;

    const budgetTokens =
      opts.thinkingLevel && opts.thinkingLevel !== "none"
        ? thinkingBudgetTokens(opts.thinkingLevel)
        : 0;

    if (budgetTokens > 0) {
      params.thinking = { type: "enabled", budget_tokens: budgetTokens };
      params.max_tokens = Math.max(
        (opts.maxTokens || 8192),
        budgetTokens + 4096,
      );
    }

    const response = await withRetry(() =>
      anthropic.messages.create(params as unknown as MessageCreateParamsNonStreaming),
    );

    totalUsage.inputTokens += response.usage?.input_tokens || 0;
    totalUsage.outputTokens += response.usage?.output_tokens || 0;

    // Extract content blocks
    let text = "";
    const toolUseBlocks: ToolUseBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        text += (block as TextBlock).text;
      } else if (block.type === "thinking") {
        finalThinking = (block as ThinkingBlock).thinking;
      } else if (block.type === "tool_use") {
        toolUseBlocks.push(block as ToolUseBlock);
      }
    }

    // No tool calls -- done
    if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
      finalText = text;
      break;
    }

    // Execute tool calls and build tool_result messages
    log.info(
      "Claude executing %d tool call(s), loop %d",
      toolUseBlocks.length,
      loop + 1,
    );

    // Add assistant message with the full content (text + tool_use blocks)
    messages.push({ role: "assistant", content: response.content as ContentBlockParam[] });

    // Build tool results
    const toolResultBlocks: ToolResultBlockParam[] = [];

    for (const tu of toolUseBlocks) {
      const toolResult = await executeToolFn(
        tu.name,
        (tu.input as Record<string, unknown>) || {},
      );
      allToolResults.push({ name: tu.name, ...toolResult });

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: toolResult.success
          ? toolResult.output
          : `ERROR: ${toolResult.error}`,
        is_error: !toolResult.success,
      });

      log.info("Tool %s: %s", tu.name, toolResult.success ? "OK" : "FAIL");
    }

    messages.push({ role: "user", content: toolResultBlocks });

    if (text) finalText = text;
  }

  return {
    text: finalText,
    thinking: finalThinking,
    allToolResults,
    usage: totalUsage,
  };
}

// ── Streaming ────────────────────────────────────────────────────────────

export async function* generateStream(
  opts: GenerateOptions,
): AsyncGenerator<{
  type: "text" | "thinking" | "tool_call" | "done";
  content: string;
}> {
  const anthropic = getClaudeClient();
  const messages = convertMessages(opts.messages);

  const params: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens || 8192,
    messages,
    stream: true,
  };

  if (opts.systemPrompt) params.system = opts.systemPrompt;
  if (opts.temperature !== undefined) params.temperature = opts.temperature;

  const budgetTokens =
    opts.thinkingLevel && opts.thinkingLevel !== "none"
      ? thinkingBudgetTokens(opts.thinkingLevel)
      : 0;

  if (budgetTokens > 0) {
    params.thinking = { type: "enabled", budget_tokens: budgetTokens };
    params.max_tokens = Math.max(
      (opts.maxTokens || 8192),
      budgetTokens + 4096,
    );
  }

  const stream = anthropic.messages.stream(params as any);

  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      const delta = (event as any).delta;
      if (delta?.type === "text_delta" && delta.text) {
        yield { type: "text", content: delta.text };
      } else if (delta?.type === "thinking_delta" && delta.thinking) {
        yield { type: "thinking", content: delta.thinking };
      }
    }
  }

  yield { type: "done", content: "" };
}
