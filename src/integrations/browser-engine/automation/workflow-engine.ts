/**
 * Workflow Engine -- multi-step workflow orchestration with conditionals,
 * error branching, retries, fallback selectors, and variables.
 */

import type { Page } from "playwright-core";
import type { WorkflowStep, WorkflowResult, WorkflowStepResult } from "../types.js";
import { extractWithSchema } from "../extraction/schema-extractor.js";
import { executeWait } from "./wait-strategies.js";
import type { WaitStrategy } from "../types.js";

/**
 * Execute a multi-step workflow with conditionals and error handling.
 */
export async function executeWorkflow(
  page: Page,
  steps: WorkflowStep[],
  screenshotDir?: string
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const stepResults: WorkflowStepResult[] = [];
  const extracted: Record<string, unknown>[] = [];
  const screenshots: string[] = [];
  const variables: Record<string, unknown> = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStart = Date.now();

    // Check condition
    if (step.condition) {
      try {
        const condResult = await page.evaluate(
          (expr: string) => {
            try {
              return !!eval(expr);
            } catch {
              return false;
            }
          },
          substituteVars(step.condition, variables)
        );
        if (!condResult) {
          stepResults.push({
            step: i,
            action: step.action,
            success: true,
            skipped: true,
            duration: Date.now() - stepStart,
          });
          continue;
        }
      } catch {
        // Condition eval failed, skip step
        stepResults.push({
          step: i,
          action: step.action,
          success: true,
          skipped: true,
          duration: Date.now() - stepStart,
        });
        continue;
      }
    }

    // forEach is handled inline (needs access to variables, extracted, etc.)
    if (step.action === "forEach") {
      const forEachResult = await executeForEach(page, step, variables, extracted, screenshots, screenshotDir, i);
      stepResults.push(...forEachResult.stepResults);
      if (!forEachResult.success && (step.onError ?? "stop") === "stop") {
        return {
          success: false,
          steps: stepResults,
          extracted,
          screenshots,
          variables,
          duration: Date.now() - startTime,
        };
      }
      continue;
    }

    // Execute with retry support
    const maxRetries = step.onError === "retry" ? (step.maxRetries ?? 2) : 0;
    let lastError: string | undefined;
    let succeeded = false;
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Substitute variables into step values
        const resolvedStep = resolveStep(step, variables);
        await executeWorkflowStep(page, resolvedStep);
        succeeded = true;
        retries = attempt;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        // Try fallback target on first failure
        if (attempt === 0 && step.fallbackTarget && step.target) {
          try {
            const fallbackStep = { ...step, target: step.fallbackTarget };
            await executeWorkflowStep(page, resolveStep(fallbackStep, variables));
            succeeded = true;
            retries = attempt;
            break;
          } catch {
            // Fallback also failed, continue to retry
          }
        }

        if (attempt < maxRetries) {
          // Wait before retry
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    if (succeeded) {
      // Wait after step if specified
      if (step.waitFor) {
        const waitStrategy = parseWaitFor(
          substituteVars(step.waitFor, variables),
          step.timeout
        );
        try {
          await executeWait(page, waitStrategy);
        } catch {
          // Wait failure is non-fatal
        }
      }

      // Extract data if specified
      if (step.extract) {
        try {
          const data = await extractWithSchema(page, step.extract);
          extracted.push(...data);

          // Store in variable if requested
          if (step.storeAs) {
            variables[step.storeAs] = data;
          }
        } catch {
          // Extraction failure is non-fatal
        }
      }

      // Screenshot if requested
      if (step.screenshot && screenshotDir) {
        try {
          const filePath = `${screenshotDir}/workflow-step-${i}.png`;
          await page.screenshot({ path: filePath });
          screenshots.push(filePath);
        } catch {
          // Screenshot failure is non-fatal
        }
      }

      stepResults.push({
        step: i,
        action: step.action,
        success: true,
        retries: retries > 0 ? retries : undefined,
        duration: Date.now() - stepStart,
      });
    } else {
      // Step failed
      stepResults.push({
        step: i,
        action: step.action,
        success: false,
        retries: maxRetries > 0 ? maxRetries : undefined,
        error: lastError,
        duration: Date.now() - stepStart,
      });

      // Error handling
      const onError = step.onError ?? "stop";
      if (onError === "stop") {
        return {
          success: false,
          steps: stepResults,
          extracted,
          screenshots,
          variables,
          duration: Date.now() - startTime,
        };
      }
      // "skip" continues to next step
    }
  }

  return {
    success: true,
    steps: stepResults,
    extracted,
    screenshots,
    variables,
    duration: Date.now() - startTime,
  };
}

/**
 * Execute a single workflow step.
 */
async function executeWorkflowStep(page: Page, step: WorkflowStep): Promise<void> {
  const timeout = step.timeout ?? 10_000;

  switch (step.action) {
    case "navigate":
    case "goto":
      await page.goto(step.value!, { waitUntil: "domcontentloaded", timeout: 30_000 });
      break;

    case "click":
      if (step.target) {
        await page.click(step.target, { timeout });
      }
      break;

    case "type":
    case "fill":
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

    case "select":
      if (step.target && step.value) {
        await page.selectOption(step.target, step.value);
      }
      break;

    case "hover":
      if (step.target) {
        await page.hover(step.target, { timeout });
      }
      break;

    case "scroll":
      await page.evaluate((amount: string) => {
        if (amount === "bottom") window.scrollTo(0, document.body.scrollHeight);
        else if (amount === "top") window.scrollTo(0, 0);
        else window.scrollBy(0, parseInt(amount) || 500);
      }, step.value ?? "500");
      break;

    case "wait":
      await new Promise((r) => setTimeout(r, parseInt(step.value ?? "1000", 10)));
      break;

    case "screenshot":
      // Handled by caller
      break;

    case "evaluate":
      if (step.value) {
        await page.evaluate(step.value);
      }
      break;

    case "forEach":
      // Handled inline in executeWorkflow, not here
      break;

    default:
      throw new Error(`Unknown workflow action: ${step.action}`);
  }
}

/**
 * Execute a forEach loop step -- iterates over DOM elements or a stored variable array,
 * running subSteps for each item.
 */
async function executeForEach(
  page: Page,
  step: WorkflowStep,
  variables: Record<string, unknown>,
  extracted: Record<string, unknown>[],
  screenshots: string[],
  screenshotDir: string | undefined,
  parentStepIndex: number
): Promise<{ success: boolean; stepResults: WorkflowStepResult[] }> {
  const stepResults: WorkflowStepResult[] = [];
  const stepStart = Date.now();
  const iterVar = step.iterVar ?? "item";
  const maxIter = step.maxIterations ?? 50;
  const subSteps = step.subSteps ?? [];

  if (!step.items || subSteps.length === 0) {
    stepResults.push({
      step: parentStepIndex,
      action: "forEach",
      success: true,
      skipped: true,
      duration: Date.now() - stepStart,
    });
    return { success: true, stepResults };
  }

  // Resolve items: either a CSS selector or a variable name
  let items: unknown[];
  const resolvedItems = substituteVars(step.items, variables);

  if (variables[resolvedItems] && Array.isArray(variables[resolvedItems])) {
    // Items from a stored variable
    items = variables[resolvedItems] as unknown[];
  } else {
    // Items from CSS selector -- query the page for matching elements
    try {
      items = await page.evaluate((selector: string) => {
        const els = document.querySelectorAll(selector);
        return Array.from(els).map((el, idx) => ({
          index: idx,
          tag: el.tagName.toLowerCase(),
          text: (el as HTMLElement).innerText?.trim().substring(0, 200) ?? "",
          selector: selector + `:nth-child(${idx + 1})`,
        }));
      }, resolvedItems);
    } catch (err) {
      stepResults.push({
        step: parentStepIndex,
        action: "forEach",
        success: false,
        error: `Failed to query items "${resolvedItems}": ${err instanceof Error ? err.message : String(err)}`,
        duration: Date.now() - stepStart,
      });
      return { success: false, stepResults };
    }
  }

  // Cap iterations
  const iterCount = Math.min(items.length, maxIter);

  stepResults.push({
    step: parentStepIndex,
    action: "forEach",
    success: true,
    duration: 0, // Updated at end
  });

  for (let idx = 0; idx < iterCount; idx++) {
    const item = items[idx];

    // Set loop variables
    variables[iterVar] = item;
    variables[`${iterVar}_index`] = idx;
    variables[`${iterVar}_count`] = iterCount;

    // Execute sub-steps as a nested workflow
    const subResult = await executeWorkflow(page, subSteps, screenshotDir);

    // Merge results
    for (const sr of subResult.steps) {
      stepResults.push({
        ...sr,
        step: parentStepIndex,
        action: `forEach[${idx}].${sr.action}`,
      });
    }
    extracted.push(...subResult.extracted);
    screenshots.push(...subResult.screenshots);

    // Merge sub-workflow variables back (except loop vars)
    for (const [key, val] of Object.entries(subResult.variables)) {
      if (key !== iterVar && key !== `${iterVar}_index` && key !== `${iterVar}_count`) {
        variables[key] = val;
      }
    }

    // If sub-workflow failed and onError is "stop", bail out
    if (!subResult.success && (step.onError ?? "stop") === "stop") {
      // Update the forEach summary step duration
      stepResults[0].duration = Date.now() - stepStart;
      return { success: false, stepResults };
    }
  }

  // Clean up loop variables
  delete variables[iterVar];
  delete variables[`${iterVar}_index`];
  delete variables[`${iterVar}_count`];

  // Update the forEach summary step duration
  stepResults[0].duration = Date.now() - stepStart;

  return { success: true, stepResults };
}

/**
 * Resolve a step by substituting variables into target and value.
 */
function resolveStep(
  step: WorkflowStep,
  variables: Record<string, unknown>
): WorkflowStep {
  return {
    ...step,
    target: step.target ? substituteVars(step.target, variables) : step.target,
    value: step.value ? substituteVars(step.value, variables) : step.value,
  };
}

/**
 * Substitute {{varName}} placeholders in a string.
 */
function substituteVars(str: string, variables: Record<string, unknown>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = variables[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Parse a waitFor string into a WaitStrategy.
 */
function parseWaitFor(waitFor: string, timeout?: number): WaitStrategy {
  if (waitFor === "networkidle") return { type: "networkidle" };
  if (waitFor === "domready") return { type: "domready" };
  if (waitFor.startsWith("delay:")) return { type: "delay", ms: parseInt(waitFor.slice(6), 10) };
  // Assume it's a CSS selector
  return { type: "selector", value: waitFor, timeout };
}

/**
 * Format workflow result for LLM output.
 */
export function formatWorkflowResult(result: WorkflowResult): string {
  const lines: string[] = [];

  lines.push(
    `Workflow ${result.success ? "completed" : "failed"} (${result.duration}ms, ${result.steps.length} steps)`
  );

  for (const step of result.steps) {
    const status = step.skipped ? "SKIP" : step.success ? "OK" : "FAIL";
    const retryInfo = step.retries ? ` (${step.retries} retries)` : "";
    lines.push(
      `  Step ${step.step + 1} [${step.action}]: ${status}${retryInfo} (${step.duration}ms)${step.error ? ` - ${step.error}` : ""}`
    );
  }

  if (result.extracted.length > 0) {
    lines.push(`\nExtracted ${result.extracted.length} item(s)`);
  }

  if (result.screenshots.length > 0) {
    lines.push(`Screenshots: ${result.screenshots.length}`);
  }

  if (Object.keys(result.variables).length > 0) {
    lines.push(`\nVariables: ${Object.keys(result.variables).join(", ")}`);
  }

  return lines.join("\n");
}
