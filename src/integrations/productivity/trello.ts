/**
 * Trello Integration
 *
 * Provides access to Trello boards and cards via the Trello REST API.
 * Supports listing boards, listing cards, creating cards, and moving cards
 * between lists.
 *
 * @requires TRELLO_API_KEY - API key from https://trello.com/power-ups/admin
 * @requires TRELLO_TOKEN - User token generated via Trello authorization flow.
 * @see https://developer.atlassian.com/cloud/trello/rest/
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.trello.com/1";

export default class TrelloIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "trello",
    name: "Trello",
    category: "productivity",
    version: "1.0.0",
    description: "List boards, list cards, create cards, and move cards in Trello.",
    auth: {
      type: "api-key",
      envVars: ["TRELLO_API_KEY", "TRELLO_TOKEN"],
    },
    tools: [
      {
        name: "trello_list_boards",
        description: "List all boards accessible to the authenticated user.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "trello_list_cards",
        description: "List cards on a specific board, optionally filtered by list.",
        parameters: {
          type: "object",
          properties: {
            boardId: { type: "string", description: "Board ID." },
            listId: { type: "string", description: "Filter to a specific list ID (optional)." },
          },
          required: ["boardId"],
        },
      },
      {
        name: "trello_create_card",
        description: "Create a new card on a Trello list.",
        parameters: {
          type: "object",
          properties: {
            listId: { type: "string", description: "List ID to create the card in." },
            name: { type: "string", description: "Card name." },
            desc: { type: "string", description: "Card description (Markdown)." },
          },
          required: ["listId", "name"],
        },
      },
      {
        name: "trello_move_card",
        description: "Move a card to a different list.",
        parameters: {
          type: "object",
          properties: {
            cardId: { type: "string", description: "Card ID to move." },
            listId: { type: "string", description: "Destination list ID." },
          },
          required: ["cardId", "listId"],
        },
      },
    ],
  };

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const creds = await this.getCredentials<{ TRELLO_API_KEY: string; TRELLO_TOKEN: string }>();
    if (!creds?.TRELLO_API_KEY || !creds?.TRELLO_TOKEN) {
      throw new Error("Missing TRELLO_API_KEY or TRELLO_TOKEN");
    }

    const separator = path.includes("?") ? "&" : "?";
    const url = `${API_BASE}${path}${separator}key=${creds.TRELLO_API_KEY}&token=${creds.TRELLO_TOKEN}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) throw new Error(`Trello ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "trello_list_boards":
          return await this.listBoards();
        case "trello_list_cards":
          return await this.listCards(args.boardId as string, args.listId as string | undefined);
        case "trello_create_card":
          return await this.createCard(args.listId as string, args.name as string, args.desc as string | undefined);
        case "trello_move_card":
          return await this.moveCard(args.cardId as string, args.listId as string);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Trello error: ${(err as Error).message}`);
    }
  }

  private async listBoards(): Promise<ToolResult> {
    const data = await this.request("/members/me/boards?fields=id,name,url,closed");
    const boards = (data as any[]).filter((b: any) => !b.closed);
    const summary = boards
      .map((b: any) => `${b.name} (${b.id})\n  ${b.url}`)
      .join("\n");
    return this.ok(summary || "No boards found.", { count: boards.length });
  }

  private async listCards(boardId: string, listId?: string): Promise<ToolResult> {
    if (listId) {
      const data = await this.request(`/lists/${listId}/cards?fields=id,name,desc,idList,url`);
      const summary = (data as any[])
        .map((c: any) => `[${c.id}] ${c.name}`)
        .join("\n");
      return this.ok(summary || "No cards found.", { count: (data as any[]).length });
    }

    // Fetch all lists first, then cards grouped by list
    const lists = await this.request(`/boards/${boardId}/lists?fields=id,name`);
    const cards = await this.request(`/boards/${boardId}/cards?fields=id,name,idList,url`);

    const listNames = new Map((lists as any[]).map((l: any) => [l.id, l.name]));
    const summary = (cards as any[])
      .map((c: any) => `[${listNames.get(c.idList) ?? "Unknown"}] ${c.name} (${c.id})`)
      .join("\n");
    return this.ok(summary || "No cards found.", { count: (cards as any[]).length });
  }

  private async createCard(listId: string, name: string, desc?: string): Promise<ToolResult> {
    const body: Record<string, unknown> = { idList: listId, name };
    if (desc) body.desc = desc;

    const data = await this.request("/cards", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return this.ok(`Card created: ${data.name}\n${data.url}`, {
      id: data.id,
      url: data.url,
    });
  }

  private async moveCard(cardId: string, listId: string): Promise<ToolResult> {
    const data = await this.request(`/cards/${cardId}`, {
      method: "PUT",
      body: JSON.stringify({ idList: listId }),
    });
    return this.ok(`Card "${data.name}" moved to list ${listId}.`, { id: data.id });
  }
}
