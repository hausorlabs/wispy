/**
 * Page Search -- zero-LLM-cost text/regex search within the current page.
 *
 * Two modes:
 * 1. searchInPage -- find all text matches (like Ctrl+F) without scrolling
 * 2. scrollToText -- scroll page until the target text is visible in viewport
 */

import type { Page } from "playwright-core";

export interface SearchMatch {
  text: string;
  index: number;
  /** Surrounding context (chars before + after the match). */
  context: string;
  /** Approximate element selector containing the match. */
  selector: string;
}

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
  totalMatches: number;
}

export interface ScrollToTextResult {
  found: boolean;
  text?: string;
  scrollY?: number;
  elapsed: number;
}

/**
 * Search for text or regex pattern within the page content.
 * Zero LLM cost -- runs entirely in the browser.
 */
export async function searchInPage(
  page: Page,
  query: string,
  opts?: { regex?: boolean; caseSensitive?: boolean; limit?: number; contextChars?: number }
): Promise<SearchResult> {
  const limit = opts?.limit ?? 20;
  const contextChars = opts?.contextChars ?? 80;
  const isRegex = opts?.regex ?? false;
  const caseSensitive = opts?.caseSensitive ?? false;

  return page.evaluate(
    ({ query, isRegex, caseSensitive, limit, contextChars }) => {
      const body = document.body;
      if (!body) return { query, matches: [], totalMatches: 0 };

      const fullText = body.innerText || "";
      const matches: Array<{
        text: string;
        index: number;
        context: string;
        selector: string;
      }> = [];

      let regex: RegExp;
      try {
        const flags = "g" + (caseSensitive ? "" : "i");
        regex = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      } catch {
        return { query, matches: [], totalMatches: 0 };
      }

      let match: RegExpExecArray | null;
      let totalMatches = 0;

      while ((match = regex.exec(fullText)) !== null) {
        totalMatches++;
        if (matches.length < limit) {
          const start = Math.max(0, match.index - contextChars);
          const end = Math.min(fullText.length, match.index + match[0].length + contextChars);
          const context = (start > 0 ? "..." : "") +
            fullText.substring(start, end) +
            (end < fullText.length ? "..." : "");

          // Try to find the DOM element containing this text
          let selector = "body";
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          let charOffset = 0;
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const len = (node.textContent ?? "").length;
            if (charOffset + len > match.index) {
              const el = node.parentElement;
              if (el) {
                if (el.id) selector = `#${el.id}`;
                else if (el.className && typeof el.className === "string") {
                  selector = `${el.tagName.toLowerCase()}.${el.className.split(/\s+/).join(".")}`;
                } else {
                  selector = el.tagName.toLowerCase();
                }
              }
              break;
            }
            charOffset += len;
          }

          matches.push({
            text: match[0],
            index: match.index,
            context,
            selector,
          });
        }

        // Prevent infinite loop on zero-length match
        if (match[0].length === 0) regex.lastIndex++;
      }

      return { query, matches, totalMatches };
    },
    { query, isRegex, caseSensitive, limit, contextChars }
  );
}

/**
 * Scroll the page until the target text is found in the viewport.
 * Useful for finding content on long/infinite-scroll pages.
 */
export async function scrollToText(
  page: Page,
  text: string,
  opts?: { timeout?: number; maxScrolls?: number; scrollAmount?: number }
): Promise<ScrollToTextResult> {
  const timeout = opts?.timeout ?? 30_000;
  const maxScrolls = opts?.maxScrolls ?? 50;
  const scrollAmount = opts?.scrollAmount ?? 600;
  const start = Date.now();

  for (let i = 0; i < maxScrolls; i++) {
    if (Date.now() - start > timeout) break;

    // Check if text is visible in viewport
    const found = await page.evaluate(
      ({ text }) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if ((node.textContent ?? "").includes(text)) {
            const el = node.parentElement;
            if (el) {
              const rect = el.getBoundingClientRect();
              // Check if element is in viewport
              if (
                rect.top >= 0 &&
                rect.bottom <= window.innerHeight &&
                rect.width > 0 &&
                rect.height > 0
              ) {
                return { found: true, scrollY: window.scrollY };
              }
              // If found but not in viewport, scroll to it
              el.scrollIntoView({ behavior: "instant", block: "center" });
              return { found: true, scrollY: window.scrollY };
            }
          }
        }
        return { found: false, scrollY: window.scrollY };
      },
      { text }
    );

    if (found.found) {
      return {
        found: true,
        text,
        scrollY: found.scrollY,
        elapsed: Date.now() - start,
      };
    }

    // Scroll down
    await page.evaluate((amount: number) => window.scrollBy(0, amount), scrollAmount);
    // Brief wait for dynamic content to load
    await new Promise((r) => setTimeout(r, 300));
  }

  return { found: false, elapsed: Date.now() - start };
}

/**
 * Format search results for LLM output.
 */
export function formatSearchResult(result: SearchResult): string {
  if (result.totalMatches === 0) {
    return `No matches found for "${result.query}".`;
  }

  const lines = [`Found ${result.totalMatches} match(es) for "${result.query}":\n`];

  for (const m of result.matches) {
    lines.push(`  ${m.index}: "${m.context}"`);
    lines.push(`    Element: ${m.selector}`);
  }

  if (result.totalMatches > result.matches.length) {
    lines.push(`\n  ... and ${result.totalMatches - result.matches.length} more matches`);
  }

  return lines.join("\n");
}
