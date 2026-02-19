/**
 * Form Filler -- intelligent form detection and filling.
 */

import type { Page } from "playwright-core";

export interface FormField {
  selector: string;
  type: string;
  name: string;
  label: string;
  placeholder: string;
  required: boolean;
  value: string;
}

export interface FormInfo {
  action: string;
  method: string;
  fields: FormField[];
  submitSelector: string;
}

/**
 * Detect all forms on the page and their fields.
 */
export async function detectForms(page: Page): Promise<FormInfo[]> {
  return page.evaluate(() => {
    const forms: Array<{
      action: string;
      method: string;
      fields: Array<{
        selector: string;
        type: string;
        name: string;
        label: string;
        placeholder: string;
        required: boolean;
        value: string;
      }>;
      submitSelector: string;
    }> = [];

    const formEls = document.querySelectorAll("form");

    for (let fi = 0; fi < formEls.length; fi++) {
      const form = formEls[fi];
      const fields: typeof forms[0]["fields"] = [];

      // Find all input fields
      const inputs = form.querySelectorAll("input, select, textarea");
      for (let ii = 0; ii < inputs.length; ii++) {
        const input = inputs[ii] as HTMLInputElement;
        if (["hidden", "submit", "button", "reset"].includes(input.type)) continue;

        // Find associated label
        let label = "";
        if (input.id) {
          const labelEl = form.querySelector(`label[for="${input.id}"]`);
          if (labelEl) label = labelEl.textContent?.trim() ?? "";
        }
        if (!label) {
          const parent = input.closest("label");
          if (parent) label = parent.textContent?.trim() ?? "";
        }

        fields.push({
          selector: input.id
            ? `#${input.id}`
            : input.name
              ? `[name="${input.name}"]`
              : `form:nth-of-type(${fi + 1}) ${input.tagName.toLowerCase()}:nth-of-type(${ii + 1})`,
          type: input.type || input.tagName.toLowerCase(),
          name: input.name || "",
          label,
          placeholder: input.placeholder || "",
          required: input.required,
          value: input.value || "",
        });
      }

      // Find submit button
      const submit = form.querySelector(
        'button[type="submit"], input[type="submit"], button:not([type])'
      );
      const submitSelector = submit
        ? (submit as HTMLElement).id
          ? `#${(submit as HTMLElement).id}`
          : `form:nth-of-type(${fi + 1}) button[type="submit"], form:nth-of-type(${fi + 1}) button:not([type])`
        : "";

      forms.push({
        action: form.action || "",
        method: (form.method || "GET").toUpperCase(),
        fields,
        submitSelector,
      });
    }

    return forms;
  });
}

/**
 * Fill a form with provided values.
 * @param values - Map of field names/selectors to values
 */
export async function fillForm(
  page: Page,
  values: Record<string, string>,
  opts?: { submit?: boolean; formIndex?: number }
): Promise<{ filled: number; errors: string[] }> {
  const forms = await detectForms(page);
  const formIndex = opts?.formIndex ?? 0;

  if (forms.length === 0) return { filled: 0, errors: ["No forms found on page"] };
  if (formIndex >= forms.length) return { filled: 0, errors: [`Form index ${formIndex} out of range (${forms.length} forms found)`] };

  const form = forms[formIndex];
  let filled = 0;
  const errors: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    // Try to match key to a field by name, label, or selector
    const field = form.fields.find(
      (f) =>
        f.name === key ||
        f.label.toLowerCase().includes(key.toLowerCase()) ||
        f.selector === key ||
        f.placeholder.toLowerCase().includes(key.toLowerCase())
    );

    const selector = field?.selector ?? key;

    try {
      const fieldType = field?.type ?? "text";

      if (fieldType === "select" || fieldType === "select-one") {
        await page.selectOption(selector, value);
      } else if (fieldType === "checkbox" || fieldType === "radio") {
        const isChecked = await page.isChecked(selector);
        const shouldCheck = value === "true" || value === "1" || value === "on";
        if (isChecked !== shouldCheck) {
          await page.click(selector);
        }
      } else if (fieldType === "file") {
        // File upload: value should be a file path
        const input = page.locator(selector);
        await input.setInputFiles(value);
      } else if (fieldType === "date") {
        // Normalize date format for HTML date inputs (YYYY-MM-DD)
        const normalized = normalizeDate(value);
        await page.fill(selector, normalized);
      } else if (fieldType === "number" || fieldType === "range") {
        // Validate numeric value
        const num = parseFloat(value);
        if (isNaN(num)) {
          errors.push(`"${key}" expects a number but got "${value}"`);
          continue;
        }
        await page.fill(selector, String(num));
      } else if (fieldType === "color") {
        // Ensure hex format
        const hex = value.startsWith("#") ? value : `#${value}`;
        await page.fill(selector, hex);
      } else if (fieldType === "textarea") {
        await page.fill(selector, value);
      } else {
        await page.fill(selector, value);
      }
      filled++;
    } catch (err) {
      errors.push(`Failed to fill "${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Submit if requested
  if (opts?.submit && form.submitSelector) {
    try {
      await page.click(form.submitSelector);
    } catch {
      errors.push("Failed to click submit button");
    }
  }

  return { filled, errors };
}

/**
 * Normalize various date formats to YYYY-MM-DD for HTML date inputs.
 */
function normalizeDate(value: string): string {
  // Already in correct format
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  try {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  } catch {
    // Fall through
  }

  return value;
}

/**
 * Format form info for LLM display.
 */
export function formatFormInfo(forms: FormInfo[]): string {
  if (forms.length === 0) return "No forms found on the page.";

  const lines: string[] = [`Found ${forms.length} form(s):\n`];

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    lines.push(`--- Form ${i + 1} ---`);
    lines.push(`  Action: ${form.action || "(current page)"}`);
    lines.push(`  Method: ${form.method}`);
    lines.push(`  Fields:`);

    for (const f of form.fields) {
      const req = f.required ? " *" : "";
      const label = f.label || f.name || f.placeholder || f.selector;
      lines.push(`    - ${label} (${f.type})${req}`);
    }

    if (form.submitSelector) {
      lines.push(`  Submit: ${form.submitSelector}`);
    }
  }

  return lines.join("\n");
}
