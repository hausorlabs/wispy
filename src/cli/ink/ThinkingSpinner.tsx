/**
 * Animated thinking spinner - Ink component.
 *
 * Features:
 *   - Braille-style smooth spinner with theme colors
 *   - Thinking level badge with color coding
 *   - Cycling action phrases
 *   - Color-coded elapsed time (green -> yellow -> orange)
 *   - Level-aware pulse speed (faster pulse = deeper thinking)
 *   - Preview of current thinking content
 *   - Optional mode label (marathon, x402, background)
 *   - Expanded mode: multi-line reasoning with animated gradient text
 *   - Gradient adapts to current theme (Dawn, Day, Dusk, Night)
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import { getTheme } from "../ui/theme.js";

const PHRASES = [
  "Thinking",
  "Reasoning",
  "Analyzing",
  "Processing",
  "Evaluating",
  "Planning",
  "Composing",
  "Synthesizing",
];

// Braille spinner frames for smooth rotation
const BRAILLE = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

// Block-bar pulse animations at different intensities
const PULSE_SLOW = [
  "\u2591\u2591\u2591\u2591",
  "\u2592\u2591\u2591\u2591",
  "\u2593\u2592\u2591\u2591",
  "\u2588\u2593\u2592\u2591",
  "\u2591\u2588\u2593\u2592",
  "\u2591\u2591\u2588\u2593",
  "\u2591\u2591\u2591\u2588",
  "\u2591\u2591\u2591\u2591",
];

const PULSE_FAST = [
  "\u2591\u2592\u2593\u2588",
  "\u2592\u2593\u2588\u2593",
  "\u2593\u2588\u2593\u2592",
  "\u2588\u2593\u2592\u2591",
  "\u2593\u2592\u2591\u2592",
  "\u2592\u2591\u2592\u2593",
  "\u2591\u2592\u2593\u2588",
  "\u2592\u2593\u2588\u2588",
];

const PULSE_ULTRA = [
  "\u2588\u2593\u2588\u2593",
  "\u2593\u2588\u2593\u2588",
  "\u2588\u2588\u2593\u2588",
  "\u2593\u2588\u2588\u2593",
  "\u2588\u2593\u2593\u2588",
  "\u2593\u2593\u2588\u2588",
  "\u2588\u2588\u2588\u2593",
  "\u2593\u2588\u2588\u2588",
];

// ─── Gradient helpers ────────────────────────────────────────

/** Linearly interpolate between two hex colors */
function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/**
 * Build a smooth N-color gradient palette from theme gradient stops.
 * Creates a forward-and-back sweep: stop1 -> stop2 -> stop3 -> stop2 -> stop1
 */
function buildGradientPalette(stops: string[], size = 16): string[] {
  if (!stops || stops.length === 0) return Array(size).fill("#888888");
  if (stops.length === 1) return Array(size).fill(stops[0]);

  // Build a round-trip path: [s0, s1, s2, s1, s0] for smooth looping
  const path = [...stops, ...stops.slice(1, -1).reverse()];
  const segCount = path.length - 1;
  const palette: string[] = [];

  for (let i = 0; i < size; i++) {
    const pos = (i / size) * segCount;
    const segIdx = Math.min(Math.floor(pos), segCount - 1);
    const t = pos - segIdx;
    palette.push(lerpColor(path[segIdx], path[segIdx + 1], t));
  }
  return palette;
}

/**
 * Split text into segments with gradient colors.
 * Each segment gets a color from the palette, offset by `shift` to animate.
 */
function gradientSegments(
  text: string,
  shift: number,
  palette: string[],
  segCount = 8,
): Array<{ text: string; color: string }> {
  if (!text || palette.length === 0) return [];
  const count = Math.min(segCount, text.length);
  if (count <= 0) return [{ text, color: palette[0] }];
  const segLen = Math.ceil(text.length / count);
  const segments: Array<{ text: string; color: string }> = [];

  for (let i = 0; i < count; i++) {
    const start = i * segLen;
    const end = Math.min(start + segLen, text.length);
    if (start >= text.length) break;
    const colorIdx = (i + shift) % palette.length;
    segments.push({ text: text.slice(start, end), color: palette[colorIdx] });
  }
  return segments;
}

/** Render a single line with gradient colors */
function GradientLine({ segments }: { segments: Array<{ text: string; color: string }> }) {
  return (
    <Text>
      {segments.map((s, i) => (
        <Text key={i} color={s.color}>{s.text}</Text>
      ))}
    </Text>
  );
}

// ─── Spinner internals ───────────────────────────────────────

type ThinkingLevel = "none" | "minimal" | "low" | "medium" | "high" | "ultra";

interface ThinkingSpinnerProps {
  elapsed: number;
  thinkingText?: string;
  thinkingLevel?: ThinkingLevel;
  mode?: string;
  expanded?: boolean;
}

function getTimeColor(elapsed: number): string {
  if (elapsed < 5) return "#4CAF50";
  if (elapsed < 15) return "#FFB74D";
  return "#FF7F50";
}

function getPulseConfig(level: ThinkingLevel): { frames: string[]; speed: number } {
  switch (level) {
    case "none": case "minimal": return { frames: PULSE_SLOW, speed: 180 };
    case "low": return { frames: PULSE_SLOW, speed: 140 };
    case "medium": return { frames: PULSE_FAST, speed: 120 };
    case "high": return { frames: PULSE_FAST, speed: 90 };
    case "ultra": return { frames: PULSE_ULTRA, speed: 60 };
    default: return { frames: PULSE_SLOW, speed: 120 };
  }
}

function getLevelBadge(level: ThinkingLevel): string {
  switch (level) {
    case "minimal": return "MIN";
    case "low": return "LOW";
    case "medium": return "MED";
    case "high": return "HIGH";
    case "ultra": return "ULTRA";
    default: return "";
  }
}

function getModeIcon(mode?: string): string {
  switch (mode) {
    case "marathon": return "\u26A1";
    case "x402": return "\uD83D\uDCB3";
    case "background": return "\u25C9";
    default: return "";
  }
}

function getPreviewLine(text: string): string {
  if (!text) return "";
  const lines = text.split("\n").filter((l) => l.trim().length > 10);
  const line = lines[lines.length - 1] || "";
  if (line.length > 80) return line.slice(0, 77) + "...";
  return line;
}

function getExpandedLines(text: string, maxLines: number): string[] {
  if (!text) return [];
  const all = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 8);
  const start = Math.max(0, all.length - maxLines);
  return all.slice(start).map((l) => l.length > 90 ? l.slice(0, 87) + "..." : l);
}

// ─── Component ───────────────────────────────────────────────

export function ThinkingSpinner({ elapsed, thinkingText, thinkingLevel, mode, expanded }: ThinkingSpinnerProps) {
  const theme = getTheme();
  const level = thinkingLevel || "medium";
  const pulseConfig = getPulseConfig(level);

  // Build gradient palette from the current theme's gradient stops
  const palette = useMemo(
    () => buildGradientPalette(theme.gradient, 16),
    [theme.gradient],
  );

  const [frame, setFrame] = useState(0);
  const [phrase, setPhrase] = useState(() => Math.floor(Math.random() * PHRASES.length));
  const [pulse, setPulse] = useState(0);
  const [gradientShift, setGradientShift] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % BRAILLE.length), 80);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setPhrase((p) => (p + 1) % PHRASES.length), 2200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(
      () => setPulse((p) => (p + 1) % pulseConfig.frames.length),
      pulseConfig.speed,
    );
    return () => clearInterval(t);
  }, [pulseConfig.speed, pulseConfig.frames.length]);

  useEffect(() => {
    if (!expanded) return;
    const t = setInterval(() => setGradientShift((s) => (s + 1) % palette.length), 150);
    return () => clearInterval(t);
  }, [expanded, palette.length]);

  const timeColor = getTimeColor(elapsed);
  const levelBadge = getLevelBadge(level);
  const levelColor = theme.thinkingLevelHex?.[level] || theme.accentHex;
  const modeIcon = getModeIcon(mode);

  // ── Expanded mode ──
  if (expanded) {
    const lines = getExpandedLines(thinkingText || "", 5);
    const hasLines = lines.length > 0;

    return (
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Box>
          <Text color={theme.accentHex || theme.primaryHex}>{BRAILLE[frame]} </Text>
          <Text color={theme.primaryHex} bold>{PHRASES[phrase]}</Text>
          {levelBadge && <Text>  </Text>}
          {levelBadge && <Text color={levelColor} bold>[{levelBadge}]</Text>}
          {modeIcon && <Text color={theme.dimHex || "#555"}> {modeIcon}</Text>}
          <Text color={levelColor}>  {pulseConfig.frames[pulse]}</Text>
          <Text color={timeColor}> {elapsed.toFixed(1)}s</Text>
        </Box>

        {hasLines && lines.map((line, i) => {
          const lineShift = gradientShift + (i * 3);
          const pipeColorIdx = (gradientShift + i * 2) % palette.length;
          const segs = gradientSegments(line, lineShift, palette);
          return (
            <Box key={i} marginLeft={2}>
              <Text color={palette[pipeColorIdx]}>{"\u250A"} </Text>
              <GradientLine segments={segs} />
            </Box>
          );
        })}

        {hasLines && (
          <Box marginLeft={2}>
            <Text color={levelColor}>{"\u2570\u2500"}</Text>
          </Box>
        )}

        {!hasLines && (
          <Box marginLeft={2}>
            <Text color="#555">{"\u250A"} </Text>
            <Text color="#555" italic>Initializing reasoning...</Text>
          </Box>
        )}
      </Box>
    );
  }

  // ── Compact mode ──
  const preview = getPreviewLine(thinkingText || "");

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
      <Box>
        <Text color={theme.accentHex || theme.primaryHex}>{BRAILLE[frame]} </Text>
        <Text color={theme.primaryHex} bold>{PHRASES[phrase]}</Text>
        {levelBadge && <Text>  </Text>}
        {levelBadge && <Text color={levelColor} bold>[{levelBadge}]</Text>}
        {modeIcon && <Text color={theme.dimHex || "#555"}> {modeIcon}</Text>}
        <Text color={levelColor}>  {pulseConfig.frames[pulse]}</Text>
        <Text color={timeColor}> {elapsed.toFixed(1)}s</Text>
      </Box>

      {preview && (
        <Box marginLeft={2}>
          <Text dimColor>{"\u2502"} </Text>
          <Text color="#8B8B8B" italic>{preview}</Text>
        </Box>
      )}
    </Box>
  );
}

/** Export gradient helpers for ThoughtSignature to use */
export { buildGradientPalette, gradientSegments, GradientLine };
