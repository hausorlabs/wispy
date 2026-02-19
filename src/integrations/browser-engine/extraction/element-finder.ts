/**
 * Element Finder -- CSS selector queries and long content reading.
 *
 * findElements: CSS query returning text + attributes for matched elements.
 * readLongContent: Intelligent chunked reading of long page content.
 */

import type { Page } from "playwright-core";

export interface FoundElement {
  index: number;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  selector: string;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number } | null;
}

export interface ContentChunk {
  chunkIndex: number;
  totalChunks: number;
  content: string;
  startOffset: number;
  endOffset: number;
}

/**
 * Find elements matching a CSS selector. Returns text + attributes.
 */
export async function findElements(
  page: Page,
  selector: string,
  opts?: { limit?: number; attributes?: string[] }
): Promise<FoundElement[]> {
  const limit = opts?.limit ?? 50;
  const requestedAttrs = opts?.attributes;

  return page.evaluate(
    ({ selector, limit, requestedAttrs }) => {
      const els = document.querySelectorAll(selector);
      const results: Array<{
        index: number;
        tag: string;
        text: string;
        attributes: Record<string, string>;
        selector: string;
        visible: boolean;
        rect: { x: number; y: number; width: number; height: number } | null;
      }> = [];

      const defaultAttrs = ["id", "class", "href", "src", "type", "name", "value", "role", "aria-label", "alt", "title", "placeholder", "data-testid"];
      const attrsToCapture = requestedAttrs ?? defaultAttrs;

      for (let i = 0; i < Math.min(els.length, limit); i++) {
        const el = els[i] as HTMLElement;
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0 &&
          getComputedStyle(el).display !== "none" &&
          getComputedStyle(el).visibility !== "hidden";

        const attributes: Record<string, string> = {};
        for (const attr of attrsToCapture) {
          const val = el.getAttribute(attr);
          if (val !== null && val !== "") {
            attributes[attr] = val.substring(0, 200);
          }
        }

        // Build a usable selector
        let selectorStr: string;
        if (el.id) {
          selectorStr = `#${el.id}`;
        } else if (el.getAttribute("data-testid")) {
          selectorStr = `[data-testid="${el.getAttribute("data-testid")}"]`;
        } else {
          selectorStr = selector + `:nth-child(${i + 1})`;
        }

        results.push({
          index: i,
          tag: el.tagName.toLowerCase(),
          text: (el.innerText ?? el.textContent ?? "").trim().substring(0, 200),
          attributes,
          selector: selectorStr,
          visible,
          rect: visible ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        });
      }

      return results;
    },
    { selector, limit, requestedAttrs }
  );
}

/**
 * Read long page content in chunks. Useful for pages with extensive text
 * that exceeds context limits.
 */
export async function readLongContent(
  page: Page,
  opts?: { selector?: string; chunkSize?: number; chunkIndex?: number }
): Promise<ContentChunk> {
  const selector = opts?.selector ?? "body";
  const chunkSize = opts?.chunkSize ?? 50_000;
  const chunkIndex = opts?.chunkIndex ?? 0;

  const result = await page.evaluate(
    ({ selector, chunkSize, chunkIndex }) => {
      const el = document.querySelector(selector);
      if (!el) return { fullText: "", totalLength: 0 };

      const fullText = (el as HTMLElement).innerText ?? el.textContent ?? "";
      return { fullText, totalLength: fullText.length };
    },
    { selector, chunkSize, chunkIndex }
  );

  const totalChunks = Math.max(1, Math.ceil(result.totalLength / chunkSize));
  const startOffset = chunkIndex * chunkSize;
  const endOffset = Math.min(startOffset + chunkSize, result.totalLength);
  const content = result.fullText.substring(startOffset, endOffset);

  return {
    chunkIndex,
    totalChunks,
    content,
    startOffset,
    endOffset,
  };
}

/**
 * Format found elements for LLM output.
 */
export function formatFoundElements(elements: FoundElement[]): string {
  if (elements.length === 0) return "No elements found matching the selector.";

  const lines: string[] = [`Found ${elements.length} element(s):\n`];

  for (const el of elements) {
    const vis = el.visible ? "" : " [hidden]";
    const attrs = Object.entries(el.attributes)
      .map(([k, v]) => `${k}="${v.substring(0, 60)}"`)
      .join(" ");
    const text = el.text ? ` "${el.text.substring(0, 100)}"` : "";
    lines.push(`[${el.index}] <${el.tag}${attrs ? " " + attrs : ""}>${text}${vis}`);
  }

  return lines.join("\n");
}

/**
 * Format content chunk for LLM output.
 */
export function formatContentChunk(chunk: ContentChunk): string {
  const header = chunk.totalChunks > 1
    ? `--- Content chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks} (chars ${chunk.startOffset}-${chunk.endOffset}) ---\n`
    : "";
  return header + chunk.content;
}
