/**
 * Kimi (Moonshot AI) Integration
 *
 * Provides access to Kimi's long-context models via the
 * OpenAI-compatible Moonshot API.
 *
 * @requires MOONSHOT_API_KEY - API key from https://platform.moonshot.cn
 * @see https://platform.moonshot.cn/docs
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.moonshot.cn/v1";

export default class KimiIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "kimi",
    name: "Kimi (Moonshot)",
    category: "ai-models",
    version: "1.0.0",
    description: "Long-context chat via Moonshot's Kimi models (up to 128K tokens).",
    auth: {
      type: "api-key",
      envVars: ["MOONSHOT_API_KEY"],
    },
    tools: [
      {
        name: "kimi_chat",
        description: "Send a message to a Kimi model with long-context support.",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "The user message to send." },
            model: {
              type: "string",
              description: "Model ID (moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k).",
              default: "moonshot-v1-8k",
            },
            systemPrompt: { type: "string", description: "Optional system prompt." },
          },
          required: ["message"],
        },
      },
      {
        name: "kimi_list_models",
        description: "List available Kimi/Moonshot models.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ],
  };

  private async request(path: string, body: Record<string, unknown>): Promise<any> {
    const creds = await this.getCredentials<{ MOONSHOT_API_KEY: string }>();
    if (!creds?.MOONSHOT_API_KEY) throw new Error("Missing MOONSHOT_API_KEY");

    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.MOONSHOT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kimi ${res.status}: ${text}`);
    }
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "kimi_chat":
          return await this.chat(
            args.message as string,
            (args.model as string) ?? "moonshot-v1-8k",
            args.systemPrompt as string | undefined
          );
        case "kimi_list_models":
          return this.listModels();
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Kimi error: ${(err as Error).message}`);
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
      { id: "moonshot-v1-8k", name: "Kimi v1 8K", context: "8,192 tokens" },
      { id: "moonshot-v1-32k", name: "Kimi v1 32K", context: "32,768 tokens" },
      { id: "moonshot-v1-128k", name: "Kimi v1 128K", context: "131,072 tokens" },
    ];

    const list = models
      .map((m) => `  ${m.id.padEnd(24)} ${m.name} (${m.context})`)
      .join("\n");

    return this.ok(`Available Kimi models:\n${list}`);
  }
}
