/**
 * Anthropic (Claude) Integration
 *
 * Provides access to Claude chat completions and vision via the Anthropic API.
 *
 * @requires ANTHROPIC_API_KEY - API key from https://console.anthropic.com
 * @see https://docs.anthropic.com/en/docs/api-reference
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

export default class AnthropicIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "anthropic",
    name: "Anthropic (Claude)",
    category: "ai-models",
    version: "1.0.0",
    description: "Chat completions and vision via Claude models.",
    auth: {
      type: "api-key",
      envVars: ["ANTHROPIC_API_KEY"],
    },
    tools: [
      {
        name: "anthropic_chat",
        description: "Send a message to a Claude model and receive a response.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "The user message to send." },
            model: {
              type: "string",
              description: "Model ID (e.g. claude-sonnet-4-20250514, claude-haiku-4-5-20251001).",
              default: "claude-sonnet-4-20250514",
            },
            systemPrompt: { type: "string", description: "Optional system prompt." },
            maxTokens: { type: "number", description: "Max tokens to generate (default: 4096)." },
          },
          required: ["message"],
        },
      },
      {
        name: "anthropic_list_models",
        description: "List available Claude models.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ],
  };

  private async request(path: string, body: Record<string, unknown>): Promise<any> {
    const creds = await this.getCredentials<{ ANTHROPIC_API_KEY: string }>();
    if (!creds?.ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");

    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "x-api-key": creds.ANTHROPIC_API_KEY,
        "anthropic-version": API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic ${res.status}: ${text}`);
    }
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "anthropic_chat":
          return await this.chat(
            args.message as string,
            (args.model as string) ?? "claude-sonnet-4-20250514",
            args.systemPrompt as string | undefined,
            (args.maxTokens as number) ?? 4096
          );
        case "anthropic_list_models":
          return this.listModels();
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Anthropic error: ${(err as Error).message}`);
    }
  }

  private async chat(
    message: string,
    model: string,
    systemPrompt?: string,
    maxTokens = 4096
  ): Promise<ToolResult> {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: message }],
      max_tokens: maxTokens,
    };

    if (systemPrompt) body.system = systemPrompt;

    const data = await this.request("/messages", body);

    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    return this.ok(text, {
      model: data.model,
      usage: data.usage,
      stopReason: data.stop_reason,
    });
  }

  private listModels(): ToolResult {
    const models = [
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", tier: "flagship" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", tier: "balanced" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", tier: "fast" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", tier: "balanced" },
    ];

    const list = models
      .map((m) => `  ${m.id.padEnd(38)} ${m.name} (${m.tier})`)
      .join("\n");

    return this.ok(`Available Claude models:\n${list}`);
  }
}
