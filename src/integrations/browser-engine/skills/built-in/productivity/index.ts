/**
 * Productivity skills -- Google Docs, Notion, Airtable, Calendar Events.
 */

import type { SkillDefinition } from "../../types.js";

export const productivitySkills: SkillDefinition[] = [
  {
    id: "google-docs-read",
    name: "Google Docs Reader",
    description: "Read a published Google Doc and extract its content",
    category: "productivity",
    tags: ["google", "docs", "document"],
    parameters: [
      { name: "url", description: "Google Docs published URL", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "networkidle" },
        extract: {
          name: "document",
          selector: ".doc-content, #contents, .kix-appview-editor, main",
          fields: {
            title: { selector: ".doc-title, .kix-document-title, h1", transform: "text" },
            body: { transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{title, body}",
  },
  {
    id: "notion-public-page",
    name: "Notion Public Page",
    description: "Read a public Notion page",
    category: "productivity",
    tags: ["notion", "page", "wiki"],
    parameters: [
      { name: "url", description: "Notion public page URL", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".notion-page-content, [class*='notion-page']", timeout: 15000 },
        extract: {
          name: "page",
          selector: ".notion-page-content, [class*='notion-page'], main",
          fields: {
            title: { selector: "h1, .notion-title, [placeholder='Untitled']", transform: "text" },
            body: { transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{title, body}",
  },
  {
    id: "airtable-view",
    name: "Airtable Public View",
    description: "Read a public Airtable view/table",
    category: "productivity",
    tags: ["airtable", "spreadsheet", "database"],
    parameters: [
      { name: "url", description: "Airtable shared view URL", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".sharedViewHeaderTitle, [class*='HeaderRow']", timeout: 15000 },
        extract: {
          name: "table",
          selector: "[class*='Grid'], [class*='table'], .dataRow",
          fields: {
            content: { transform: "text" },
          },
          multiple: true,
          limit: 50,
        },
      },
    ],
    outputHint: "Array of row data",
  },
  {
    id: "calendar-events",
    name: "Google Calendar Events (Public)",
    description: "View events from a public Google Calendar",
    category: "productivity",
    tags: ["calendar", "events", "schedule", "google"],
    parameters: [
      { name: "calendar_id", description: "Public Google Calendar ID (email format)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://calendar.google.com/calendar/embed?src={{calendar_id}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-eventid], .event-summary", timeout: 15000 },
        extract: {
          name: "events",
          selector: "[data-eventid], .event-summary, [class*='event']",
          fields: {
            title: { selector: ".event-summary, [class*='title']", transform: "text" },
            time: { selector: "[class*='time'], [class*='when']", transform: "text" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, time}",
  },
];
