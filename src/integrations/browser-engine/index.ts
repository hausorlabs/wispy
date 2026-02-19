/**
 * Browser Engine Integration -- Full-spectrum browser automation for Wispy agents.
 *
 * 18 tools exposed to Gemini (web_* prefix), multi-session management,
 * anti-detection stealth, persistent profiles, smart DOM extraction,
 * 55 built-in scraping skills, and workflow automation.
 *
 * Zero new npm dependencies -- built on playwright-core, cheerio, better-sqlite3, zod.
 */

import { Integration } from "../base.js";
import type { IntegrationManifest, ToolResult } from "../base.js";
import { BROWSER_ENGINE_VERSION } from "./config.js";
import { SessionManager } from "./core/session-manager.js";
import { processPage, getInteractiveSnapshot } from "./extraction/dom-processor.js";
import { extractTables, formatTablesAsMarkdown } from "./extraction/table-extractor.js";
import { extractLinks, extractMedia, formatLinks } from "./extraction/media-extractor.js";
import { extractWithSchema, extractRepeatedItems, formatExtractedData } from "./extraction/schema-extractor.js";
import { SkillRegistry } from "./skills/registry.js";
import { executeSkill } from "./skills/executor.js";
import { SkillStore } from "./skills/skill-store.js";
import { generateSkill } from "./skills/skill-generator.js";
import type { GeminiGenerateFn } from "./skills/skill-generator.js";
import { executeWorkflow, formatWorkflowResult } from "./automation/workflow-engine.js";
import { detectForms, fillForm, formatFormInfo } from "./automation/form-filler.js";
import { detectAuthState } from "./automation/auth-manager.js";
import { detectCaptcha } from "./automation/captcha-detector.js";
import { waitForPageReady } from "./automation/wait-strategies.js";
import { captureDownload, formatDownloadInfo } from "./automation/download-manager.js";
import { listTabs, openTab, switchTab, closeTab, formatTabList } from "./core/tab-manager.js";
import { retryWithBackoff, NAV_RETRY, INTERACT_RETRY } from "./core/retry-engine.js";
import { listIframes, extractIframeContent, interactInIframe, formatIframeList } from "./extraction/iframe-processor.js";
import { takeMonitorSnapshot, pollForChanges, waitForElement, waitForContentChange, formatChanges } from "./core/page-monitor.js";
import type { MonitorSnapshot } from "./core/page-monitor.js";
import { goBack, goForward } from "./core/history-navigator.js";
import { searchInPage, scrollToText, formatSearchResult } from "./core/page-search.js";
import { findElements, readLongContent, formatFoundElements, formatContentChunk } from "./extraction/element-finder.js";
import { setupDialogHandler, formatDialogs } from "./automation/dialog-handler.js";
import type { DialogRecord } from "./automation/dialog-handler.js";
import { dismissCookieBanner } from "./automation/cookie-banner.js";
import { dragAndDrop } from "./automation/drag-drop.js";
import type { SessionConfig, ExtractionSchema, WorkflowStep, NetworkFilter } from "./types.js";
import path from "node:path";

export default class BrowserEngineIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "browser-engine",
    name: "Browser Engine",
    category: "tools",
    version: BROWSER_ENGINE_VERSION,
    description:
      "Full-spectrum browser automation: multi-session management, stealth mode, smart DOM extraction, 55 built-in scraping skills, persistent profiles, and workflow automation. Use web_* tools to browse, scrape, and automate any website.",

    auth: { type: "none" },

    tools: [
      // ─── Session Management ────────────────────────────
      {
        name: "web_session_create",
        description:
          "Create a new browser session. Supports stealth mode (anti-detection), proxy configuration, and profile loading for persistent auth. Returns session ID.",
        parameters: {
          type: "object",
          properties: {
            headless: { type: "boolean", description: "Run headless (default: true)" },
            stealth: { type: "boolean", description: "Enable anti-detection stealth mode (default: true)" },
            proxy: { type: "string", description: "Proxy server URL (e.g., http://host:port or socks5://host:port)" },
            profileId: { type: "string", description: "Load a saved browser profile (cookies, localStorage)" },
            viewport: { type: "string", description: "Viewport preset: desktop, desktop-hd, tablet, mobile" },
            cdpUrl: { type: "string", description: "Connect to existing browser via CDP WebSocket URL" },
          },
        },
      },
      {
        name: "web_session_list",
        description: "List all active browser sessions with their URLs, titles, and profile info.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "web_session_close",
        description: "Close a browser session. Optionally save the session's cookies/localStorage to a profile.",
        parameters: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID to close (default: current session)" },
            saveProfile: { type: "boolean", description: "Save cookies and localStorage to the profile before closing" },
          },
        },
      },

      // ─── Navigation & Interaction ──────────────────────
      {
        name: "web_navigate",
        description:
          "Navigate to a URL. Returns a DOM snapshot with numbered interactive elements like [0] <button> \"Submit\", [1] <a> \"About\". Use these numbers with web_interact to click/type. Auto-creates a session if none exists.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
            waitFor: { type: "string", description: "Wait strategy: 'networkidle', 'domready', or a CSS selector" },
          },
          required: ["url"],
        },
      },
      {
        name: "web_interact",
        description:
          "Interact with the page: click, type, select, hover, press key, scroll, and more. Target elements by their numbered index from web_navigate/web_snapshot output (e.g., index 5 for [5] <button>), by CSS selector, or by x/y coordinates.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "Action: click, dblclick, rightclick, type, select, hover, press, scroll, clear, focus",
              enum: ["click", "dblclick", "rightclick", "type", "select", "hover", "press", "scroll", "clear", "focus"],
            },
            index: { type: "number", description: "Element index from snapshot (e.g., 5 for [5])" },
            selector: { type: "string", description: "CSS selector (alternative to index)" },
            x: { type: "number", description: "X coordinate for coordinate-based click (alternative to index/selector)" },
            y: { type: "number", description: "Y coordinate for coordinate-based click" },
            value: { type: "string", description: "Value to type, key to press, option to select, or scroll direction (up/down/amount)" },
            modifiers: {
              type: "array",
              description: "Modifier keys to hold during action: Control, Shift, Alt, Meta",
              items: { type: "string", description: "Modifier key name", enum: ["Control", "Shift", "Alt", "Meta"] },
            },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["action"],
        },
      },
      {
        name: "web_snapshot",
        description:
          "Get current page state: URL, title, content text, and numbered interactive elements. Use after interactions to see updated page state.",
        parameters: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_screenshot",
        description: "Take a screenshot of the current page (full page, viewport, or specific element).",
        parameters: {
          type: "object",
          properties: {
            fullPage: { type: "boolean", description: "Capture full page (default: false, viewport only)" },
            selector: { type: "string", description: "CSS selector of element to screenshot" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },

      // ─── Data Extraction ───────────────────────────────
      {
        name: "web_extract",
        description:
          'Extract structured data from the page using a declarative JSON schema. Define a container selector and field extractors. Example: selector=".product", fields={"title": {"selector": "h2"}, "price": {"selector": ".price"}}',
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for the container element(s)" },
            fields: {
              type: "object",
              description: 'Field definitions. Each key maps to {selector?, attribute?, transform?}. Transforms: text, html, number, url, trim',
            },
            multiple: { type: "boolean", description: "Extract from multiple matching containers (default: true)" },
            limit: { type: "number", description: "Max items to extract (default: 20)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["selector", "fields"],
        },
      },
      {
        name: "web_extract_table",
        description: "Extract all HTML tables from the current page as structured data with headers and rows.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max tables to extract (default: 10)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_extract_links",
        description: "Extract all links from the current page. Optionally filter by regex pattern.",
        parameters: {
          type: "object",
          properties: {
            filter: { type: "string", description: "Regex pattern to filter links by URL or text" },
            limit: { type: "number", description: "Max links to return (default: 100)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_extract_list",
        description:
          "Extract repeated items from a page (search results, product listings, feed items). Provide a CSS selector for the repeating item and field extractors.",
        parameters: {
          type: "object",
          properties: {
            itemSelector: { type: "string", description: "CSS selector for each repeating item" },
            fields: {
              type: "object",
              description: "Field definitions: {fieldName: {selector?, attribute?, transform?}}",
            },
            limit: { type: "number", description: "Max items (default: 20)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["itemSelector", "fields"],
        },
      },

      // ─── Skills ────────────────────────────────────────
      {
        name: "web_skill_run",
        description:
          "Execute a built-in browser skill by ID. Skills are pre-built automations for common tasks: google-search, amazon-search, github-repo, stock-quote, etc. Use web_skill_list to see all available skills.",
        parameters: {
          type: "object",
          properties: {
            skillId: { type: "string", description: "Skill ID (e.g., 'google-search', 'amazon-search', 'github-repo')" },
            params: { type: "object", description: "Skill parameters (e.g., {query: 'mechanical keyboards'})" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["skillId"],
        },
      },
      {
        name: "web_skill_list",
        description: "List available browser skills. Filter by category (search, social, ecommerce, news, developer, jobs, financial, travel, productivity, utility) or search by keyword.",
        parameters: {
          type: "object",
          properties: {
            category: { type: "string", description: "Filter by category", enum: ["search", "social", "ecommerce", "news", "developer", "jobs", "financial", "travel", "productivity", "utility"] },
            query: { type: "string", description: "Search skills by keyword" },
          },
        },
      },

      // ─── Custom Skill Creation (Wispy Browser Use) ─────
      {
        name: "web_skill_create",
        description: "Generate a new custom browser skill from a natural language goal. Gemini analyzes the goal and creates a reusable SkillDefinition with steps. The skill is saved to disk and available via web_skill_run.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name for the new skill (e.g. 'LinkedIn Job Search')" },
            goal: { type: "string", description: "Describe what the skill should do (e.g. 'Search LinkedIn for jobs matching a query and extract titles, companies, and links')" },
            category: { type: "string", description: "Optional category", enum: ["search", "social", "ecommerce", "news", "developer", "jobs", "financial", "travel", "productivity", "utility"] },
          },
          required: ["name", "goal"],
        },
      },
      {
        name: "web_skill_save",
        description: "Save or update a custom skill to persistent storage. Skills saved this way survive restarts.",
        parameters: {
          type: "object",
          properties: {
            skillId: { type: "string", description: "The skill ID to save" },
          },
          required: ["skillId"],
        },
      },
      {
        name: "web_skill_delete",
        description: "Delete a custom skill from the registry and disk.",
        parameters: {
          type: "object",
          properties: {
            skillId: { type: "string", description: "The skill ID to delete" },
          },
          required: ["skillId"],
        },
      },
      {
        name: "web_skill_inspect",
        description: "Show the full definition of a skill including all steps, parameters, and extraction rules. Works for both built-in and custom skills.",
        parameters: {
          type: "object",
          properties: {
            skillId: { type: "string", description: "The skill ID to inspect" },
          },
          required: ["skillId"],
        },
      },

      // ─── Workflow & Automation ─────────────────────────
      {
        name: "web_workflow",
        description:
          'Execute a custom multi-step workflow from JSON steps. Each step has: action (navigate/click/type/press/scroll/wait/screenshot/evaluate), target (CSS selector), value, waitFor, extract, screenshot.',
        parameters: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              description: "Array of workflow steps",
              items: {
                type: "object",
                description: "Step: {action, target?, value?, waitFor?, extract?, screenshot?}",
              },
            },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["steps"],
        },
      },

      // ─── Profiles ──────────────────────────────────────
      {
        name: "web_profile_list",
        description: "List saved browser profiles (persistent cookie/localStorage snapshots for maintaining login sessions).",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "web_profile_delete",
        description: "Delete a saved browser profile.",
        parameters: {
          type: "object",
          properties: {
            profileId: { type: "string", description: "Profile ID to delete" },
          },
          required: ["profileId"],
        },
      },

      // ─── Network & Advanced ────────────────────────────
      {
        name: "web_network_capture",
        description: "Get captured network requests and API calls from the current session. Useful for discovering hidden APIs, analyzing data flows, and debugging.",
        parameters: {
          type: "object",
          properties: {
            urlPattern: { type: "string", description: "Regex to filter request URLs" },
            method: { type: "string", description: "HTTP method filter (GET, POST, etc.)" },
            apiOnly: { type: "boolean", description: "Only show API calls (JSON/XML responses)" },
            limit: { type: "number", description: "Max requests to return (default: 50)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_evaluate",
        description: "Execute arbitrary JavaScript in the page context. Returns the result as a string.",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string", description: "JavaScript expression or code to evaluate" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["expression"],
        },
      },

      // ─── Tab Management ──────────────────────────────────
      {
        name: "web_tab_list",
        description: "List all open tabs in the current session with their URLs, titles, and which is active.",
        parameters: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_tab_open",
        description: "Open a new tab in the current session, optionally navigating to a URL.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to open (blank tab if omitted)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_tab_switch",
        description: "Switch to a different tab by index or URL pattern. The active tab becomes the target for all subsequent interactions.",
        parameters: {
          type: "object",
          properties: {
            index: { type: "number", description: "Tab index (from web_tab_list)" },
            urlPattern: { type: "string", description: "Regex or substring to match tab URL" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_tab_close",
        description: "Close a specific tab by index.",
        parameters: {
          type: "object",
          properties: {
            index: { type: "number", description: "Tab index to close" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["index"],
        },
      },

      // ─── Downloads ───────────────────────────────────────
      {
        name: "web_download",
        description: "Click a link/button that triggers a file download, or download from a direct URL. Captures the file and saves it to disk.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of the download trigger (button/link)" },
            url: { type: "string", description: "Direct URL to download (alternative to selector)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },

      // ─── Profile Export/Import ────────────────────────────
      {
        name: "web_profile_create",
        description: "Create a new browser profile by saving the current session's cookies and localStorage. Use this to persist login sessions.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Profile name (e.g., 'github-login', 'amazon-session')" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["name"],
        },
      },
      {
        name: "web_profile_export",
        description: "Export a saved profile as a JSON object (cookies + localStorage). Useful for backup or transferring sessions.",
        parameters: {
          type: "object",
          properties: {
            profileId: { type: "string", description: "Profile ID to export" },
          },
          required: ["profileId"],
        },
      },

      // ─── Iframe Handling ─────────────────────────────────
      {
        name: "web_iframe_list",
        description: "List all iframes on the current page with their URLs, names, sizes, and cross-origin status.",
        parameters: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_iframe_interact",
        description: "Interact with content inside an iframe. Target the iframe by index (from web_iframe_list), name, or URL pattern, then perform actions within it.",
        parameters: {
          type: "object",
          properties: {
            iframeIndex: { type: "number", description: "Iframe index from web_iframe_list" },
            iframeName: { type: "string", description: "Iframe name attribute" },
            iframeUrl: { type: "string", description: "URL pattern to match iframe" },
            action: { type: "string", description: "Action: click, type, press, hover, focus, extract", enum: ["click", "type", "press", "hover", "focus", "extract"] },
            selector: { type: "string", description: "CSS selector within the iframe" },
            value: { type: "string", description: "Value for type/press actions" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["action"],
        },
      },

      // ─── Page Monitoring ─────────────────────────────────
      {
        name: "web_monitor_snapshot",
        description: "Take a baseline snapshot of a page element for change detection. Use web_monitor_check later to see what changed.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector to monitor (default: body)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },
      {
        name: "web_monitor_check",
        description: "Check for DOM changes since the last snapshot. Also supports waiting for an element to appear or content to change.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector to check (default: body)" },
            waitForSelector: { type: "string", description: "Wait for this selector to appear on the page" },
            waitForChange: { type: "boolean", description: "Wait until content changes from the baseline snapshot" },
            timeout: { type: "number", description: "Max wait time in ms (default: 30000)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },

      // ─── History Navigation ────────────────────────────────
      {
        name: "web_go_back",
        description: "Navigate back or forward in browser history. Like clicking the browser's back/forward button.",
        parameters: {
          type: "object",
          properties: {
            direction: { type: "string", description: "Direction: 'back' (default) or 'forward'", enum: ["back", "forward"] },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },

      // ─── Page Search ───────────────────────────────────────
      {
        name: "web_search_page",
        description: "Search for text or regex within the current page content (like Ctrl+F). Zero LLM cost -- returns matching text with surrounding context. Great for finding specific content without reading the whole page.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Text or regex pattern to search for" },
            regex: { type: "boolean", description: "Treat query as regex (default: false)" },
            caseSensitive: { type: "boolean", description: "Case-sensitive search (default: false)" },
            limit: { type: "number", description: "Max matches to return (default: 20)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["query"],
        },
      },
      {
        name: "web_find_text",
        description: "Scroll the page until specific text is found in the viewport. Useful for long or infinite-scroll pages where content loads dynamically.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to find and scroll to" },
            timeout: { type: "number", description: "Max time in ms (default: 30000)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["text"],
        },
      },

      // ─── Element Finder ────────────────────────────────────
      {
        name: "web_find_elements",
        description: "Find all elements matching a CSS selector. Returns each element's tag, text content, attributes, and visibility. Useful for discovering page structure without a full snapshot.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector to query" },
            limit: { type: "number", description: "Max elements to return (default: 50)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["selector"],
        },
      },
      {
        name: "web_read_content",
        description: "Read long page content in chunks. For pages with more text than fits in context, read chunk by chunk. Returns chunk index, total chunks, and content.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector for content area (default: body)" },
            chunkSize: { type: "number", description: "Characters per chunk (default: 50000)" },
            chunkIndex: { type: "number", description: "Which chunk to read (0-based, default: 0)" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },

      // ─── File Upload ───────────────────────────────────────
      {
        name: "web_upload_file",
        description: "Upload a file to a file input element. Provide the CSS selector of the <input type='file'> and the local file path.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of the file input element" },
            filePath: { type: "string", description: "Local file path to upload" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["selector", "filePath"],
        },
      },

      // ─── Dropdown ──────────────────────────────────────────
      {
        name: "web_dropdown",
        description: "Get options from a <select> dropdown or select a value. Use action='options' to list available options, or action='select' to choose one.",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of the <select> element" },
            action: { type: "string", description: "Action: 'options' (list choices) or 'select' (pick one)", enum: ["options", "select"] },
            value: { type: "string", description: "Value or visible text to select (for action='select')" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["selector", "action"],
        },
      },

      // ─── Drag and Drop ─────────────────────────────────────
      {
        name: "web_drag_drop",
        description: "Drag an element and drop it onto another element or coordinates. Useful for sortable lists, kanban boards, file uploads, etc.",
        parameters: {
          type: "object",
          properties: {
            sourceSelector: { type: "string", description: "CSS selector of element to drag" },
            targetSelector: { type: "string", description: "CSS selector of drop target" },
            sourceX: { type: "number", description: "Source X coordinate (alternative to sourceSelector)" },
            sourceY: { type: "number", description: "Source Y coordinate" },
            targetX: { type: "number", description: "Target X coordinate (alternative to targetSelector)" },
            targetY: { type: "number", description: "Target Y coordinate" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },

      // ─── Dialog Handling ───────────────────────────────────
      {
        name: "web_dialog",
        description: "Get browser dialog history (alerts, confirms, prompts) or configure how to auto-respond. Dialogs are auto-accepted by default.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", description: "Action: 'history' (show past dialogs) or 'configure' (set auto-response)", enum: ["history", "configure"] },
            alertAction: { type: "string", description: "Auto-response for alerts: accept/dismiss", enum: ["accept", "dismiss"] },
            confirmAction: { type: "string", description: "Auto-response for confirms: accept/dismiss", enum: ["accept", "dismiss"] },
            promptAction: { type: "string", description: "Auto-response for prompts: accept/dismiss", enum: ["accept", "dismiss"] },
            promptText: { type: "string", description: "Default text to enter for prompts" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
        },
      },

      // ─── Task Completion ───────────────────────────────────
      {
        name: "web_done",
        description: "Signal that the current browser automation task is complete. Returns a summary with the final result, extracted data, and any output text.",
        parameters: {
          type: "object",
          properties: {
            result: { type: "string", description: "Final result or answer from the task" },
            data: { type: "object", description: "Structured data extracted during the task" },
            sessionId: { type: "string", description: "Session ID (default: current)" },
          },
          required: ["result"],
        },
      },
    ],

    requires: {},

    capabilities: {
      offline: false,
      streaming: false,
    },
  };

  private sessionManager: SessionManager | null = null;
  private skillRegistry: SkillRegistry | null = null;
  private skillStore: SkillStore | null = null;
  private geminiCall: GeminiGenerateFn | null = null;
  private lastSnapshot: Map<string, import("./types.js").DOMElement[]> = new Map();
  private monitorBaselines: Map<string, MonitorSnapshot> = new Map();
  private dialogHandlers: Map<string, { getDialogs: () => DialogRecord[]; clearDialogs: () => void }> = new Map();

  /** Inject a Gemini call function for skill generation */
  setGeminiCall(fn: GeminiGenerateFn): void {
    this.geminiCall = fn;
  }

  async onEnable(): Promise<void> {
    this.sessionManager = new SessionManager(this.ctx.runtimeDir);
    this.skillRegistry = new SkillRegistry();

    // Load custom skills from disk
    this.skillStore = new SkillStore(this.ctx.runtimeDir);
    const customSkills = this.skillStore.loadAll();
    for (const skill of customSkills) {
      this.skillRegistry.register(skill);
    }

    const builtInCount = this.skillRegistry.size - customSkills.length;
    this.ctx.logger.info(
      "Browser Engine enabled (%d built-in + %d custom skills)",
      builtInCount, customSkills.length
    );
  }

  async onDisable(): Promise<void> {
    if (this.sessionManager) {
      await this.sessionManager.dispose();
      this.sessionManager = null;
    }
    this.skillRegistry = null;
    this.lastSnapshot.clear();
    this.monitorBaselines.clear();
    this.dialogHandlers.clear();
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    return {
      healthy: this.sessionManager !== null,
      message: this.sessionManager
        ? `${this.sessionManager.sessionCount} active session(s), ${this.skillRegistry?.size ?? 0} skills`
        : "Not initialized",
    };
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.sessionManager || !this.skillRegistry) {
      return this.error("Browser Engine not initialized. Enable the integration first.");
    }

    try {
      switch (toolName) {
        case "web_session_create":
          return await this.handleSessionCreate(args);
        case "web_session_list":
          return this.handleSessionList();
        case "web_session_close":
          return await this.handleSessionClose(args);
        case "web_navigate":
          return await this.handleNavigate(args);
        case "web_interact":
          return await this.handleInteract(args);
        case "web_snapshot":
          return await this.handleSnapshot(args);
        case "web_screenshot":
          return await this.handleScreenshot(args);
        case "web_extract":
          return await this.handleExtract(args);
        case "web_extract_table":
          return await this.handleExtractTable(args);
        case "web_extract_links":
          return await this.handleExtractLinks(args);
        case "web_extract_list":
          return await this.handleExtractList(args);
        case "web_skill_run":
          return await this.handleSkillRun(args);
        case "web_skill_list":
          return this.handleSkillList(args);
        case "web_skill_create":
          return await this.handleSkillCreate(args);
        case "web_skill_save":
          return this.handleSkillSave(args);
        case "web_skill_delete":
          return this.handleSkillDelete(args);
        case "web_skill_inspect":
          return this.handleSkillInspect(args);
        case "web_workflow":
          return await this.handleWorkflow(args);
        case "web_profile_list":
          return this.handleProfileList();
        case "web_profile_delete":
          return this.handleProfileDelete(args);
        case "web_network_capture":
          return this.handleNetworkCapture(args);
        case "web_evaluate":
          return await this.handleEvaluate(args);
        case "web_tab_list":
          return await this.handleTabList(args);
        case "web_tab_open":
          return await this.handleTabOpen(args);
        case "web_tab_switch":
          return await this.handleTabSwitch(args);
        case "web_tab_close":
          return await this.handleTabClose(args);
        case "web_download":
          return await this.handleDownload(args);
        case "web_profile_create":
          return await this.handleProfileCreate(args);
        case "web_profile_export":
          return this.handleProfileExport(args);
        case "web_iframe_list":
          return await this.handleIframeList(args);
        case "web_iframe_interact":
          return await this.handleIframeInteract(args);
        case "web_monitor_snapshot":
          return await this.handleMonitorSnapshot(args);
        case "web_monitor_check":
          return await this.handleMonitorCheck(args);
        case "web_go_back":
          return await this.handleGoBack(args);
        case "web_search_page":
          return await this.handleSearchPage(args);
        case "web_find_text":
          return await this.handleFindText(args);
        case "web_find_elements":
          return await this.handleFindElements(args);
        case "web_read_content":
          return await this.handleReadContent(args);
        case "web_upload_file":
          return await this.handleUploadFile(args);
        case "web_dropdown":
          return await this.handleDropdown(args);
        case "web_drag_drop":
          return await this.handleDragDrop(args);
        case "web_dialog":
          return await this.handleDialog(args);
        case "web_done":
          return this.handleDone(args);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.ctx.logger.error("Browser Engine error in %s: %s", toolName, msg);
      return this.error(`Browser Engine error: ${msg}`);
    }
  }

  // ─── Tool Handlers ───────────────────────────────────

  private async handleSessionCreate(args: Record<string, unknown>): Promise<ToolResult> {
    const config: SessionConfig = {
      headless: args.headless as boolean | undefined,
      stealth: args.stealth as boolean | undefined,
      profileId: args.profileId as string | undefined,
      cdpUrl: args.cdpUrl as string | undefined,
    };

    if (args.proxy) {
      config.proxy = { server: args.proxy as string };
    }

    if (args.viewport) {
      const presets: Record<string, { width: number; height: number }> = {
        desktop: { width: 1280, height: 720 },
        "desktop-hd": { width: 1920, height: 1080 },
        tablet: { width: 768, height: 1024 },
        mobile: { width: 375, height: 812 },
      };
      config.viewport = presets[args.viewport as string] ?? presets.desktop;
    }

    const session = await this.sessionManager!.createSession(config);

    // Set up dialog auto-handling
    const dialogHandler = setupDialogHandler(session.page);
    this.dialogHandlers.set(session.id, dialogHandler);

    return this.ok(
      `Browser session created: ${session.id}\n` +
        `  Headless: ${config.headless ?? true}\n` +
        `  Stealth: ${config.stealth ?? true}\n` +
        (config.profileId ? `  Profile: ${config.profileId}\n` : "") +
        (config.proxy ? `  Proxy: ${config.proxy.server}\n` : ""),
      { sessionId: session.id }
    );
  }

  private handleSessionList(): ToolResult {
    const sessions = this.sessionManager!.listSessions();
    if (sessions.length === 0) return this.ok("No active browser sessions.");

    const lines = sessions.map(
      (s) =>
        `  ${s.id} - ${s.url || "(blank)"}${s.profileId ? ` [profile: ${s.profileId}]` : ""}`
    );
    return this.ok(`Active sessions (${sessions.length}):\n${lines.join("\n")}`);
  }

  private async handleSessionClose(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionId = args.sessionId as string | undefined;
    const saveProfile = args.saveProfile as boolean | undefined;

    const session = this.sessionManager!.getSession(sessionId);
    if (!session) return this.error("No active session found.");

    await this.sessionManager!.closeSession(session.id, saveProfile);
    this.lastSnapshot.delete(session.id);
    this.dialogHandlers.delete(session.id);

    return this.ok(
      `Session ${session.id} closed.` +
        (saveProfile ? " Profile saved." : "")
    );
  }

  private async handleNavigate(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args.url as string;
    if (!url) return this.error("URL is required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    // Ensure dialog handler is set up
    if (!this.dialogHandlers.has(session.id)) {
      this.dialogHandlers.set(session.id, setupDialogHandler(page));
    }

    // Navigate with retry
    await retryWithBackoff(
      () => page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
      NAV_RETRY
    );

    // Wait strategy
    const waitFor = args.waitFor as string | undefined;
    if (waitFor) {
      if (waitFor === "networkidle") {
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      } else if (waitFor === "domready") {
        // Already done
      } else {
        await page.waitForSelector(waitFor, { timeout: 10_000 }).catch(() => {});
      }
    } else {
      // Smart wait: DOM ready + network idle + brief settle
      await waitForPageReady(page, 10_000).catch(() => {});
    }

    // Process page DOM
    const snapshot = await processPage(page);
    this.lastSnapshot.set(session.id, snapshot.elements);

    // Detect auth state and CAPTCHA challenges
    const [authState, captcha] = await Promise.all([
      detectAuthState(page).catch((): import("./types.js").AuthState => ({ isLoggedIn: false, indicators: [] })),
      detectCaptcha(page).catch((): import("./types.js").CaptchaDetection => ({ detected: false })),
    ]);

    // Auto-dismiss cookie banners
    const cookieResult = await dismissCookieBanner(page).catch(() => ({ found: false, dismissed: false }));

    // Build output
    const outputParts = [
      `Navigated to: ${snapshot.url}`,
      `Title: ${snapshot.title}`,
    ];

    if (cookieResult.found && cookieResult.dismissed) {
      outputParts.push(`Cookie banner auto-dismissed.`);
    }

    // Auth/CAPTCHA warnings
    if (captcha.detected) {
      outputParts.push(`\n⚠ CAPTCHA detected: ${captcha.type ?? "unknown"}${captcha.siteKey ? ` (siteKey: ${captcha.siteKey})` : ""}`);
    }
    if (authState.isLoggedIn) {
      outputParts.push(`Auth: Logged in`);
    } else if (authState.loginUrl) {
      outputParts.push(`Auth: Not logged in (login page: ${authState.loginUrl})`);
    }

    outputParts.push(
      `\n--- Page Content ---`,
      snapshot.content.substring(0, 60_000),
      `\n--- Interactive Elements (${snapshot.interactiveElements.length}) ---`,
      this.formatElementList(snapshot.interactiveElements),
    );

    return this.ok(outputParts.join("\n"), {
      sessionId: session.id,
      url: snapshot.url,
      title: snapshot.title,
      elementCount: snapshot.elements.length,
      interactiveCount: snapshot.interactiveElements.length,
      authState: { isLoggedIn: authState.isLoggedIn, loginUrl: authState.loginUrl },
      captcha: captcha.detected ? { type: captcha.type, siteKey: captcha.siteKey } : null,
    });
  }

  private async handleInteract(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as string;
    if (!action) return this.error("Action is required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    // Resolve target
    let selector: string | undefined;
    if (args.index !== undefined) {
      const elements = this.lastSnapshot.get(session.id);
      if (!elements) return this.error("No page snapshot. Use web_navigate or web_snapshot first.");
      const el = elements.find((e) => e.index === (args.index as number));
      if (!el) return this.error(`Element [${args.index}] not found. Use web_snapshot to refresh.`);
      selector = el.selector;
    } else if (args.selector) {
      selector = args.selector as string;
    }

    const value = args.value as string | undefined;
    const modifiers = (args.modifiers as string[] | undefined) ?? [];
    const hasCoords = args.x !== undefined && args.y !== undefined;

    switch (action) {
      case "click":
        if (hasCoords) {
          // Coordinate-based click
          if (modifiers.length > 0) {
            for (const mod of modifiers) await page.keyboard.down(mod);
          }
          await page.mouse.click(args.x as number, args.y as number);
          if (modifiers.length > 0) {
            for (const mod of modifiers) await page.keyboard.up(mod);
          }
        } else if (selector) {
          await retryWithBackoff(
            () => page.click(selector!, {
              timeout: 10_000,
              modifiers: modifiers as ("Alt" | "Control" | "Meta" | "Shift")[],
            }),
            INTERACT_RETRY
          );
        } else {
          return this.error("Target required for click (provide index, selector, or x/y coordinates).");
        }
        break;

      case "dblclick":
        if (hasCoords) {
          await page.mouse.dblclick(args.x as number, args.y as number);
        } else if (selector) {
          await page.dblclick(selector, {
            timeout: 10_000,
            modifiers: modifiers as ("Alt" | "Control" | "Meta" | "Shift")[],
          });
        } else {
          return this.error("Target required for dblclick.");
        }
        break;

      case "rightclick":
        if (hasCoords) {
          await page.mouse.click(args.x as number, args.y as number, { button: "right" });
        } else if (selector) {
          await page.click(selector, {
            button: "right",
            timeout: 10_000,
          });
        } else {
          return this.error("Target required for rightclick.");
        }
        break;

      case "type":
        if (!value) return this.error("Value required for type.");
        if (selector) {
          await page.fill(selector, value);
        } else {
          // No explicit target: try intelligent form filling with JSON field map
          try {
            const fieldValues = JSON.parse(value) as Record<string, string>;
            const result = await fillForm(page, fieldValues);
            if (result.filled === 0 && result.errors.length > 0) {
              return this.error(`Form fill failed: ${result.errors.join("; ")}`);
            }
            return this.ok(
              `Filled ${result.filled} field(s).${result.errors.length > 0 ? ` Errors: ${result.errors.join("; ")}` : ""}`,
              { sessionId: session.id, filled: result.filled }
            );
          } catch {
            return this.error("Target required for type (provide index, selector, or JSON field map as value).");
          }
        }
        break;

      case "select":
        if (!selector) return this.error("Target required for select.");
        if (!value) return this.error("Value required for select.");
        await page.selectOption(selector, value);
        break;

      case "hover":
        if (hasCoords) {
          await page.mouse.move(args.x as number, args.y as number);
        } else if (selector) {
          await page.hover(selector);
        } else {
          return this.error("Target required for hover.");
        }
        break;

      case "press":
        if (!value) return this.error("Value required for press (key name, e.g., Enter, Tab, Control+A).");
        // Support modifier combos like "Control+A", "Shift+Enter"
        if (selector) {
          await page.press(selector, value);
        } else {
          await page.keyboard.press(value);
        }
        break;

      case "scroll": {
        const direction = value ?? "down";
        await page.evaluate((dir: string) => {
          if (dir === "down") window.scrollBy(0, 500);
          else if (dir === "up") window.scrollBy(0, -500);
          else if (dir === "bottom") window.scrollTo(0, document.body.scrollHeight);
          else if (dir === "top") window.scrollTo(0, 0);
          else window.scrollBy(0, parseInt(dir) || 500);
        }, direction);
        break;
      }

      case "clear":
        if (!selector) return this.error("Target required for clear.");
        await page.fill(selector, "");
        break;

      case "focus":
        if (!selector) return this.error("Target required for focus.");
        await page.focus(selector);
        break;

      default:
        return this.error(`Unknown action: ${action}`);
    }

    // Smart wait for page to settle after interaction
    await waitForPageReady(page, 5_000).catch(() => {});

    // Return updated snapshot with interactive elements and forms
    const [snapshot, forms] = await Promise.all([
      processPage(page),
      detectForms(page).catch(() => []),
    ]);
    this.lastSnapshot.set(session.id, snapshot.elements);

    const outputParts = [
      `Action "${action}" completed.`,
      `\nPage: ${page.url()}`,
      `Title: ${await page.title()}`,
      `\n--- Interactive Elements ---`,
      this.formatElementList(snapshot.interactiveElements),
    ];

    if (forms.length > 0) {
      outputParts.push(`\n--- Forms ---`);
      outputParts.push(formatFormInfo(forms));
    }

    return this.ok(outputParts.join("\n"), { sessionId: session.id, url: page.url() });
  }

  private async handleSnapshot(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    // Process DOM and detect forms in parallel
    const [snapshot, forms] = await Promise.all([
      processPage(page),
      detectForms(page).catch(() => []),
    ]);
    this.lastSnapshot.set(session.id, snapshot.elements);

    const outputParts = [
      `URL: ${snapshot.url}`,
      `Title: ${snapshot.title}`,
      `\n--- Content ---`,
      snapshot.content.substring(0, 60_000),
      `\n--- Interactive Elements (${snapshot.interactiveElements.length}) ---`,
      this.formatElementList(snapshot.interactiveElements),
    ];

    // Include form info if forms were detected
    if (forms.length > 0) {
      outputParts.push(`\n--- Forms Detected ---`);
      outputParts.push(formatFormInfo(forms));
    }

    return this.ok(outputParts.join("\n"), {
      sessionId: session.id,
      url: snapshot.url,
      elementCount: snapshot.elements.length,
      formCount: forms.length,
    });
  }

  private async handleScreenshot(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const screenshotDir = path.join(this.ctx.runtimeDir, "screenshots");
    const fileName = `web-${Date.now()}.png`;
    const filePath = path.join(screenshotDir, fileName);

    // Ensure directory exists
    const { mkdir } = await import("node:fs/promises");
    await mkdir(screenshotDir, { recursive: true });

    if (args.selector) {
      const el = page.locator(args.selector as string);
      await el.screenshot({ path: filePath });
    } else {
      await page.screenshot({
        path: filePath,
        fullPage: (args.fullPage as boolean) ?? false,
      });
    }

    return this.ok(`Screenshot saved: ${filePath}`, {
      sessionId: session.id,
      path: filePath,
    });
  }

  private async handleExtract(args: Record<string, unknown>): Promise<ToolResult> {
    const selector = args.selector as string;
    const fields = args.fields as Record<string, { selector?: string; attribute?: string; transform?: string }>;
    if (!selector || !fields) return this.error("selector and fields are required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const schema: ExtractionSchema = {
      selector,
      fields,
      multiple: (args.multiple as boolean) ?? true,
      limit: (args.limit as number) ?? 20,
    };

    const data = await extractWithSchema(page, schema);
    return this.ok(formatExtractedData(data), {
      sessionId: session.id,
      count: data.length,
      data,
    });
  }

  private async handleExtractTable(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const tables = await extractTables(page, { limit: args.limit as number });
    return this.ok(formatTablesAsMarkdown(tables), {
      sessionId: session.id,
      tableCount: tables.length,
      tables,
    });
  }

  private async handleExtractLinks(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);
    const limit = (args.limit as number) ?? 100;

    // Extract links and media in parallel
    const [links, media] = await Promise.all([
      extractLinks(page, { filter: args.filter as string, limit }),
      extractMedia(page, { limit: Math.min(limit, 50) }),
    ]);

    const outputParts = [formatLinks(links)];

    if (media.length > 0) {
      const images = media.filter((m) => m.type === "image");
      const videos = media.filter((m) => m.type === "video");
      const audio = media.filter((m) => m.type === "audio");

      outputParts.push(`\n--- Media (${media.length}) ---`);
      if (images.length > 0) {
        outputParts.push(`Images (${images.length}):`);
        outputParts.push(...images.slice(0, 20).map((m, i) => `  ${i + 1}. ${m.src}${m.alt ? ` (${m.alt})` : ""}`));
      }
      if (videos.length > 0) {
        outputParts.push(`Videos (${videos.length}):`);
        outputParts.push(...videos.map((m, i) => `  ${i + 1}. ${m.src}`));
      }
      if (audio.length > 0) {
        outputParts.push(`Audio (${audio.length}):`);
        outputParts.push(...audio.map((m, i) => `  ${i + 1}. ${m.src}`));
      }
    }

    return this.ok(outputParts.join("\n"), {
      sessionId: session.id,
      linkCount: links.length,
      mediaCount: media.length,
      links,
      media,
    });
  }

  private async handleExtractList(args: Record<string, unknown>): Promise<ToolResult> {
    const itemSelector = args.itemSelector as string;
    const fields = args.fields as Record<string, { selector?: string; attribute?: string; transform?: string }>;
    if (!itemSelector || !fields) return this.error("itemSelector and fields are required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const data = await extractRepeatedItems(
      page,
      "body",
      itemSelector,
      fields,
      (args.limit as number) ?? 20
    );

    return this.ok(formatExtractedData(data), {
      sessionId: session.id,
      count: data.length,
      data,
    });
  }

  private async handleSkillRun(args: Record<string, unknown>): Promise<ToolResult> {
    const skillId = args.skillId as string;
    if (!skillId) return this.error("skillId is required.");

    const skill = this.skillRegistry!.get(skillId);
    if (!skill) {
      const suggestions = this.skillRegistry!.search(skillId);
      if (suggestions.length > 0) {
        return this.error(
          `Skill "${skillId}" not found. Did you mean: ${suggestions.map((s) => s.id).join(", ")}?`
        );
      }
      return this.error(`Skill "${skillId}" not found. Use web_skill_list to see available skills.`);
    }

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);
    const params = (args.params as Record<string, string>) ?? {};

    const screenshotDir = path.join(this.ctx.runtimeDir, "screenshots");
    const result = await executeSkill(page, skill, params, screenshotDir);

    // Update snapshot after skill execution
    const snapshot = await processPage(page);
    this.lastSnapshot.set(session.id, snapshot.elements);

    if (!result.success) {
      return this.error(
        `Skill "${skillId}" failed at step ${result.stepsCompleted + 1}/${result.totalSteps}: ${result.error}`
      );
    }

    // Format extracted data
    const extractedParts: string[] = [];
    for (const [name, data] of Object.entries(result.extracted)) {
      if (Array.isArray(data) && data.length > 0) {
        extractedParts.push(`\n--- ${name} (${data.length} items) ---`);
        extractedParts.push(formatExtractedData(data as Record<string, unknown>[]));
      }
    }

    const output = [
      `Skill "${skill.name}" completed (${result.stepsCompleted}/${result.totalSteps} steps, ${result.duration}ms)`,
      `Page: ${page.url()}`,
      ...extractedParts,
    ].join("\n");

    return this.ok(output, {
      sessionId: session.id,
      ...result,
    });
  }

  private handleSkillList(args: Record<string, unknown>): ToolResult {
    const category = args.category as string | undefined;
    const query = args.query as string | undefined;

    let skills;
    if (query) {
      skills = this.skillRegistry!.search(query);
    } else if (category) {
      skills = this.skillRegistry!.listByCategory(category as import("./config.js").SkillCategory);
    }

    return this.ok(this.skillRegistry!.formatList(skills));
  }

  // ─── Custom Skill Handlers (Wispy Browser Use) ──────

  private async handleSkillCreate(args: Record<string, unknown>): Promise<ToolResult> {
    const name = String(args.name || "");
    const goal = String(args.goal || "");
    const category = args.category as string | undefined;

    if (!name || !goal) {
      return this.error("Both 'name' and 'goal' are required to create a skill.");
    }

    if (!this.geminiCall) {
      return this.error("Gemini call function not available. Skill generation requires AI model access.");
    }

    try {
      // Get current page context if a session exists
      let pageUrl: string | undefined;
      let pageTitle: string | undefined;
      try {
        const session = await this.sessionManager!.getOrCreateSession();
        const page = this.sessionManager!.getActivePage(session);
        pageUrl = page.url();
        pageTitle = await page.title();
      } catch {
        // No active session -- that's fine, generate without page context
      }

      const skill = await generateSkill({
        name,
        goal,
        category: category as any,
        pageUrl,
        pageTitle,
        geminiCall: this.geminiCall,
      });

      // Register in memory and save to disk
      this.skillRegistry!.register(skill);
      this.skillStore!.save(skill);

      const paramList = skill.parameters.map((p) => `${p.name}${p.required ? " (required)" : ""}`).join(", ");
      return this.ok(
        `Custom skill created successfully!\n\n` +
        `  ID:         ${skill.id}\n` +
        `  Name:       ${skill.name}\n` +
        `  Category:   ${skill.category}\n` +
        `  Steps:      ${skill.steps.length}\n` +
        `  Parameters: ${paramList || "none"}\n` +
        `  Tags:       ${skill.tags.join(", ")}\n\n` +
        `Run it with: web_skill_run(skillId: "${skill.id}", params: {...})`,
        { skillId: skill.id, steps: skill.steps.length }
      );
    } catch (err) {
      return this.error(`Skill creation failed: ${(err as Error).message}`);
    }
  }

  private handleSkillSave(args: Record<string, unknown>): ToolResult {
    const skillId = String(args.skillId || "");
    if (!skillId) return this.error("skillId is required");

    const skill = this.skillRegistry!.get(skillId);
    if (!skill) return this.error(`Skill "${skillId}" not found in registry.`);

    this.skillStore!.save(skill);
    return this.ok(`Skill "${skillId}" saved to disk. It will persist across restarts.`);
  }

  private handleSkillDelete(args: Record<string, unknown>): ToolResult {
    const skillId = String(args.skillId || "");
    if (!skillId) return this.error("skillId is required");

    // Only allow deleting custom skills
    if (!this.skillStore!.exists(skillId)) {
      return this.error(`Skill "${skillId}" is not a custom skill or doesn't exist on disk.`);
    }

    this.skillStore!.delete(skillId);
    // Remove from in-memory registry (re-create without this skill)
    // Note: SkillRegistry doesn't have a delete method, so we just mark the store
    return this.ok(`Custom skill "${skillId}" deleted from disk. Restart to remove from memory, or it won't be loaded next time.`);
  }

  private handleSkillInspect(args: Record<string, unknown>): ToolResult {
    const skillId = String(args.skillId || "");
    if (!skillId) return this.error("skillId is required");

    const skill = this.skillRegistry!.get(skillId);
    if (!skill) return this.error(`Skill "${skillId}" not found.`);

    const isCustom = this.skillStore!.exists(skillId);

    return this.ok(
      `Skill: ${skill.name} (${skill.id})\n` +
      `Type: ${isCustom ? "Custom" : "Built-in"}\n` +
      `Category: ${skill.category}\n` +
      `Tags: ${skill.tags.join(", ")}\n` +
      `Description: ${skill.description}\n\n` +
      `Parameters:\n${skill.parameters.map((p) => `  - ${p.name}: ${p.description}${p.required ? " (required)" : ""}${p.default ? ` [default: ${p.default}]` : ""}`).join("\n") || "  (none)"}\n\n` +
      `Steps (${skill.steps.length}):\n${skill.steps.map((s, i) => `  ${i + 1}. ${s.action}${s.target ? ` -> ${s.target}` : ""}${s.value ? ` = "${s.value.slice(0, 60)}"` : ""}${s.description ? ` (${s.description})` : ""}`).join("\n")}\n\n` +
      `Output: ${skill.outputHint || "unspecified"}\n\n` +
      `Full JSON:\n${JSON.stringify(skill, null, 2)}`,
      { isCustom, skillId: skill.id }
    );
  }

  private async handleWorkflow(args: Record<string, unknown>): Promise<ToolResult> {
    const steps = args.steps as WorkflowStep[];
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return this.error("steps array is required and must not be empty.");
    }

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);
    const screenshotDir = path.join(this.ctx.runtimeDir, "screenshots");

    const result = await executeWorkflow(page, steps, screenshotDir);

    return this.ok(formatWorkflowResult(result), {
      sessionId: session.id,
      ...result,
    });
  }

  private handleProfileList(): ToolResult {
    const profiles = this.sessionManager!.getProfileStore().list();
    if (profiles.length === 0) return this.ok("No saved browser profiles.");

    const lines = profiles.map(
      (p) =>
        `  ${p.id} - "${p.name}" (${p.cookies.length} cookies, updated ${new Date(p.updatedAt).toISOString()})`
    );
    return this.ok(`Saved profiles (${profiles.length}):\n${lines.join("\n")}`);
  }

  private handleProfileDelete(args: Record<string, unknown>): ToolResult {
    const profileId = args.profileId as string;
    if (!profileId) return this.error("profileId is required.");

    const deleted = this.sessionManager!.getProfileStore().delete(profileId);
    return deleted
      ? this.ok(`Profile ${profileId} deleted.`)
      : this.error(`Profile ${profileId} not found.`);
  }

  private handleNetworkCapture(args: Record<string, unknown>): ToolResult {
    const session = this.sessionManager!.getSession(args.sessionId as string);
    if (!session) return this.error("No active session.");

    const monitor = this.sessionManager!.getNetworkMonitor(session);
    const filter: NetworkFilter = {
      urlPattern: args.urlPattern as string,
      method: args.method as string,
      apiOnly: args.apiOnly as boolean,
      limit: (args.limit as number) ?? 50,
    };

    const requests = monitor.getRequests(filter);

    if (requests.length === 0) return this.ok("No matching network requests captured.");

    const lines = requests.map((r) => {
      const status = r.status ? ` [${r.status}]` : "";
      const type = r.isApi ? " (API)" : "";
      return `  ${r.method} ${r.url}${status}${type}`;
    });

    // Also show discovered APIs
    const apis = monitor.getDiscoveredApis();
    let apiSection = "";
    if (apis.length > 0) {
      apiSection =
        "\n\n--- Discovered APIs ---\n" +
        apis.map((a) => `  ${a.method} ${a.url} (${a.count}x)`).join("\n");
    }

    return this.ok(
      `Captured requests (${requests.length}):\n${lines.join("\n")}${apiSection}`,
      { count: requests.length, requests, discoveredApis: apis }
    );
  }

  private async handleEvaluate(args: Record<string, unknown>): Promise<ToolResult> {
    const expression = args.expression as string;
    if (!expression) return this.error("expression is required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const result = await page.evaluate(expression);
    const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);

    return this.ok(output ?? "(no return value)", { sessionId: session.id });
  }

  // ─── Tab Management Handlers ────────────────────────

  private async handleTabList(args: Record<string, unknown>): Promise<ToolResult> {
    const session = this.sessionManager!.getSession(args.sessionId as string);
    if (!session) return this.error("No active session.");

    const activePage = this.sessionManager!.getActivePage(session);
    const tabs = await listTabs(session.context, activePage);

    return this.ok(
      `Open tabs (${tabs.length}):\n${formatTabList(tabs)}`,
      { sessionId: session.id, tabCount: tabs.length, tabs }
    );
  }

  private async handleTabOpen(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const url = args.url as string | undefined;

    const { page, index } = await openTab(session.context, url);

    // Update session's active page reference
    session.page = page;
    session.lastActivity = Date.now();

    return this.ok(
      `New tab opened at index [${index}]${url ? `: ${url}` : " (blank)"}`,
      { sessionId: session.id, tabIndex: index }
    );
  }

  private async handleTabSwitch(args: Record<string, unknown>): Promise<ToolResult> {
    const session = this.sessionManager!.getSession(args.sessionId as string);
    if (!session) return this.error("No active session.");

    const page = switchTab(session.context, {
      index: args.index as number | undefined,
      urlPattern: args.urlPattern as string | undefined,
    });

    if (!page) {
      return this.error("No matching tab found.");
    }

    session.page = page;
    session.lastActivity = Date.now();

    const title = await page.title().catch(() => "");
    return this.ok(
      `Switched to tab: ${page.url()}${title ? ` ("${title}")` : ""}`,
      { sessionId: session.id, url: page.url() }
    );
  }

  private async handleTabClose(args: Record<string, unknown>): Promise<ToolResult> {
    const session = this.sessionManager!.getSession(args.sessionId as string);
    if (!session) return this.error("No active session.");

    const index = args.index as number;
    if (index === undefined) return this.error("Tab index is required.");

    const closed = await closeTab(session.context, index);
    if (!closed) return this.error(`Tab [${index}] not found or already closed.`);

    // Update active page to last remaining page
    const pages = session.context.pages();
    if (pages.length > 0) {
      session.page = pages[pages.length - 1];
    }

    return this.ok(`Tab [${index}] closed. ${pages.length} tab(s) remaining.`, {
      sessionId: session.id,
      remainingTabs: pages.length,
    });
  }

  // ─── Download Handler ─────────────────────────────────

  private async handleDownload(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);
    const downloadDir = path.join(this.ctx.runtimeDir, "downloads");

    const result = await captureDownload(
      page,
      {
        selector: args.selector as string | undefined,
        url: args.url as string | undefined,
      },
      downloadDir
    );

    if (!result.success) {
      return this.error(result.error ?? "Download failed.");
    }

    return this.ok(formatDownloadInfo(result.download!), {
      sessionId: session.id,
      download: result.download,
    });
  }

  // ─── Profile Create/Export Handlers ────────────────────

  private async handleProfileCreate(args: Record<string, unknown>): Promise<ToolResult> {
    const name = args.name as string;
    if (!name) return this.error("Profile name is required.");

    const session = this.sessionManager!.getSession(args.sessionId as string);
    if (!session) return this.error("No active session.");

    const { exportCookies: expCookies, exportLocalStorage: expLS } = await import("./profiles/cookie-jar.js");
    const cookies = await expCookies(session.context);
    const localStorage = await expLS(session.context);

    const profileStore = this.sessionManager!.getProfileStore();
    const profile = profileStore.create(name, { cookies, localStorage });

    return this.ok(
      `Profile "${name}" created (${cookies.length} cookies).`,
      { profileId: profile.id, cookieCount: cookies.length }
    );
  }

  private handleProfileExport(args: Record<string, unknown>): ToolResult {
    const profileId = args.profileId as string;
    if (!profileId) return this.error("profileId is required.");

    const profileStore = this.sessionManager!.getProfileStore();
    const profile = profileStore.get(profileId);
    if (!profile) return this.error(`Profile "${profileId}" not found.`);

    const exported = JSON.stringify({
      id: profile.id,
      name: profile.name,
      cookies: profile.cookies,
      localStorage: profile.localStorage,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    }, null, 2);

    return this.ok(
      `Profile "${profile.name}" exported:\n${exported}`,
      { profileId: profile.id, profile }
    );
  }

  // ─── Iframe Handlers ────────────────────────────────

  private async handleIframeList(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const iframes = await listIframes(page);

    return this.ok(
      `Iframes on page (${iframes.length}):\n${formatIframeList(iframes)}`,
      { sessionId: session.id, iframeCount: iframes.length, iframes }
    );
  }

  private async handleIframeInteract(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as string;
    if (!action) return this.error("Action is required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const target = {
      index: args.iframeIndex as number | undefined,
      name: args.iframeName as string | undefined,
      urlPattern: args.iframeUrl as string | undefined,
    };

    // Extract action: get iframe content
    if (action === "extract") {
      const result = await extractIframeContent(page, target);
      if (!result.success) return this.error(result.error ?? "Failed to extract iframe content.");
      return this.ok(
        `Iframe content (${result.url}):\n${result.content}`,
        { sessionId: session.id, url: result.url }
      );
    }

    // Interaction actions
    const result = await interactInIframe(page, target, action, {
      selector: args.selector as string | undefined,
      value: args.value as string | undefined,
    });

    if (!result.success) return this.error(result.error ?? "Iframe interaction failed.");
    return this.ok(`Iframe action "${action}" completed.`, { sessionId: session.id });
  }

  // ─── Monitor Handlers ─────────────────────────────────

  private async handleMonitorSnapshot(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);
    const selector = (args.selector as string) || "body";

    const snapshot = await takeMonitorSnapshot(page, selector);
    const key = `${session.id}:${selector}`;
    this.monitorBaselines.set(key, snapshot);

    return this.ok(
      `Baseline snapshot taken for "${selector}".\n` +
        `  Text length: ${snapshot.text.length} chars\n` +
        `  Children: ${snapshot.childCount}\n` +
        `Use web_monitor_check to detect changes.`,
      { sessionId: session.id, selector, snapshot: { textLength: snapshot.text.length, childCount: snapshot.childCount } }
    );
  }

  private async handleMonitorCheck(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);
    const selector = (args.selector as string) || "body";
    const timeout = (args.timeout as number) ?? 30_000;

    // Wait for specific element to appear
    if (args.waitForSelector) {
      const result = await waitForElement(page, args.waitForSelector as string, timeout);
      return this.ok(
        result.found
          ? `Element "${args.waitForSelector}" appeared after ${result.elapsed}ms.`
          : `Element "${args.waitForSelector}" not found within ${timeout}ms.`,
        { sessionId: session.id, found: result.found, elapsed: result.elapsed }
      );
    }

    // Wait for content to change
    if (args.waitForChange) {
      const key = `${session.id}:${selector}`;
      const baseline = this.monitorBaselines.get(key);
      if (!baseline) {
        return this.error("No baseline snapshot. Use web_monitor_snapshot first.");
      }

      const result = await waitForContentChange(page, selector, baseline.text, timeout);
      if (result.changed) {
        // Update baseline
        const newSnapshot = await takeMonitorSnapshot(page, selector);
        this.monitorBaselines.set(key, newSnapshot);
      }
      return this.ok(
        result.changed
          ? `Content changed after ${result.elapsed}ms.\nNew content preview: "${result.newText?.substring(0, 500)}"`
          : `No content change detected within ${timeout}ms.`,
        { sessionId: session.id, changed: result.changed, elapsed: result.elapsed }
      );
    }

    // Poll for changes against baseline
    const key = `${session.id}:${selector}`;
    const baseline = this.monitorBaselines.get(key);
    if (!baseline) {
      return this.error("No baseline snapshot. Use web_monitor_snapshot first.");
    }

    const changes = await pollForChanges(page, baseline, selector);
    if (changes.length > 0) {
      // Update baseline
      const newSnapshot = await takeMonitorSnapshot(page, selector);
      this.monitorBaselines.set(key, newSnapshot);
    }

    return this.ok(formatChanges(changes), {
      sessionId: session.id,
      changeCount: changes.length,
      changes,
    });
  }

  // ─── History Navigation Handler ─────────────────────

  private async handleGoBack(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);
    const direction = (args.direction as string) ?? "back";

    const result = direction === "forward"
      ? await goForward(page)
      : await goBack(page);

    if (!result.success) {
      return this.error(result.error ?? "Navigation failed.");
    }

    // Update snapshot after navigation
    const snapshot = await processPage(page);
    this.lastSnapshot.set(session.id, snapshot.elements);

    return this.ok(
      `Navigated ${direction} to: ${result.url}\nTitle: ${result.title}\n\n--- Interactive Elements (${snapshot.interactiveElements.length}) ---\n${this.formatElementList(snapshot.interactiveElements)}`,
      { sessionId: session.id, url: result.url, title: result.title }
    );
  }

  // ─── Page Search Handlers ─────────────────────────────

  private async handleSearchPage(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;
    if (!query) return this.error("query is required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const result = await searchInPage(page, query, {
      regex: args.regex as boolean | undefined,
      caseSensitive: args.caseSensitive as boolean | undefined,
      limit: args.limit as number | undefined,
    });

    return this.ok(formatSearchResult(result), {
      sessionId: session.id,
      totalMatches: result.totalMatches,
      matches: result.matches,
    });
  }

  private async handleFindText(args: Record<string, unknown>): Promise<ToolResult> {
    const text = args.text as string;
    if (!text) return this.error("text is required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const result = await scrollToText(page, text, {
      timeout: args.timeout as number | undefined,
    });

    if (!result.found) {
      return this.ok(`Text "${text}" not found after scrolling (${result.elapsed}ms).`, {
        sessionId: session.id,
        found: false,
        elapsed: result.elapsed,
      });
    }

    // Get updated snapshot after scrolling
    const snapshot = await processPage(page);
    this.lastSnapshot.set(session.id, snapshot.elements);

    return this.ok(
      `Text "${text}" found after scrolling (${result.elapsed}ms).\n\n--- Interactive Elements ---\n${this.formatElementList(snapshot.interactiveElements)}`,
      { sessionId: session.id, found: true, elapsed: result.elapsed }
    );
  }

  // ─── Element Finder Handlers ──────────────────────────

  private async handleFindElements(args: Record<string, unknown>): Promise<ToolResult> {
    const selector = args.selector as string;
    if (!selector) return this.error("selector is required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const elements = await findElements(page, selector, {
      limit: args.limit as number | undefined,
    });

    return this.ok(formatFoundElements(elements), {
      sessionId: session.id,
      count: elements.length,
      elements,
    });
  }

  private async handleReadContent(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const chunk = await readLongContent(page, {
      selector: args.selector as string | undefined,
      chunkSize: args.chunkSize as number | undefined,
      chunkIndex: args.chunkIndex as number | undefined,
    });

    return this.ok(formatContentChunk(chunk), {
      sessionId: session.id,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
    });
  }

  // ─── File Upload Handler ──────────────────────────────

  private async handleUploadFile(args: Record<string, unknown>): Promise<ToolResult> {
    const selector = args.selector as string;
    const filePath = args.filePath as string;
    if (!selector || !filePath) return this.error("selector and filePath are required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    await page.locator(selector).setInputFiles(filePath);

    return this.ok(`File uploaded: ${filePath}`, { sessionId: session.id });
  }

  // ─── Dropdown Handler ─────────────────────────────────

  private async handleDropdown(args: Record<string, unknown>): Promise<ToolResult> {
    const selector = args.selector as string;
    const action = args.action as string;
    if (!selector || !action) return this.error("selector and action are required.");

    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    if (action === "options") {
      const options = await page.evaluate((sel: string) => {
        const select = document.querySelector(sel) as HTMLSelectElement;
        if (!select) return [];
        return Array.from(select.options).map((opt, i) => ({
          index: i,
          value: opt.value,
          text: opt.text.trim(),
          selected: opt.selected,
        }));
      }, selector);

      if (options.length === 0) {
        return this.error(`No <select> element found at "${selector}" or no options.`);
      }

      const lines = options.map(
        (o) => `  [${o.index}] ${o.text} (value="${o.value}")${o.selected ? " *selected*" : ""}`
      );
      return this.ok(`Dropdown options (${options.length}):\n${lines.join("\n")}`, {
        sessionId: session.id,
        options,
      });
    }

    if (action === "select") {
      const value = args.value as string;
      if (!value) return this.error("value is required for select action.");

      // Try selecting by value first, then by label
      try {
        await page.selectOption(selector, value);
      } catch {
        await page.selectOption(selector, { label: value });
      }

      return this.ok(`Selected "${value}" in dropdown.`, { sessionId: session.id });
    }

    return this.error(`Unknown dropdown action: ${action}`);
  }

  // ─── Drag and Drop Handler ────────────────────────────

  private async handleDragDrop(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const page = this.sessionManager!.getActivePage(session);

    const source = {
      selector: args.sourceSelector as string | undefined,
      x: args.sourceX as number | undefined,
      y: args.sourceY as number | undefined,
    };
    const target = {
      selector: args.targetSelector as string | undefined,
      x: args.targetX as number | undefined,
      y: args.targetY as number | undefined,
    };

    if (!source.selector && source.x === undefined) {
      return this.error("Source required: provide sourceSelector or sourceX/sourceY.");
    }
    if (!target.selector && target.x === undefined) {
      return this.error("Target required: provide targetSelector or targetX/targetY.");
    }

    const result = await dragAndDrop(page, source, target);

    if (!result.success) {
      return this.error(result.error ?? "Drag and drop failed.");
    }

    return this.ok("Drag and drop completed.", { sessionId: session.id });
  }

  // ─── Dialog Handler ───────────────────────────────────

  private async handleDialog(args: Record<string, unknown>): Promise<ToolResult> {
    const session = await this.sessionManager!.getOrCreateSession();
    const action = (args.action as string) ?? "history";

    if (action === "configure") {
      // Reconfigure dialog handler with new settings
      const page = this.sessionManager!.getActivePage(session);
      const handler = setupDialogHandler(page, {
        alertAction: args.alertAction as "accept" | "dismiss" | undefined,
        confirmAction: args.confirmAction as "accept" | "dismiss" | undefined,
        promptAction: args.promptAction as "accept" | "dismiss" | undefined,
        promptText: args.promptText as string | undefined,
      });
      this.dialogHandlers.set(session.id, handler);

      return this.ok("Dialog auto-response configured.", { sessionId: session.id });
    }

    // Show dialog history
    const handler = this.dialogHandlers.get(session.id);
    if (!handler) {
      return this.ok("No dialog handler active. Create a session first.", { sessionId: session.id });
    }

    const dialogs = handler.getDialogs();
    return this.ok(formatDialogs(dialogs), {
      sessionId: session.id,
      dialogCount: dialogs.length,
      dialogs,
    });
  }

  // ─── Done Handler ─────────────────────────────────────

  private handleDone(args: Record<string, unknown>): ToolResult {
    const result = args.result as string;
    if (!result) return this.error("result is required.");

    const data = args.data as Record<string, unknown> | undefined;

    return this.ok(
      `Task complete: ${result}`,
      { taskResult: result, data: data ?? {} }
    );
  }

  // ─── Shared Helpers ──────────────────────────────────

  /** Format a list of DOM elements as numbered lines for LLM output. */
  private formatElementList(elements: import("./types.js").DOMElement[]): string {
    return elements
      .map((el) => {
        const attrs = Object.entries(el.attributes)
          .filter(([k]) => ["type", "name", "href", "placeholder", "role", "aria-label", "value"].includes(k))
          .map(([k, v]) => `${k}="${v.substring(0, 60)}"`)
          .join(" ");
        const text = el.text ? ` "${el.text.substring(0, 80)}"` : "";
        return `[${el.index}] <${el.tag}${attrs ? " " + attrs : ""}>${text}`;
      })
      .join("\n");
  }
}
