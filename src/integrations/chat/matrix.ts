/**
 * Matrix Integration
 *
 * Communicate over the Matrix decentralized protocol.
 * Send messages, join rooms, list rooms, and read message history.
 *
 * @requires MATRIX_HOMESERVER - Matrix homeserver URL (e.g. https://matrix.org).
 * @requires MATRIX_ACCESS_TOKEN - Access token for authentication.
 * @see https://spec.matrix.org/latest/client-server-api/
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const CLIENT_API = "/_matrix/client/v3";

export default class MatrixIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "matrix",
    name: "Matrix",
    category: "chat",
    version: "1.0.0",
    description: "Communicate over the Matrix decentralized protocol - send messages, join rooms, and read history",
    auth: {
      type: "token",
      envVars: ["MATRIX_HOMESERVER", "MATRIX_ACCESS_TOKEN"],
    },
    tools: [
      {
        name: "matrix_send_message",
        description: "Send a text message to a Matrix room by room ID or alias",
        parameters: {
          type: "object",
          properties: {
            room_id: { type: "string", description: "Matrix room ID (e.g. !abc123:matrix.org) or alias (#room:matrix.org)" },
            message: { type: "string", description: "Plain text or HTML message to send" },
            formatted: { type: "boolean", description: "Whether to send as HTML-formatted message (default: false)" },
          },
          required: ["room_id", "message"],
        },
      },
      {
        name: "matrix_join_room",
        description: "Join a Matrix room by room ID or alias",
        parameters: {
          type: "object",
          properties: {
            room_id: { type: "string", description: "Room ID or alias to join" },
          },
          required: ["room_id"],
        },
      },
      {
        name: "matrix_list_rooms",
        description: "List all Matrix rooms the authenticated user has joined",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "matrix_get_messages",
        description: "Retrieve recent messages from a Matrix room with optional limit",
        parameters: {
          type: "object",
          properties: {
            room_id: { type: "string", description: "Room ID to fetch messages from" },
            limit: { type: "number", description: "Maximum number of messages to retrieve (default: 20, max: 100)" },
          },
          required: ["room_id"],
        },
      },
    ],
    capabilities: { offline: false, streaming: false },
  };

  private async matrixFetch(endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
    const homeserver = process.env.MATRIX_HOMESERVER;
    const token = process.env.MATRIX_ACCESS_TOKEN;
    if (!homeserver || !token) throw new Error("MATRIX_HOMESERVER and MATRIX_ACCESS_TOKEN must be set");

    const url = `${homeserver.replace(/\/$/, "")}${CLIENT_API}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Matrix API ${res.status}: ${errText}`);
    }
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case "matrix_send_message":
        return this.sendMessage(args);
      case "matrix_join_room":
        return this.joinRoom(args);
      case "matrix_list_rooms":
        return this.listRooms();
      case "matrix_get_messages":
        return this.getMessages(args);
      default:
        return this.error(`Unknown tool: ${toolName}`);
    }
  }

  private async sendMessage(args: Record<string, unknown>): Promise<ToolResult> {
    const { room_id, message, formatted } = args as {
      room_id: string;
      message: string;
      formatted?: boolean;
    };
    if (!room_id || !message) return this.error("room_id and message are required");

    try {
      const txnId = `m${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      const content: Record<string, string> = { msgtype: "m.text", body: message };
      if (formatted) {
        content.format = "org.matrix.custom.html";
        content.formatted_body = message;
      }
      await this.matrixFetch(
        `/rooms/${encodeURIComponent(room_id)}/send/m.room.message/${txnId}`,
        "PUT",
        content,
      );
      return this.ok(`Message sent to ${room_id}`);
    } catch (err) {
      return this.error(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async joinRoom(args: Record<string, unknown>): Promise<ToolResult> {
    const { room_id } = args as { room_id: string };
    if (!room_id) return this.error("room_id is required");

    try {
      await this.matrixFetch(`/join/${encodeURIComponent(room_id)}`, "POST", {});
      return this.ok(`Joined room ${room_id}`);
    } catch (err) {
      return this.error(`Failed to join room: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async listRooms(): Promise<ToolResult> {
    try {
      const data = (await this.matrixFetch("/joined_rooms")) as { joined_rooms: string[] };
      return this.ok(JSON.stringify({ rooms: data.joined_rooms, count: data.joined_rooms.length }));
    } catch (err) {
      return this.error(`Failed to list rooms: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async getMessages(args: Record<string, unknown>): Promise<ToolResult> {
    const { room_id, limit } = args as { room_id: string; limit?: number };
    if (!room_id) return this.error("room_id is required");

    const msgLimit = Math.min(limit || 20, 100);
    try {
      const data = (await this.matrixFetch(
        `/rooms/${encodeURIComponent(room_id)}/messages?dir=b&limit=${msgLimit}`,
      )) as { chunk: unknown[] };
      return this.ok(JSON.stringify({ messages: data.chunk, count: data.chunk.length }));
    } catch (err) {
      return this.error(`Failed to get messages: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
