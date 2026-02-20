/**
 * Discord Channel Adapter for Wispy
 *
 * Integrates with Discord via discord.js to provide bidirectional
 * messaging between Discord servers/DMs and the Wispy agent.
 */

import {
  registerChannel,
  registerChannelDispatcher,
  broadcastChannelEvent,
} from "../dock.js";
import { createLogger } from "../../infra/logger.js";

const log = createLogger("channel:discord");

export interface DiscordChannelConfig {
  token: string;
  applicationId?: string;
  prefix?: string;
  allowedGuilds?: string[];
  allowedChannels?: string[];
  ignoreBots?: boolean;
  maxMessageLength?: number;
}

type OnMessageFn = (
  chatId: string,
  text: string,
  meta?: Record<string, unknown>
) => Promise<string>;

export async function startDiscordChannel(
  config: DiscordChannelConfig,
  onMessage: OnMessageFn
): Promise<{ shutdown: () => Promise<void> }> {
  const prefix = config.prefix ?? "!wispy";
  const ignoreBots = config.ignoreBots ?? true;
  const maxLen = config.maxMessageLength ?? 2000;

  const capabilities = {
    text: true, media: true, voice: false,
    buttons: true, reactions: true, groups: true, threads: true,
  };

  registerChannel({ name: "discord", type: "chat", capabilities, status: "connecting" });

  let clientRef: any = null;

  try {
    const { Client, GatewayIntentBits, Partials, AttachmentBuilder } =
      await import("discord.js" as string);

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
    clientRef = client;

    client.on("messageCreate", async (msg: any) => {
      try {
        if (ignoreBots && msg.author.bot) return;
        if (config.allowedGuilds?.length && msg.guild && !config.allowedGuilds.includes(msg.guild.id)) return;
        if (config.allowedChannels?.length && !config.allowedChannels.includes(msg.channelId)) return;

        const content = msg.content.trim();
        const isDM = !msg.guild;
        const mentionRe = client.user
          ? new RegExp(`^<@!?${client.user.id}>`)
          : null;
        const isMentioned = mentionRe?.test(content) ?? false;
        const hasPrefix = content.startsWith(prefix);

        if (!isDM && !isMentioned && !hasPrefix) return;

        let userText = content;
        if (hasPrefix) {
          userText = content.slice(prefix.length).trim();
        } else if (isMentioned && mentionRe) {
          userText = content.replace(mentionRe, "").trim();
        }
        if (!userText) return;

        broadcastChannelEvent({
          type: "message", source: "discord",
          data: {
            text: userText, chatId: msg.channelId,
            author: msg.author.username,
            authorId: msg.author.id, guild: msg.guild?.name ?? null,
            guildId: msg.guild?.id ?? null, isDM,
          },
          timestamp: new Date().toISOString(),
        });

        await msg.channel.sendTyping();

        const response = await onMessage(msg.channelId, userText, {
          author: msg.author.username, authorId: msg.author.id,
          guild: msg.guild?.name, guildId: msg.guild?.id,
          channelName: "name" in msg.channel ? (msg.channel as any).name : "DM",
          isDM,
        });

        for (const chunk of splitMessage(response, maxLen)) {
          await msg.reply(chunk);
        }
      } catch (err) {
        log.error("Error handling Discord message: %s", err);
        try {
          await msg.reply("Something went wrong while processing your message.");
        } catch { /* noop */ }
      }
    });

    registerChannelDispatcher("discord", {
      async sendMessage(chatId: string, text: string): Promise<boolean> {
        if (!clientRef) return false;
        try {
          const channel = await clientRef.channels.fetch(chatId);
          if (!channel || !("send" in channel)) return false;
          for (const chunk of splitMessage(text, maxLen)) {
            await (channel as any).send(chunk);
          }
          return true;
        } catch { return false; }
      },
      async sendImage(chatId: string, imagePath: string, caption?: string): Promise<boolean> {
        if (!clientRef) return false;
        try {
          const { AttachmentBuilder } = await import("discord.js" as string);
          const channel = await clientRef.channels.fetch(chatId);
          if (!channel || !("send" in channel)) return false;
          const attachment = new AttachmentBuilder(imagePath);
          await (channel as any).send({ content: caption ?? "", files: [attachment] });
          return true;
        } catch { return false; }
      },
    });

    await client.login(config.token);
    log.info("Discord channel connected as %s", client.user?.tag ?? "unknown");
    registerChannel({ name: "discord", type: "chat", capabilities, status: "connected" });

    return {
      async shutdown() {
        log.info("Shutting down Discord channel");
        client.destroy();
        clientRef = null;
      },
    };
  } catch (err) {
    log.error("Failed to start Discord channel: %s", err);
    registerChannel({ name: "discord", type: "chat", capabilities, status: "error" });
    return { async shutdown() {} };
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

export async function startDiscordFromEnv(
  onMessage: OnMessageFn
): Promise<{ shutdown: () => Promise<void> } | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  return startDiscordChannel({ token }, onMessage);
}
