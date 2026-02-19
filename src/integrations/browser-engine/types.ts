/**
 * Browser Engine types -- all TypeScript interfaces for the browser automation system.
 */

import type { Page, Browser, BrowserContext } from "playwright-core";

// ─── Session Types ─────────────────────────────────────────

export interface SessionConfig {
  headless?: boolean;
  stealth?: boolean;
  proxy?: ProxyConfig;
  profileId?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezone?: string;
  cdpUrl?: string;
  timeout?: number;
}

export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  config: SessionConfig;
  profileId?: string;
  createdAt: number;
  lastActivity: number;
  networkLog: CapturedRequest[];
}

export interface SessionInfo {
  id: string;
  url: string;
  title: string;
  profileId?: string;
  createdAt: number;
  lastActivity: number;
}

// ─── Proxy Types ───────────────────────────────────────────

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export interface ProxyEntry {
  server: string;
  username?: string;
  password?: string;
  protocol: "http" | "https" | "socks5";
  failCount: number;
  lastUsed: number;
}

// ─── Profile Types ─────────────────────────────────────────

export interface BrowserProfile {
  id: string;
  name: string;
  cookies: SerializedCookie[];
  localStorage: Record<string, Record<string, string>>;
  userAgent?: string;
  viewport?: { width: number; height: number };
  createdAt: number;
  updatedAt: number;
}

export interface SerializedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

// ─── DOM / Extraction Types ────────────────────────────────

export interface DOMElement {
  index: number;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  selector: string;
  isInteractive: boolean;
  isVisible: boolean;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface PageSnapshot {
  url: string;
  title: string;
  content: string;
  elements: DOMElement[];
  interactiveElements: DOMElement[];
  timestamp: number;
}

export interface ExtractionSchema {
  selector: string;
  fields: Record<string, FieldExtractor>;
  multiple?: boolean;
  limit?: number;
}

export interface FieldExtractor {
  selector?: string;
  attribute?: string;
  transform?: string;
}

export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  caption?: string;
  selector: string;
}

export interface ExtractedLink {
  text: string;
  url: string;
  isExternal: boolean;
}

export interface ExtractedMedia {
  type: "image" | "video" | "audio";
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

// ─── Network Types ─────────────────────────────────────────

export interface CapturedRequest {
  url: string;
  method: string;
  status?: number;
  contentType?: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  body?: string;
  responseBody?: string;
  timestamp: number;
  isApi: boolean;
}

export interface NetworkFilter {
  urlPattern?: string;
  method?: string;
  contentType?: string;
  apiOnly?: boolean;
  limit?: number;
}

// ─── Interaction Types ─────────────────────────────────────

export type InteractionAction =
  | "click"
  | "type"
  | "select"
  | "hover"
  | "press"
  | "scroll"
  | "focus"
  | "clear";

export interface InteractionTarget {
  index?: number;
  selector?: string;
}

export interface InteractionCommand {
  action: InteractionAction;
  target?: InteractionTarget;
  value?: string;
  options?: {
    delay?: number;
    button?: "left" | "right" | "middle";
    modifiers?: string[];
    direction?: "up" | "down";
    amount?: number;
  };
}

// ─── Workflow Types ────────────────────────────────────────

export interface WorkflowStep {
  action: string;
  target?: string;
  value?: string;
  waitFor?: string;
  timeout?: number;
  extract?: ExtractionSchema;
  screenshot?: boolean;
  /** JS expression that must return truthy for this step to execute. */
  condition?: string;
  /** Error handling: "stop" (default) | "skip" | "retry". */
  onError?: "stop" | "skip" | "retry";
  /** Max retries when onError is "retry" (default: 2). */
  maxRetries?: number;
  /** Store extracted value into a named variable for later steps. */
  storeAs?: string;
  /** Alternative selector if primary target fails. */
  fallbackTarget?: string;
  /** For "forEach" action: CSS selector of items to iterate, or variable name holding an array. */
  items?: string;
  /** For "forEach" action: sub-steps to execute for each item. */
  subSteps?: WorkflowStep[];
  /** For "forEach" action: variable name for current iteration item (default: "item"). */
  iterVar?: string;
  /** Max iterations for forEach (default: 50). */
  maxIterations?: number;
}

export interface WorkflowResult {
  success: boolean;
  steps: WorkflowStepResult[];
  extracted: Record<string, unknown>[];
  screenshots: string[];
  variables: Record<string, unknown>;
  duration: number;
}

export interface WorkflowStepResult {
  step: number;
  action: string;
  success: boolean;
  skipped?: boolean;
  retries?: number;
  error?: string;
  duration: number;
}

export interface DownloadInfo {
  filename: string;
  url: string;
  path: string;
  mimeType: string;
  size: number;
  timestamp: number;
}

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  isActive: boolean;
}

// ─── Drag & Drop Types ──────────────────────────────────────

export interface DragDropTarget {
  selector?: string;
  x?: number;
  y?: number;
}

// ─── Dialog Types ───────────────────────────────────────────

export interface DialogRecord {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  defaultValue?: string;
  response: string;
  timestamp: number;
}

// ─── Wait Strategy Types ───────────────────────────────────

export type WaitStrategy =
  | { type: "domready" }
  | { type: "networkidle" }
  | { type: "selector"; value: string; timeout?: number }
  | { type: "delay"; ms: number }
  | { type: "function"; expression: string };

// ─── Auth Types ────────────────────────────────────────────

export interface AuthState {
  isLoggedIn: boolean;
  loginUrl?: string;
  indicators: string[];
}

// ─── Captcha Types ─────────────────────────────────────────

export type CaptchaType = "recaptcha-v2" | "recaptcha-v3" | "hcaptcha" | "cloudflare" | "unknown";

export interface CaptchaDetection {
  detected: boolean;
  type?: CaptchaType;
  siteKey?: string;
  selector?: string;
}
