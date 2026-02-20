/**
 * Signal Integration
 *
 * Send and receive messages via Signal messenger using signal-cli.
 * Supports direct messages, group messaging, and receiving pending messages.
 *
 * @requires SIGNAL_CLI_PATH - Path to the signal-cli binary.
 * @requires SIGNAL_PHONE_NUMBER - Registered phone number with country code.
 * @see https://github.com/AsamK/signal-cli
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

export default class SignalIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "signal",
    name: "Signal",
    category: "social",
    version: "1.0.0",
    description: "Send and receive messages via Signal messenger using signal-cli",
    auth: {
      type: "api-key",
      envVars: ["SIGNAL_CLI_PATH", "SIGNAL_PHONE_NUMBER"],
    },
    tools: [
      {
        name: "signal_send_message",
        description: "Send a text message via Signal to a specific phone number or group ID",
        parameters: {
          type: "object",
          properties: {
            recipient: { type: "string", description: "Phone number (with country code, e.g. +1234567890) or group ID" },
            message: { type: "string", description: "The message text to send" },
            attachment: { type: "string", description: "Optional file path to attach to the message" },
          },
          required: ["recipient", "message"],
        },
      },
      {
        name: "signal_list_groups",
        description: "List all Signal groups the registered number is a member of",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "signal_receive_messages",
        description: "Receive and return pending Signal messages for the registered number",
        parameters: {
          type: "object",
          properties: {
            timeout: { type: "number", description: "Timeout in seconds to wait for messages (default: 5)" },
          },
          required: [],
        },
      },
    ],
    capabilities: { offline: false, streaming: false },
  };

  private getCliPath(): string {
    return process.env.SIGNAL_CLI_PATH || "signal-cli";
  }

  private getPhoneNumber(): string | null {
    return process.env.SIGNAL_PHONE_NUMBER || null;
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case "signal_send_message":
        return this.sendMessage(args);
      case "signal_list_groups":
        return this.listGroups();
      case "signal_receive_messages":
        return this.receiveMessages(args);
      default:
        return this.error(`Unknown tool: ${toolName}`);
    }
  }

  private async sendMessage(args: Record<string, unknown>): Promise<ToolResult> {
    const phone = this.getPhoneNumber();
    const cliPath = this.getCliPath();
    if (!phone) return this.error("SIGNAL_PHONE_NUMBER not configured");

    const { recipient, message, attachment } = args as {
      recipient: string;
      message: string;
      attachment?: string;
    };
    if (!recipient || !message) return this.error("recipient and message are required");

    try {
      const { execSync } = await import("child_process");
      const attachArgs = attachment ? `-a ${attachment}` : "";
      execSync(`${cliPath} -u ${phone} send -m ${JSON.stringify(message)} ${attachArgs} ${recipient}`, {
        timeout: 30_000,
      });
      return this.ok(`Message sent to ${recipient}`);
    } catch (err) {
      return this.error(`Failed to send Signal message: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async listGroups(): Promise<ToolResult> {
    const phone = this.getPhoneNumber();
    const cliPath = this.getCliPath();
    if (!phone) return this.error("SIGNAL_PHONE_NUMBER not configured");

    try {
      const { execSync } = await import("child_process");
      const output = execSync(`${cliPath} -u ${phone} listGroups -d`, {
        timeout: 15_000,
        encoding: "utf-8",
      });
      return this.ok(output || "No groups found");
    } catch (err) {
      return this.error(`Failed to list groups: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async receiveMessages(args: Record<string, unknown>): Promise<ToolResult> {
    const phone = this.getPhoneNumber();
    const cliPath = this.getCliPath();
    if (!phone) return this.error("SIGNAL_PHONE_NUMBER not configured");

    const timeout = (args.timeout as number) || 5;

    try {
      const { execSync } = await import("child_process");
      const output = execSync(`${cliPath} -u ${phone} receive -t ${timeout} --json`, {
        timeout: (timeout + 10) * 1000,
        encoding: "utf-8",
      });
      const lines = output.trim().split("\n").filter(Boolean);
      const messages = lines.map((l) => {
        try { return JSON.parse(l); } catch { return l; }
      });
      return this.ok(JSON.stringify({ count: messages.length, messages }));
    } catch (err) {
      return this.error(`Failed to receive messages: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
