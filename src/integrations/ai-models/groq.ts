/**
 * Groq Integration
 *
 * Provides access to Groq's ultra-fast inference API using
 * OpenAI-compatible endpoints.
 *
 * @requires GROQ_API_KEY - API key from https://console.groq.com
 * @see https://console.groq.com/docs/api-reference
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.groq.com/openai/v1";

export default class GroqIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "groq",
    name: "Groq",
    category: "ai-models",
    version: "1.0.0",
    description: "Ultra-fast inference with Llama, Mixtral, and Gemma models via Groq.",
    auth: {
      type: "api-key",
      envVars: ["GROQ_API_KEY"],
    },
    tools: [
      {
        name: "groq_chat",
        description: "Send a message to a Groq-hosted model.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "The user message to send." },
            model: {
              type: "string",
              description: "Model ID (e.g. llama-3.3-70b-versatile, mixtral-8x7b-32768).",
              default: "llama-3.3-70b-versatile",
            },
            systemPrompt: { type: "string", description: "Optional system prompt." },
          },
          required: ["message"],
        },
      },
      {
        name: "groq_list_models",
        description: "List available Groq models.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ],
  };

  private async request(path: string, body: Record<string, unknown>, method = "POST"): Promise<any> {
    const creds = await this.getCredentials<{ GROQ_API_KEY: string }>();
    if (!creds?.GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${creds.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq ${res.status}: ${text}`);
    }
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "groq_chat":
          return await this.chat(
            args.message as string,
            (args.model as string) ?? "llama-3.3-70b-versatile",
            args.systemPrompt as string | undefined
          );
        case "groq_list_models":
          return this.listModels();
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Groq error: ${(err as Error).message}`);
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
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", speed: "~330 tok/s" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", speed: "~750 tok/s" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", speed: "~480 tok/s" },
      { id: "gemma2-9b-it", name: "Gemma 2 9B", speed: "~500 tok/s" },
    ];

    const list = models
      .map((m) => `  ${m.id.padEnd(30)} ${m.name} (${m.speed})`)
      .join("\n");

    return this.ok(`Available Groq models:\n${list}`);
  }
}
