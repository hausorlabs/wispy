/**
 * Instagram Integration
 *
 * Publish photos/reels and retrieve account insights via the Instagram Graph API.
 * Requires a Facebook Page linked to an Instagram Professional account.
 * Uses a long-lived Page Access Token for API operations.
 *
 * @requires INSTAGRAM_ACCESS_TOKEN - Page access token with instagram_basic, instagram_content_publish, instagram_manage_insights.
 * @see https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
 * @see https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/insights
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

interface InstagramCreds {
  INSTAGRAM_ACCESS_TOKEN: string;
}

export default class InstagramIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "instagram",
    name: "Instagram",
    category: "social",
    version: "1.0.0",
    description: "Publish photos/reels and retrieve account insights via the Instagram Graph API.",
    auth: {
      type: "token",
      envVars: ["INSTAGRAM_ACCESS_TOKEN"],
    },
    tools: [
      {
        name: "instagram_post",
        description: "Publish a photo or reel to Instagram. Provide a publicly accessible media URL.",
        parameters: {
          type: "object",
          properties: {
            image_url: { type: "string", description: "Public URL of the image to post (JPEG recommended)." },
            video_url: { type: "string", description: "Public URL of the video for a reel (MP4, max 15 min)." },
            caption: { type: "string", description: "Post caption text (max 2200 characters). Supports hashtags." },
            media_type: {
              type: "string",
              description: "Type of media: IMAGE or REELS.",
              enum: ["IMAGE", "REELS"],
            },
          },
          required: ["caption"],
        },
      },
      {
        name: "instagram_insights",
        description: "Get account-level insights and metrics for the Instagram Professional account.",
        parameters: {
          type: "object",
          properties: {
            metric: {
              type: "string",
              description: "Comma-separated metrics: impressions, reach, profile_views, accounts_engaged, total_interactions, follows_and_unfollows.",
            },
            period: {
              type: "string",
              description: "Time period for the metrics: day, week, or days_28.",
              enum: ["day", "week", "days_28"],
            },
          },
        },
      },
    ],
    capabilities: { offline: false, streaming: false },
  };

  private async getToken(): Promise<string> {
    const envToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (envToken) return envToken;

    const creds = await this.getCredentials<InstagramCreds>();
    if (!creds?.INSTAGRAM_ACCESS_TOKEN) {
      throw new Error("Missing INSTAGRAM_ACCESS_TOKEN. Set the env var or configure credentials.");
    }
    return creds.INSTAGRAM_ACCESS_TOKEN;
  }

  /**
   * Resolve the Instagram Business/Creator account ID linked to the token.
   * Queries the /me/accounts endpoint to find the Page, then its linked IG account.
   */
  private async getInstagramAccountId(token: string): Promise<string> {
    // Get pages linked to the token
    const pagesRes = await fetch(
      `${GRAPH_BASE}/me/accounts?fields=instagram_business_account&access_token=${token}`
    );
    if (!pagesRes.ok) {
      throw new Error(`Failed to fetch pages: ${pagesRes.status} ${await pagesRes.text()}`);
    }
    const pagesData = (await pagesRes.json()) as any;
    const pages = pagesData.data || [];

    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        return page.instagram_business_account.id;
      }
    }

    throw new Error("No Instagram Professional account found linked to any Facebook Page on this token.");
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "instagram_post":
          return await this.publishPost(args);
        case "instagram_insights":
          return await this.getInsights(args);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Instagram error: ${(err as Error).message}`);
    }
  }

  /**
   * Two-step publishing flow:
   * 1. Create a media container (upload phase)
   * 2. Publish the container
   */
  private async publishPost(args: Record<string, unknown>): Promise<ToolResult> {
    const caption = args.caption as string;
    if (!caption) return this.error("Caption is required.");

    const imageUrl = args.image_url as string | undefined;
    const videoUrl = args.video_url as string | undefined;
    const mediaType = (args.media_type as string) || (videoUrl ? "REELS" : "IMAGE");

    if (mediaType === "IMAGE" && !imageUrl) {
      return this.error("image_url is required for IMAGE posts.");
    }
    if (mediaType === "REELS" && !videoUrl) {
      return this.error("video_url is required for REELS posts.");
    }

    const token = await this.getToken();
    const igAccountId = await this.getInstagramAccountId(token);

    // Step 1: Create media container
    const containerParams: Record<string, string> = {
      caption,
      access_token: token,
    };

    if (mediaType === "REELS") {
      containerParams.media_type = "REELS";
      containerParams.video_url = videoUrl!;
    } else {
      containerParams.image_url = imageUrl!;
    }

    const containerRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerParams),
    });

    if (!containerRes.ok) {
      const errText = await containerRes.text();
      throw new Error(`Container creation failed (${containerRes.status}): ${errText}`);
    }

    const containerData = (await containerRes.json()) as any;
    const containerId = containerData.id;
    if (!containerId) throw new Error("No container ID returned from media creation.");

    // For reels, poll until the container is ready (video processing)
    if (mediaType === "REELS") {
      await this.waitForContainerReady(containerId, token);
    }

    // Step 2: Publish the container
    const publishRes = await fetch(`${GRAPH_BASE}/${igAccountId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: token,
      }),
    });

    if (!publishRes.ok) {
      const errText = await publishRes.text();
      throw new Error(`Publish failed (${publishRes.status}): ${errText}`);
    }

    const publishData = (await publishRes.json()) as any;
    const mediaId = publishData.id;

    return this.ok(`Published ${mediaType.toLowerCase()} to Instagram (id: ${mediaId})`, {
      mediaId,
      containerId,
      mediaType,
      igAccountId,
    });
  }

  /**
   * Poll the container status until it is FINISHED (video processing complete).
   * Throws after max retries to prevent infinite loops.
   */
  private async waitForContainerReady(containerId: string, token: string): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusRes = await fetch(
        `${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${token}`
      );

      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as any;
        if (statusData.status_code === "FINISHED") return;
        if (statusData.status_code === "ERROR") {
          throw new Error(`Media processing failed: ${statusData.status || "unknown error"}`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error("Media processing timed out after 150 seconds.");
  }

  private async getInsights(args: Record<string, unknown>): Promise<ToolResult> {
    const token = await this.getToken();
    const igAccountId = await this.getInstagramAccountId(token);

    const metric = (args.metric as string) || "impressions,reach,accounts_engaged,total_interactions";
    const period = (args.period as string) || "day";

    const url =
      `${GRAPH_BASE}/${igAccountId}/insights` +
      `?metric=${encodeURIComponent(metric)}` +
      `&period=${encodeURIComponent(period)}` +
      `&access_token=${token}`;

    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Insights request failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const insights = data.data || [];

    if (insights.length === 0) {
      return this.ok("No insight data available for the requested metrics and period.", {
        metric,
        period,
      });
    }

    const summary = insights
      .map((m: any) => {
        const values = m.values?.map((v: any) => `  ${v.end_time}: ${JSON.stringify(v.value)}`).join("\n") || "  No data";
        return `${m.name} (${m.period}):\n${values}`;
      })
      .join("\n\n");

    return this.ok(summary, {
      metric,
      period,
      metricsCount: insights.length,
      igAccountId,
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      const token = await this.getToken();
      const igAccountId = await this.getInstagramAccountId(token);
      return { healthy: true, message: `Connected to IG account ${igAccountId}` };
    } catch (err) {
      return { healthy: false, message: (err as Error).message };
    }
  }
}
