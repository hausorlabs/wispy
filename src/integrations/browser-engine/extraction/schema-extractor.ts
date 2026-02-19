/**
 * Schema Extractor -- declarative structured data extraction using CSS selectors.
 *
 * Given a schema like:
 * {
 *   selector: ".product",
 *   fields: {
 *     title: { selector: "h2", transform: "text" },
 *     price: { selector: ".price", transform: "text" },
 *     image: { selector: "img", attribute: "src" },
 *     link: { selector: "a", attribute: "href", transform: "url" }
 *   },
 *   multiple: true,
 *   limit: 10
 * }
 *
 * Extracts an array of { title, price, image, link } objects.
 */

import type { Page } from "playwright-core";
import type { ExtractionSchema, FieldExtractor } from "../types.js";

/**
 * Extract structured data from a page using a declarative schema.
 */
export async function extractWithSchema(
  page: Page,
  schema: ExtractionSchema
): Promise<Record<string, unknown>[]> {
  const results = await page.evaluate(
    (args: { schema: ExtractionSchema }) => {
      const { schema } = args;

      function extractField(el: Element, field: { selector?: string; attribute?: string; transform?: string }): unknown {
        let target: Element | null = el;

        if (field.selector) {
          target = el.querySelector(field.selector);
        }

        if (!target) return null;

        let value: string;

        if (field.attribute) {
          value = target.getAttribute(field.attribute) ?? "";
        } else {
          value = (target as HTMLElement).innerText?.trim() ?? target.textContent?.trim() ?? "";
        }

        // Apply transforms
        switch (field.transform) {
          case "number": {
            const num = parseFloat(value.replace(/[^0-9.-]/g, ""));
            return isNaN(num) ? null : num;
          }
          case "currency": {
            // Parse "$1,234.56" → 1234.56
            const clean = value.replace(/[^0-9.,\-]/g, "").replace(/,/g, "");
            const num = parseFloat(clean);
            return isNaN(num) ? null : num;
          }
          case "date": {
            // Parse common date formats → ISO string
            try {
              const d = new Date(value);
              return isNaN(d.getTime()) ? value : d.toISOString();
            } catch {
              return value;
            }
          }
          case "boolean": {
            const lower = value.toLowerCase().trim();
            return ["true", "yes", "1", "on", "enabled"].includes(lower);
          }
          case "slug": {
            return value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
          }
          case "json": {
            try {
              return JSON.parse(value);
            } catch {
              return value;
            }
          }
          case "array": {
            // Split comma-separated values
            return value.split(",").map((s: string) => s.trim()).filter(Boolean);
          }
          case "clean": {
            // Strip HTML tags, collapse whitespace
            return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
          }
          case "url": {
            if (value.startsWith("http")) return value;
            try {
              return new URL(value, window.location.href).href;
            } catch {
              return value;
            }
          }
          case "html":
            return target.innerHTML;
          case "trim":
            return value.trim();
          case "text":
          default:
            return value;
        }
      }

      const items: Record<string, unknown>[] = [];
      const containers = document.querySelectorAll(schema.selector);
      const limit = schema.limit ?? (schema.multiple ? 100 : 1);
      const max = schema.multiple ? Math.min(containers.length, limit) : Math.min(containers.length, 1);

      for (let i = 0; i < max; i++) {
        const container = containers[i];
        const item: Record<string, unknown> = {};

        for (const [key, fieldDef] of Object.entries(schema.fields)) {
          item[key] = extractField(container, fieldDef);
        }

        items.push(item);
      }

      return items;
    },
    { schema }
  );

  return results;
}

/**
 * Extract repeated list items using a container + item selector pattern.
 * Useful for search results, product listings, etc.
 */
export async function extractRepeatedItems(
  page: Page,
  containerSelector: string,
  itemSelector: string,
  fields: Record<string, FieldExtractor>,
  limit = 20
): Promise<Record<string, unknown>[]> {
  return extractWithSchema(page, {
    selector: itemSelector,
    fields,
    multiple: true,
    limit,
  });
}

/**
 * Format extracted data as a readable string for LLM output.
 */
export function formatExtractedData(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "No data extracted.";

  const lines: string[] = [];
  lines.push(`Extracted ${data.length} item(s):\n`);

  for (let i = 0; i < data.length; i++) {
    lines.push(`--- Item ${i + 1} ---`);
    for (const [key, value] of Object.entries(data[i])) {
      if (value !== null && value !== undefined && value !== "") {
        lines.push(`  ${key}: ${String(value)}`);
      }
    }
  }

  return lines.join("\n");
}
