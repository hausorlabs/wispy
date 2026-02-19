/**
 * OpenRouter Integration
 *
 * Access 200+ AI models through OpenRouter's unified API.
 * Uses OpenAI-compatible format.
 *
 * @requires OPENROUTER_API_KEY - API key from https://openrouter.ai/keys
 * @see https://openrouter.ai/docs
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://openrouter.ai/api/v1";

export default class OpenRouterIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "openrouter",
    name: "OpenRouter",
    category: "ai-models",
    version: "1.0.0",
    description: "Access 200+ AI models through OpenRouter's unified API.",
    auth: {
      type: "api-key",
      envVars: ["OPENROUTER_API_KEY"],
    },
    tools: [
      {
        name: "openrouter_chat",
        description: "Send a message to any model via OpenRouter.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "The user message to send." },
            model: {
              type: "string",
              description: "Model ID (e.g. anthropic/claude-sonnet-4, google/gemini-2.5-pro).",
              default: "anthropic/claude-sonnet-4",
            },
            systemPrompt: { type: "string", description: "Optional system prompt." },
          },
          required: ["message"],
        },
      },
      {
        name: "openrouter_list_models",
        description: "List popular models available on OpenRouter.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ],
  };

  private async request(path: string, body?: Record<string, unknown>, method = "POST"): Promise<any> {
    const creds = await this.getCredentials<{ OPENROUTER_API_KEY: string }>();
    if (!creds?.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${creds.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wispy.cc",
        "X-Title": "Wispy AI Agent",
      },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text}`);
    }
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "openrouter_chat":
          return await this.chat(
            args.message as string,
            (args.model as string) ?? "anthropic/claude-sonnet-4",
            args.systemPrompt as string | undefined
          );
        case "openrouter_list_models":
          return this.listModels();
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`OpenRouter error: ${(err as Error).message}`);
    }
  }

  private async chat(message: string, model: string, systemPrompt?: string): Promise<ToolResult> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: message });

    const data = await this.request("/chat/completions", { model, messages });
    const reply = data.choices?.[0]?.message?.content ?? "";
    return this.ok(reply, {
      model: data.model,
      usage: data.usage,
    });
  }

  private listModels(): ToolResult {
    const models = [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
      { id: "meta-llama/llama-3.3-70b", name: "Llama 3.3 70B" },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
      { id: "mistralai/mistral-large", name: "Mistral Large" },
    ];

    const list = models
      .map((m) => `  ${m.id.padEnd(38)} ${m.name}`)
      .join("\n");

    return this.ok(`Popular OpenRouter models:\n${list}\n\n  Browse all at https://openrouter.ai/models`);
  }
}
