/**
 * Social skills -- Twitter/X, LinkedIn, Reddit, Instagram, HackerNews.
 */

import type { SkillDefinition } from "../../types.js";

export const socialSkills: SkillDefinition[] = [
  {
    id: "twitter-profile",
    name: "Twitter/X Profile",
    description: "View a Twitter/X user profile and extract bio, follower count, recent tweets",
    category: "social",
    tags: ["twitter", "x", "profile", "social"],
    parameters: [
      { name: "username", description: "Twitter username (without @)", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://x.com/{{username}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-testid='UserName']", timeout: 15000 },
        extract: {
          name: "profile",
          selector: "[data-testid='primaryColumn']",
          fields: {
            name: { selector: "[data-testid='UserName'] span:first-child", transform: "text" },
            bio: { selector: "[data-testid='UserDescription']", transform: "text" },
            location: { selector: "[data-testid='UserLocation']", transform: "text" },
            website: { selector: "[data-testid='UserUrl'] a", attribute: "href" },
            joined: { selector: "[data-testid='UserJoinDate']", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{name, bio, location, website, joined}",
  },
  {
    id: "twitter-search",
    name: "Twitter/X Search",
    description: "Search Twitter/X for tweets matching a query",
    category: "social",
    tags: ["twitter", "x", "search", "tweets"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://x.com/search?q={{query}}&src=typed_query&f=top" },
      {
        action: "extract",
        waitFor: { type: "selector", value: "[data-testid='tweet']", timeout: 15000 },
        extract: {
          name: "tweets",
          selector: "[data-testid='tweet']",
          fields: {
            author: { selector: "[data-testid='User-Name'] a:first-child span", transform: "text" },
            handle: { selector: "[data-testid='User-Name'] a:nth-child(2)", transform: "text" },
            text: { selector: "[data-testid='tweetText']", transform: "text" },
            time: { selector: "time", attribute: "datetime" },
          },
          multiple: true,
          limit: 15,
        },
      },
    ],
    outputHint: "Array of {author, handle, text, time}",
  },
  {
    id: "linkedin-profile",
    name: "LinkedIn Profile",
    description: "View a LinkedIn profile page (requires login session)",
    category: "social",
    tags: ["linkedin", "profile", "professional"],
    parameters: [
      { name: "url", description: "LinkedIn profile URL", required: true },
    ],
    steps: [
      { action: "navigate", value: "{{url}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".pv-top-card", timeout: 15000 },
        extract: {
          name: "profile",
          selector: ".pv-top-card",
          fields: {
            name: { selector: "h1", transform: "text" },
            headline: { selector: ".text-body-medium", transform: "text" },
            location: { selector: ".text-body-small.inline", transform: "text" },
          },
          multiple: false,
        },
      },
    ],
    outputHint: "{name, headline, location}",
  },
  {
    id: "reddit-subreddit",
    name: "Reddit Subreddit",
    description: "Browse a subreddit and extract top posts",
    category: "social",
    tags: ["reddit", "subreddit", "posts"],
    parameters: [
      { name: "subreddit", description: "Subreddit name (without r/)", required: true },
      { name: "sort", description: "Sort order: hot, new, top", required: false, default: "hot" },
    ],
    steps: [
      { action: "navigate", value: "https://old.reddit.com/r/{{subreddit}}/{{sort}}/" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".thing", timeout: 10000 },
        extract: {
          name: "posts",
          selector: ".thing.link",
          fields: {
            title: { selector: "a.title", transform: "text" },
            url: { selector: "a.title", attribute: "href", transform: "url" },
            score: { selector: ".score.unvoted", transform: "text" },
            author: { selector: ".author", transform: "text" },
            comments: { selector: ".comments", transform: "text" },
            time: { selector: "time", attribute: "title" },
          },
          multiple: true,
          limit: 25,
        },
      },
    ],
    outputHint: "Array of {title, url, score, author, comments, time}",
  },
  {
    id: "reddit-search",
    name: "Reddit Search",
    description: "Search Reddit for posts matching a query",
    category: "social",
    tags: ["reddit", "search"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://old.reddit.com/search?q={{query}}&sort=relevance&t=all" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".thing" },
        extract: {
          name: "results",
          selector: ".thing.link",
          fields: {
            title: { selector: "a.title", transform: "text" },
            url: { selector: "a.title", attribute: "href", transform: "url" },
            subreddit: { selector: ".subreddit", transform: "text" },
            score: { selector: ".score.unvoted", transform: "text" },
            author: { selector: ".author", transform: "text" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, url, subreddit, score, author}",
  },
  {
    id: "hackernews-front",
    name: "Hacker News Front Page",
    description: "Get the current Hacker News front page stories",
    category: "social",
    tags: ["hackernews", "hn", "tech", "news"],
    parameters: [],
    steps: [
      { action: "navigate", value: "https://news.ycombinator.com" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".athing" },
        extract: {
          name: "stories",
          selector: ".athing",
          fields: {
            rank: { selector: ".rank", transform: "text" },
            title: { selector: ".titleline a", transform: "text" },
            url: { selector: ".titleline a", attribute: "href" },
            site: { selector: ".sitestr", transform: "text" },
          },
          multiple: true,
          limit: 30,
        },
      },
    ],
    outputHint: "Array of {rank, title, url, site}",
  },
  {
    id: "hackernews-search",
    name: "Hacker News Search",
    description: "Search Hacker News via Algolia for stories and comments",
    category: "social",
    tags: ["hackernews", "hn", "search"],
    parameters: [
      { name: "query", description: "Search query", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://hn.algolia.com/?q={{query}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".Story", timeout: 10000 },
        extract: {
          name: "results",
          selector: ".Story",
          fields: {
            title: { selector: ".Story_title a:first-child", transform: "text" },
            url: { selector: ".Story_title a:first-child", attribute: "href" },
            points: { selector: ".Story_meta span:first-child", transform: "text" },
            author: { selector: ".Story_meta a:first-child", transform: "text" },
            time: { selector: ".Story_meta span:nth-child(2)", transform: "text" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, url, points, author, time}",
  },
];
