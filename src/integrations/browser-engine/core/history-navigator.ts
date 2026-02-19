/**
 * History Navigator -- browser back/forward navigation with state tracking.
 */

import type { Page } from "playwright-core";

export interface NavigationResult {
  success: boolean;
  url: string;
  title: string;
  error?: string;
}

/**
 * Navigate back in browser history.
 */
export async function goBack(
  page: Page,
  opts?: { waitUntil?: "domcontentloaded" | "networkidle"; timeout?: number }
): Promise<NavigationResult> {
  try {
    const response = await page.goBack({
      waitUntil: opts?.waitUntil ?? "domcontentloaded",
      timeout: opts?.timeout ?? 15_000,
    });

    if (!response) {
      return {
        success: false,
        url: page.url(),
        title: await page.title().catch(() => ""),
        error: "No previous page in history",
      };
    }

    return {
      success: true,
      url: page.url(),
      title: await page.title().catch(() => ""),
    };
  } catch (err) {
    return {
      success: false,
      url: page.url(),
      title: await page.title().catch(() => ""),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Navigate forward in browser history.
 */
export async function goForward(
  page: Page,
  opts?: { waitUntil?: "domcontentloaded" | "networkidle"; timeout?: number }
): Promise<NavigationResult> {
  try {
    const response = await page.goForward({
      waitUntil: opts?.waitUntil ?? "domcontentloaded",
      timeout: opts?.timeout ?? 15_000,
    });

    if (!response) {
      return {
        success: false,
        url: page.url(),
        title: await page.title().catch(() => ""),
        error: "No next page in history",
      };
    }

    return {
      success: true,
      url: page.url(),
      title: await page.title().catch(() => ""),
    };
  } catch (err) {
    return {
      success: false,
      url: page.url(),
      title: await page.title().catch(() => ""),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
