/**
 * News skills -- article extraction, Reuters, TechCrunch, Medium, Wikipedia.
 */

import type { SkillDefinition } from "../../types.js";

export const newsSkills: SkillDefinition[] = [
  {
    id: "article-extract",
    name: "Article Extractor",
    description: "Extract article content from any news/blog URL (title, author, date, body)",
    category: "news",
    tags: ["article", "news", "blog", "content"],
    parameters: [
      { name: "url", description: "Article URL", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "networkidle" },
        extract: {
          name: "article",
          selector: "article, [role='article'], .post-content, .article-content, main, .entry-content, #content",
          fields: {
            title: { selector: "h1", transform: "text" },
            author: { selector: "[rel='author'], .author, .byline, [class*='author']", transform: "text" },
            date: { selector: "time, [class*='date'], [class*='time'], .published", transform: "text" },
            body: { transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{title, author, date, body}",
  },
  {
    id: "google-news",
    name: "Google News Search",
    description: "Search Google News for recent articles",
    category: "news",
    tags: ["google", "news", "current events"],
    parameters: [
      { name: "query", description: "News search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://www.google.com/search?q={{query}}&tbm=nws" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "#search" },
        extract: {
          name: "articles",
          selector: "#search .SoaBEf, #search [data-hveid]",
          fields: {
            title: { selector: "[role='heading'], .n0jPhd, .mCBkyc", transform: "text" },
            source: { selector: ".NUnG9d, .CEMjEf span", transform: "text" },
            time: { selector: ".OSrXXb span, .WG9SHc span", transform: "text" },
            snippet: { selector: ".GI74Re, .Y3v8qd", transform: "text" },
            url: { selector: "a", attribute: "href" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, source, time, snippet, url}",
  },
  {
    id: "techcrunch-latest",
    name: "TechCrunch Latest",
    description: "Get latest articles from TechCrunch",
    category: "news",
    tags: ["techcrunch", "tech", "startups"],
    parameters: [],
    steps: [
      { action: "navigate", value: "https://techcrunch.com" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "article, .post-block" },
        extract: {
          name: "articles",
          selector: "article, .post-block",
          fields: {
            title: { selector: "h2 a, h3 a, .post-block__title a", transform: "text" },
            url: { selector: "h2 a, h3 a, .post-block__title a", attribute: "href" },
            author: { selector: ".river-byline__authors a, [class*='author']", transform: "text" },
            time: { selector: "time", transform: "text" },
            excerpt: { selector: ".post-block__content, .excerpt", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, url, author, time, excerpt}",
  },
  {
    id: "medium-article",
    name: "Medium Article",
    description: "Read and extract a Medium article",
    category: "news",
    tags: ["medium", "blog", "article"],
    parameters: [
      { name: "url", description: "Medium article URL", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "networkidle" },
        extract: {
          name: "article",
          selector: "article",
          fields: {
            title: { selector: "h1", transform: "text" },
            subtitle: { selector: "h2:first-of-type", transform: "text" },
            author: { selector: "[data-testid='authorName'], a[rel='author']", transform: "text" },
            date: { selector: "[data-testid='storyPublishDate'], time", transform: "text" },
            body: { selector: "section", transform: "text" },
            claps: { selector: "[data-testid='clapCount']", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{title, subtitle, author, date, body, claps}",
  },
  {
    id: "wikipedia-article",
    name: "Wikipedia Article",
    description: "Extract a Wikipedia article's summary, infobox, and sections",
    category: "news",
    tags: ["wikipedia", "encyclopedia", "reference"],
    parameters: [
      { name: "topic", description: "Wikipedia article title or search term", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://en.wikipedia.org/wiki/{{topic}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "#firstHeading" },
        extract: {
          name: "article",
          selector: "#content",
          fields: {
            title: { selector: "#firstHeading", transform: "text" },
            summary: { selector: ".mw-parser-output > p:not(.mw-empty-elt)", transform: "text" },
            categories: { selector: "#mw-normal-catlinks li a", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{title, summary, categories}",
  },
  {
    id: "reuters-latest",
    name: "Reuters Latest News",
    description: "Get latest news from Reuters",
    category: "news",
    tags: ["reuters", "news", "world"],
    parameters: [
      { name: "section", description: "Section: world, business, technology, markets", required: false, default: "world" },
    ],
    steps: [
      { action: "navigate", value: "https://www.reuters.com/{{section}}/" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-testid='MediaStoryCard'], article" },
        extract: {
          name: "articles",
          selector: "[data-testid='MediaStoryCard'], article",
          fields: {
            title: { selector: "h3, [data-testid='Heading']", transform: "text" },
            url: { selector: "a", attribute: "href", transform: "url" },
            time: { selector: "time", transform: "text" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {title, url, time}",
  },
];
