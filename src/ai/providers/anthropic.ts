/**
 * Anthropic Claude provider.
 *
 * Uses the Anthropic Messages API directly for chat completions,
 * streaming, and vision support.
 */

import type { ModelProvider, GenerateOptions, GenerateResult, StreamChunk } from "../model-registry.js";
import { createLogger } from "../../infra/logger.js";

const log = createLogger("anthropic");

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly supportsTools = true;
  readonly supportsThinking = true;
  readonly supportsVision = true;

  private config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const messages = this.buildMessages(opts);
    const model = opts.model || this.config.defaultModel || "claude-sonnet-4-20250514";

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: opts.maxTokens || 4096,
    };

    if (opts.systemPrompt) {
      body.system = opts.systemPrompt;
    }

    if (opts.tools && opts.tools.length > 0) {
      body.tools = (opts.tools as any[]).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as AnthropicResponse;

    let text = "";
    let thinking = "";
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    for (const block of data.content || []) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "thinking") {
        thinking += block.thinking || "";
      } else if (block.type === "tool_use") {
        toolCalls.push({
          name: block.name || "",
          args: (block.input as Record<string, unknown>) || {},
        });
      }
    }

    return {
      text,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
    };
  }

  async *generateStream(opts: GenerateOptions): AsyncGenerator<StreamChunk> {
    const messages = this.buildMessages(opts);
    const model = opts.model || this.config.defaultModel || "claude-sonnet-4-20250514";

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: opts.maxTokens || 4096,
      stream: true,
    };

    if (opts.systemPrompt) {
      body.system = opts.systemPrompt;
    }

    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Anthropic stream error: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          yield { type: "done", content: "" };
          return;
        }

        try {
          const event = JSON.parse(payload) as AnthropicStreamEvent;
          if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta") {
              yield { type: "text", content: event.delta.text || "" };
            } else if (event.delta?.type === "thinking_delta") {
              yield { type: "thinking", content: event.delta.thinking || "" };
            }
          } else if (event.type === "message_stop") {
            yield { type: "done", content: "" };
            return;
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  private buildMessages(
    opts: GenerateOptions
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    for (const msg of opts.messages) {
      messages.push({
        role: msg.role === "model" ? "assistant" : msg.role,
        content: msg.content,
      });
    }

    return messages;
  }
}

// ---- Anthropic API Types ----

interface AnthropicResponse {
  content?: Array<{
    type: "text" | "thinking" | "tool_use";
    text?: string;
    thinking?: string;
    name?: string;
    input?: unknown;
  }>;
  usage?: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
  };
}
