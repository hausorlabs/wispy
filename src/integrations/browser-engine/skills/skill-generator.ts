/**
 * Skill Generator -- Uses Gemini to generate SkillDefinitions from natural language goals.
 *
 * Agent mode: describe what you want, Gemini creates a reusable skill.
 * The generator provides the SkillDefinition schema, examples, and current page context
 * to Gemini, then validates and returns the generated skill.
 */

import type { SkillDefinition, SkillAction, SkillStep, SkillParameter } from "./types.js";
import type { SkillCategory } from "../config.js";
import { SKILL_CATEGORIES } from "../config.js";
import { createLogger } from "../../../infra/logger.js";

const log = createLogger("skill-generator");

/** Function type for calling Gemini -- injected to avoid circular deps */
export type GeminiGenerateFn = (prompt: string, systemPrompt?: string) => Promise<string>;

const VALID_ACTIONS: SkillAction[] = [
  "navigate", "click", "type", "press", "wait", "scroll",
  "screenshot", "extract", "select", "hover",
];

const SYSTEM_PROMPT = `You are a browser automation skill generator. Given a goal, you produce a SkillDefinition JSON object that describes a reusable browser automation workflow.

## SkillDefinition Schema

{
  "id": "string (kebab-case, unique identifier)",
  "name": "string (human-readable name)",
  "description": "string (what the skill does)",
  "category": "string (one of: ${SKILL_CATEGORIES.join(", ")})",
  "tags": ["string array of keywords for discovery"],
  "parameters": [
    {
      "name": "string",
      "description": "string",
      "required": true/false,
      "default": "optional default value"
    }
  ],
  "steps": [
    {
      "action": "navigate|click|type|press|wait|scroll|screenshot|extract|select|hover",
      "target": "CSS selector (for click, type, select, hover)",
      "value": "URL for navigate, text for type, key for press",
      "waitFor": {
        "type": "selector|networkidle|delay|navigation",
        "value": "CSS selector or delay in ms",
        "timeout": 10000
      },
      "extract": {
        "name": "variable name for extracted data",
        "selector": "container CSS selector",
        "fields": {
          "fieldName": {
            "selector": "CSS selector within container",
            "attribute": "HTML attribute (default: textContent)",
            "transform": "text|html|number|url|trim"
          }
        },
        "multiple": true,
        "limit": 20
      },
      "description": "what this step does"
    }
  ],
  "outputHint": "description of expected output format"
}

## Parameter Substitution
Use {{paramName}} in step values to reference parameters. Example:
- step value: "https://google.com/search?q={{query}}"
- The executor will replace {{query}} with the actual parameter value at runtime.

## Example: Google Search Skill
{
  "id": "google-search",
  "name": "Google Search",
  "description": "Search Google and extract top results",
  "category": "search",
  "tags": ["google", "search", "web"],
  "parameters": [
    { "name": "query", "description": "Search query", "required": true }
  ],
  "steps": [
    { "action": "navigate", "value": "https://www.google.com/search?q={{query}}" },
    {
      "action": "extract",
      "waitFor": { "type": "selector", "value": "#search" },
      "extract": {
        "name": "results",
        "selector": "#search .g",
        "fields": {
          "title": { "selector": "h3", "transform": "text" },
          "url": { "selector": "a", "attribute": "href", "transform": "url" },
          "snippet": { "selector": ".VwiC3b", "transform": "text" }
        },
        "multiple": true,
        "limit": 10
      }
    }
  ],
  "outputHint": "Array of {title, url, snippet}"
}

## Rules
1. ONLY output valid JSON -- no markdown, no explanation, just the JSON object.
2. Use real, working CSS selectors. Prefer data attributes and semantic selectors over fragile class names.
3. Include waitFor on steps that depend on page content loading.
4. Make skills reusable -- use parameters for variable inputs.
5. Keep skills focused -- one task per skill.
6. Category must be one of: ${SKILL_CATEGORIES.join(", ")}`;

export interface GenerateSkillOptions {
  goal: string;
  name: string;
  category?: SkillCategory;
  pageUrl?: string;
  pageTitle?: string;
  geminiCall: GeminiGenerateFn;
}

export async function generateSkill(opts: GenerateSkillOptions): Promise<SkillDefinition> {
  const { goal, name, category, pageUrl, pageTitle, geminiCall } = opts;

  const contextInfo = pageUrl
    ? `\n\nCurrent browser page:\n- URL: ${pageUrl}\n- Title: ${pageTitle || "Unknown"}`
    : "";

  const userPrompt = `Generate a browser automation skill with these requirements:

Name: ${name}
Goal: ${goal}${category ? `\nCategory: ${category}` : ""}${contextInfo}

Return ONLY the JSON SkillDefinition object.`;

  log.info("Generating skill: %s (goal: %s)", name, goal);

  const response = await geminiCall(userPrompt, SYSTEM_PROMPT);

  // Extract JSON from response (handle potential markdown wrapping)
  let jsonStr = response.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let skill: SkillDefinition;
  try {
    skill = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse generated skill JSON: ${(err as Error).message}\nResponse: ${jsonStr.slice(0, 500)}`);
  }

  // Validate and sanitize the generated skill
  skill = validateSkill(skill, name, category);

  log.info("Generated skill %s with %d steps", skill.id, skill.steps.length);
  return skill;
}

function validateSkill(
  raw: any,
  fallbackName: string,
  fallbackCategory?: SkillCategory
): SkillDefinition {
  // Ensure required fields
  if (!raw.id || typeof raw.id !== "string") {
    raw.id = `custom-${fallbackName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`;
  }
  if (!raw.name || typeof raw.name !== "string") {
    raw.name = fallbackName;
  }
  if (!raw.description || typeof raw.description !== "string") {
    raw.description = `Custom skill: ${fallbackName}`;
  }

  // Validate category
  if (!raw.category || !SKILL_CATEGORIES.includes(raw.category)) {
    raw.category = fallbackCategory || "utility";
  }

  // Ensure arrays
  if (!Array.isArray(raw.tags)) raw.tags = [];
  if (!Array.isArray(raw.parameters)) raw.parameters = [];
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("Generated skill has no steps");
  }

  // Validate parameters
  raw.parameters = raw.parameters.map((p: any) => ({
    name: String(p.name || "param"),
    description: String(p.description || ""),
    required: Boolean(p.required),
    default: p.default !== undefined ? String(p.default) : undefined,
  }));

  // Validate steps
  raw.steps = raw.steps.map((step: any, i: number) => {
    if (!step.action || !VALID_ACTIONS.includes(step.action)) {
      throw new Error(`Step ${i + 1}: invalid action "${step.action}". Valid: ${VALID_ACTIONS.join(", ")}`);
    }

    const validated: SkillStep = {
      action: step.action,
    };

    if (step.target) validated.target = String(step.target);
    if (step.value) validated.value = String(step.value);
    if (step.description) validated.description = String(step.description);
    if (step.condition) validated.condition = String(step.condition);

    if (step.waitFor && typeof step.waitFor === "object") {
      validated.waitFor = {
        type: step.waitFor.type || "delay",
        value: step.waitFor.value ? String(step.waitFor.value) : undefined,
        timeout: Number(step.waitFor.timeout) || 10000,
      };
    }

    if (step.extract && typeof step.extract === "object") {
      validated.extract = {
        name: String(step.extract.name || "data"),
        selector: String(step.extract.selector || "body"),
        fields: step.extract.fields || {},
        multiple: Boolean(step.extract.multiple ?? true),
        limit: Number(step.extract.limit) || 20,
      };
    }

    return validated;
  });

  // Add custom tag
  if (!raw.tags.includes("custom")) {
    raw.tags.push("custom");
  }

  return raw as SkillDefinition;
}
