/**
 * Skill definition types for the browser engine.
 *
 * Skills are declarative -- JSON/TS objects with steps, not imperative code.
 * Parameters use {{param}} substitution syntax.
 */

import type { SkillCategory } from "../config.js";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  parameters: SkillParameter[];
  steps: SkillStep[];
  /** Expected output schema -- hints for the LLM about what gets returned */
  outputHint?: string;
}

export interface SkillParameter {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface SkillStep {
  action: SkillAction;
  target?: string;
  value?: string;
  waitFor?: SkillWait;
  extract?: SkillExtraction;
  condition?: string;
  description?: string;
}

export type SkillAction =
  | "navigate"
  | "click"
  | "type"
  | "press"
  | "wait"
  | "scroll"
  | "screenshot"
  | "extract"
  | "select"
  | "hover";

export interface SkillWait {
  type: "selector" | "networkidle" | "delay" | "navigation";
  value?: string;
  timeout?: number;
}

export interface SkillExtraction {
  name: string;
  selector: string;
  fields: Record<string, { selector?: string; attribute?: string; transform?: string }>;
  multiple?: boolean;
  limit?: number;
}

export interface SkillExecutionResult {
  skillId: string;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  extracted: Record<string, unknown[]>;
  screenshots: string[];
  error?: string;
  duration: number;
}
