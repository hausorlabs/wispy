/**
 * Cookie Banner -- auto-dismiss cookie consent banners.
 *
 * Detects common cookie consent patterns and clicks accept/dismiss.
 */

import type { Page } from "playwright-core";

/** Common selectors for cookie consent accept buttons. */
const ACCEPT_SELECTORS = [
  // Generic consent buttons
  '[id*="cookie" i][id*="accept" i]',
  '[id*="cookie" i][id*="agree" i]',
  '[id*="consent" i][id*="accept" i]',
  '[class*="cookie" i][class*="accept" i]',
  '[class*="consent" i][class*="accept" i]',
  // Common cookie libraries
  '#onetrust-accept-btn-handler',                     // OneTrust
  '.cc-btn.cc-dismiss',                               // CookieConsent
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', // Cookiebot
  '[data-cookiefirst-action="accept"]',               // CookieFirst
  '.fc-cta-consent',                                  // FundingChoices
  '#didomi-notice-agree-button',                      // Didomi
  '.qc-cmp2-summary-buttons button:first-child',      // Quantcast
  '#accept-cookie-notification',
  // Text-based matching
  'button:has-text("Accept all")',
  'button:has-text("Accept cookies")',
  'button:has-text("I agree")',
  'button:has-text("Got it")',
  'button:has-text("OK")',
  'a:has-text("Accept all")',
  'a:has-text("Accept cookies")',
];

/** Common selectors for cookie banner containers. */
const BANNER_SELECTORS = [
  '#cookie-banner',
  '#cookie-consent',
  '#cookie-notice',
  '[class*="cookie-banner" i]',
  '[class*="cookie-consent" i]',
  '[class*="cookie-notice" i]',
  '#onetrust-banner-sdk',
  '#CybotCookiebotDialog',
  '.cc-window',
  '#didomi-notice',
  '[id*="gdpr" i]',
  '[class*="gdpr" i]',
];

export interface CookieBannerResult {
  found: boolean;
  dismissed: boolean;
  selector?: string;
  error?: string;
}

/**
 * Detect and dismiss cookie consent banners.
 */
export async function dismissCookieBanner(page: Page): Promise<CookieBannerResult> {
  // First check if a banner is visible
  const bannerVisible = await page.evaluate((selectors: string[]) => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return sel;
          }
        }
      } catch {
        // Invalid selector
      }
    }
    return null;
  }, BANNER_SELECTORS);

  if (!bannerVisible) {
    return { found: false, dismissed: false };
  }

  // Try to click accept buttons
  for (const selector of ACCEPT_SELECTORS) {
    try {
      const visible = await page.locator(selector).first().isVisible({ timeout: 500 }).catch(() => false);
      if (visible) {
        await page.locator(selector).first().click({ timeout: 2_000 });
        // Wait for banner to disappear
        await page.waitForTimeout(500);
        return { found: true, dismissed: true, selector };
      }
    } catch {
      continue;
    }
  }

  return {
    found: true,
    dismissed: false,
    error: "Cookie banner found but could not find accept button",
  };
}
