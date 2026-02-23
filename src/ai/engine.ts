/**
 * Engine Abstraction Layer
 *
 * Delegates generate/generateAgentic/generateStream to the active engine
 * (Gemini or Claude). Embeddings always route through Gemini since Claude
 * has no embeddings API.
 */

import type { GenerateOptions, GenerateResult, ThinkingLevel } from "./gemini.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("engine");

export type EngineName = "gemini" | "claude";

let activeEngine: EngineName = "gemini";

export function setEngine(engine: EngineName): void {
  activeEngine = engine;
  log.info("Engine set to: %s", engine);
}

export function getEngine(): EngineName {
  return activeEngine;
}

/**
 * Initialize the active engine with credentials.
 */
export async function initEngine(config: {
  engine?: EngineName;
  geminiApiKey?: string;
  claudeApiKey?: string;
  vertexai?: { enabled: boolean; project?: string; location?: string };
}): Promise<void> {
  if (config.engine) {
    activeEngine = config.engine;
  }

  // Always init Gemini (needed for embeddings regardless of engine)
  if (config.geminiApiKey || config.vertexai?.enabled) {
    const { initGemini } = await import("./gemini.js");
    if (config.vertexai?.enabled) {
      initGemini({
        vertexai: true,
        project: config.vertexai.project,
        location: config.vertexai.location,
      });
    } else if (config.geminiApiKey) {
      initGemini(config.geminiApiKey);
    }
  }

  // Init Claude if selected or key provided
  if (activeEngine === "claude" || config.claudeApiKey) {
    if (config.claudeApiKey) {
      const { initClaude } = await import("./claude.js");
      initClaude(config.claudeApiKey);
    } else if (activeEngine === "claude") {
      log.warn("Claude engine selected but no ANTHROPIC_API_KEY provided");
    }
  }

  log.info("Engine initialized: %s", activeEngine);
}

/**
 * Generate — delegates to active engine.
 */
export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  if (activeEngine === "claude") {
    const claude = await import("./claude.js");
    return claude.generate(opts);
  }
  const gemini = await import("./gemini.js");
  return gemini.generate(opts);
}

/**
 * Agentic generate — delegates to active engine.
 */
export async function generateAgentic(
  opts: GenerateOptions,
  executeToolFn: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ success: boolean; output: string; error?: string }>,
): Promise<
  GenerateResult & {
    allToolResults: Array<{
      name: string;
      success: boolean;
      output: string;
      error?: string;
    }>;
  }
> {
  if (activeEngine === "claude") {
    const claude = await import("./claude.js");
    return claude.generateAgentic(opts, executeToolFn);
  }
  const gemini = await import("./gemini.js");
  return gemini.generateAgentic(opts, executeToolFn);
}

/**
 * Streaming generate — delegates to active engine.
 */
export async function* generateStream(
  opts: GenerateOptions,
): AsyncGenerator<{
  type: "text" | "thinking" | "tool_call" | "done";
  content: string;
}> {
  if (activeEngine === "claude") {
    const claude = await import("./claude.js");
    yield* claude.generateStream(opts);
    return;
  }
  const gemini = await import("./gemini.js");
  yield* gemini.generateStream(opts);
}

// Re-export types the rest of the codebase uses
export type { GenerateOptions, GenerateResult, ThinkingLevel };
