/**
 * Wispy CLI - Root Ink Application
 *
 * Manages conversation state, streaming, tool calls, and input.
 * Uses Ink's Static component for completed messages (never re-rendered)
 * and a dynamic area for current activity (thinking spinner, streaming text).
 *
 * Features:
 *   - Slash command palette with live filtering (type / to activate)
 *   - Arrow key navigation + Tab/Enter to autocomplete commands
 *   - Markdown-rendered responses
 *   - Streaming with cursor indicator
 *   - Ctrl+C to cancel / exit
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { Banner } from "./Banner.js";
import { ToolCall, ToolResult } from "./ToolCall.js";
import { ThinkingSpinner } from "./ThinkingSpinner.js";
import { GlareBar } from "./GlareBar.js";
import { ThoughtSignature } from "./ThoughtSignature.js";
import { StatsLine } from "./StatsLine.js";
import { Separator } from "./Separator.js";
import { MarkdownText } from "./MarkdownText.js";
import { filterCommands } from "./command-registry.js";
import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import gradient from "gradient-string";
import { getTheme } from "../ui/theme.js";
import type { HistoryEntry, NewHistoryEntry } from "./types.js";
import type { Agent } from "../../core/agent.js";
import type { SessionType } from "../../security/isolation.js";
import type { TokenManager } from "../../token/estimator.js";
import type { CommandDef } from "./command-registry.js";
import { onChannelEvent } from "../../channels/dock.js";

// ── Ink instance clear — called from ink-repl.tsx after render() ─
// Ink's clear() resets its internal line tracking, which prevents
// ghost renders when the terminal resizes on Windows Terminal.
let _inkClear: (() => void) | null = null;
export function registerInkClear(fn: () => void) { _inkClear = fn; }

// ── Props ────────────────────────────────────────────────────────

interface AppProps {
  agent: Agent;
  config: any;
  tokenManager: TokenManager;
  vertexEnabled: boolean;
  runtimeDir: string;
  soulDir: string;
  connectedChannels?: string[];
  marathonService?: any;
}

// ── ID generator ─────────────────────────────────────────────────

let _id = 0;
const nextId = () => String(++_id);

// ── Constants ────────────────────────────────────────────────────

const MAX_PALETTE_VISIBLE = 12;

// ── Image extraction ────────────────────────────────────────────
// Detects image file paths in user input, loads them as base64,
// and strips the paths from the text.

interface ImagePart {
  mimeType: string;
  data: string;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

function extractImages(input: string): { text: string; images: ImagePart[] } {
  const images: ImagePart[] = [];
  const pathRegex = /(?:[A-Za-z]:[\\\/]|[~.\/\\])[\w\-. \\\/]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg)/gi;
  const matches = input.match(pathRegex) || [];

  let text = input;
  for (const match of matches) {
    const ext = extname(match).toLowerCase();
    if (IMAGE_EXTS.has(ext) && existsSync(match)) {
      try {
        const data = readFileSync(match).toString("base64");
        images.push({ mimeType: MIME_MAP[ext] || "image/png", data });
        text = text.replace(match, "").trim();
      } catch {
        // skip unreadable files
      }
    }
  }

  if (!text && images.length > 0) text = "Describe this image.";
  return { text, images };
}

// ── History Item Renderer ────────────────────────────────────────

function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const theme = getTheme();
  const color = theme.primaryHex;

  switch (entry.type) {
    case "banner":
      return (
        <Banner
          model={entry.model}
          provider={entry.provider}
          cwd={entry.cwd}
          vertexai={entry.vertexai}
          channels={entry.channels}
        />
      );

    case "separator":
      return <Separator />;

    case "user-input": {
      const inputCols = process.stdout.columns || 80;
      const prompt = `\u276F ${entry.text}`;
      const padded = prompt.padEnd(inputCols);
      return (
        <Box marginTop={1}>
          <Text bold backgroundColor={theme.highlightBgHex} color="white">{padded}</Text>
        </Box>
      );
    }

    case "tool-call":
      return <ToolCall data={entry.data} />;

    case "tool-result":
      return <ToolResult data={entry.data} />;

    case "thinking":
      return (
        <ThoughtSignature
          text={entry.text}
          signature={entry.signature}
          thinkingLevel={entry.thinkingLevel}
        />
      );

    case "response":
      return <MarkdownText>{entry.text}</MarkdownText>;

    case "verification":
      return (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {(entry.text as string).split("\n").map((line: string, i: number) => {
            // Color-code specific elements in each line
            const isHeader = line.includes("HACKATHON DEMO") || line.startsWith("━") || line.startsWith("┗");
            const isBorder = /^[\s]*[┌┐└┘├┤┬┴┼─╔╗╚╝╠╣═]+[\s]*$/.test(line) || line.trim().startsWith("┌") || line.trim().startsWith("└");
            const isTrackPass = line.includes("PASS");
            const isTrackFail = line.includes("FAIL");
            if (isHeader) return <Text key={i} color={theme.primaryHex} bold>{line}</Text>;
            if (isBorder) return <Text key={i} dimColor>{line}</Text>;
            if (isTrackPass) return <Text key={i}>{line.replace("PASS", "")}<Text color="#4CAF50" bold>PASS</Text></Text>;
            if (isTrackFail) return <Text key={i}>{line.replace("FAIL", "")}<Text color="#EF4444" bold>FAIL</Text></Text>;
            return <Text key={i}>{line}</Text>;
          })}
        </Box>
      );

    case "stats":
      return <StatsLine data={entry.data} />;

    case "error":
      return (
        <Box marginLeft={2}>
          <Text color="red">{"\u25CF"} {entry.message}</Text>
        </Box>
      );

    case "context-compacted":
      return (
        <Box marginLeft={2}>
          <Text dimColor>{"  \u27F3"} Context auto-compacted</Text>
        </Box>
      );

    case "image-attached":
      return (
        <Box marginLeft={2}>
          <Text dimColor>
            {"  \u25C6"} {entry.count} image(s) attached
          </Text>
        </Box>
      );

    case "cross-channel":
      return (
        <Box marginLeft={2} marginTop={1}>
          <Text color="cyan" bold>{"\u25C6"} </Text>
          <Text dimColor>[{entry.source}] </Text>
          <Text italic>{entry.isVoice ? "\uD83C\uDF99 " : ""}{entry.text}</Text>
        </Box>
      );

    case "marathon-progress": {
      const icons: Record<string, string> = {
        started: "\u26A1",
        milestone_started: "\u250C",
        milestone_completed: "\u2713",
        milestone_failed: "\u2717",
        completed: "\u2713",
        approval_needed: "\u2691",
      };
      const colors: Record<string, string> = {
        started: "#31CCFF",
        milestone_started: "#34D399",
        milestone_completed: "#4CAF50",
        milestone_failed: "#EF4444",
        completed: "#4CAF50",
        approval_needed: "#C084FC",
      };
      const icon = icons[entry.event] || "\u25C6";
      const color = colors[entry.event] || "#FFB74D";

      // Progress bar with gradient coloring
      let bar = "";
      if (entry.total > 0) {
        const filled = Math.round((entry.progress / entry.total) * 20);
        const empty = 20 - filled;
        bar = ` ${"█".repeat(filled)}${"░".repeat(empty)} ${entry.progress}/${entry.total}`;
      }

      // Thinking level badge
      const levelLabels: Record<string, string> = { minimal: "MIN", low: "LOW", medium: "MED", high: "HIGH", ultra: "ULTRA" };
      const levelColors: Record<string, string> = { minimal: "#6B7280", low: "#60A5FA", medium: "#FBBF24", high: "#F97316", ultra: "#EF4444" };
      const lvl = entry.thinkingLevel || "";
      const levelBadge = levelLabels[lvl] || "";
      const levelColor = levelColors[lvl] || "#555";

      const isMajor = entry.event === "started" || entry.event === "completed";

      return (
        <Box marginLeft={2} marginTop={isMajor ? 1 : 0}>
          <Text color={color}>{icon} </Text>
          <Text bold={isMajor} color={isMajor ? color : undefined}>
            {entry.milestone || entry.event.replace(/_/g, " ")}
          </Text>
          {bar && <Text color={entry.progress === entry.total ? "#4CAF50" : "#FFB74D"}>{bar}</Text>}
          {levelBadge && <Text color={levelColor}> [{levelBadge}]</Text>}
          {entry.phase && <Text dimColor> {entry.phase}</Text>}
        </Box>
      );
    }

    case "x402-dashboard": {
      const d = entry.data;
      const spentPct = d.dailyLimit > 0 ? Math.min(100, (d.dailySpent / d.dailyLimit) * 100) : 0;
      const barLen = 20;
      const filled = Math.round((spentPct / 100) * barLen);
      const budgetBar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

      return (
        <Box flexDirection="column" marginTop={1} marginBottom={1} borderStyle="round" borderColor="#00FFA3" paddingX={2} paddingY={1}>
          <Text bold color="#00FFA3">{"\uD83D\uDCB3"} x402 Transaction Dashboard</Text>
          <Text dimColor>{"=".repeat(44)}</Text>
          <Text><Text bold>Wallet:  </Text><Text color="cyan">{d.walletAddress}</Text></Text>
          <Text><Text bold>Explorer:</Text> <Text dimColor>{d.explorerUrl}/address/{d.walletAddress.startsWith("0x") ? d.walletAddress : ""}</Text></Text>
          <Text><Text bold>USDC:    </Text><Text color="green">${d.usdcBalance}</Text></Text>
          <Text><Text bold>Network: </Text><Text dimColor>SKALE BITE V2 Sandbox (Chain 103698795)</Text></Text>
          <Text>{" "}</Text>
          <Text bold>Daily Budget</Text>
          <Text>  Spent:     ${d.dailySpent.toFixed(6)} / ${d.dailyLimit.toFixed(2)}</Text>
          <Box>
            <Text>  </Text>
            <Text color={spentPct > 80 ? "red" : "green"}>{budgetBar}</Text>
            <Text dimColor> {spentPct.toFixed(0)}%</Text>
          </Box>
          <Text>  Remaining: <Text color="green">${d.budgetRemaining.toFixed(6)}</Text></Text>
          {d.recentPayments.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Recent Payments</Text>
              <Text dimColor>  {"Service".padEnd(25)} {"Amount".padEnd(12)} {"Tx Hash".padEnd(18)} Status</Text>
              {d.recentPayments.slice(-5).map((p, i) => (
                <Text key={`xp${i}`} dimColor>
                  {"  "}{p.service.slice(0, 24).padEnd(25)} ${p.amount.toFixed(6).padEnd(11)} {(p.txHash ? p.txHash.slice(0, 14) + "..." : "pending").padEnd(18)} {p.status}
                </Text>
              ))}
            </Box>
          )}
          {d.recentPayments.length === 0 && (
            <Text dimColor>{"\n"}  No payments recorded yet. Run /x402demo to start.</Text>
          )}
        </Box>
      );
    }

    case "x402-payment": {
      const p = entry.data;
      return (
        <Box marginLeft={2}>
          <Text color="#00FFA3">{"\u25C6"} </Text>
          <Text>x402: </Text>
          <Text bold>{p.service}</Text>
          <Text dimColor> | ${p.amount.toFixed(6)} USDC | </Text>
          <Text color="cyan">{p.explorerLink}</Text>
        </Box>
      );
    }

    case "verbose-toggle":
      return (
        <Box marginLeft={2} marginTop={1}>
          <Text color={entry.enabled ? "#00FFA3" : "yellow"}>
            {entry.enabled ? "\u25CF" : "\u25CB"} x402 verbose mode: {entry.enabled ? "ON" : "OFF"}
          </Text>
          <Text dimColor> {entry.enabled ? "-- showing full payment details" : "-- compact view"}</Text>
        </Box>
      );

    case "sandbox":
      return (
        <Box borderStyle="round" borderColor="#34D399" paddingX={2} paddingY={1} marginLeft={2} marginTop={1}>
          <Text color="#34D399" bold>{"\u2B21"} Sandbox Active</Text>
          <Text> {"\u00B7"} </Text>
          <Text color="cyan" underline>{entry.url}</Text>
          {entry.framework && <Text dimColor> {"\u00B7"} {entry.framework}</Text>}
        </Box>
      );

    default:
      return null;
  }
}

// ── Inline Palette Rows ──────────────────────────────────────────
// Rendered directly in App to avoid dynamic-mount issues with Ink.

function PaletteRow({
  cmd,
  colWidth,
  isSelected,
  query,
  color,
}: {
  cmd: CommandDef;
  colWidth: number;
  isSelected: boolean;
  query: string;
  color: string;
}) {
  const aliasStr = cmd.aliases?.length
    ? `, /${cmd.aliases.join(", /")}`
    : "";
  const argsStr = cmd.args ? ` ${cmd.args}` : "";
  const nameStr = `/${cmd.name}${aliasStr}${argsStr}`;
  const padded = nameStr.padEnd(colWidth);

  if (isSelected) {
    return (
      <Box marginLeft={2}>
        <Text color={color} bold>
          {"\u25B8"}{" "}
        </Text>
        <Text color={color} bold>
          {padded}
        </Text>
        <Text> {cmd.description}</Text>
      </Box>
    );
  }

  // Highlight matched prefix
  if (query) {
    const matchEnd = 1 + query.length;
    return (
      <Box marginLeft={2}>
        <Text>{"  "}</Text>
        <Text color={color} bold>
          {padded.slice(0, matchEnd)}
        </Text>
        <Text color={color} dimColor>
          {padded.slice(matchEnd)}
        </Text>
        <Text dimColor> {cmd.description}</Text>
      </Box>
    );
  }

  return (
    <Box marginLeft={2}>
      <Text>{"  "}</Text>
      <Text color={color}>{padded}</Text>
      <Text dimColor> {cmd.description}</Text>
    </Box>
  );
}

// ── Hints Bar ───────────────────────────────────────────────────
// Shows below the bottom separator when the palette is not open.
// Left: keyboard shortcuts, Right: stats (model · tokens · cost · context bar · time · backend)

function HintsBar({ stats }: { stats?: import("./types.js").StatsData | null }) {
  // Read terminal width live each render
  const w = process.stdout.columns || 80;
  const left = " ctrl+c cancel  ctrl+o verbose  ctrl+e x402";

  if (!stats) {
    const right = "/ commands";
    const gap = Math.max(1, w - left.length - right.length);
    const line = (left + " ".repeat(gap) + right).slice(0, w);
    return <Text dimColor>{line}</Text>;
  }

  // Build context progress bar
  const barWidth = 10;
  const filled = Math.min(barWidth, Math.round((stats.contextPercent / 100) * barWidth));
  const empty = barWidth - filled;
  const barFilled = "\u2588".repeat(filled);
  const barEmpty = "\u2591".repeat(empty);

  // Build right side as a single string
  const rightParts = [
    stats.model,
    `${stats.tokens.toLocaleString()} tk`,
    `$${stats.cost.toFixed(4)}`,
    `${barFilled}${barEmpty} ${stats.contextPercent}%`,
    `${stats.elapsed}s`,
    ...(stats.mode && stats.mode !== "chat" ? [`[${stats.mode}]`] : []),
    ...(stats.backend ? [`[${stats.backend}]`] : []),
  ].join(" \u00b7 ");

  const gap = Math.max(1, w - left.length - rightParts.length);

  // Build a single pre-composed line that fits within the terminal
  const fullLine = left + " ".repeat(gap) + rightParts;
  const truncated = fullLine.slice(0, w);

  return <Text dimColor>{truncated}</Text>;
}

// ── Main App ─────────────────────────────────────────────────────

export function App({
  agent,
  config,
  tokenManager,
  vertexEnabled,
  runtimeDir,
  soulDir,
  connectedChannels,
  marathonService,
}: AppProps) {
  const { exit } = useApp();

  // ── Session state ──
  const [currentSession, setCurrentSession] = useState("main");

  // ── History (Static items) ──
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      id: nextId(),
      type: "banner",
      model: config.gemini.models.pro,
      provider: vertexEnabled ? "Vertex AI" : config.gemini.models.pro,
      cwd: process.cwd(),
      vertexai: vertexEnabled,
      channels: connectedChannels,
    },
  ]);

  // ── Input state ──
  const [input, setInput] = useState("");

  // ── Command palette state ──
  const [paletteIndex, setPaletteIndex] = useState(0);

  // ── Processing state ──
  const [isProcessing, setIsProcessing] = useState(false);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const thinkingTextRef = useRef("");
  const thinkingSigRef = useRef("");

  // ── Last stats (shown above input, not in history) ──
  const [lastStats, setLastStats] = useState<import("./types.js").StatsData | null>(null);

  // ── x402 verbose mode ──
  const [verboseMode, setVerboseMode] = useState(false);

  // ── Active prompt (shown in terminal tab title) ──
  const [activePrompt, setActivePrompt] = useState("");

  // ── Refs ──
  const abortRef = useRef<AbortController | null>(null);
  const thinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkStartRef = useRef(0);

  // ── Derived state ──
  const showPalette = !isProcessing && input.startsWith("/");
  const paletteQuery = showPalette ? input.slice(1).split(" ")[0] : "";
  const filteredCommands = useMemo(
    () => (showPalette ? filterCommands(paletteQuery) : []),
    [showPalette, paletteQuery],
  );

  // Check if input exactly matches a command (ready to execute)
  const hasExactMatch = useMemo(() => {
    if (!showPalette) return false;
    const q = paletteQuery.toLowerCase();
    return filteredCommands.some(
      (c) => c.name === q || (c.aliases?.includes(q) ?? false),
    );
  }, [showPalette, paletteQuery, filteredCommands]);

  // ── Helpers ──

  const addEntry = useCallback(
    (entry: NewHistoryEntry) => {
      setHistory((h) => [...h, { ...entry, id: nextId() } as HistoryEntry]);
    },
    [],
  );

  // ── Cross-channel event listener (voice sync, etc.) ──
  useEffect(() => {
    const unsubscribe = onChannelEvent("cli", (event) => {
      if (event.type === "message" && event.source !== "cli") {
        const data = event.data as { text?: string; isVoice?: boolean };
        if (data.text) {
          setHistory((h) => [
            ...h,
            {
              id: nextId(),
              type: "cross-channel" as const,
              source: event.source,
              text: data.text!,
              isVoice: data.isVoice,
            },
          ]);
        }
      }
      if (event.type === "notification" && event.source !== "cli") {
        const data = event.data as { text?: string; isResponse?: boolean };
        if (data.isResponse && data.text) {
          setHistory((h) => [
            ...h,
            { id: nextId(), type: "response" as const, text: data.text! },
          ]);
        }
      }
    });
    return unsubscribe;
  }, []);

  // ── Marathon event listener (live progress in CLI) ──
  useEffect(() => {
    const svc = marathonService;
    if (!svc || !svc.onEvent) return;

    const unsubscribe = svc.onEvent((event: any) => {
      const data = event.data as Record<string, unknown>;
      const milestone = (data?.milestone as string) || "";
      const eventType = event.type as string;

      // Show significant events with thinking level and phase info
      if (["milestone_started", "milestone_completed", "milestone_failed", "started", "completed", "approval_needed", "planning", "verification_started", "recovering"].includes(eventType)) {
        const phase = eventType === "planning" ? "Planning"
          : eventType === "verification_started" ? "Verifying"
          : eventType === "recovering" ? "Recovering"
          : eventType.includes("milestone") ? "Executing"
          : undefined;

        setHistory((h) => [
          ...h,
          {
            id: nextId(),
            type: "marathon-progress" as const,
            event: eventType,
            milestone,
            progress: event.progress?.completed ?? 0,
            total: event.progress?.total ?? 0,
            thinkingLevel: config?.thinking?.defaultLevel || "high",
            phase,
          },
        ]);
      }
    });

    return unsubscribe;
  }, [marathonService]);

  // ── Terminal tab title — shows current state with blue icon ──
  useEffect(() => {
    let title: string;
    if (isProcessing && activePrompt) {
      // Truncate long prompts for the tab
      const short = activePrompt.length > 40
        ? activePrompt.slice(0, 37) + "..."
        : activePrompt;
      title = streamingText
        ? `\u{1F539} Wispy \u2014 Responding...`
        : `\u{1F539} Wispy \u2014 ${short}`;
    } else if (isProcessing) {
      title = `\u{1F539} Wispy \u2014 Thinking...`;
    } else {
      title = `\u{1F539} Wispy`;
    }
    // OSC 0 sets both window title and tab title (most terminal support)
    process.stdout.write(`\x1b]0;${title}\x07`);
  }, [isProcessing, activePrompt, streamingText]);

  // Reset title on unmount
  useEffect(() => {
    return () => {
      process.stdout.write(`\x1b]0;Wispy\x07`);
    };
  }, []);

  const stopThinking = useCallback(() => {
    if (thinkTimerRef.current) {
      clearInterval(thinkTimerRef.current);
      thinkTimerRef.current = null;
    }
    setThinkingElapsed(0);
  }, []);

  const startThinking = useCallback(() => {
    stopThinking();
    thinkStartRef.current = Date.now();
    thinkTimerRef.current = setInterval(() => {
      setThinkingElapsed(
        (Date.now() - thinkStartRef.current) / 1000,
      );
    }, 100);
  }, [stopThinking]);

  // ── Autocomplete helper ──

  const autocompleteSelected = useCallback(() => {
    if (filteredCommands.length === 0) return false;
    const idx = Math.min(paletteIndex, filteredCommands.length - 1);
    const selected = filteredCommands[idx];
    if (!selected) return false;
    const suffix = selected.args ? " " : "";
    setInput(`/${selected.name}${suffix}`);
    setPaletteIndex(0);
    return true;
  }, [filteredCommands, paletteIndex]);

  // ── Input change handler ──

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setPaletteIndex(0);
  }, []);

  // ── Keyboard shortcuts ──

  useInput((_ch, key) => {
    // Ctrl+C: cancel stream or exit
    if (key.ctrl && _ch === "c") {
      if (abortRef.current) {
        abortRef.current.abort();
        stopThinking();
        setIsProcessing(false);
          setActivePrompt("");
        setStreamingText("");
      } else {
        exit();
      }
      return;
    }

    // Ctrl+O: toggle verbose x402 mode
    if (key.ctrl && _ch === "o") {
      const next = !verboseMode;
      setVerboseMode(next);
      addEntry({
        type: "verbose-toggle" as const,
        enabled: next,
      });
      return;
    }

    // Ctrl+E: show x402 transaction dashboard
    if (key.ctrl && _ch === "e") {
      (async () => {
        try {
          const { SKALE_BITE_SANDBOX } = await import("../../integrations/agentic-commerce/config.js");
          const { readFileSync } = await import("fs");
          const { join } = await import("path");
          const explorerUrl = SKALE_BITE_SANDBOX.explorerUrl;

          // Read wallet address from wallet.json
          let walletAddr = "Not configured";
          try {
            const walletData = JSON.parse(readFileSync(join(runtimeDir, "wallet", "wallet.json"), "utf-8"));
            walletAddr = walletData.info?.address || walletAddr;
          } catch {}

          // Read commerce policy for daily limit
          let dailyLimit = 10.0;
          try {
            const policy = JSON.parse(readFileSync(join(runtimeDir, "wallet", "commerce-policy.json"), "utf-8"));
            dailyLimit = policy.dailyLimit ?? dailyLimit;
          } catch {}

          // Get live spend data from the tool executor (in-memory SpendTracker)
          let dailySpent = 0;
          let recentPayments: import("./types.js").X402DashboardData["recentPayments"] = [];

          try {
            const executor = agent.getToolExecutor();
            const auditResult = await executor.execute({ name: "x402_audit_trail", args: { format: "json" } });
            if (auditResult.success && auditResult.output) {
              const report = JSON.parse(auditResult.output);
              dailySpent = report.totalSpent ?? 0;
              dailyLimit = report.dailyLimit ?? dailyLimit;
              const records = report.records || [];
              for (const r of records.slice(-10)) {
                recentPayments.push({
                  service: r.service || r.url || "unknown",
                  amount: r.amount || 0,
                  txHash: r.txHash || "",
                  status: r.status || "settled",
                  timestamp: r.timestamp || "",
                });
              }
              if (report.agentAddress) walletAddr = report.agentAddress;
            }
          } catch {
            // Tool executor not available or no integration loaded
          }

          // Try to read wallet balance on-chain
          let usdcBalance = "0.000000";
          try {
            const { createPublicClient, http } = await import("viem");
            const client = createPublicClient({ transport: http(SKALE_BITE_SANDBOX.rpcUrl) });
            if (walletAddr.startsWith("0x")) {
              const bal = await client.readContract({
                address: SKALE_BITE_SANDBOX.usdc as `0x${string}`,
                abi: [{ name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const,
                functionName: "balanceOf",
                args: [walletAddr as `0x${string}`],
              });
              usdcBalance = (Number(bal) / 1_000_000).toFixed(6);
            }
          } catch {
            // Balance check failed
          }

          addEntry({
            type: "x402-dashboard" as const,
            data: {
              walletAddress: walletAddr,
              explorerUrl,
              usdcBalance,
              dailySpent,
              dailyLimit,
              budgetRemaining: Math.max(0, dailyLimit - dailySpent),
              recentPayments,
            },
          });
        } catch {
          addEntry({
            type: "x402-dashboard" as const,
            data: {
              walletAddress: "Not configured",
              explorerUrl: "https://base-sepolia-testnet-explorer.skalenodes.com:10032",
              usdcBalance: "0.000000",
              dailySpent: 0,
              dailyLimit: 10.0,
              budgetRemaining: 10.0,
              recentPayments: [],
            },
          });
        }
      })();
      return;
    }

    // Only handle palette navigation when palette is visible
    if (!showPalette || isProcessing) return;

    const total = filteredCommands.length;
    if (total === 0) return;

    // Arrow up/down: navigate palette
    if (key.upArrow) {
      setPaletteIndex((i) => (i <= 0 ? total - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setPaletteIndex((i) => (i >= total - 1 ? 0 : i + 1));
      return;
    }

    // Tab: autocomplete selected command
    if (key.tab) {
      autocompleteSelected();
      return;
    }

    // Escape: dismiss palette (clear input)
    if (key.escape) {
      setInput("");
      setPaletteIndex(0);
      return;
    }
  });

  // ── Submit handler ──

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isProcessing) return;

      // ── Palette is open: handle autocomplete vs execute ──
      if (trimmed.startsWith("/")) {
        const cmdPart = trimmed.slice(1).split(" ")[0];

        // Bare "/" or no exact match → autocomplete instead of submit
        if (!cmdPart || (!hasExactMatch && filteredCommands.length > 0)) {
          autocompleteSelected();
          return;
        }
      }

      setInput("");
      setPaletteIndex(0);

      // ── Built-in commands ──

      if (trimmed === "/quit" || trimmed === "/exit") {
        exit();
        return;
      }

      if (trimmed === "/clear") {
        setHistory([{ id: nextId(), type: "separator" }]);
        return;
      }

      // ── x402demo: agent-driven hackathon demo (multi-turn) ──
      if (trimmed.startsWith("/x402demo")) {
        const trackArg = trimmed.replace("/x402demo", "").trim();
        setActivePrompt(`/x402demo ${trackArg || "all"}`);

        // Start demo seller services in background
        addEntry({ type: "user-input", text: trimmed });

        (async () => {
          try {
            const { startDemoServices } = await import("../../integrations/agentic-commerce/demo/server.js");
            const { sellerAddress } = await startDemoServices(process.env.SELLER_PRIVATE_KEY);
            const { getServiceUrls } = await import("../../integrations/agentic-commerce/x402/seller.js");
            const urls = getServiceUrls();

            // Build the agent prompt based on track selection
            const tracks = trackArg === "all" || !trackArg ? "1,2,3,4,5" : trackArg;
            const trackList = tracks.split(",").map((t: string) => t.trim());
            const trackCount = trackList.length;

            // Show demo start progress
            addEntry({
              type: "marathon-progress" as const,
              event: "started",
              milestone: `x402 Demo: ${trackCount} track${trackCount > 1 ? "s" : ""}`,
              progress: 0,
              total: trackCount,
              thinkingLevel: config?.thinking?.defaultLevel || "high",
              phase: "Executing",
            });

            let demoPrompt = `You are Wispy, an autonomous AI agent running a LIVE demonstration for the SF Agentic Commerce x402 Hackathon. You have FULL AUTONOMY to choose how to accomplish each track's goals.

CRITICAL ANTI-HALLUCINATION RULES (you MUST follow these):
1. ONLY use these exact service URLs. Do NOT invent, guess, or modify URLs:
   - Weather:   ${urls.weather}
   - Sentiment: ${urls.sentiment}
   - Report:    ${urls.report}
2. For AP2 purchases, use service_url with the EXACT URLs above (e.g. "${urls.weather}?city=Tokyo").
3. NEVER fabricate transaction hashes, wallet addresses, payment IDs, or amounts. Only use values returned by tool calls.
4. For bite_check_and_execute: you MUST first call bite_encrypt_payment and use the payment_id it returns. NEVER guess or make up a payment_id.
5. If a tool returns an error, read the error message and fix the issue. Do NOT retry with made-up parameters.
6. When showing tx hashes, wallet addresses, or amounts in summaries, copy them EXACTLY from tool results. Do NOT paraphrase or approximate.
7. NEVER say a track passed if a tool call failed. Fix it or note it honestly.

YOUR FIRST ACTION: Call x402_discover_services to see available services.

Seller address: ${sellerAddress}

FORMATTING RULES:
- Do NOT use markdown tables. Use box-drawing characters (┌ ─ ┐ │ ├ └ ┘ ═ ━)
- Format tabular data with padded columns for alignment
- Use section headers with ━━━ borders
- Show your reasoning: WHY you do things, not just what
- For every x402 payment, show amount, recipient, and status

TRACK COMPLETION RULES:
- Complete ALL tracks sequentially. Do not stop until ALL are done.
- After EACH track, you MUST say exactly "TRACK N COMPLETE" on its own line (no markdown, no bold, no asterisks). Example: TRACK 1 COMPLETE
- Do NOT mark a track complete if it failed. Retry or adapt first.
- If a tool call fails, retry with the CORRECT URLs listed above. Do NOT invent new URLs.
- You decide the order of operations, which tools to use, and what data to work with.

AVAILABLE TOOLS: x402_discover_services, x402_pay_and_fetch, x402_check_budget, x402_audit_trail, ap2_purchase, ap2_get_receipts, defi_research, defi_swap, defi_trade_log, bite_encrypt_payment, bite_check_and_execute, bite_lifecycle_report, wallet_balance

Here are the tracks to complete:\n\n`;

            if (trackList.includes("1") || trackList.includes("all")) {
              demoPrompt += `━━━ TRACK 1: Overall Best Agentic App ━━━
GOAL: Demonstrate autonomous multi-step reasoning by fetching data from ALL THREE paid APIs and compiling findings.
SUCCESS CRITERIA (you MUST do ALL of these IN ORDER):
  Step A: Call x402_pay_and_fetch with url: "weather" (or the full weather URL) and reason: "Fetching weather data for demo"
  Step B: Call x402_pay_and_fetch with url: "sentiment" (method: POST, body with text from Step A's weather data) and reason: "Analyzing sentiment of weather report"
  Step C: Call x402_pay_and_fetch with url: "report" (method: POST, body with data from Steps A and B) and reason: "Compiling final report"
CRITICAL: You MUST call ALL THREE services (weather, sentiment, report). Do NOT skip any. These are 3 separate x402_pay_and_fetch calls.
WHEN DONE: Say exactly "TRACK 1 COMPLETE" on its own line (plain text).\n\n`;
            }

            if (trackList.includes("2")) {
              demoPrompt += `━━━ TRACK 2: Agentic Tool Usage on x402 ━━━
GOAL: Demonstrate intelligent, cost-aware usage of x402-paywalled services.
SUCCESS CRITERIA (you MUST do ALL of these):
  Step A: Call x402_check_budget to show current budget status
  Step B: Explain your cost/benefit reasoning (how much you've spent, what's left, was it worth it)
  Step C: Call x402_audit_trail to show the full payment history
WHEN DONE: Say exactly "TRACK 2 COMPLETE" on its own line (plain text).\n\n`;
            }

            if (trackList.includes("3")) {
              demoPrompt += `━━━ TRACK 3: Best Integration of AP2 ━━━
GOAL: Demonstrate the AP2 structured purchase flow (Intent -> Cart -> Payment -> Receipt).
SUCCESS CRITERIA (you MUST do ALL of these):
  Step A: Call ap2_purchase with service_url: "${urls.weather}?city=Tokyo", description: "Weather data purchase via AP2 protocol", amount: "0.001"
  Step B: Show and explain each mandate stage (Intent -> Cart -> Payment -> Receipt)
  Step C: Call ap2_get_receipts to show the receipt chain
CRITICAL: You MUST call ap2_purchase. This is a DIFFERENT tool from x402_pay_and_fetch. Do NOT skip this track.
WHEN DONE: Say exactly "TRACK 3 COMPLETE" on its own line (plain text).\n\n`;
            }

            if (trackList.includes("4")) {
              demoPrompt += `━━━ TRACK 4: Best Trading/DeFi Agent ━━━
GOAL: Demonstrate autonomous DeFi trading with risk controls -- BOTH an approved swap AND a denied swap.
YOU MUST MAKE EXACTLY 4 TOOL CALLS FOR THIS TRACK:
  1. defi_research (token: "ETH") -- get market data
  2. defi_swap (from_token: "USDC", to_token: "ETH", amount: "0.01", reasoning: "Small safe swap within risk limits") -- this WILL BE APPROVED
  3. defi_swap (from_token: "USDC", to_token: "ETH", amount: "5000", reasoning: "Large swap to test risk engine denial") -- this WILL BE DENIED
  4. defi_trade_log -- show the full trade history with BOTH the approved and denied trades
ALL 4 CALLS ARE MANDATORY. The demo requires showing both an approved AND a denied swap. If you only show the denial, the track FAILS.
WHEN DONE: Say exactly "TRACK 4 COMPLETE" on its own line (plain text).\n\n`;
            }

            if (trackList.includes("5")) {
              demoPrompt += `━━━ TRACK 5: Encrypted Agents (BITE v2) ━━━
GOAL: Demonstrate BITE v2 threshold encryption for conditional payments.
SUCCESS CRITERIA: Follow these steps IN ORDER:
  Step A: Call bite_encrypt_payment (use to: "${sellerAddress}", data: any hex string like "0x1234", condition_type: "time_lock", condition_description: "Immediate execution").
  Step B: Take the payment_id from Step A's response (it starts with "bite_").
  Step C: Call bite_check_and_execute with that exact payment_id from Step B.
  Step D: Call bite_lifecycle_report with that same payment_id.
CRITICAL: Do NOT call bite_check_and_execute before bite_encrypt_payment. The payment_id MUST come from the encrypt step's response.
AUTONOMY: You choose the condition description and data payload.
WHEN DONE: Say exactly "TRACK 5 COMPLETE" on its own line (plain text).\n\n`;
            }

            demoPrompt += `After ALL tracks are complete, call x402_audit_trail one final time, then provide a FINAL VERIFICATION SUMMARY using this format:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HACKATHON DEMO - FINAL VERIFICATION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Tracks Completed:    N / N
  Total Payments:      N transactions
  Total USDC Spent:    $X.XXXXXX

  ┌─ Transaction Log ─────────────────────────────────────────────────┐
  │ #  Service                Amount        Status     Tx Hash        │
  │────────────────────────────────────────────────────────────────────│
  │ (list ALL transactions with real values from audit trail)         │
  └────────────────────────────────────────────────────────────────────┘

  ┌─ Track Results ───────────────────────────────────────────────────┐
  │ Track   Title                      Status    Key Proof            │
  │────────────────────────────────────────────────────────────────────│
  │ (list ALL tracks with PASS/FAIL and evidence)                     │
  └────────────────────────────────────────────────────────────────────┘

  ┌─ On-Chain Verification ───────────────────────────────────────────┐
  │ Wallet:     (your real wallet address explorer link)              │
  │ Network:    SKALE BITE V2 Sandbox (Chain 103698795)               │
  │ Explorer:   https://base-sepolia-testnet-explorer.skalenodes.com:10032  │
  │ Tx Links:   (list all real tx hash explorer links)                │
  └────────────────────────────────────────────────────────────────────┘

ALL TRACKS COMPLETE

Fill in ALL actual values. Show real tx hashes, real wallet address, real amounts.
Use CLI-style formatting with box-drawing characters throughout.`;

            // ── Multi-turn demo execution ──────────────────────
            setIsProcessing(true);
            setStreamingText("");
            setThinkingText("");
            thinkingTextRef.current = "";
            thinkingSigRef.current = "";
            startThinking();

            const abort = new AbortController();
            abortRef.current = abort;

            const MAX_DEMO_TURNS = 15;
            let demoTurn = 0;
            let demoComplete = false;
            let totalInTk = 0;
            let totalOutTk = 0;
            let tracksCompleted = 0;
            const completedTracks = new Set<string>();
            let allAccumulated = ""; // Cross-turn accumulation for track detection
            const chatStart = Date.now();

            // Tool-based track detection: track which tools completed successfully
            const toolCalls = new Map<string, number>(); // tool name -> success count
            const markTrackIfNeeded = (track: string) => {
              if (completedTracks.has(track) || !trackList.includes(track)) return;
              completedTracks.add(track);
              tracksCompleted = completedTracks.size;
              addEntry({
                type: "marathon-progress" as const,
                event: "milestone_completed",
                milestone: `Track ${track} complete`,
                progress: tracksCompleted,
                total: trackCount,
                thinkingLevel: config?.thinking?.defaultLevel || "high",
              });
            };
            // Count tool calls with normalized name matching
            const toolCount = (name: string) => {
              let total = 0;
              for (const [k, v] of toolCalls) {
                if (k === name || k.toLowerCase().replace(/[\s-]+/g, "_") === name) total += v;
              }
              return total;
            };

            // Validate whether a track has real tool evidence (not just agent text claims)
            const hasTrackEvidence = (track: string): boolean => {
              switch (track) {
                case "1": return toolCount("x402_pay_and_fetch") >= 3;
                case "2": return toolCount("x402_check_budget") >= 1 && toolCount("x402_audit_trail") >= 1;
                case "3": return toolCount("ap2_purchase") >= 1;
                case "4": {
                  // Need at least 2 defi_swap calls (one approved, one denied) + trade log
                  // AND content evidence of both outcomes (since denied swaps also return success=true)
                  const c = allAccumulated.toLowerCase();
                  const hasApproved = c.includes("swap executed successfully");
                  const hasDenied = c.includes("swap denied");
                  return toolCount("defi_swap") >= 2 && toolCount("defi_trade_log") >= 1 && hasApproved && hasDenied;
                }
                case "5": return toolCount("bite_encrypt_payment") >= 1 && toolCount("bite_check_and_execute") >= 1;
                default: return false;
              }
            };

            const checkToolBasedTracks = () => {
              if (hasTrackEvidence("1")) markTrackIfNeeded("1");
              if (hasTrackEvidence("2")) markTrackIfNeeded("2");
              if (hasTrackEvidence("3")) markTrackIfNeeded("3");
              if (hasTrackEvidence("4")) markTrackIfNeeded("4");
              if (hasTrackEvidence("5")) markTrackIfNeeded("5");
            };

            // Content-based track detection: only fires if tool evidence also exists
            // This prevents the agent's text claims from triggering completion without actual tools
            const checkContentBasedTracks = () => {
              // Content-based detection is now secondary to tool-based detection
              // Only check content if tool evidence partially supports it
              const c = allAccumulated.toLowerCase();

              // Track 1: Require 3 x402_pay_and_fetch calls (strict)
              // Content alone is NOT enough - agent can hallucinate service responses
              if (!completedTracks.has("1") && toolCount("x402_pay_and_fetch") >= 3) {
                markTrackIfNeeded("1");
              }
              // Track 2: tool-based only (budget + audit)
              if (!completedTracks.has("2") && hasTrackEvidence("2")) {
                markTrackIfNeeded("2");
              }
              // Track 3: AP2 mandate chain evidence + tool call
              if (!completedTracks.has("3") && toolCount("ap2_purchase") >= 1) {
                markTrackIfNeeded("3");
              }
              // Track 4: Need BOTH approved + denied swap evidence with exact output strings
              if (!completedTracks.has("4")) {
                const hasApproved = c.includes("swap executed successfully");
                const hasDenied = c.includes("swap denied");
                if (hasApproved && hasDenied && toolCount("defi_swap") >= 2 && toolCount("defi_trade_log") >= 1) markTrackIfNeeded("4");
              }
              // Track 5: BITE tool-based only
              if (!completedTracks.has("5") && hasTrackEvidence("5")) {
                markTrackIfNeeded("5");
              }
            };

            while (demoTurn < MAX_DEMO_TURNS && !demoComplete && !abort.signal.aborted) {
              demoTurn++;

              // First turn uses the full demo prompt; subsequent turns ask to continue
              const remainingTracks = trackList.filter((t: string) => !completedTracks.has(t));

              // Build a status report of what tools have ACTUALLY been called
              const toolStatus: string[] = [];
              for (const t of remainingTracks) {
                const missing: string[] = [];
                switch (t) {
                  case "1": {
                    const payCount = toolCount("x402_pay_and_fetch");
                    if (payCount < 3) missing.push(`x402_pay_and_fetch (called ${payCount}/3 -- you MUST call ${3 - payCount} more: ${payCount < 1 ? "weather, " : ""}${payCount < 2 ? "sentiment, " : ""}report)`);
                    break;
                  }
                  case "2": {
                    if (toolCount("x402_check_budget") < 1) missing.push("x402_check_budget");
                    if (toolCount("x402_audit_trail") < 1) missing.push("x402_audit_trail");
                    break;
                  }
                  case "3": {
                    if (toolCount("ap2_purchase") < 1) missing.push(`ap2_purchase (use service_url: "${urls.weather}?city=Tokyo")`);
                    break;
                  }
                  case "4": {
                    const swapCount = toolCount("defi_swap");
                    const ct = allAccumulated.toLowerCase();
                    const hasApprovedSwap = ct.includes("swap executed successfully");
                    const hasDeniedSwap = ct.includes("swap denied");
                    if (swapCount < 1) {
                      missing.push("defi_swap (from_token: USDC, to_token: ETH, amount: 0.01, reasoning: 'Small safe swap') -- APPROVED swap");
                    } else if (!hasApprovedSwap) {
                      missing.push("defi_swap (amount: 0.01 USDC) -- you only have denied swaps, you MUST also execute a SMALL approved swap");
                    }
                    if (!hasDeniedSwap) {
                      missing.push("defi_swap (amount: 5000 USDC) -- DENIED swap to show risk engine");
                    }
                    if (toolCount("defi_trade_log") < 1) missing.push("defi_trade_log");
                    break;
                  }
                  case "5": {
                    if (toolCount("bite_encrypt_payment") < 1) missing.push(`bite_encrypt_payment (to: "${sellerAddress}")`);
                    if (toolCount("bite_check_and_execute") < 1) missing.push("bite_check_and_execute");
                    break;
                  }
                }
                if (missing.length > 0) {
                  toolStatus.push(`Track ${t} MISSING tool calls: ${missing.join(", ")}`);
                }
              }

              const turnPrompt = demoTurn === 1
                ? demoPrompt
                : `Continue the demonstration. You have ${remainingTracks.length} tracks remaining: ${remainingTracks.map((t: string) => `Track ${t}`).join(", ")}.

WARNING: A track is ONLY considered complete when you have actually called the required tools. Saying "TRACK N COMPLETE" without making the tool calls does NOT count. The system tracks your ACTUAL tool calls.

${toolStatus.length > 0 ? `ACTUAL TOOL CALL STATUS (from system tracking):\n${toolStatus.join("\n")}\n` : ""}
IMPORTANT: You MUST make every listed tool call. Do NOT claim a track is complete without making the calls. Do NOT skip tool calls between turns.
STRICT RULES:
- ONLY use these URLs: ${urls.weather}, ${urls.sentiment}, ${urls.report}
- NEVER fabricate tx hashes, amounts, or addresses. Only use values returned by tools.
- Call ALL required tools BEFORE saying "TRACK N COMPLETE".`;

              // Show continuation indicator for turns > 1
              if (demoTurn > 1) {
                addEntry({
                  type: "marathon-progress" as const,
                  event: "milestone_started",
                  milestone: `Continuing demo (turn ${demoTurn}/${MAX_DEMO_TURNS})`,
                  progress: tracksCompleted,
                  total: trackCount,
                  thinkingLevel: config?.thinking?.defaultLevel || "high",
                  phase: "Executing",
                });
                startThinking();
              }

              let turnAccumulated = "";
              let turnHadThinking = false;
              let tn = "";
              let ts = 0;
              let turnIn = 0;
              let turnOut = 0;

              for await (const chunk of agent.chatStream(
                turnPrompt,
                "cli-user",
                "cli",
                currentSession as SessionType,
              )) {
                if (abort.signal.aborted) break;

                switch (chunk.type) {
                  case "thinking":
                    if (chunk.content) {
                      thinkingTextRef.current = chunk.content;
                      setThinkingText(chunk.content);
                    }
                    break;

                  case "thought_signature":
                    if (chunk.content) {
                      thinkingSigRef.current = chunk.content;
                    }
                    break;

                  case "tool_call": {
                    stopThinking();
                    // Capture any thinking that happened before this tool call
                    if (thinkingTextRef.current) {
                      turnHadThinking = true;
                      addEntry({
                        type: "thinking",
                        text: thinkingTextRef.current,
                        signature: thinkingSigRef.current || undefined,
                        thinkingLevel: config?.thinking?.defaultLevel || "high",
                      });
                      thinkingTextRef.current = "";
                      thinkingSigRef.current = "";
                      setThinkingText("");
                    }
                    let args: Record<string, unknown> = {};
                    let name = chunk.content;
                    try {
                      if (chunk.content.includes("{")) {
                        const idx = chunk.content.indexOf("{");
                        args = JSON.parse(chunk.content.slice(idx));
                        name = chunk.content.slice(0, idx).trim();
                      }
                    } catch {}
                    tn = name;
                    ts = Date.now();
                    addEntry({ type: "tool-call", data: { name, args } });
                    // Pre-register the tool call (even before result comes back)
                    // This ensures the name is tracked regardless of result format
                    const normalizedCallName = name.toLowerCase().replace(/[\s-]+/g, "_");
                    if (normalizedCallName) {
                      toolCalls.set(normalizedCallName, (toolCalls.get(normalizedCallName) ?? 0));
                    }
                    break;
                  }

                  case "tool_result": {
                    const elapsed = Date.now() - ts;
                    const isError = chunk.success === false || chunk.content.startsWith("ERROR: ");
                    addEntry({
                      type: "tool-result",
                      data: {
                        name: tn || "tool",
                        result: chunk.content.slice(0, 800),
                        durationMs: elapsed,
                        isError,
                      },
                    });
                    // Also accumulate tool results for track detection
                    allAccumulated += "\n" + chunk.content;
                    // Track successful tool calls for progress detection
                    if (!isError && tn) {
                      const normalizedTn = tn.toLowerCase().replace(/[\s-]+/g, "_");
                      toolCalls.set(normalizedTn, (toolCalls.get(normalizedTn) ?? 0) + 1);
                      checkToolBasedTracks();
                      checkContentBasedTracks();
                    } else if (tn) {
                      // Even on error, still do content-based check (some "errors" contain useful data)
                      checkContentBasedTracks();
                    }
                    // Detect sandbox (dev server) launches
                    if (tn === "run_dev_server" || tn === "bash") {
                      const urlMatch = chunk.content.match(/https?:\/\/localhost:\d+/);
                      if (urlMatch) {
                        addEntry({ type: "sandbox", url: urlMatch[0], project: "app" });
                      }
                    }
                    break;
                  }

                  case "text":
                    stopThinking();
                    if (!turnAccumulated && thinkingTextRef.current) {
                      turnHadThinking = true;
                      addEntry({
                        type: "thinking",
                        text: thinkingTextRef.current,
                        signature: thinkingSigRef.current || undefined,
                        thinkingLevel: config?.thinking?.defaultLevel || "high",
                      });
                      thinkingTextRef.current = "";
                      thinkingSigRef.current = "";
                      setThinkingText("");
                    }
                    turnAccumulated += chunk.content;
                    setStreamingText(turnAccumulated);
                    break;

                  case "usage": {
                    try {
                      const usage = JSON.parse(chunk.content);
                      turnIn = usage.inputTokens ?? 0;
                      turnOut = usage.outputTokens ?? 0;
                    } catch {}
                    break;
                  }

                  case "context_compacted":
                    addEntry({ type: "context-compacted" });
                    break;

                  case "done":
                    stopThinking();
                    break;
                }
              }

              // ── Commit any remaining thinking to history ────
              // If the model returned thinking content that wasn't committed
              // (e.g. final turn with text but no tool call), commit it now
              if (thinkingTextRef.current) {
                turnHadThinking = true;
                addEntry({
                  type: "thinking",
                  text: thinkingTextRef.current,
                  signature: thinkingSigRef.current || undefined,
                  thinkingLevel: config?.thinking?.defaultLevel || "high",
                });
                thinkingTextRef.current = "";
                thinkingSigRef.current = "";
                setThinkingText("");
              }

              // ── Synthesize thinking from turn text if none was captured ──
              // Gemini 2.5 may not always return thinking parts, so we extract
              // the agent's reasoning from its output to create a ThoughtSignature
              if (turnAccumulated && !abort.signal.aborted && !turnHadThinking) {
                // Strip markdown and filter to substantive reasoning lines
                const reasoningLines = turnAccumulated
                  .split("\n")
                  .map((l: string) => l
                    .replace(/\*\*/g, "").replace(/\*/g, "")
                    .replace(/__/g, "").replace(/_/g, "")
                    .replace(/`/g, "").replace(/^#+\s*/g, "")
                    .replace(/^[-*]\s+/g, "").trim()
                  )
                  .filter((l: string) => l.length > 15 && !l.startsWith("TRACK ") && !l.startsWith("━"))
                  .slice(0, 8)
                  .join("\n");
                if (reasoningLines.length > 30) {
                  const sigHash = Buffer.from(reasoningLines.slice(0, 500))
                    .toString("base64")
                    .slice(0, 12);
                  addEntry({
                    type: "thinking",
                    text: reasoningLines,
                    signature: sigHash,
                    thinkingLevel: config?.thinking?.defaultLevel || "high",
                  });
                }
              }

              // ── Finalize this turn ─────────────────────────
              if (turnAccumulated && !abort.signal.aborted) {
                addEntry({ type: "response", text: turnAccumulated });
                setStreamingText("");
                totalInTk += turnIn || Math.ceil(turnPrompt.length / 4) + 100;
                totalOutTk += turnOut || Math.ceil(turnAccumulated.length / 4);

                // Accumulate across all turns for track detection
                allAccumulated += "\n" + turnAccumulated;

                // Run content-based track detection after each turn
                checkContentBasedTracks();
                // Also run tool-based detection (in case tools completed this turn)
                checkToolBasedTracks();

                // Detect track completions (flexible matching, strip ALL formatting)
                const cleaned = allAccumulated
                  .replace(/\*\*/g, "").replace(/\*/g, "").replace(/_/g, "").replace(/`/g, "")
                  .replace(/[║│┃╎╏┆┇┊┋╔╗╚╝╠╣╦╩╬═─━┌┐└┘├┤┬┴┼▸▹►▻●○◉✓✗✔✕✅❌⚡⭐🟢🔴💰🎯📊🔒📄]/gu, " ")
                  .replace(/\s+/g, " ")
                  .toLowerCase();
                for (const t of trackList) {
                  if (completedTracks.has(t)) continue;
                  // Match "TRACK N COMPLETE/PASS/DONE/SUCCEEDED" in any format
                  const agentClaimsComplete = cleaned.includes(`track ${t} complete`) ||
                      cleaned.includes(`track ${t}: complete`) ||
                      cleaned.includes(`track ${t} pass`) ||
                      cleaned.includes(`track ${t}: pass`) ||
                      !!cleaned.match(new RegExp(`track\\s*${t}\\s*(?::|\\s)\\s*(?:is\\s+)?(?:complete|pass|done|succeeded)`)) ||
                      !!cleaned.match(new RegExp(`track\\s*${t}\\s+done`));

                  if (agentClaimsComplete) {
                    // Validate: only mark complete if we have tool evidence
                    if (hasTrackEvidence(t)) {
                      markTrackIfNeeded(t);
                    }
                    // else: agent claims complete but tools don't confirm — skip
                    // The continuation prompt will tell the agent to actually complete it
                  }
                }

                // Detect overall completion
                if (completedTracks.size >= trackCount) {
                  demoComplete = true;
                } else if (cleaned.includes("all tracks complete") ||
                    cleaned.includes("all 5 tracks") ||
                    cleaned.includes("demonstration complete") ||
                    cleaned.includes("5/5 tracks") ||
                    cleaned.match(/all\s+tracks?\s+(?:passed|done|succeeded|complete)/)) {
                  // Agent claims all tracks are done - run evidence checks
                  checkContentBasedTracks();
                  checkToolBasedTracks();
                  // Only mark remaining tracks if they have evidence
                  for (const t of trackList) {
                    if (!completedTracks.has(t) && hasTrackEvidence(t)) {
                      markTrackIfNeeded(t);
                    }
                  }
                  // End demo: all evidence-backed tracks are marked, rest stay incomplete
                  demoComplete = true;
                }
              } else if (!turnAccumulated && demoTurn > 1) {
                // No output produced -- agent is done
                demoComplete = true;
              }
            }

            // ── Demo complete ────────────────────────────────
            addEntry({
              type: "marathon-progress" as const,
              event: "completed",
              milestone: `x402 Demo finished (${completedTracks.size}/${trackCount} tracks, ${demoTurn} turns)`,
              progress: completedTracks.size,
              total: trackCount,
              thinkingLevel: config?.thinking?.defaultLevel || "high",
            });

            // ── Programmatic Verification Proof ──
            try {
              const { SKALE_BITE_SANDBOX } = await import("../../integrations/agentic-commerce/config.js");
              const executor = agent.getToolExecutor();
              const auditResult = await executor.execute({ name: "x402_audit_trail", args: { format: "json" } });
              const budgetResult = await executor.execute({ name: "x402_check_budget", args: {} });

              if (auditResult.success && auditResult.output) {
                let report: any = {};
                try { report = JSON.parse(auditResult.output); } catch {}
                const records = report.records || [];
                const totalSpent = report.totalSpent ?? records.reduce((s: number, r: any) => s + (r.amount || 0), 0);
                const walletAddr = report.agentAddress || "";
                const explorerBase = SKALE_BITE_SANDBOX.explorerUrl;

                // Build verification table lines
                const txRows = records.map((r: any, i: number) => {
                  const num = String(i + 1).padEnd(3);
                  const svc = (r.service || "unknown").slice(0, 22).padEnd(23);
                  const amt = `$${(r.amount || 0).toFixed(6)}`.padEnd(14);
                  const st = (r.status || "unknown").padEnd(11);
                  const hasRealHash = r.txHash && r.txHash.startsWith("0x") && r.txHash.length >= 66;
                  const hash = hasRealHash
                    ? `${r.txHash.slice(0, 14)}...`
                    : "facilitator-settled";
                  return `  \u2502 ${num}${svc}${amt}${st}${hash}`;
                });

                const trackRows = trackList.map((t: string) => {
                  const passed = completedTracks.has(t);
                  const trackNames: Record<string, string> = {
                    "1": "Agentic App", "2": "x402 Tool Usage", "3": "AP2 Integration",
                    "4": "DeFi/Trading", "5": "BITE v2 Encryption",
                  };
                  const name = (trackNames[t] || `Track ${t}`).padEnd(28);
                  const status = passed ? "PASS" : "FAIL";
                  return `  \u2502 ${t.padEnd(8)}${name}${status}`;
                });

                // Collect BITE tx hashes (tracked separately from x402)
                let biteHashes: string[] = [];
                try {
                  const biteResult = await executor.execute({ name: "bite_lifecycle_report", args: { payment_id: "all" } });
                  if (biteResult.success && biteResult.output) {
                    const hashMatches = biteResult.output.matchAll(/Tx:\s+(0x[a-fA-F0-9]{64})/g);
                    for (const m of hashMatches) biteHashes.push(m[1]);
                  }
                } catch {}
                // Fallback: extract BITE hashes from accumulated agent output
                if (biteHashes.length === 0) {
                  // Match both console format "[BITE] Submitted: 0x..." and report format "│ Tx:  0x..."
                  const patterns = [
                    /\[BITE\]\s+Submitted:\s+(0x[a-fA-F0-9]{64})/g,
                    /Tx:\s+(0x[a-fA-F0-9]{64})/g,
                  ];
                  for (const pat of patterns) {
                    const matches = allAccumulated.matchAll(pat);
                    for (const m of matches) {
                      // Exclude x402/DeFi tx hashes (already in records)
                      const hash = m[1];
                      const isInRecords = records.some((r: any) => r.txHash === hash);
                      if (!isInRecords) biteHashes.push(hash);
                    }
                  }
                }
                // Deduplicate
                biteHashes = [...new Set(biteHashes)];

                // Full tx hashes for verification (x402 + BITE merged)
                let linkIdx = 0;
                const txLinks = records
                  .filter((r: any) => r.txHash && r.txHash.startsWith("0x") && r.txHash.length >= 66)
                  .map((r: any) => `  \u2502 Tx #${++linkIdx}: ${explorerBase}/tx/${r.txHash}`);
                for (const h of biteHashes) {
                  if (!txLinks.some((l: string) => l.includes(h))) {
                    txLinks.push(`  \u2502 BITE #${++linkIdx}: ${explorerBase}/tx/${h}`);
                  }
                }

                const verificationText = [
                  "",
                  "\u2501".repeat(62),
                  "  HACKATHON DEMO \u2500 ON-CHAIN VERIFICATION PROOF",
                  "\u2501".repeat(62),
                  "",
                  `  Tracks Completed:    ${completedTracks.size} / ${trackCount}`,
                  `  Total Payments:      ${records.length} transactions`,
                  `  Total USDC Spent:    $${totalSpent.toFixed(6)}`,
                  `  Demo Duration:       ${demoTurn} turns`,
                  `  Budget Remaining:    $${(report.budgetRemaining ?? 0).toFixed(6)}`,
                  "",
                  "  \u250C\u2500 Transaction Verification \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510",
                  `  \u2502 ${"#".padEnd(3)}${"Service".padEnd(23)}${"Amount".padEnd(14)}${"Status".padEnd(11)}Tx Hash`,
                  `  \u2502${"─".repeat(59)}`,
                  ...txRows,
                  "  \u2514" + "\u2500".repeat(59) + "\u2518",
                  "",
                  "  \u250C\u2500 Track Results \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510",
                  `  \u2502 ${"Track".padEnd(8)}${"Title".padEnd(28)}Status`,
                  `  \u2502${"─".repeat(59)}`,
                  ...trackRows,
                  "  \u2514" + "\u2500".repeat(59) + "\u2518",
                  "",
                  "  \u250C\u2500 On-Chain Verification Links \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510",
                  `  \u2502 Wallet:    ${explorerBase}/address/${walletAddr}`,
                  `  \u2502 Network:   SKALE BITE V2 Sandbox (Chain ${SKALE_BITE_SANDBOX.chainId})`,
                  `  \u2502 Seller:    ${sellerAddress}`,
                  `  \u2502 Explorer:  ${explorerBase}`,
                  `  \u2502`,
                  ...txLinks,
                  "  \u2514" + "\u2500".repeat(59) + "\u2518",
                  "",
                  "\u2501".repeat(62),
                ].join("\n");

                addEntry({ type: "verification", text: verificationText });

                // Auto-generate PDF audit report
                try {
                  const reportPath = `x402-audit-report-${Date.now()}`;
                  const executor = agent.getToolExecutor();
                  const reportResult = await executor.execute({
                    name: "generate_x402_report",
                    args: {
                      outputPath: reportPath,
                      agentAddress: walletAddr,
                      sellerAddress,
                      network: "SKALE BITE V2 Sandbox",
                      chainId: String(SKALE_BITE_SANDBOX.chainId),
                      explorerUrl: explorerBase,
                      transactions: JSON.stringify(records),
                      tracks: JSON.stringify(trackList.map((t: string) => ({
                        track: parseInt(t),
                        title: ({ "1": "Agentic App", "2": "x402 Tool Usage", "3": "AP2 Integration", "4": "DeFi/Trading", "5": "BITE v2 Encryption" } as Record<string, string>)[t] || `Track ${t}`,
                        status: completedTracks.has(t) ? "PASS" : "FAIL",
                        summary: completedTracks.has(t) ? "Completed successfully" : "Not completed",
                      }))),
                      totalSpent: String(totalSpent),
                      duration: `${((Date.now() - chatStart) / 1000).toFixed(0)}s`,
                      demoTurns: String(demoTurn),
                    },
                  });
                  if (reportResult.success) {
                    addEntry({ type: "response", text: `\n  Audit report generated: ${reportResult.output?.split("\n")[0] || reportPath}` });
                  }
                } catch {
                  // Report generation is optional
                }
              }
            } catch {
              // Commerce module may not be initialized
            }

            tokenManager.recordUsage(config.gemini.models.pro, totalInTk, totalOutTk);

            const elapsed = ((Date.now() - chatStart) / 1000).toFixed(1);
            const stats = tokenManager.getStats();
            const contextWindow = tokenManager.getContextWindow(config.gemini.models.pro);
            const pct = Math.round((stats.sessionTokens / contextWindow) * 100);

            const modelDisplay = config.gemini.models.pro
              .replace("gemini-", "")
              .replace("-preview", "")
              .split("-")
              .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
              .join(" ");

            setLastStats({
              model: modelDisplay,
              tokens: totalInTk + totalOutTk,
              cost: stats.sessionCost,
              contextPercent: pct,
              elapsed,
              mode: agent.getMode() === "plan" ? "plan" : undefined,
              backend: vertexEnabled ? "Vertex" : undefined,
            });

            // Stop demo services only after ALL turns complete
            try {
              const { stopDemoServices } = await import("../../integrations/agentic-commerce/demo/server.js");
              await stopDemoServices();
            } catch {}

          } catch (err) {
            addEntry({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            });
            // Ensure services stop even on error
            try {
              const { stopDemoServices } = await import("../../integrations/agentic-commerce/demo/server.js");
              await stopDemoServices();
            } catch {}
          }

          abortRef.current = null;
          stopThinking();
          setIsProcessing(false);
          setActivePrompt("");
          setStreamingText("");
        })();

        return;
      }

      if (trimmed === "/help" || trimmed === "?") {
        addEntry({ type: "user-input", text: trimmed });
        addEntry({
          type: "response",
          text:
            "## Commands\n\n" +
            "| Command | Description |\n" +
            "|---------|-------------|\n" +
            "| `/help` | Show this help |\n" +
            "| `/marathon <goal>` | Start autonomous marathon |\n" +
            "| `/model [name]` | Switch AI model |\n" +
            "| `/compact` | Compact conversation context |\n" +
            "| `/session [key]` | Switch session |\n" +
            "| `/theme [name]` | Switch theme |\n" +
            "| `/clear` | Clear screen |\n" +
            "| `/quit` | Exit Wispy |\n\n" +
            "Type `/` to browse all commands. Type naturally to chat.",
        });
        return;
      }

      // ── Delegate other slash commands ──

      if (trimmed.startsWith("/")) {
        addEntry({ type: "user-input", text: trimmed });
        try {
          const { handleSlashCommand } = await import("../commands.js");
          await handleSlashCommand(trimmed, {
            agent,
            runtimeDir,
            soulDir,
            currentSession,
            setSession: setCurrentSession,
            tokenManager,
          });
        } catch (err) {
          addEntry({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      // ── Chat with agent ──

      // Extract image file paths from the message (if any)
      const { text: chatText, images } = extractImages(trimmed);

      addEntry({ type: "user-input", text: trimmed });
      setActivePrompt(trimmed);

      // Show image attachment indicator
      if (images.length > 0) {
        addEntry({ type: "image-attached", count: images.length });
      }

      setIsProcessing(true);
      setStreamingText("");
      setThinkingText("");
      thinkingTextRef.current = "";
      thinkingSigRef.current = "";
      startThinking();

      const abort = new AbortController();
      abortRef.current = abort;

      let accumulated = "";
      let toolName = "";
      let toolStart = 0;
      let realInTk = 0;
      let realOutTk = 0;
      const chatStart = Date.now();

      try {
        for await (const chunk of agent.chatStream(
          chatText,
          "cli-user",
          "cli",
          currentSession as SessionType,
          images.length > 0 ? { images } : undefined,
        )) {
          if (abort.signal.aborted) break;

          switch (chunk.type) {
            case "thinking":
              if (chunk.content) {
                thinkingTextRef.current = chunk.content;
                setThinkingText(chunk.content);
              }
              break;

            case "thought_signature":
              if (chunk.content) {
                thinkingSigRef.current = chunk.content;
              }
              break;

            case "tool_call": {
              stopThinking();
              let args: Record<string, unknown> = {};
              let name = chunk.content;
              try {
                if (chunk.content.includes("{")) {
                  const idx = chunk.content.indexOf("{");
                  args = JSON.parse(chunk.content.slice(idx));
                  name = chunk.content.slice(0, idx).trim();
                }
              } catch {}
              toolName = name;
              toolStart = Date.now();
              addEntry({ type: "tool-call", data: { name, args } });
              break;
            }

            case "tool_result": {
              const elapsed = Date.now() - toolStart;
              const isError = chunk.success === false || chunk.content.startsWith("ERROR: ");
              addEntry({
                type: "tool-result",
                data: {
                  name: toolName || "tool",
                  result: chunk.content.slice(0, 800),
                  durationMs: elapsed,
                  isError,
                },
              });
              // Detect sandbox (dev server) launches
              if (toolName === "run_dev_server" || toolName === "bash") {
                const urlMatch = chunk.content.match(/https?:\/\/localhost:\d+/);
                if (urlMatch) {
                  addEntry({ type: "sandbox", url: urlMatch[0], project: "app" });
                }
              }
              break;
            }

            case "text":
              stopThinking();
              // Commit thinking to history on first text chunk
              if (!accumulated && thinkingTextRef.current) {
                addEntry({
                  type: "thinking",
                  text: thinkingTextRef.current,
                  signature: thinkingSigRef.current || undefined,
                  thinkingLevel: config?.thinking?.defaultLevel || "high",
                });
                thinkingTextRef.current = "";
                thinkingSigRef.current = "";
                setThinkingText("");
              }
              accumulated += chunk.content;
              setStreamingText(accumulated);
              break;

            case "usage": {
              try {
                const usage = JSON.parse(chunk.content);
                realInTk = usage.inputTokens ?? 0;
                realOutTk = usage.outputTokens ?? 0;
              } catch {}
              break;
            }

            case "context_compacted":
              addEntry({ type: "context-compacted" });
              break;

            case "done":
              stopThinking();
              break;
          }
        }

        // ── Finalize response ──

        if (accumulated && !abort.signal.aborted) {
          addEntry({ type: "response", text: accumulated });
          setStreamingText("");

          // Use real Gemini API token counts when available, fall back to estimation
          const outTk = realOutTk || Math.ceil(accumulated.length / 4);
          const inTk = realInTk || (Math.ceil(trimmed.length / 4) + 100);
          tokenManager.recordUsage(config.gemini.models.pro, inTk, outTk);

          const elapsed = ((Date.now() - chatStart) / 1000).toFixed(1);
          const stats = tokenManager.getStats();
          const contextWindow = tokenManager.getContextWindow(config.gemini.models.pro);
          const pct = Math.round(
            (stats.sessionTokens / contextWindow) * 100,
          );

          const modelDisplay = config.gemini.models.pro
            .replace("gemini-", "")
            .replace("-preview", "")
            .split("-")
            .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(" ");

          setLastStats({
            model: modelDisplay,
            tokens: inTk + outTk,
            cost: stats.sessionCost,
            contextPercent: pct,
            elapsed,
            mode: agent.getMode() === "plan" ? "plan" : undefined,
            backend: vertexEnabled ? "Vertex" : undefined,
          });
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          addEntry({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      abortRef.current = null;
      stopThinking();
      setIsProcessing(false);
          setActivePrompt("");
      setStreamingText("");
    },
    [
      agent,
      config,
      tokenManager,
      vertexEnabled,
      runtimeDir,
      soulDir,
      currentSession,
      isProcessing,
      filteredCommands,
      hasExactMatch,
      paletteIndex,
      autocompleteSelected,
      addEntry,
      setLastStats,
      startThinking,
      stopThinking,
      exit,
    ],
  );

  // ── Palette scroll math ──

  const paletteTotal = filteredCommands.length;
  const paletteVisible = Math.min(paletteTotal, MAX_PALETTE_VISIBLE);
  let paletteScrollStart = 0;
  if (paletteTotal > MAX_PALETTE_VISIBLE) {
    const clamped = Math.max(0, Math.min(paletteIndex, paletteTotal - 1));
    paletteScrollStart = Math.max(
      0,
      Math.min(clamped - Math.floor(paletteVisible / 2), paletteTotal - paletteVisible),
    );
  }
  const paletteSlice = filteredCommands.slice(
    paletteScrollStart,
    paletteScrollStart + paletteVisible,
  );

  const paletteColWidth = paletteSlice.length > 0
    ? Math.min(
        Math.max(
          ...paletteSlice.map((c) => {
            const a = c.aliases?.length ? `, /${c.aliases.join(", /")}` : "";
            const args = c.args ? ` ${c.args}` : "";
            return `/${c.name}${a}${args}`.length;
          }),
        ) + 2,
        35,
      )
    : 20;

  // ── Resize: use Ink's own clear() to reset output tracking ──
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout>;
    const onResize = () => {
      const c = process.stdout.columns;
      if (!c || c < 20) return; // ignore minimize
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        // Ink's clear() properly resets internal line-count tracking,
        // preventing ghost renders that raw ANSI escapes can't fix.
        if (_inkClear) {
          _inkClear();
        }
        // Trigger re-render so dynamic area repaints at new width
        setResizeTick((n) => n + 1);
      }, 100);
    };
    process.stdout.on("resize", onResize);
    return () => { clearTimeout(debounce); process.stdout.off("resize", onResize); };
  }, []);

  // ── Terminal width — always read live (resizeTick forces fresh read) ──
  const cols = (resizeTick >= 0 && process.stdout.columns) || 80;

  // ── Gradient separator (exact terminal width, read live each render) ──
  const theme = getTheme();
  const sepCols = process.stdout.columns || 80;
  const palSepLine = gradient(theme.gradientAccent)("\u2500".repeat(sepCols));

  // ── Render ──

  return (
    <Box flexDirection="column">
      {/* Completed messages - rendered once, never re-rendered */}
      <Static items={history}>
        {(entry) => <HistoryItem key={entry.id} entry={entry} />}
      </Static>

      {/* Thinking spinner (with live thinking preview integrated) */}
      {isProcessing && thinkingElapsed > 0 && !streamingText && (
        <ThinkingSpinner
          elapsed={thinkingElapsed}
          thinkingText={thinkingText}
          thinkingLevel={config?.thinking?.defaultLevel || "medium"}
          mode={activePrompt.startsWith("/marathon") ? "marathon" : activePrompt.startsWith("/x402") ? "x402" : undefined}
          expanded={activePrompt.startsWith("/x402")}
        />
      )}

      {/* Streaming response text */}
      {streamingText && (
        <Box marginLeft={2} marginTop={1}>
          <Text>
            {streamingText}
            <Text color={theme.primaryHex}>{"\u2588"}</Text>
          </Text>
        </Box>
      )}

      {/*
        Input area: StatusLine + Lines + Prompt + Palette all in ONE flexbox.
        This is critical -- Ink only re-renders one contiguous dynamic block
        below Static. Everything interactive must be in this single tree.

        Layout matches GitHub Copilot CLI:
          ~[main*]                         gemini-2.5-pro
          ─────────────────────────────────────────────────
          ❯ /input
          ─────────────────────────────────────────────────
            /command         Description
            /command2        Description2
      */}
      {/* Input area -- always visible (like Claude Code) */}
      <Box flexDirection="column">
        {/* ── Active prompt indicator (shown while processing) ── */}
        {isProcessing && activePrompt && (
          <Box>
            <Text color="#4A9EFF">{"\u{1F539}"} </Text>
            <Text color="#4A9EFF" bold>
              {activePrompt.length > 60 ? activePrompt.slice(0, 57) + "..." : activePrompt}
            </Text>
          </Box>
        )}

        {/* ── Top separator ── */}
        <Text>{palSepLine}</Text>

        {/* Input prompt */}
        <Box>
          <Text bold color={isProcessing ? "#666666" : theme.primaryHex}>
            {"\u276F"}{" "}
          </Text>
          <TextInput
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            placeholder={isProcessing ? "Wispy is thinking..." : "Type naturally, / for commands"}
          />
        </Box>

        {/* ── Bottom separator ── */}
        <Text>{palSepLine}</Text>

        {/* Hints bar with stats (when palette is NOT open) */}
        {!showPalette && (
          <HintsBar stats={lastStats} />
        )}

        {/* Command palette rows (when palette IS open) */}
        {!isProcessing && showPalette && filteredCommands.length > 0 && (
          <Box flexDirection="column">
            {paletteScrollStart > 0 && (
              <Text dimColor>  {"\u25B2"} {paletteScrollStart} more above</Text>
            )}

            {paletteSlice.map((cmd, i) => (
              <PaletteRow
                key={cmd.name}
                cmd={cmd}
                colWidth={paletteColWidth}
                isSelected={paletteScrollStart + i === paletteIndex}
                query={paletteQuery}
                color={theme.primaryHex}
              />
            ))}

            {paletteScrollStart + paletteVisible < paletteTotal && (
              <Text dimColor>  {"\u25BC"} {paletteTotal - paletteScrollStart - paletteVisible} more below</Text>
            )}

            <Text dimColor>  {"\u2191\u2193"} navigate  Tab complete  Enter select  Esc dismiss</Text>
          </Box>
        )}

        {!isProcessing && showPalette && filteredCommands.length === 0 && (
          <Text dimColor>  No matching commands</Text>
        )}
      </Box>
    </Box>
  );
}
