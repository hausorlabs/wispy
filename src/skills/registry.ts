/**
 * skills.sh Registry Client
 *
 * Integrates with https://skills.sh - the largest agent skills directory
 * with 67,000+ community skills. Skills are SKILL.md files hosted on GitHub
 * that define tools, prompts, and capabilities an agent can use.
 *
 * Install flow: skills.sh -> GitHub raw -> parse SKILL.md -> save to soulDir/skills/
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createLogger } from "../infra/logger.js";
import { loadSkills, type SkillManifest } from "./loader.js";

const log = createLogger("skills-registry");

const SKILLS_SH_API = "https://skills.sh/api";
const SKILLS_SH_BASE = "https://skills.sh";
const GITHUB_RAW = "https://raw.githubusercontent.com";

export interface SkillSearchResult {
  name: string;
  owner: string;
  repo: string;
  description: string;
  stars: number;
  tools: number;
  url: string;
}

export interface InstalledSkill {
  name: string;
  source: string;
  version: string;
  toolCount: number;
  installedAt: string;
}

/**
 * Search the skills.sh registry for agent skills.
 */
export async function searchSkills(
  query: string,
  limit: number = 10
): Promise<SkillSearchResult[]> {
  try {
    // Try the skills.sh search API
    const res = await fetch(
      `${SKILLS_SH_API}/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );

    if (res.ok) {
      const data = (await res.json()) as { results?: SkillSearchResult[] };
      return data.results ?? [];
    }

    // Fallback: search GitHub for SKILL.md files
    log.debug("skills.sh API unavailable, falling back to GitHub search");
    return await searchGitHub(query, limit);
  } catch (err) {
    log.warn("Skills search failed: %s", err);
    // Graceful fallback with GitHub search
    return searchGitHub(query, limit);
  }
}

async function searchGitHub(
  query: string,
  limit: number
): Promise<SkillSearchResult[]> {
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query + " SKILL.md")}&sort=stars&per_page=${limit}`,
      { headers: { Accept: "application/vnd.github.v3+json" } }
    );

    if (!res.ok) return [];

    const data = (await res.json()) as {
      items?: Array<{
        name: string;
        owner: { login: string };
        description: string;
        stargazers_count: number;
        html_url: string;
      }>;
    };

    return (data.items ?? []).map((item) => ({
      name: item.name,
      owner: item.owner.login,
      repo: item.name,
      description: item.description ?? "",
      stars: item.stargazers_count,
      tools: 0,
      url: item.html_url,
    }));
  } catch {
    return [];
  }
}

/**
 * Install a skill from skills.sh or GitHub.
 * Accepts: "owner/repo" or full URL.
 */
export async function installSkill(
  skillId: string,
  soulDir: string
): Promise<InstalledSkill> {
  // Parse skill identifier
  let owner: string;
  let repo: string;

  if (skillId.includes("skills.sh/")) {
    // Parse skills.sh URL: https://skills.sh/s/owner/repo
    const parts = skillId.split("/").filter(Boolean);
    owner = parts[parts.length - 2];
    repo = parts[parts.length - 1];
  } else if (skillId.includes("github.com/")) {
    const parts = skillId.replace("https://github.com/", "").split("/");
    owner = parts[0];
    repo = parts[1];
  } else if (skillId.includes("/")) {
    [owner, repo] = skillId.split("/");
  } else {
    throw new Error(`Invalid skill identifier: ${skillId}. Use 'owner/repo' format.`);
  }

  const skillsDir = resolve(soulDir, "skills", repo);
  mkdirSync(skillsDir, { recursive: true });

  // Try to fetch SKILL.md from multiple locations
  const urls = [
    `${GITHUB_RAW}/${owner}/${repo}/main/SKILL.md`,
    `${GITHUB_RAW}/${owner}/${repo}/master/SKILL.md`,
    `${GITHUB_RAW}/${owner}/${repo}/main/skill.md`,
  ];

  let content: string | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        content = await res.text();
        break;
      }
    } catch {
      continue;
    }
  }

  if (!content) {
    rmSync(skillsDir, { recursive: true, force: true });
    throw new Error(`Could not find SKILL.md in ${owner}/${repo}`);
  }

  // Save SKILL.md
  writeFileSync(resolve(skillsDir, "SKILL.md"), content, "utf-8");

  // Save metadata
  const meta = {
    source: `${owner}/${repo}`,
    installedAt: new Date().toISOString(),
    url: `https://github.com/${owner}/${repo}`,
  };
  writeFileSync(resolve(skillsDir, ".meta.json"), JSON.stringify(meta, null, 2), "utf-8");

  // Parse to get tool count
  const skills = loadSkills(soulDir);
  const installed = skills.find((s) => s.name === repo);

  log.info("Installed skill: %s/%s (%d tools)", owner, repo, installed?.tools.length ?? 0);

  return {
    name: repo,
    source: `${owner}/${repo}`,
    version: installed?.version ?? "0.1.0",
    toolCount: installed?.tools.length ?? 0,
    installedAt: meta.installedAt,
  };
}

/**
 * Uninstall a skill by name.
 */
export function uninstallSkill(name: string, soulDir: string): boolean {
  const skillDir = resolve(soulDir, "skills", name);
  if (!existsSync(skillDir)) return false;

  rmSync(skillDir, { recursive: true, force: true });
  log.info("Uninstalled skill: %s", name);
  return true;
}

/**
 * List all installed skills with metadata.
 */
export function listInstalledSkills(soulDir: string): InstalledSkill[] {
  const skillsDir = resolve(soulDir, "skills");
  if (!existsSync(skillsDir)) return [];

  const results: InstalledSkill[] = [];
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  const skills = loadSkills(soulDir);

  for (const dir of dirs) {
    const metaPath = resolve(skillsDir, dir.name, ".meta.json");
    let meta = { source: "local", installedAt: "unknown", url: "" };
    try {
      if (existsSync(metaPath)) {
        const raw = require("fs").readFileSync(metaPath, "utf-8");
        meta = JSON.parse(raw);
      }
    } catch {}

    const manifest = skills.find((s) => s.name === dir.name);
    results.push({
      name: dir.name,
      source: meta.source,
      version: manifest?.version ?? "0.1.0",
      toolCount: manifest?.tools.length ?? 0,
      installedAt: meta.installedAt,
    });
  }

  return results;
}
