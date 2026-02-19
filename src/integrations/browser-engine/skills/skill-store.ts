/**
 * Skill Store -- Persists custom skills as JSON files on disk.
 *
 * Custom skills are stored in {runtimeDir}/browser/custom-skills/{skillId}.json
 * and loaded back into the SkillRegistry on startup.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from "fs";
import { join, basename } from "path";
import type { SkillDefinition } from "./types.js";
import { createLogger } from "../../../infra/logger.js";

const log = createLogger("skill-store");

export class SkillStore {
  private storePath: string;

  constructor(runtimeDir: string) {
    this.storePath = join(runtimeDir, "browser", "custom-skills");
    mkdirSync(this.storePath, { recursive: true });
  }

  /** Save a skill definition to disk */
  save(skill: SkillDefinition): void {
    const filePath = join(this.storePath, `${skill.id}.json`);
    writeFileSync(filePath, JSON.stringify(skill, null, 2), "utf-8");
    log.info("Saved custom skill: %s -> %s", skill.id, filePath);
  }

  /** Load a single skill by ID */
  load(id: string): SkillDefinition | null {
    const filePath = join(this.storePath, `${id}.json`);
    if (!existsSync(filePath)) return null;

    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as SkillDefinition;
    } catch (err) {
      log.warn("Failed to load skill %s: %s", id, (err as Error).message);
      return null;
    }
  }

  /** Load all custom skills from disk */
  loadAll(): SkillDefinition[] {
    if (!existsSync(this.storePath)) return [];

    const skills: SkillDefinition[] = [];
    const files = readdirSync(this.storePath).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const content = readFileSync(join(this.storePath, file), "utf-8");
        const skill = JSON.parse(content) as SkillDefinition;
        if (skill.id && skill.name && skill.steps) {
          skills.push(skill);
        }
      } catch (err) {
        log.warn("Skipping invalid skill file %s: %s", file, (err as Error).message);
      }
    }

    log.info("Loaded %d custom skills from disk", skills.length);
    return skills;
  }

  /** Delete a custom skill from disk */
  delete(id: string): boolean {
    const filePath = join(this.storePath, `${id}.json`);
    if (!existsSync(filePath)) return false;

    try {
      unlinkSync(filePath);
      log.info("Deleted custom skill: %s", id);
      return true;
    } catch (err) {
      log.warn("Failed to delete skill %s: %s", id, (err as Error).message);
      return false;
    }
  }

  /** Check if a custom skill exists on disk */
  exists(id: string): boolean {
    return existsSync(join(this.storePath, `${id}.json`));
  }

  /** List all custom skill IDs on disk */
  listIds(): string[] {
    if (!existsSync(this.storePath)) return [];
    return readdirSync(this.storePath)
      .filter((f) => f.endsWith(".json"))
      .map((f) => basename(f, ".json"));
  }
}
