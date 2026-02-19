/**
 * DOM Processor -- converts page HTML into LLM-friendly numbered element index.
 *
 * Outputs format like:
 *   [0] <button> "Submit"
 *   [1] <a href="/about"> "About Us"
 *   [2] <input type="text" name="search" placeholder="Search...">
 *
 * This lets the LLM say "click [0]" instead of guessing CSS selectors.
 * Same pattern as Browser Use and Claude Computer Use.
 */

import type { Page } from "playwright-core";
import type { DOMElement, PageSnapshot } from "../types.js";
import { INTERACTIVE_TAGS, INTERACTIVE_ATTRIBUTES, INTERACTIVE_ROLES, STRIP_TAGS, DEFAULTS } from "../config.js";

/**
 * Process the current page and return a snapshot with numbered elements.
 */
export async function processPage(page: Page): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title();

  // Extract all elements in a single evaluate call for performance
  const rawElements = await page.evaluate(
    (opts: { interactiveTags: string[]; interactiveAttrs: string[]; interactiveRoles: string[]; stripTags: string[]; maxElements: number }) => {
      const { interactiveTags, interactiveAttrs, interactiveRoles, stripTags, maxElements } = opts;
      const interTagSet = new Set(interactiveTags);
      const interAttrSet = new Set(interactiveAttrs);
      const interRoleSet = new Set(interactiveRoles);
      const stripSet = new Set(stripTags);

      const elements: Array<{
        tag: string;
        text: string;
        attributes: Record<string, string>;
        isInteractive: boolean;
        isVisible: boolean;
        rect: { x: number; y: number; width: number; height: number };
        xpath: string;
      }> = [];

      function isVisible(el: Element): boolean {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      function getXPath(el: Element): string {
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && current !== document.body) {
          let index = 1;
          let sibling = current.previousElementSibling;
          while (sibling) {
            if (sibling.tagName === current.tagName) index++;
            sibling = sibling.previousElementSibling;
          }
          parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
          current = current.parentElement;
        }
        return `//${parts.join("/")}`;
      }

      function getCleanText(el: Element): string {
        // Get direct text, not from children
        let text = "";
        for (let ci = 0; ci < el.childNodes.length; ci++) {
          const node = el.childNodes[ci];
          if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent ?? "";
          }
        }
        text = text.trim();
        if (!text) {
          // Fallback: use innerText but truncate
          text = (el as HTMLElement).innerText?.trim() ?? "";
        }
        return text.substring(0, 200);
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0;

      while (walker.nextNode() && count < maxElements) {
        const el = walker.currentNode as Element;
        const tag = el.tagName.toLowerCase();

        if (stripSet.has(tag)) continue;

        const visible = isVisible(el);
        if (!visible) continue;

        const attrs: Record<string, string> = {};
        const ariaStateAttrs = ["aria-expanded", "aria-pressed", "aria-selected", "aria-checked", "aria-disabled", "aria-hidden", "aria-live", "aria-required", "aria-invalid"];
        for (let ai = 0; ai < el.attributes.length; ai++) {
          const attr = el.attributes[ai];
          if (["id", "class", "name", "type", "href", "src", "value", "placeholder", "role", "aria-label", "title", "alt", "action", "data-testid", "contenteditable", "disabled", ...ariaStateAttrs].includes(attr.name)) {
            attrs[attr.name] = attr.value.substring(0, 200);
          }
        }

        // Capture disabled state from property (not just attribute)
        if ((el as HTMLButtonElement).disabled) {
          attrs["disabled"] = "true";
        }

        const isInteractive =
          interTagSet.has(tag) ||
          Array.from(el.attributes).some((a) => interAttrSet.has(a.name)) ||
          interRoleSet.has(attrs["role"] ?? "") ||
          attrs["contenteditable"] === "true";

        // Only include interactive elements + structural elements with text
        const text = getCleanText(el);
        if (!isInteractive && !text && !["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "span", "div"].includes(tag)) {
          continue;
        }

        // Skip divs/spans with no text and no interactive role
        if (["div", "span"].includes(tag) && !text && !isInteractive) continue;

        const rect = el.getBoundingClientRect();
        elements.push({
          tag,
          text,
          attributes: attrs,
          isInteractive,
          isVisible: visible,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          xpath: getXPath(el),
        });

        count++;
      }

      return elements;
    },
    {
      interactiveTags: [...INTERACTIVE_TAGS],
      interactiveAttrs: [...INTERACTIVE_ATTRIBUTES],
      interactiveRoles: [...INTERACTIVE_ROLES],
      stripTags: [...STRIP_TAGS],
      maxElements: DEFAULTS.maxElements,
    }
  );

  // Build indexed elements
  const elements: DOMElement[] = rawElements.map((raw, index) => ({
    index,
    tag: raw.tag,
    text: raw.text,
    attributes: raw.attributes,
    selector: raw.xpath,
    isInteractive: raw.isInteractive,
    isVisible: raw.isVisible,
    rect: raw.rect,
  }));

  const interactiveElements = elements.filter((e) => e.isInteractive);

  // Build LLM-friendly content
  const content = buildContentString(elements);

  return {
    url,
    title,
    content,
    elements,
    interactiveElements,
    timestamp: Date.now(),
  };
}

/**
 * Build a concise text representation of the page for the LLM.
 */
function buildContentString(elements: DOMElement[]): string {
  const lines: string[] = [];

  for (const el of elements) {
    if (el.isInteractive) {
      lines.push(formatInteractiveElement(el));
    } else if (el.text) {
      // Content elements: just show text with tag context
      const prefix = ["h1", "h2", "h3", "h4", "h5", "h6"].includes(el.tag)
        ? `## ${el.tag.toUpperCase()}: `
        : "";
      lines.push(`${prefix}${el.text}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format an interactive element for LLM display.
 * Example: [5] <button> "Submit Order"
 * Example: [12] <input type="text" name="email" placeholder="Enter email">
 */
function formatInteractiveElement(el: DOMElement): string {
  const displayAttrs = ["type", "name", "href", "placeholder", "role", "aria-label", "value", "title", "contenteditable"];
  const stateAttrs = ["aria-expanded", "aria-pressed", "aria-selected", "aria-checked", "disabled"];

  const attrs = Object.entries(el.attributes)
    .filter(([k]) => displayAttrs.includes(k))
    .map(([k, v]) => `${k}="${truncate(v, 60)}"`)
    .join(" ");

  // Show ARIA states as compact flags
  const states = Object.entries(el.attributes)
    .filter(([k]) => stateAttrs.includes(k))
    .map(([k, v]) => {
      const short = k.replace("aria-", "");
      return v === "true" ? short : `${short}=${v}`;
    })
    .join(" ");

  const attrStr = attrs ? ` ${attrs}` : "";
  const stateStr = states ? ` [${states}]` : "";
  const textStr = el.text ? ` "${truncate(el.text, 80)}"` : "";

  return `[${el.index}] <${el.tag}${attrStr}>${textStr}${stateStr}`;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max - 3) + "..." : str;
}

/**
 * Get a minimal snapshot -- just interactive elements for quick reference.
 */
export async function getInteractiveSnapshot(page: Page): Promise<string> {
  const snapshot = await processPage(page);
  return snapshot.interactiveElements.map((el) => formatInteractiveElement(el)).join("\n");
}
