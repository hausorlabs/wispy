import type { WispyConfig } from "../config/schema.js";
import type { ThinkingLevel } from "./gemini.js";
import { getEngine } from "./engine.js";

export type TaskType =
  | "reasoning"
  | "planning"
  | "analysis"
  | "quick"
  | "classification"
  | "heartbeat"
  | "image_gen"
  | "embedding"
  | "voice";

interface ModelRoute {
  model: string;
  thinking: ThinkingLevel;
}

// Default Claude model mappings
const CLAUDE_MODELS = {
  reasoning: "claude-sonnet-4-20250514",
  fast: "claude-haiku-4-5-20251001",
};

export function routeTask(
  taskType: TaskType,
  config: WispyConfig
): ModelRoute {
  const engine = getEngine();

  // Claude routing
  if (engine === "claude") {
    const claudeConfig = config.claude;
    const reasoning = claudeConfig?.models?.reasoning || CLAUDE_MODELS.reasoning;
    const fast = claudeConfig?.models?.fast || CLAUDE_MODELS.fast;

    switch (taskType) {
      case "reasoning":
      case "planning":
      case "analysis":
        return { model: reasoning, thinking: "high" };
      case "quick":
      case "classification":
        return { model: fast, thinking: "minimal" };
      case "heartbeat":
        return { model: fast, thinking: "low" };
      // Image gen and embedding always go through Gemini
      case "image_gen":
        return { model: config.gemini.models.image, thinking: "none" };
      case "embedding":
        return { model: config.gemini.models.embedding, thinking: "none" };
      case "voice":
        return { model: fast, thinking: "none" };
      default:
        return { model: reasoning, thinking: "medium" };
    }
  }

  // Gemini routing (default)
  const models = config.gemini.models;

  switch (taskType) {
    case "reasoning":
    case "planning":
    case "analysis":
      return { model: models.pro, thinking: "high" };

    case "quick":
    case "classification":
      return { model: models.flash, thinking: "minimal" };

    case "heartbeat":
      return { model: models.flash, thinking: "low" };

    case "image_gen":
      return { model: models.image, thinking: "none" };

    case "embedding":
      return { model: models.embedding, thinking: "none" };

    case "voice":
      return { model: models.flash, thinking: "none" };

    default:
      return { model: models.pro, thinking: "medium" };
  }
}
