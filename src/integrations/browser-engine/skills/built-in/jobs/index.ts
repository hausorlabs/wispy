/**
 * Jobs skills -- LinkedIn Jobs, Indeed, Greenhouse, Lever.
 */

import type { SkillDefinition } from "../../types.js";

export const jobsSkills: SkillDefinition[] = [
  {
    id: "linkedin-jobs",
    name: "LinkedIn Job Search",
    description: "Search LinkedIn for job listings",
    category: "jobs",
    tags: ["linkedin", "jobs", "career"],
    parameters: [
      { name: "query", description: "Job title or keywords", required: true },
      { name: "location", description: "Location", required: false, default: "" },
    ],
    steps: [
      { action: "navigate", value: "https://www.linkedin.com/jobs/search/?keywords={{query}}&location={{location}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".jobs-search__results-list li, .scaffold-layout__list-container li", timeout: 15000 },
        extract: {
          name: "jobs",
          selector: ".jobs-search__results-list li, .scaffold-layout__list-container li",
          fields: {
            title: { selector: ".base-search-card__title, .job-card-list__title", transform: "text" },
            company: { selector: ".base-search-card__subtitle a, .job-card-container__primary-description", transform: "text" },
            location: { selector: ".job-search-card__location, .job-card-container__metadata-item", transform: "text" },
            url: { selector: "a.base-card__full-link, a.job-card-list__title", attribute: "href" },
            posted: { selector: "time", transform: "text" },
          },
          multiple: true,
          limit: 25,
        },
      },
    ],
    outputHint: "Array of {title, company, location, url, posted}",
  },
  {
    id: "indeed-search",
    name: "Indeed Job Search",
    description: "Search Indeed for job listings",
    category: "jobs",
    tags: ["indeed", "jobs", "career"],
    parameters: [
      { name: "query", description: "Job title or keywords", required: true },
      { name: "location", description: "Location", required: false, default: "" },
    ],
    steps: [
      { action: "navigate", value: "https://www.indeed.com/jobs?q={{query}}&l={{location}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".job_seen_beacon, .jobsearch-ResultsList" },
        extract: {
          name: "jobs",
          selector: ".job_seen_beacon, .result",
          fields: {
            title: { selector: ".jobTitle a, h2.jobTitle span", transform: "text" },
            company: { selector: ".companyName, [data-testid='company-name']", transform: "text" },
            location: { selector: ".companyLocation, [data-testid='text-location']", transform: "text" },
            salary: { selector: ".salary-snippet-container, .metadata.salary-snippet-container", transform: "text" },
            snippet: { selector: ".job-snippet, .underShelfFooter", transform: "text" },
            url: { selector: ".jobTitle a, h2.jobTitle a", attribute: "href", transform: "url" },
          },
          multiple: true,
          limit: 20,
        },
      },
    ],
    outputHint: "Array of {title, company, location, salary, snippet, url}",
  },
  {
    id: "greenhouse-jobs",
    name: "Greenhouse Job Board",
    description: "Extract jobs from a company's Greenhouse job board",
    category: "jobs",
    tags: ["greenhouse", "jobs", "ats"],
    parameters: [
      { name: "company", description: "Company slug on Greenhouse (e.g., 'anthropic')", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://boards.greenhouse.io/{{company}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".opening, .job-post" },
        extract: {
          name: "jobs",
          selector: ".opening, .job-post",
          fields: {
            title: { selector: "a", transform: "text" },
            url: { selector: "a", attribute: "href", transform: "url" },
            location: { selector: ".location", transform: "text" },
            department: { selector: ".department", transform: "text" },
          },
          multiple: true,
          limit: 50,
        },
      },
    ],
    outputHint: "Array of {title, url, location, department}",
  },
  {
    id: "lever-jobs",
    name: "Lever Job Board",
    description: "Extract jobs from a company's Lever job board",
    category: "jobs",
    tags: ["lever", "jobs", "ats"],
    parameters: [
      { name: "company", description: "Company slug on Lever (e.g., 'openai')", required: true },
    ],
    steps: [
      { action: "navigate", value: "https://jobs.lever.co/{{company}}" },
      {
        action: "extract",
        waitFor: { type: "selector", value: ".posting" },
        extract: {
          name: "jobs",
          selector: ".posting",
          fields: {
            title: { selector: ".posting-title h5, a[data-qa='posting-name']", transform: "text" },
            url: { selector: "a.posting-title, a[data-qa='posting-name']", attribute: "href" },
            location: { selector: ".posting-categories .location, .sort-by-location", transform: "text" },
            department: { selector: ".posting-categories .department, .sort-by-team", transform: "text" },
            commitment: { selector: ".posting-categories .commitment, .sort-by-commitment", transform: "text" },
          },
          multiple: true,
          limit: 50,
        },
      },
    ],
    outputHint: "Array of {title, url, location, department, commitment}",
  },
];
