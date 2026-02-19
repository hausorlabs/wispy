/**
 * Developer skills -- GitHub, npm, PyPI, StackOverflow, docs.
 */

import type { SkillDefinition } from "../../types.js";

export const developerSkills: SkillDefinition[] = [
  {
    id: "github-repo",
    name: "GitHub Repository",
    description: "Extract GitHub repo details: description, stars, forks, language, README preview",
    category: "developer",
    tags: ["github", "repo", "code", "open-source"],
    parameters: [
      { name: "owner", description: "Repository owner", required: true },
      { name: "repo", description: "Repository name", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://github.com/{{owner}}/{{repo}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[itemprop='name']" },
        extract: {
          name: "repository",
          selector: "#repository-container-header, .Layout-main, main",
          fields: {
            name: { selector: "[itemprop='name'] a, strong[itemprop='name']", transform: "text" },
            description: { selector: ".f4.my-3, [itemprop='about'], .BorderGrid-cell p", transform: "text" },
            stars: { selector: "#repo-stars-counter-star, .Counter[aria-label*='star']", transform: "text" },
            forks: { selector: "#repo-network-counter, .Counter[aria-label*='fork']", transform: "text" },
            language: { selector: "[itemprop='programmingLanguage'], .d-inline .color-fg-default", transform: "text" },
            topics: { selector: ".topic-tag", transform: "text" },
            license: { selector: "[data-analytics-event*='license'], .octicon-law + span", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{name, description, stars, forks, language, topics, license}",
  },
  {
    id: "github-issues",
    name: "GitHub Issues",
    description: "List open issues for a GitHub repository",
    category: "developer",
    tags: ["github", "issues", "bugs"],
    parameters: [
      { name: "owner", description: "Repository owner", required: true },
      { name: "repo", description: "Repository name", required: true },
      { name: "state", description: "Issue state: open or closed", required: false, default: "open" },
    ],
    steps: [
      { action: "navigate", value: "https://github.com/{{owner}}/{{repo}}/issues?q=is%3Aissue+is%3A{{state}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".js-issue-row, [data-id]" },
        extract: {
          name: "issues",
          selector: ".js-issue-row, [data-id]",
          fields: {
            title: { selector: ".Link--primary, a[data-hovercard-type='issue']", transform: "text" },
            url: { selector: ".Link--primary, a[data-hovercard-type='issue']", attribute: "href", transform: "url" },
            labels: { selector: ".lh-default a.IssueLabel", transform: "text" },
            author: { selector: ".opened-by a, .Link--muted", transform: "text" },
            comments: { selector: ".Link--muted.v-align-middle", transform: "text" },
            time: { selector: "relative-time", attribute: "datetime" },
          },
          multiple: true,
          limit: 25,
        },
      },
    ],
    outputHint: "Array of {title, url, labels, author, comments, time}",
  },
  {
    id: "github-trending",
    name: "GitHub Trending",
    description: "Get trending repositories on GitHub",
    category: "developer",
    tags: ["github", "trending", "popular"],
    parameters: [
      { name: "language", description: "Programming language filter (e.g., python, javascript)", required: false, default: "" },
      { name: "since", description: "Time range: daily, weekly, monthly", required: false, default: "daily" },
    ],
    steps: [
      { action: "navigate", value: "https://github.com/trending/{{language}}?since={{since}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "article.Box-row" },
        extract: {
          name: "repos",
          selector: "article.Box-row",
          fields: {
            name: { selector: "h2 a", transform: "text" },
            url: { selector: "h2 a", attribute: "href", transform: "url" },
            description: { selector: "p", transform: "text" },
            language: { selector: "[itemprop='programmingLanguage']", transform: "text" },
            stars: { selector: ".Link--muted.d-inline-block.mr-3:first-of-type", transform: "text" },
            todayStars: { selector: ".float-sm-right", transform: "text" },
          },
          multiple: true,
          limit: 25,
        },
      },
    ],
    outputHint: "Array of {name, url, description, language, stars, todayStars}",
  },
  {
    id: "npm-package",
    name: "npm Package Info",
    description: "Get npm package details: version, downloads, dependencies",
    category: "developer",
    tags: ["npm", "package", "node", "javascript"],
    parameters: [
      { name: "package", description: "npm package name", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.npmjs.com/package/{{package}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "#top" },
        extract: {
          name: "package",
          selector: "#top, main",
          fields: {
            name: { selector: "h1 span, #package-title span", transform: "text" },
            version: { selector: "[class*='version']", transform: "text" },
            description: { selector: "p[class*='package-description']", transform: "text" },
            weeklyDownloads: { selector: "[class*='downloads'] p, [class*='weekly-downloads']", transform: "text" },
            license: { selector: "[class*='license']", transform: "text" },
            lastPublish: { selector: "time", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{name, version, description, weeklyDownloads, license, lastPublish}",
  },
  {
    id: "pypi-package",
    name: "PyPI Package Info",
    description: "Get Python package details from PyPI",
    category: "developer",
    tags: ["pypi", "python", "package"],
    parameters: [
      { name: "package", description: "PyPI package name", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://pypi.org/project/{{package}}/" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".package-header" },
        extract: {
          name: "package",
          selector: ".package-header, .project-description",
          fields: {
            name: { selector: "h1.package-header__name", transform: "text" },
            version: { selector: ".package-header__name", transform: "text" },
            description: { selector: ".package-description__summary", transform: "text" },
            author: { selector: "[data-controller='author'] a", transform: "text" },
            license: { selector: ".sidebar-section .vertical-tabs__tab:first-child", transform: "text" },
            python_requires: { selector: "[data-controller='requires-python']", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{name, version, description, author, license, python_requires}",
  },
  {
    id: "stackoverflow-search",
    name: "StackOverflow Search",
    description: "Search StackOverflow for programming questions and answers",
    category: "developer",
    tags: ["stackoverflow", "qa", "programming"],
    parameters: [
      { name: "query", description: "Programming question or error message", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://stackoverflow.com/search?q={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".question-summary, .s-post-summary" },
        extract: {
          name: "questions",
          selector: ".question-summary, .s-post-summary",
          fields: {
            title: { selector: "h3 a, .s-post-summary--content-title a", transform: "text" },
            url: { selector: "h3 a, .s-post-summary--content-title a", attribute: "href", transform: "url" },
            votes: { selector: ".vote-count-post strong, .s-post-summary--stats-item:first-child .s-post-summary--stats-item-number", transform: "text" },
            answers: { selector: ".status strong, .s-post-summary--stats-item:nth-child(2) .s-post-summary--stats-item-number", transform: "text" },
            tags: { selector: ".post-tag, .s-tag", transform: "text" },
            excerpt: { selector: ".excerpt, .s-post-summary--content-excerpt", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, url, votes, answers, tags, excerpt}",
  },
  {
    id: "mdn-docs",
    name: "MDN Web Docs",
    description: "Search and extract MDN documentation for web technologies",
    category: "developer",
    tags: ["mdn", "docs", "web", "javascript", "css", "html"],
    parameters: [
      { name: "query", description: "API or topic to search", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://developer.mozilla.org/en-US/search?q={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".search-results" },
        extract: {
          name: "results",
          selector: ".search-results article",
          fields: {
            title: { selector: "h3 a", transform: "text" },
            url: { selector: "h3 a", attribute: "href", transform: "url" },
            excerpt: { selector: "p", transform: "text" },
          },
          multiple: true,
          limit: 10,
        },
      },
    ],
    outputHint: "Array of {title, url, excerpt}",
  },
];
