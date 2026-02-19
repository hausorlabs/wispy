/**
 * Auth Manager -- login detection and session persistence.
 */

import type { Page } from "playwright-core";
import type { AuthState } from "../types.js";

/** Common login form indicators */
const LOGIN_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[autocomplete="current-password"]',
  'form[action*="login"]',
  'form[action*="signin"]',
  'form[action*="sign-in"]',
  'form[action*="auth"]',
  '#login-form',
  '#signin-form',
  '.login-form',
  '.signin-form',
];

/** Common logged-in indicators */
const LOGGED_IN_SELECTORS = [
  '[aria-label*="account" i]',
  '[aria-label*="profile" i]',
  '[data-testid*="avatar"]',
  '.user-avatar',
  '.user-menu',
  '#user-nav',
  '.account-menu',
  'a[href*="logout"]',
  'a[href*="signout"]',
  'button[aria-label*="sign out" i]',
];

/**
 * Detect whether the current page shows a login form or is logged in.
 */
export async function detectAuthState(page: Page): Promise<AuthState> {
  return page.evaluate(
    (args: { loginSelectors: string[]; loggedInSelectors: string[] }) => {
      // Check for login form
      const hasLoginForm = args.loginSelectors.some((sel) => {
        try {
          return document.querySelector(sel) !== null;
        } catch {
          return false;
        }
      });

      // Check for logged-in indicators
      const loggedInIndicators = args.loggedInSelectors.filter((sel) => {
        try {
          return document.querySelector(sel) !== null;
        } catch {
          return false;
        }
      });

      const isLoggedIn = loggedInIndicators.length > 0 && !hasLoginForm;

      // Try to find login URL
      let loginUrl: string | undefined;
      if (!isLoggedIn) {
        const loginLinks = document.querySelectorAll(
          'a[href*="login"], a[href*="signin"], a[href*="sign-in"], a[href*="auth"]'
        );
        if (loginLinks.length > 0) {
          loginUrl = (loginLinks[0] as HTMLAnchorElement).href;
        }
      }

      return {
        isLoggedIn,
        loginUrl,
        indicators: loggedInIndicators,
      };
    },
    { loginSelectors: LOGIN_SELECTORS, loggedInSelectors: LOGGED_IN_SELECTORS }
  );
}

/**
 * Attempt to fill and submit a login form.
 */
export async function performLogin(
  page: Page,
  credentials: { username: string; password: string },
  opts?: { usernameSelector?: string; passwordSelector?: string; submitSelector?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    // Find username/email field
    const usernameSelector =
      opts?.usernameSelector ??
      'input[type="email"], input[name="email"], input[name="username"], input[autocomplete="username"], input[type="text"]:first-of-type';

    // Find password field
    const passwordSelector =
      opts?.passwordSelector ??
      'input[type="password"], input[name="password"], input[autocomplete="current-password"]';

    // Fill credentials
    await page.fill(usernameSelector, credentials.username);
    await page.fill(passwordSelector, credentials.password);

    // Submit
    const submitSelector =
      opts?.submitSelector ??
      'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Login")';

    await page.click(submitSelector);

    // Wait for navigation
    await page.waitForNavigation({ timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded");

    // Check if login succeeded
    const state = await detectAuthState(page);
    return { success: state.isLoggedIn };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
