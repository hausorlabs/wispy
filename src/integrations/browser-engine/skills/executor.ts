/**
 * Skill Executor -- step-by-step execution of skill definitions with {{param}} substitution.
 */

import type { Page } from "playwright-core";
import type { SkillDefinition, SkillStep, SkillExecutionResult } from "./types.js";
import { extractWithSchema } from "../extraction/schema-extractor.js";

/**
 * Execute a skill with parameter substitution.
 */
export async function executeSkill(
  page: Page,
  skill: SkillDefinition,
  params: Record<string, string>,
  screenshotDir?: string
): Promise<SkillExecutionResult> {
  const startTime = Date.now();
  const extracted: Record<string, unknown[]> = {};
  const screenshots: string[] = [];
  let stepsCompleted = 0;

  // Validate required parameters
  for (const param of skill.parameters) {
    if (param.required && !params[param.name] && !param.default) {
      return {
        skillId: skill.id,
        success: false,
        stepsCompleted: 0,
        totalSteps: skill.steps.length,
        extracted,
        screenshots,
        error: `Missing required parameter: ${param.name}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // Apply defaults
  const resolvedParams: Record<string, string> = {};
  for (const param of skill.parameters) {
    resolvedParams[param.name] = params[param.name] ?? param.default ?? "";
  }

  try {
    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];

      // Substitute parameters in step values
      const resolvedStep = substituteParams(step, resolvedParams);

      await executeStep(page, resolvedStep);

      // Handle extraction
      if (resolvedStep.extract) {
        const data = await extractWithSchema(page, {
          selector: resolvedStep.extract.selector,
          fields: resolvedStep.extract.fields,
          multiple: resolvedStep.extract.multiple,
          limit: resolvedStep.extract.limit,
        });
        extracted[resolvedStep.extract.name] = data;
      }

      // Handle screenshot
      if (resolvedStep.action === "screenshot" && screenshotDir) {
        const filePath = `${screenshotDir}/skill-${skill.id}-step${i}.png`;
        await page.screenshot({ path: filePath, fullPage: false });
        screenshots.push(filePath);
      }

      stepsCompleted++;
    }
  } catch (err) {
    return {
      skillId: skill.id,
      success: false,
      stepsCompleted,
      totalSteps: skill.steps.length,
      extracted,
      screenshots,
      error: err instanceof Error ? err.message : String(err),
      duration: Date.now() - startTime,
    };
  }

  return {
    skillId: skill.id,
    success: true,
    stepsCompleted,
    totalSteps: skill.steps.length,
    extracted,
    screenshots,
    duration: Date.now() - startTime,
  };
}

/**
 * Execute a single skill step.
 */
async function executeStep(page: Page, step: SkillStep): Promise<void> {
  // Wait first if specified
  if (step.waitFor) {
    switch (step.waitFor.type) {
      case "selector":
        await page.waitForSelector(step.waitFor.value!, { timeout: step.waitFor.timeout ?? 10_000 });
        break;
      case "networkidle":
        await page.waitForLoadState("networkidle", { timeout: step.waitFor.timeout ?? 15_000 });
        break;
      case "delay":
        await new Promise((r) => setTimeout(r, step.waitFor!.timeout ?? 1000));
        break;
      case "navigation":
        await page.waitForNavigation({ timeout: step.waitFor.timeout ?? 15_000 }).catch(() => {});
        break;
    }
  }

  switch (step.action) {
    case "navigate":
      await page.goto(step.value!, { waitUntil: "domcontentloaded", timeout: 30_000 });
      break;

    case "click":
      if (step.target) {
        await page.click(step.target, { timeout: 10_000 });
      }
      break;

    case "type":
      if (step.target && step.value) {
        await page.fill(step.target, step.value);
      }
      break;

    case "press":
      if (step.value) {
        if (step.target) {
          await page.press(step.target, step.value);
        } else {
          await page.keyboard.press(step.value);
        }
      }
      break;

    case "wait":
      await new Promise((r) => setTimeout(r, parseInt(step.value ?? "1000", 10)));
      break;

    case "scroll":
      await page.evaluate((dir: string) => {
        if (dir === "bottom") window.scrollTo(0, document.body.scrollHeight);
        else if (dir === "top") window.scrollTo(0, 0);
        else window.scrollBy(0, parseInt(dir) || 500);
      }, step.value ?? "500");
      break;

    case "screenshot":
      // Handled by caller
      break;

    case "select":
      if (step.target && step.value) {
        await page.selectOption(step.target, step.value);
      }
      break;

    case "hover":
      if (step.target) {
        await page.hover(step.target);
      }
      break;

    case "extract":
      // Handled by caller via step.extract
      break;
  }
}

/**
 * Substitute {{param}} placeholders in a step with actual values.
 */
function substituteParams(step: SkillStep, params: Record<string, string>): SkillStep {
  const resolve = (str: string | undefined): string | undefined => {
    if (!str) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? "");
  };

  return {
    ...step,
    target: resolve(step.target),
    value: resolve(step.value),
    condition: resolve(step.condition),
    description: resolve(step.description),
    extract: step.extract
      ? {
          ...step.extract,
          selector: resolve(step.extract.selector)!,
        }
      : undefined,
  };
}
