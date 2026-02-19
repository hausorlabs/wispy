/**
 * CAPTCHA Detector -- detects CAPTCHA presence and type.
 * Provides solver hooks (no built-in solver for ethical reasons).
 */

import type { Page } from "playwright-core";
import type { CaptchaDetection } from "../types.js";

/**
 * Detect if the current page has a CAPTCHA challenge.
 */
export async function detectCaptcha(page: Page): Promise<CaptchaDetection> {
  return page.evaluate(() => {
    // reCAPTCHA v2
    const recaptchaV2 = document.querySelector(
      '.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]'
    );
    if (recaptchaV2) {
      const siteKey =
        recaptchaV2.getAttribute("data-sitekey") ??
        recaptchaV2
          .closest("[data-sitekey]")
          ?.getAttribute("data-sitekey") ??
        undefined;
      return {
        detected: true,
        type: "recaptcha-v2" as const,
        siteKey: siteKey ?? undefined,
        selector: ".g-recaptcha",
      };
    }

    // reCAPTCHA v3 (invisible)
    const recaptchaV3Script = document.querySelector(
      'script[src*="recaptcha/api.js?render="]'
    );
    if (recaptchaV3Script) {
      const src = recaptchaV3Script.getAttribute("src") ?? "";
      const match = src.match(/render=([^&]+)/);
      return {
        detected: true,
        type: "recaptcha-v3" as const,
        siteKey: match?.[1],
        selector: undefined,
      };
    }

    // hCaptcha
    const hcaptcha = document.querySelector(
      '.h-captcha, [data-hcaptcha-sitekey], iframe[src*="hcaptcha"]'
    );
    if (hcaptcha) {
      return {
        detected: true,
        type: "hcaptcha" as const,
        siteKey: hcaptcha.getAttribute("data-hcaptcha-sitekey") ?? undefined,
        selector: ".h-captcha",
      };
    }

    // Cloudflare challenge
    const cfChallenge = document.querySelector(
      '#challenge-running, #challenge-form, [class*="cf-challenge"], iframe[src*="challenges.cloudflare.com"]'
    );
    if (cfChallenge) {
      return {
        detected: true,
        type: "cloudflare" as const,
        selector: "#challenge-form",
      };
    }

    // Generic CAPTCHA detection
    const genericCaptcha = document.querySelector(
      '[class*="captcha" i], [id*="captcha" i], img[src*="captcha" i]'
    );
    if (genericCaptcha) {
      return {
        detected: true,
        type: "unknown" as const,
        selector: '[class*="captcha" i]',
      };
    }

    return { detected: false };
  });
}

/**
 * Wait for a CAPTCHA to be solved (e.g., by a human or external solver).
 * Polls until the CAPTCHA element is removed or a success indicator appears.
 */
export async function waitForCaptchaSolved(
  page: Page,
  timeout = 120_000
): Promise<boolean> {
  const start = Date.now();
  const pollInterval = 2_000;

  while (Date.now() - start < timeout) {
    const detection = await detectCaptcha(page);
    if (!detection.detected) return true;

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  return false;
}
