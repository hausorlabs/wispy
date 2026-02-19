/**
 * Search skills -- Google, Bing, DuckDuckGo, YouTube, Google Scholar.
 */

import type { SkillDefinition } from "../../types.js";

export const searchSkills: SkillDefinition[] = [
  {
    id: "google-search",
    name: "Google Search",
    description: "Search Google and extract top results with titles, URLs, and snippets",
    category: "search",
    tags: ["google", "search", "web"],
    parameters: [
      { name: "query", description: "Search query", required: true },
      { name: "num_results", description: "Number of results to extract", required: false, default: "10" },
    ],
    steps: [
      { action: "navigate", value: "https://www.google.com/search?q={{query}}&num={{num_results}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "#search" },
        extract: {
          name: "results",
          selector: "#search .g",
          fields: {
            title: { selector: "h3", transform: "text" },
            url: { selector: "a", attribute: "href", transform: "url" },
            snippet: { selector: ".VwiC3b, [data-sncf], .IsZvec", transform: "text" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, url, snippet}",
  },
  {
    id: "bing-search",
    name: "Bing Search",
    description: "Search Bing and extract results",
    category: "search",
    tags: ["bing", "search", "web"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.bing.com/search?q={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "#b_results" },
        extract: {
          name: "results",
          selector: "#b_results .b_algo",
          fields: {
            title: { selector: "h2 a", transform: "text" },
            url: { selector: "h2 a", attribute: "href" },
            snippet: { selector: ".b_caption p", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, url, snippet}",
  },
  {
    id: "duckduckgo-search",
    name: "DuckDuckGo Search",
    description: "Search DuckDuckGo for privacy-focused results",
    category: "search",
    tags: ["duckduckgo", "ddg", "search", "privacy"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://duckduckgo.com/?q={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-testid='result']", timeout: 10000 },
        extract: {
          name: "results",
          selector: "[data-testid='result']",
          fields: {
            title: { selector: "[data-testid='result-title-a']", transform: "text" },
            url: { selector: "[data-testid='result-title-a']", attribute: "href" },
            snippet: { selector: "[data-testid='result-snippet']", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, url, snippet}",
  },
  {
    id: "youtube-search",
    name: "YouTube Search",
    description: "Search YouTube and extract video results with titles, channels, and view counts",
    category: "search",
    tags: ["youtube", "video", "search"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.youtube.com/results?search_query={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "ytd-video-renderer", timeout: 10000 },
        extract: {
          name: "results",
          selector: "ytd-video-renderer",
          fields: {
            title: { selector: "#video-title", transform: "text" },
            url: { selector: "#video-title", attribute: "href", transform: "url" },
            channel: { selector: "#channel-name a, ytd-channel-name a", transform: "text" },
            views: { selector: "#metadata-line span:first-child", transform: "text" },
            uploaded: { selector: "#metadata-line span:nth-child(2)", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, url, channel, views, uploaded}",
  },
  {
    id: "google-scholar",
    name: "Google Scholar Search",
    description: "Search Google Scholar for academic papers and citations",
    category: "search",
    tags: ["scholar", "academic", "papers", "research"],
    parameters: [
      { name: "query", description: "Academic search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://scholar.google.com/scholar?q={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".gs_r" },
        extract: {
          name: "results",
          selector: ".gs_r .gs_ri",
          fields: {
            title: { selector: "h3 a", transform: "text" },
            url: { selector: "h3 a", attribute: "href" },
            authors: { selector: ".gs_a", transform: "text" },
            snippet: { selector: ".gs_rs", transform: "text" },
            citations: { selector: ".gs_fl a:first-child", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, url, authors, snippet, citations}",
  },
];
