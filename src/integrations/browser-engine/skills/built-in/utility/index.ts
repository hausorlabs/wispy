/**
 * Utility skills -- screenshot, PDF, form fill, page monitor.
 */

import type { SkillDefinition } from "../../types.js";

export const utilitySkills: SkillDefinition[] = [
  {
    id: "screenshot-page",
    name: "Full Page Screenshot",
    description: "Take a full-page screenshot of a URL",
    category: "utility",
    tags: ["screenshot", "capture", "image"],
    parameters: [
      { name: "url", description: "URL to screenshot", required: true },
      { name: "fullpage", description: "Full page capture (true/false)", required: false, default: "true" },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      { action: "wait", value: "2000" },
      { action: "screenshot", description: "Capture page screenshot" },
    ],
    outputHint: "Screenshot saved to file",
  },
  {
    id: "pdf-save",
    name: "Save Page as PDF",
    description: "Save a web page as a PDF document",
    category: "utility",
    tags: ["pdf", "save", "document", "export"],
    parameters: [
      { name: "url", description: "URL to save as PDF", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      { action: "wait", value: "3000" },
      { action: "screenshot", description: "Capture as PDF" },
    ],
    outputHint: "PDF saved to file",
  },
  {
    id: "form-fill-submit",
    name: "Fill and Submit Form",
    description: "Navigate to a URL and fill a form with provided field values",
    category: "utility",
    tags: ["form", "fill", "submit", "automation"],
    parameters: [
      { name: "url", description: "URL with the form", required: true },
      { name: "fields", description: "JSON object of field selectors to values", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "form" },
        extract: {
          name: "form_info",
          selector: "form",
          fields: {
            action: { attribute: "action" },
            method: { attribute: "method" },
            inputs: { selector: "input, select, textarea", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "Form fields detected for filling",
  },
  {
    id: "page-monitor",
    name: "Page Content Monitor",
    description: "Check a page and extract specific content for monitoring changes",
    category: "utility",
    tags: ["monitor", "watch", "changes", "alert"],
    parameters: [
      { name: "url", description: "URL to monitor", required: true },
      { name: "selector", description: "CSS selector of content to monitor", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "{{selector}}" },
        extract: {
          name: "content",
          selector: "{{selector}}",
          fields: {
            text: { transform: "text" },
            html: { transform: "html" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{text, html} of monitored element",
  },
  {
    id: "wayback-machine",
    name: "Wayback Machine Lookup",
    description: "Check archived versions of a URL on the Wayback Machine",
    category: "utility",
    tags: ["archive", "wayback", "history", "cache"],
    parameters: [
      { name: "url", description: "URL to look up in the Wayback Machine", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://web.archive.org/web/*/{{url}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "#sparkline, .calendar-day" },
        extract: {
          name: "archive",
          selector: "#wb-calendar, main",
          fields: {
            info: { transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "Archive availability info",
  },
  {
    id: "whois-lookup",
    name: "WHOIS Domain Lookup",
    description: "Look up domain registration information via who.is",
    category: "utility",
    tags: ["whois", "domain", "dns", "registration"],
    parameters: [
      { name: "domain", description: "Domain name to look up", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://who.is/whois/{{domain}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".queryResponseBodyKey, .whois-data" },
        extract: {
          name: "whois",
          selector: ".queryResponseBodyRow, .whois-data, .df-row",
          fields: {
            key: { selector: ".queryResponseBodyKey, dt", transform: "text" },
            value: { selector: ".queryResponseBodyValue, dd", transform: "text" },
          },
          multiple: true,
          limit: 30,
        },
      },
    ],
    outputHint: "Array of {key, value} WHOIS records",
  },
];
