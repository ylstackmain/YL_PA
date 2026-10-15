import type { Skill } from "@talorys/shared";
import type { SkillRepository } from "../db/repositories/skills";

export interface ParsedSkillMd {
  name: string;
  slug: string;
  description: string;
  triggers: string[];
  markdown: string;
  frontmatter: Record<string, unknown>;
}

export class SkillService {
  constructor(private readonly repo: SkillRepository) {}

  /**
   * Parses a SKILL.md content block with YAML frontmatter.
   */
  parseSkillMarkdown(raw: string, fallbackSlug?: string): ParsedSkillMd {
    const trimmed = raw.trim();
    let frontmatter: Record<string, unknown> = {};
    let markdown = trimmed;

    if (trimmed.startsWith("---")) {
      const secondDash = trimmed.indexOf("---", 3);
      if (secondDash !== -1) {
        const yamlStr = trimmed.slice(3, secondDash).trim();
        markdown = trimmed.slice(secondDash + 3).trim();
        frontmatter = this.parseSimpleYaml(yamlStr);
      }
    }

    const name = String(frontmatter.name || fallbackSlug || "Custom Skill");
    const slug = (fallbackSlug || String(frontmatter.slug || name))
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const description = String(frontmatter.description || "");

    let triggers: string[] = [];
    if (Array.isArray(frontmatter.triggers)) {
      triggers = frontmatter.triggers.map(String);
    } else if (typeof frontmatter.triggers === "string") {
      triggers = frontmatter.triggers.split(",").map((s) => s.trim());
    }

    return {
      name,
      slug,
      description,
      triggers,
      markdown,
      frontmatter,
    };
  }

  /**
   * Imports or creates a skill from markdown content.
   */
  importSkill(rawMarkdown: string, slugOverride?: string): Skill {
    const parsed = this.parseSkillMarkdown(rawMarkdown, slugOverride);
    const existing = this.repo.getBySlug(parsed.slug);
    if (existing) {
      return this.repo.update(existing.id, {
        name: parsed.name,
        description: parsed.description,
        markdown_content: parsed.markdown,
        frontmatter_json: JSON.stringify(parsed.frontmatter),
        triggers: parsed.triggers,
        enabled: true,
      });
    }
    return this.repo.create({
      name: parsed.name,
      slug: parsed.slug,
      description: parsed.description,
      markdown_content: parsed.markdown,
      frontmatter_json: JSON.stringify(parsed.frontmatter),
      triggers: parsed.triggers,
      enabled: true,
    });
  }

  /**
   * Checks the user's prompt against registered skills and produces a formatted
   * system prompt extension with the relevant instructions.
   */
  resolveForPrompt(promptText: string): string | null {
    const matched = this.repo.matchSkills(promptText);
    if (!matched || matched.length === 0) return null;

    const sections = matched.map((s) => `### Skill: ${s.name}\n${s.markdown_content}`);
    return `Specialized Active Skills:\n${sections.join("\n\n")}`;
  }

  private parseSimpleYaml(str: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = str.split("\n");
    let currentKey: string | null = null;
    let inArray = false;
    let arrayItems: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      if (line.startsWith("- ") && inArray && currentKey) {
        arrayItems.push(line.slice(2).trim().replace(/^['"]|['"]$/g, ""));
        continue;
      }

      if (inArray && currentKey) {
        result[currentKey] = arrayItems;
        inArray = false;
        arrayItems = [];
        currentKey = null;
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();

        if (!val) {
          currentKey = key;
          inArray = true;
          arrayItems = [];
        } else if (val.startsWith("[") && val.endsWith("]")) {
          result[key] = val
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
        } else {
          result[key] = val.replace(/^['"]|['"]$/g, "");
        }
      }
    }

    if (inArray && currentKey) {
      result[currentKey] = arrayItems;
    }

    return result;
  }
}
