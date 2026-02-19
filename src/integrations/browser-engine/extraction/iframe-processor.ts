/**
 * Iframe Processor -- detect, list, and enable interaction within iframes.
 *
 * Many modern sites use iframes for payment forms (Stripe), embedded content,
 * OAuth flows, and video players. This module provides:
 * - Iframe detection and listing
 * - Frame switching for interactions
 * - Cross-origin safety checks
 */

import type { Page, Frame } from "playwright-core";

export interface IframeInfo {
  index: number;
  name: string;
  url: string;
  src: string;
  isCrossOrigin: boolean;
  isVisible: boolean;
  rect: { x: number; y: number; width: number; height: number };
  selector: string;
}

/**
 * Detect and list all iframes on the page.
 */
export async function listIframes(page: Page): Promise<IframeInfo[]> {
  const iframeData = await page.evaluate(() => {
    const results: Array<{
      name: string;
      src: string;
      url: string;
      isCrossOrigin: boolean;
      isVisible: boolean;
      rect: { x: number; y: number; width: number; height: number };
      index: number;
    }> = [];

    const iframes = document.querySelectorAll("iframe");

    for (let i = 0; i < iframes.length; i++) {
      const iframe = iframes[i];
      const rect = iframe.getBoundingClientRect();
      const style = window.getComputedStyle(iframe);
      const isVisible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;

      let isCrossOrigin = false;
      let url = "";
      try {
        url = iframe.contentWindow?.location?.href ?? "";
      } catch {
        // Cross-origin: cannot access contentWindow.location
        isCrossOrigin = true;
        url = iframe.src || "";
      }

      results.push({
        name: iframe.name || iframe.id || "",
        src: iframe.src || "",
        url: url || iframe.src || "",
        isCrossOrigin,
        isVisible,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        index: i,
      });
    }

    return results;
  });

  return iframeData.map((d, i) => ({
    ...d,
    selector: d.name
      ? `iframe[name="${d.name}"]`
      : d.src
        ? `iframe[src="${d.src}"]`
        : `iframe:nth-of-type(${i + 1})`,
  }));
}

/**
 * Get a Frame object for a specific iframe by index, name, or URL pattern.
 */
export function getIframeFrame(
  page: Page,
  target: { index?: number; name?: string; urlPattern?: string }
): Frame | null {
  const frames = page.frames();

  // Skip main frame (index 0 in frames array is usually the main frame)
  const childFrames = frames.filter((f) => f !== page.mainFrame());

  if (target.index !== undefined) {
    return childFrames[target.index] ?? null;
  }

  if (target.name) {
    return childFrames.find((f) => f.name() === target.name) ?? null;
  }

  if (target.urlPattern) {
    try {
      const regex = new RegExp(target.urlPattern, "i");
      return childFrames.find((f) => regex.test(f.url())) ?? null;
    } catch {
      return childFrames.find((f) => f.url().includes(target.urlPattern!)) ?? null;
    }
  }

  return null;
}

/**
 * Execute an interaction within a specific iframe.
 */
export async function interactInIframe(
  page: Page,
  target: { index?: number; name?: string; urlPattern?: string },
  action: string,
  opts: { selector?: string; value?: string }
): Promise<{ success: boolean; error?: string }> {
  const frame = getIframeFrame(page, target);
  if (!frame) {
    return { success: false, error: "Iframe not found." };
  }

  try {
    switch (action) {
      case "click":
        if (opts.selector) await frame.click(opts.selector, { timeout: 10_000 });
        break;
      case "type":
      case "fill":
        if (opts.selector && opts.value) await frame.fill(opts.selector, opts.value);
        break;
      case "press":
        if (opts.value) {
          if (opts.selector) await frame.press(opts.selector, opts.value);
          else await frame.page()?.keyboard.press(opts.value);
        }
        break;
      case "hover":
        if (opts.selector) await frame.hover(opts.selector, { timeout: 10_000 });
        break;
      case "focus":
        if (opts.selector) await frame.focus(opts.selector);
        break;
      default:
        return { success: false, error: `Unsupported iframe action: ${action}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Extract content from an iframe (text + interactive elements).
 */
export async function extractIframeContent(
  page: Page,
  target: { index?: number; name?: string; urlPattern?: string }
): Promise<{ success: boolean; content?: string; url?: string; error?: string }> {
  const frame = getIframeFrame(page, target);
  if (!frame) {
    return { success: false, error: "Iframe not found." };
  }

  try {
    const url = frame.url();
    const content = await frame.evaluate(() => {
      const elements: string[] = [];

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let count = 0;

      while (walker.nextNode() && count < 500) {
        const el = walker.currentNode as Element;
        const tag = el.tagName.toLowerCase();

        if (["script", "style", "noscript", "svg", "path", "meta", "link"].includes(tag)) continue;

        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;

        const isInteractive = ["a", "button", "input", "select", "textarea"].includes(tag);
        const text = (el as HTMLElement).innerText?.trim() ?? "";

        if (isInteractive) {
          const attrs: string[] = [];
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            if (["type", "name", "href", "placeholder", "value"].includes(attr.name)) {
              attrs.push(`${attr.name}="${attr.value.substring(0, 80)}"`);
            }
          }
          const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
          elements.push(`[${count}] <${tag}${attrStr}>${text ? ` "${text.substring(0, 80)}"` : ""}`);
        } else if (text && text.length > 0) {
          elements.push(text.substring(0, 200));
        }

        count++;
      }

      return elements.join("\n");
    });

    return { success: true, content, url };
  } catch (err) {
    return {
      success: false,
      error: `Cannot access iframe content (likely cross-origin): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Format iframe list for LLM output.
 */
export function formatIframeList(iframes: IframeInfo[]): string {
  if (iframes.length === 0) return "No iframes found on the page.";

  return iframes
    .map((f) => {
      const visibility = f.isVisible ? "" : " (hidden)";
      const origin = f.isCrossOrigin ? " [cross-origin]" : "";
      const name = f.name ? ` name="${f.name}"` : "";
      const size = `${f.rect.width}x${f.rect.height}`;
      return `  [${f.index}] ${f.url || f.src || "(empty)"}${name}${origin}${visibility} (${size})`;
    })
    .join("\n");
}
