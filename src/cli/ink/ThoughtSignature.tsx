/**
 * ThoughtSignature - Prominent thinking content display with animated gradient text.
 *
 * Shows LLM reasoning with:
 *   - GlareBar at the top (animated sweep in thinking level color)
 *   - Header: signature hash, thinking level badge, character count
 *   - 5-6 meaningful lines with animated gradient coloring
 *   - Hidden line count summary
 *   - Gradient adapts to current theme (Dawn, Day, Dusk, Night)
 *
 *   ░░░░▒▓█▓▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 *   ⟡ Thought Signature · sig:a3f8b2c1 · [HIGH] · 2,340 chars
 *   │ Considering the weather data and market conditions...
 *   │ The user needs real-time analysis of 3 data sources
 *   │ I should chain web_search -> run_python -> memory_save
 *   │ Risk assessment: low - all operations are read-only
 *   │ Proceeding with 4-tool chain for comprehensive results
 *   └ +12 more lines
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import { getTheme } from "../ui/theme.js";
import { buildGradientPalette, gradientSegments, GradientLine } from "./ThinkingSpinner.js";

type ThinkingLevel = "none" | "minimal" | "low" | "medium" | "high" | "ultra";

const LEVEL_LABELS: Record<string, string> = {
  none: "",
  minimal: "MIN",
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  ultra: "ULTRA",
};

interface ThoughtSignatureProps {
  text: string;
  signature?: string;
  thinkingLevel?: string;
  compact?: boolean;
}

/** Strip markdown formatting from text */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Filter and extract meaningful lines from thinking text */
function extractLines(text: string, maxLines: number): { lines: string[]; hidden: number } {
  const allLines = text
    .split("\n")
    .map((l) => stripMarkdown(l))
    .filter((l) => l.length > 10);
  const lines = allLines.slice(0, maxLines).map((l) =>
    l.length > 100 ? l.slice(0, 97) + "..." : l
  );
  const hidden = Math.max(0, allLines.length - maxLines);
  return { lines, hidden };
}

export function ThoughtSignature({ text, signature, thinkingLevel, compact }: ThoughtSignatureProps) {
  const theme = getTheme();
  const level = (thinkingLevel || "high") as ThinkingLevel;
  const levelLabel = LEVEL_LABELS[level] || "";
  const levelColor = theme.thinkingLevelHex?.[level] || theme.accentHex || "#F97316";
  const maxLines = compact ? 3 : 6;
  const { lines, hidden } = extractLines(text, maxLines);
  const sigLabel = signature ? `sig:${signature.slice(0, 8)}` : "";
  const charCount = text.length.toLocaleString();

  // Build theme-aware gradient palette
  const palette = useMemo(
    () => buildGradientPalette(theme.gradient, 16),
    [theme.gradient],
  );

  // Animated gradient shift
  const [gradientShift, setGradientShift] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setGradientShift((s) => (s + 1) % palette.length), 180);
    return () => clearInterval(t);
  }, [palette.length]);

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1} marginBottom={1}>
      {/* Header line */}
      <Box marginLeft={0} marginTop={0}>
        <Text color={levelColor} bold>{"\u27E1"} Thought Signature</Text>
        {sigLabel && (
          <Text color="#6B7280"> {"\u00B7"} </Text>
        )}
        {sigLabel && (
          <Text color="#8B8B8B">{sigLabel}</Text>
        )}
        {levelLabel && (
          <Text color="#6B7280"> {"\u00B7"} </Text>
        )}
        {levelLabel && (
          <Text color={levelColor} bold>[{levelLabel}]</Text>
        )}
        <Text color="#6B7280"> {"\u00B7"} </Text>
        <Text color="#8B8B8B">{charCount} chars</Text>
      </Box>

      {/* Thinking content lines with animated gradient */}
      {lines.map((line, i) => {
        const lineShift = gradientShift + (i * 3);
        const pipeColorIdx = (gradientShift + i * 2) % palette.length;
        const segs = gradientSegments(line, lineShift, palette);

        return (
          <Box key={i} marginLeft={0}>
            <Text color={palette[pipeColorIdx]}>{"\u2502"} </Text>
            <GradientLine segments={segs} />
          </Box>
        );
      })}

      {/* Hidden line count */}
      {hidden > 0 && (
        <Box marginLeft={0}>
          <Text color={levelColor}>{"\u2514"} </Text>
          <Text color="#6B7280">+{hidden} more lines</Text>
        </Box>
      )}
      {hidden === 0 && lines.length > 0 && (
        <Box marginLeft={0}>
          <Text color={levelColor}>{"\u2514"}</Text>
        </Box>
      )}
    </Box>
  );
}
