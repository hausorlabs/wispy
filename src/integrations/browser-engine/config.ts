/**
 * Browser Engine configuration constants and defaults.
 */

export const BROWSER_ENGINE_VERSION = "1.0.0";

/** Default session settings */
export const DEFAULTS = {
  headless: true,
  stealth: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30_000,
  navigationTimeout: 30_000,
  maxSessions: 5,
  maxNetworkLog: 500,
  maxContentLength: 80_000,
  maxElements: 2000,
  sessionIdleTimeout: 300_000, // 5 minutes
  profileDbName: "browser-profiles.db",
} as const;

/** User agents for stealth rotation */
export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
] as const;

/** Viewport presets */
export const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  "desktop-hd": { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
} as const;

/** Interactive element tags for DOM processing */
export const INTERACTIVE_TAGS = new Set([
  "a", "button", "input", "select", "textarea", "details", "summary",
  "label", "option", "fieldset", "legend",
]);

/** Attributes that indicate interactivity */
export const INTERACTIVE_ATTRIBUTES = new Set([
  "onclick", "onchange", "onsubmit", "role", "tabindex",
  "contenteditable", "draggable",
]);

/** Interactive roles */
export const INTERACTIVE_ROLES = new Set([
  "button", "link", "tab", "menuitem", "option", "switch",
  "checkbox", "radio", "textbox", "combobox", "slider",
  "spinbutton", "searchbox", "listbox",
]);

/** Tags to strip from content extraction */
export const STRIP_TAGS = new Set([
  "script", "style", "noscript", "svg", "path", "meta", "link",
  "head",
]);

/** Content type patterns that indicate API responses */
export const API_CONTENT_TYPES = [
  "application/json",
  "application/xml",
  "text/xml",
  "application/graphql",
] as const;

/** URL patterns to ignore in network capture */
export const NETWORK_IGNORE_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|css)(\?|$)/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /facebook\.net.*\/sdk/i,
  /doubleclick\.net/i,
] as const;

/** Skill categories */
export const SKILL_CATEGORIES = [
  "search", "social", "ecommerce", "news", "developer",
  "jobs", "financial", "travel", "productivity", "utility",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
