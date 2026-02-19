/**
 * Skill Executor tests.
 */

import { describe, it, expect, vi } from "vitest";
import { SkillRegistry } from "../skills/registry.js";

describe("SkillRegistry", () => {
  it("should load all built-in skills", () => {
    const registry = new SkillRegistry();
    expect(registry.size).toBeGreaterThan(40);
  });

  it("should find a skill by ID", () => {
    const registry = new SkillRegistry();
    const skill = registry.get("google-search");
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("Google Search");
    expect(skill!.category).toBe("search");
  });

  it("should search skills by keyword", () => {
    const registry = new SkillRegistry();
    const results = registry.search("amazon");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((s) => s.id === "amazon-search")).toBe(true);
  });

  it("should list skills by category", () => {
    const registry = new SkillRegistry();
    const searchSkills = registry.listByCategory("search");
    expect(searchSkills.length).toBeGreaterThan(0);
    expect(searchSkills.every((s) => s.category === "search")).toBe(true);
  });

  it("should list all skills grouped by category", () => {
    const registry = new SkillRegistry();
    const all = registry.listAll();
    expect(Object.keys(all)).toContain("search");
    expect(Object.keys(all)).toContain("social");
    expect(Object.keys(all)).toContain("ecommerce");
  });

  it("should format skill list", () => {
    const registry = new SkillRegistry();
    const output = registry.formatList();
    expect(output).toContain("Available Skills");
    expect(output).toContain("SEARCH");
    expect(output).toContain("google-search");
  });

  it("should register custom skills", () => {
    const registry = new SkillRegistry();
    const before = registry.size;
    registry.register({
      id: "custom-test",
      name: "Custom Test",
      description: "A test skill",
      category: "utility",
      tags: ["test"],
      parameters: [],
      steps: [{ action: "navigate", value: "https://example.com" }],
    });
    expect(registry.size).toBe(before + 1);
    expect(registry.get("custom-test")).toBeDefined();
  });
});
