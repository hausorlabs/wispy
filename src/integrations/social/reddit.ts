/**
 * Reddit Integration
 *
 * Submit posts, search content, and reply to threads via the Reddit API (OAuth2).
 * Uses script-type OAuth (password grant) for server-side operations.
 *
 * @requires REDDIT_CLIENT_ID - OAuth app client ID (from https://www.reddit.com/prefs/apps).
 * @requires REDDIT_CLIENT_SECRET - OAuth app client secret.
 * @requires REDDIT_USERNAME - Reddit account username.
 * @requires REDDIT_PASSWORD - Reddit account password.
 * @see https://www.reddit.com/dev/api
 * @see https://github.com/reddit-archive/reddit/wiki/OAuth2
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const AUTH_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const USER_AGENT = "wispy-ai:1.0.0 (by /u/wispy-agent)";

interface RedditCreds {
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  REDDIT_USERNAME: string;
  REDDIT_PASSWORD: string;
}

export default class RedditIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "reddit",
    name: "Reddit",
    category: "social",
    version: "1.0.0",
    description: "Submit posts, search content, and reply to threads on Reddit.",
    auth: {
      type: "oauth2",
      envVars: [
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "REDDIT_USERNAME",
        "REDDIT_PASSWORD",
      ],
    },
    tools: [
      {
        name: "reddit_post",
        description: "Submit a new text or link post to a subreddit.",
        parameters: {
          type: "object",
          properties: {
            subreddit: { type: "string", description: "Target subreddit name (without r/ prefix)." },
            title: { type: "string", description: "Post title (max 300 characters)." },
            text: { type: "string", description: "Self-post body text (markdown supported). Omit for link posts." },
            url: { type: "string", description: "URL for link posts. Omit for self/text posts." },
            flair_id: { type: "string", description: "Optional flair template ID for the post." },
          },
          required: ["subreddit", "title"],
        },
      },
      {
        name: "reddit_search",
        description: "Search Reddit for posts matching a query.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query string." },
            subreddit: { type: "string", description: "Limit search to a specific subreddit (optional)." },
            sort: {
              type: "string",
              description: "Sort order for results.",
              enum: ["relevance", "hot", "top", "new", "comments"],
            },
            time: {
              type: "string",
              description: "Time filter for results.",
              enum: ["hour", "day", "week", "month", "year", "all"],
            },
            limit: { type: "number", description: "Number of results to return (max 100, default 10)." },
          },
          required: ["query"],
        },
      },
      {
        name: "reddit_comment",
        description: "Reply to a Reddit post or comment by its fullname (thing ID).",
        parameters: {
          type: "object",
          properties: {
            thing_id: {
              type: "string",
              description: "Fullname of the parent post (t3_xxx) or comment (t1_xxx) to reply to.",
            },
            text: { type: "string", description: "Comment body text (markdown supported)." },
          },
          required: ["thing_id", "text"],
        },
      },
    ],
    capabilities: { offline: false, streaming: false },
  };

  /** Cached OAuth bearer token and its expiry timestamp. */
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  private getCreds(): RedditCreds {
    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    const username = process.env.REDDIT_USERNAME;
    const password = process.env.REDDIT_PASSWORD;

    if (!clientId || !clientSecret || !username || !password) {
      throw new Error(
        "Missing Reddit credentials. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD."
      );
    }

    return {
      REDDIT_CLIENT_ID: clientId,
      REDDIT_CLIENT_SECRET: clientSecret,
      REDDIT_USERNAME: username,
      REDDIT_PASSWORD: password,
    };
  }

  /**
   * Obtain an OAuth2 bearer token via the password grant flow.
   * Caches the token and refreshes it when expired.
   */
  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const creds = this.getCreds();
    const basicAuth = Buffer.from(`${creds.REDDIT_CLIENT_ID}:${creds.REDDIT_CLIENT_SECRET}`).toString("base64");

    const body = new URLSearchParams({
      grant_type: "password",
      username: creds.REDDIT_USERNAME,
      password: creds.REDDIT_PASSWORD,
    });

    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Reddit auth failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    if (data.error) {
      throw new Error(`Reddit auth error: ${data.error}`);
    }

    this.accessToken = data.access_token;
    // Expire 60 seconds early to avoid edge cases
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

    return this.accessToken!;
  }

  /**
   * Make an authenticated request to the Reddit OAuth API.
   */
  private async request(
    endpoint: string,
    options: { method?: string; body?: URLSearchParams | string; json?: Record<string, unknown> } = {}
  ): Promise<any> {
    const token = await this.authenticate();
    const { method = "GET", body, json } = options;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
    };

    let fetchBody: string | undefined;
    if (json) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(json);
    } else if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      fetchBody = body.toString();
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: fetchBody,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Reddit API ${res.status}: ${errText}`);
    }

    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "reddit_post":
          return await this.submitPost(args);
        case "reddit_search":
          return await this.search(args);
        case "reddit_comment":
          return await this.comment(args);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Reddit error: ${(err as Error).message}`);
    }
  }

  private async submitPost(args: Record<string, unknown>): Promise<ToolResult> {
    const subreddit = args.subreddit as string;
    const title = args.title as string;
    const text = args.text as string | undefined;
    const url = args.url as string | undefined;
    const flairId = args.flair_id as string | undefined;

    if (!subreddit || !title) {
      return this.error("subreddit and title are required.");
    }

    const params = new URLSearchParams({
      sr: subreddit,
      title,
      kind: url ? "link" : "self",
      api_type: "json",
      resubmit: "true",
    });

    if (url) {
      params.set("url", url);
    } else if (text) {
      params.set("text", text);
    }

    if (flairId) {
      params.set("flair_id", flairId);
    }

    const data = await this.request("/api/submit", { method: "POST", body: params });
    const result = data?.json?.data;

    if (data?.json?.errors?.length) {
      const errors = data.json.errors.map((e: string[]) => e.join(": ")).join("; ");
      return this.error(`Reddit submission errors: ${errors}`);
    }

    const postUrl = result?.url || "unknown";
    const postId = result?.id || result?.name || "unknown";

    return this.ok(`Post submitted to r/${subreddit}: ${postUrl}`, {
      postId,
      postUrl,
      subreddit,
      kind: url ? "link" : "self",
    });
  }

  private async search(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;
    if (!query) return this.error("Search query is required.");

    const subreddit = args.subreddit as string | undefined;
    const sort = (args.sort as string) || "relevance";
    const time = (args.time as string) || "all";
    const limit = Math.min(Math.max((args.limit as number) || 10, 1), 100);

    const endpoint = subreddit
      ? `/r/${encodeURIComponent(subreddit)}/search`
      : "/search";

    const params = new URLSearchParams({
      q: query,
      sort,
      t: time,
      limit: limit.toString(),
      type: "link",
      restrict_sr: subreddit ? "true" : "false",
    });

    const data = await this.request(`${endpoint}?${params.toString()}`);
    const posts = data?.data?.children || [];

    if (posts.length === 0) {
      return this.ok("No results found.", { query, count: 0 });
    }

    const summary = posts
      .map((child: any, i: number) => {
        const p = child.data;
        return [
          `${i + 1}. [${p.score} pts] ${p.title}`,
          `   r/${p.subreddit} | ${p.num_comments} comments | ${p.author}`,
          `   ${p.url}`,
          `   id: ${p.name}`,
        ].join("\n");
      })
      .join("\n\n");

    return this.ok(summary, {
      query,
      count: posts.length,
      subreddit: subreddit || "all",
    });
  }

  private async comment(args: Record<string, unknown>): Promise<ToolResult> {
    const thingId = args.thing_id as string;
    const text = args.text as string;

    if (!thingId || !text) {
      return this.error("thing_id and text are required.");
    }

    // Validate thing_id format (t1_ for comment, t3_ for post)
    if (!thingId.startsWith("t1_") && !thingId.startsWith("t3_")) {
      return this.error("thing_id must be a fullname starting with t1_ (comment) or t3_ (post).");
    }

    const params = new URLSearchParams({
      thing_id: thingId,
      text,
      api_type: "json",
    });

    const data = await this.request("/api/comment", { method: "POST", body: params });

    if (data?.json?.errors?.length) {
      const errors = data.json.errors.map((e: string[]) => e.join(": ")).join("; ");
      return this.error(`Comment errors: ${errors}`);
    }

    const commentData = data?.json?.data?.things?.[0]?.data;
    const commentId = commentData?.name || "unknown";
    const parentType = thingId.startsWith("t1_") ? "comment" : "post";

    return this.ok(`Reply posted to ${parentType} ${thingId} (id: ${commentId})`, {
      commentId,
      parentId: thingId,
      parentType,
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.authenticate();
      const data = await this.request("/api/v1/me");
      return {
        healthy: true,
        message: `Connected as u/${data.name} (${data.total_karma} karma)`,
      };
    } catch (err) {
      return { healthy: false, message: (err as Error).message };
    }
  }
}
