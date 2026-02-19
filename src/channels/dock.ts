// Plugin dock pattern — channels declare capabilities as metadata
// Supports event broadcasting for cross-channel sync (CLI <-> Telegram)

export interface ChannelCapabilities {
  text: boolean;
  media: boolean;
  voice: boolean;
  buttons: boolean;
  reactions: boolean;
  groups: boolean;
  threads: boolean;
}

export interface ChannelDock {
  name: string;
  type: string;
  capabilities: ChannelCapabilities;
  status: "connected" | "connecting" | "disconnected" | "error";
  connectedAt?: string;
  error?: string;
}

export interface ChannelEvent {
  type: "message" | "marathon_update" | "approval" | "notification" | "status_change";
  source: string;
  target?: string; // If undefined, broadcast to all channels
  data: Record<string, unknown>;
  timestamp: string;
}

export type ChannelEventListener = (event: ChannelEvent) => void;

/** Cross-channel dispatch functions for sending media/messages from any channel */
export interface ChannelDispatcher {
  sendMessage: (chatId: string, text: string) => Promise<boolean>;
  sendImage: (chatId: string, imagePath: string, caption?: string) => Promise<boolean>;
  sendDocument?: (chatId: string, filePath: string, caption?: string) => Promise<boolean>;
}

const registry = new Map<string, ChannelDock>();
const dispatchers = new Map<string, ChannelDispatcher>();
const eventListeners = new Map<string, ChannelEventListener[]>();

export function registerChannel(dock: ChannelDock) {
  registry.set(dock.name, dock);
}

export function getChannel(name: string): ChannelDock | undefined {
  return registry.get(name);
}

export function getAllChannels(): ChannelDock[] {
  return Array.from(registry.values());
}

export function updateChannelStatus(
  name: string,
  status: ChannelDock["status"],
  error?: string
) {
  const ch = registry.get(name);
  if (ch) {
    ch.status = status;
    ch.error = error;
    if (status === "connected") ch.connectedAt = new Date().toISOString();
  }
}

/** Register a channel's dispatch functions for cross-channel sending */
export function registerChannelDispatcher(channelName: string, dispatcher: ChannelDispatcher): void {
  dispatchers.set(channelName, dispatcher);
}

/** Get a registered channel dispatcher */
export function getChannelDispatcher(channelName: string): ChannelDispatcher | undefined {
  return dispatchers.get(channelName);
}

/**
 * Subscribe a channel to events
 */
export function onChannelEvent(channelName: string, listener: ChannelEventListener): () => void {
  const listeners = eventListeners.get(channelName) || [];
  listeners.push(listener);
  eventListeners.set(channelName, listeners);
  return () => {
    const current = eventListeners.get(channelName) || [];
    eventListeners.set(channelName, current.filter(l => l !== listener));
  };
}

/**
 * Broadcast an event to all channels (or a specific target)
 */
export function broadcastChannelEvent(event: ChannelEvent): void {
  if (event.target) {
    // Send to specific channel
    const listeners = eventListeners.get(event.target) || [];
    for (const listener of listeners) {
      try { listener(event); } catch {}
    }
  } else {
    // Broadcast to all channels except source
    for (const [name, listeners] of eventListeners) {
      if (name === event.source) continue;
      for (const listener of listeners) {
        try { listener(event); } catch {}
      }
    }
  }
}
