/**
 * LinkedIn Integration
 *
 * Share posts and retrieve profile information via the LinkedIn API v2.
 * Uses OAuth 2.0 three-legged access tokens for member-level operations.
 *
 * @requires LINKEDIN_ACCESS_TOKEN - OAuth 2.0 access token with w_member_social and r_liteprofile scopes.
 * @see https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 * @see https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.linkedin.com/v2";

interface LinkedInCreds {
  LINKEDIN_ACCESS_TOKEN: string;
}

export default class LinkedInIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "linkedin",
    name: "LinkedIn",
    category: "social",
    version: "1.0.0",
    description: "Share posts and retrieve profile information on LinkedIn.",
    auth: {
      type: "token",
      envVars: ["LINKEDIN_ACCESS_TOKEN"],
    },
    tools: [
      {
        name: "linkedin_post",
        description: "Share a text post on LinkedIn on behalf of the authenticated member.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "The text content of the post (max 3000 characters)." },
            visibility: {
              type: "string",
              description: "Post visibility: PUBLIC or CONNECTIONS.",
              enum: ["PUBLIC", "CONNECTIONS"],
            },
          },
          required: ["text"],
        },
      },
      {
        name: "linkedin_profile",
        description: "Get the authenticated member's LinkedIn profile information.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ],
    capabilities: { offline: false, streaming: false },
  };

  private async getToken(): Promise<string> {
    // Check env var first, then credential manager
    const envToken = process.env.LINKEDIN_ACCESS_TOKEN;
    if (envToken) return envToken;

    const creds = await this.getCredentials<LinkedInCreds>();
    if (!creds?.LINKEDIN_ACCESS_TOKEN) {
      throw new Error("Missing LINKEDIN_ACCESS_TOKEN. Set the env var or configure credentials.");
    }
    return creds.LINKEDIN_ACCESS_TOKEN;
  }

  private async request(
    endpoint: string,
    options: { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> } = {}
  ): Promise<any> {
    const token = await this.getToken();
    const { method = "GET", body, headers = {} } = options;

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": "202401",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LinkedIn API ${res.status}: ${errBody}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Fetch the authenticated member's URN (person ID).
   * Required for composing posts under the member's identity.
   */
  private async getMemberUrn(): Promise<string> {
    const data = await this.request("/userinfo");
    const sub = data.sub;
    if (!sub) throw new Error("Could not resolve member URN from /userinfo");
    return `urn:li:person:${sub}`;
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "linkedin_post":
          return await this.createPost(args);
        case "linkedin_profile":
          return await this.getProfile();
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`LinkedIn error: ${(err as Error).message}`);
    }
  }

  private async createPost(args: Record<string, unknown>): Promise<ToolResult> {
    const text = args.text as string;
    if (!text) return this.error("Post text is required.");

    const visibility = (args.visibility as string) || "PUBLIC";
    const authorUrn = await this.getMemberUrn();

    const body = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": visibility,
      },
    };

    const data = await this.request("/ugcPosts", { method: "POST", body });
    const postId = data.id || "unknown";

    return this.ok(`Post shared on LinkedIn (id: ${postId})`, {
      postId,
      author: authorUrn,
      visibility,
    });
  }

  private async getProfile(): Promise<ToolResult> {
    const data = await this.request("/userinfo");

    const profile = {
      id: data.sub,
      name: data.name || `${data.given_name || ""} ${data.family_name || ""}`.trim(),
      email: data.email,
      picture: data.picture,
      locale: data.locale,
    };

    const summary = [
      `Name: ${profile.name}`,
      profile.email ? `Email: ${profile.email}` : null,
      `ID: ${profile.id}`,
    ]
      .filter(Boolean)
      .join("\n");

    return this.ok(summary, profile);
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.getToken();
      const data = await this.request("/userinfo");
      return { healthy: true, message: `Connected as ${data.name || data.sub}` };
    } catch (err) {
      return { healthy: false, message: (err as Error).message };
    }
  }
}
