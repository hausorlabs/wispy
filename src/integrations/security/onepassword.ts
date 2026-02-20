/**
 * 1Password Integration
 *
 * Retrieves secrets and lists vaults using the 1Password Connect API.
 * Requires a service account token or Connect server credentials.
 *
 * @requires OP_SERVICE_ACCOUNT_TOKEN - 1Password service account token
 * @see https://developer.1password.com/docs/connect/
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const DEFAULT_HOST = "https://connect.1password.com";

export default class OnePasswordIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "onepassword",
    name: "1Password",
    category: "security",
    version: "1.0.0",
    description: "Retrieve secrets and list vaults from 1Password.",
    website: "https://1password.com",
    auth: {
      type: "api-key",
      envVars: ["OP_SERVICE_ACCOUNT_TOKEN"],
    },
    requires: { env: ["OP_SERVICE_ACCOUNT_TOKEN"] },
    tools: [
      {
        name: "op_get_secret",
        description: "Retrieve a secret from a 1Password vault by item title or ID.",
        parameters: {
          type: "object",
          properties: {
            vault: { type: "string", description: "Vault name or ID containing the item." },
            item: { type: "string", description: "Item title or ID to retrieve." },
            field: { type: "string", description: "Specific field label to return (e.g. 'password', 'username'). Returns all fields if omitted." },
          },
          required: ["vault", "item"],
        },
      },
      {
        name: "op_list_vaults",
        description: "List all available 1Password vaults the service account can access.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ],
  };

  private get token(): string {
    const t = process.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (!t) throw new Error("Missing OP_SERVICE_ACCOUNT_TOKEN");
    return t;
  }

  private get host(): string {
    return process.env.OP_CONNECT_HOST || DEFAULT_HOST;
  }

  private async opRequest(path: string): Promise<Response> {
    return fetch(`${this.host}/v1${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "op_get_secret":
          return await this.getSecret(args.vault as string, args.item as string, args.field as string | undefined);
        case "op_list_vaults":
          return await this.listVaults();
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`1Password error: ${(err as Error).message}`);
    }
  }

  private async listVaults(): Promise<ToolResult> {
    const res = await this.opRequest("/vaults");
    if (!res.ok) return this.error(`List vaults failed (${res.status}): ${await res.text()}`);

    const vaults = (await res.json()) as Array<{ id: string; name: string; description?: string; items: number }>;
    if (vaults.length === 0) return this.ok("No vaults accessible.", { count: 0 });

    const lines = vaults.map((v) =>
      `  ${v.id} | ${v.name}${v.description ? ` - ${v.description}` : ""} (${v.items ?? "?"} items)`
    );
    return this.ok(`Vaults (${vaults.length}):\n${lines.join("\n")}`, { count: vaults.length });
  }

  private async getSecret(vault: string, item: string, field?: string): Promise<ToolResult> {
    // Resolve vault ID if a name was provided
    const vaultId = await this.resolveVaultId(vault);
    if (!vaultId) return this.error(`Vault not found: ${vault}`);

    // List items in vault to find the target
    const itemsRes = await this.opRequest(`/vaults/${vaultId}/items?filter=title eq "${encodeURIComponent(item)}"`);
    if (!itemsRes.ok) {
      // Fallback: try using item as a direct ID
      const directRes = await this.opRequest(`/vaults/${vaultId}/items/${encodeURIComponent(item)}`);
      if (!directRes.ok) return this.error(`Item not found: ${item} in vault ${vault}`);
      return this.formatItem(await directRes.json(), field);
    }

    const items = (await itemsRes.json()) as Array<{ id: string; title: string }>;
    if (items.length === 0) {
      // Fallback: try direct ID lookup
      const directRes = await this.opRequest(`/vaults/${vaultId}/items/${encodeURIComponent(item)}`);
      if (!directRes.ok) return this.error(`Item not found: ${item}`);
      return this.formatItem(await directRes.json(), field);
    }

    // Fetch full item details
    const detailRes = await this.opRequest(`/vaults/${vaultId}/items/${items[0].id}`);
    if (!detailRes.ok) return this.error(`Failed to fetch item details: ${detailRes.status}`);
    return this.formatItem(await detailRes.json(), field);
  }

  private async resolveVaultId(vaultNameOrId: string): Promise<string | null> {
    // Try direct ID first (UUIDs are 26 chars)
    if (/^[a-z0-9]{26}$/i.test(vaultNameOrId)) return vaultNameOrId;

    const res = await this.opRequest("/vaults");
    if (!res.ok) return null;
    const vaults = (await res.json()) as Array<{ id: string; name: string }>;
    const match = vaults.find(
      (v) => v.id === vaultNameOrId || v.name.toLowerCase() === vaultNameOrId.toLowerCase()
    );
    return match?.id ?? null;
  }

  private formatItem(
    item: { title?: string; fields?: Array<{ label: string; value: string; type: string }> },
    fieldFilter?: string
  ): ToolResult {
    const fields = item.fields ?? [];

    if (fieldFilter) {
      const match = fields.find((f) => f.label.toLowerCase() === fieldFilter.toLowerCase());
      if (!match) return this.error(`Field "${fieldFilter}" not found in item "${item.title}"`);
      return this.ok(match.value, { title: item.title, field: match.label });
    }

    // Return all non-empty concealed/text fields
    const visible = fields
      .filter((f) => f.value && f.type !== "REFERENCE")
      .map((f) => `  ${f.label}: ${f.value}`);

    if (visible.length === 0) return this.ok(`Item "${item.title}" has no readable fields.`);
    return this.ok(`${item.title}:\n${visible.join("\n")}`, { title: item.title, fieldCount: visible.length });
  }
}
