/**
 * Skill Registry -- storage, search, and categorization of built-in skills.
 */

import type { SkillDefinition } from "./types.js";
import type { SkillCategory } from "../config.js";
import { SKILL_CATEGORIES } from "../config.js";

// Import all built-in skills
import { searchSkills } from "./built-in/search/index.js";
import { socialSkills } from "./built-in/social/index.js";
import { ecommerceSkills } from "./built-in/ecommerce/index.js";
import { newsSkills } from "./built-in/news/index.js";
import { developerSkills } from "./built-in/developer/index.js";
import { jobsSkills } from "./built-in/jobs/index.js";
import { financialSkills } from "./built-in/financial/index.js";
import { travelSkills } from "./built-in/travel/index.js";
import { productivitySkills } from "./built-in/productivity/index.js";
import { utilitySkills } from "./built-in/utility/index.js";

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  constructor() {
    this.loadBuiltIn();
  }

  private loadBuiltIn(): void {
    const allSkills: SkillDefinition[] = [
      ...searchSkills,
      ...socialSkills,
      ...ecommerceSkills,
      ...newsSkills,
      ...developerSkills,
      ...jobsSkills,
      ...financialSkills,
      ...travelSkills,
      ...productivitySkills,
      ...utilitySkills,
    ];

    for (const skill of allSkills) {
      this.skills.set(skill.id, skill);
    }
  }

  /** Get a skill by ID */
  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  /** Search skills by keyword (matches id, name, description, tags) */
  search(query: string): SkillDefinition[] {
    const q = query.toLowerCase();
    return [...this.skills.values()].filter(
      (s) =>
        s.id.includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q))
    );
  }

  /** List skills by category */
  listByCategory(category: SkillCategory): SkillDefinition[] {
    return [...this.skills.values()].filter((s) => s.category === category);
  }

  /** List all skills grouped by category */
  listAll(): Record<string, SkillDefinition[]> {
    const result: Record<string, SkillDefinition[]> = {};
    for (const cat of SKILL_CATEGORIES) {
      const skills = this.listByCategory(cat);
      if (skills.length > 0) result[cat] = skills;
    }
    return result;
  }

  /** Format skill list for LLM output */
  formatList(skills?: SkillDefinition[]): string {
    const toFormat = skills ?? [...this.skills.values()];
    if (toFormat.length === 0) return "No skills found.";

    // Group by category
    const grouped = new Map<string, SkillDefinition[]>();
    for (const s of toFormat) {
      const list = grouped.get(s.category) ?? [];
      list.push(s);
      grouped.set(s.category, list);
    }

    const lines: string[] = [];
    for (const [cat, catSkills] of grouped) {
      lines.push(`\n## ${cat.toUpperCase()}`);
      for (const s of catSkills) {
        const params = s.parameters.filter((p) => p.required).map((p) => p.name).join(", ");
        lines.push(`  ${s.id} - ${s.name} (${params || "no required params"})`);
      }
    }

    return `Available Skills (${toFormat.length} total):${lines.join("\n")}`;
  }

  /** Register a custom skill */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
  }

  get size(): number {
    return this.skills.size;
  }
}
