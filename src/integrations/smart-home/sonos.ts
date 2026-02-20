/**
 * Sonos Integration
 *
 * Controls Sonos speakers via the Sonos Control API (cloud-based).
 * Supports playback control, volume adjustment, and now-playing queries.
 *
 * @requires SONOS_API_KEY - OAuth2 access token for the Sonos Control API.
 * @requires SONOS_HOUSEHOLD_ID - Household ID from Sonos developer account.
 * @see https://developer.sonos.com/reference/control-api/
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.ws.sonos.com/control/api/v1";

export default class SonosIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "sonos",
    name: "Sonos",
    category: "smart-home",
    version: "1.0.0",
    description: "Control Sonos speakers -- play music, pause, adjust volume, and check what is playing.",
    auth: {
      type: "token",
      envVars: ["SONOS_API_KEY", "SONOS_HOUSEHOLD_ID"],
    },
    tools: [
      {
        name: "sonos_play",
        description: "Play music or a radio station on a Sonos group. Provide a group ID and optionally a streaming URL or a Sonos favorite name.",
        parameters: {
          type: "object",
          properties: {
            groupId: { type: "string", description: "Sonos group (room) ID. Use sonos_now_playing to discover groups." },
            streamUrl: { type: "string", description: "HTTP(S) URL of an audio stream or track to play. Optional -- omit to resume current queue." },
            favoriteName: { type: "string", description: "Name of a Sonos favorite to load. Ignored if streamUrl is provided." },
          },
          required: ["groupId"],
        },
      },
      {
        name: "sonos_pause",
        description: "Pause playback on a Sonos group.",
        parameters: {
          type: "object",
          properties: {
            groupId: { type: "string", description: "Sonos group ID to pause." },
          },
          required: ["groupId"],
        },
      },
      {
        name: "sonos_volume",
        description: "Set the volume level on a Sonos group (0-100).",
        parameters: {
          type: "object",
          properties: {
            groupId: { type: "string", description: "Sonos group ID." },
            volume: { type: "number", description: "Volume level from 0 to 100." },
          },
          required: ["groupId", "volume"],
        },
      },
      {
        name: "sonos_now_playing",
        description: "Get the currently playing track and playback state for all groups in the household.",
        parameters: { type: "object", properties: {} },
      },
    ],
  };

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const creds = await this.getCredentials<{ SONOS_API_KEY: string; SONOS_HOUSEHOLD_ID: string }>();
    if (!creds?.SONOS_API_KEY) throw new Error("Missing SONOS_API_KEY");
    if (!creds?.SONOS_HOUSEHOLD_ID) throw new Error("Missing SONOS_HOUSEHOLD_ID");

    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${creds.SONOS_API_KEY}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }

  private async getHouseholdId(): Promise<string> {
    const creds = await this.getCredentials<{ SONOS_HOUSEHOLD_ID: string }>();
    return creds!.SONOS_HOUSEHOLD_ID;
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "sonos_play":
          return await this.play(
            args.groupId as string,
            args.streamUrl as string | undefined,
            args.favoriteName as string | undefined,
          );
        case "sonos_pause":
          return await this.pause(args.groupId as string);
        case "sonos_volume":
          return await this.setVolume(args.groupId as string, args.volume as number);
        case "sonos_now_playing":
          return await this.nowPlaying();
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Sonos error: ${(err as Error).message}`);
    }
  }

  private async play(groupId: string, streamUrl?: string, favoriteName?: string): Promise<ToolResult> {
    // If a stream URL is provided, use the audioClip or loadStreamUrl endpoint
    if (streamUrl) {
      const res = await this.request(`/groups/${groupId}/playback/loadStreamUrl`, {
        method: "POST",
        body: JSON.stringify({ streamUrl }),
      });
      if (!res.ok) return this.error(`Load stream failed (${res.status}): ${await res.text()}`);
      return this.ok(`Now streaming: ${streamUrl}`, { groupId });
    }

    // If a favorite name is given, resolve it and load
    if (favoriteName) {
      const householdId = await this.getHouseholdId();
      const favRes = await this.request(`/households/${householdId}/favorites`);
      if (!favRes.ok) return this.error(`Failed to fetch favorites (${favRes.status})`);
      const favData = (await favRes.json()) as any;
      const items = favData.items ?? [];
      const match = items.find(
        (f: any) => f.name.toLowerCase() === favoriteName.toLowerCase(),
      );
      if (!match) {
        const available = items.map((f: any) => f.name).join(", ");
        return this.error(`Favorite "${favoriteName}" not found. Available: ${available}`);
      }

      const loadRes = await this.request(`/groups/${groupId}/favorites`, {
        method: "POST",
        body: JSON.stringify({ favoriteId: match.id, playOnCompletion: true }),
      });
      if (!loadRes.ok) return this.error(`Load favorite failed (${loadRes.status}): ${await loadRes.text()}`);
      return this.ok(`Playing favorite: ${match.name}`, { groupId, favoriteId: match.id });
    }

    // No URL or favorite -- just resume playback
    const res = await this.request(`/groups/${groupId}/playback/play`, { method: "POST" });
    if (!res.ok) return this.error(`Play failed (${res.status}): ${await res.text()}`);
    return this.ok("Playback resumed.", { groupId });
  }

  private async pause(groupId: string): Promise<ToolResult> {
    const res = await this.request(`/groups/${groupId}/playback/pause`, { method: "POST" });
    if (!res.ok) return this.error(`Pause failed (${res.status}): ${await res.text()}`);
    return this.ok("Playback paused.", { groupId });
  }

  private async setVolume(groupId: string, volume: number): Promise<ToolResult> {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    const res = await this.request(`/groups/${groupId}/groupVolume`, {
      method: "POST",
      body: JSON.stringify({ volume: clamped }),
    });
    if (!res.ok) return this.error(`Volume change failed (${res.status}): ${await res.text()}`);
    return this.ok(`Volume set to ${clamped}.`, { groupId, volume: clamped });
  }

  private async nowPlaying(): Promise<ToolResult> {
    const householdId = await this.getHouseholdId();
    const groupsRes = await this.request(`/households/${householdId}/groups`);
    if (!groupsRes.ok) return this.error(`Failed to fetch groups (${groupsRes.status})`);
    const groupsData = (await groupsRes.json()) as any;
    const groups = groupsData.groups ?? [];

    if (!groups.length) return this.ok("No Sonos groups found in this household.");

    const lines: string[] = [];
    for (const group of groups) {
      const metaRes = await this.request(`/groups/${group.id}/playbackMetadata`);
      const state = await this.request(`/groups/${group.id}/playback`);

      let trackInfo = "Nothing playing";
      let playbackState = "IDLE";

      if (metaRes.ok) {
        const meta = (await metaRes.json()) as any;
        const track = meta.currentItem?.track;
        if (track) {
          const artist = track.artist?.name ?? "Unknown artist";
          trackInfo = `${track.name} by ${artist}`;
        }
      }

      if (state.ok) {
        const stateData = (await state.json()) as any;
        playbackState = stateData.playbackState ?? "UNKNOWN";
      }

      lines.push(`[${group.name}] (${group.id}) ${playbackState} -- ${trackInfo}`);
    }

    return this.ok(lines.join("\n"), { groupCount: groups.length });
  }
}
