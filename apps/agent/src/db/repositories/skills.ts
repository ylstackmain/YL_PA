import type { Skill } from "@talorys/shared";
import { type Database, newId, now } from "../database";
import { NotFoundError } from "../../api/errors";

export interface SkillInput {
  name: string;
  slug: string;
  description?: string;
  markdown_content: string;
  frontmatter_json?: string;
  triggers?: string[];
  enabled?: boolean;
}

export interface SkillUpdate {
  name?: string;
  description?: string;
  markdown_content?: string;
  frontmatter_json?: string;
  triggers?: string[];
  enabled?: boolean;
}

interface SkillRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  markdown_content: string;
  frontmatter_json: string;
  triggers_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export class SkillRepository {
  constructor(private readonly db: Database) {}

  list(enabledOnly = false): Skill[] {
    const rows = enabledOnly
      ? this.db.all<SkillRow>(`SELECT * FROM tal_skills WHERE enabled = 1 ORDER BY name ASC`)
      : this.db.all<SkillRow>(`SELECT * FROM tal_skills ORDER BY name ASC`);
    return rows.map((r) => this.toSkill(r));
  }

  get(id: string): Skill | null {
    const row = this.db.one<SkillRow>(`SELECT * FROM tal_skills WHERE id = ?`, id);
    return row ? this.toSkill(row) : null;
  }

  getBySlug(slug: string): Skill | null {
    const row = this.db.one<SkillRow>(`SELECT * FROM tal_skills WHERE slug = ?`, slug);
    return row ? this.toSkill(row) : null;
  }

  create(input: SkillInput): Skill {
    const id = newId();
    const ts = now();
    const triggersJson = JSON.stringify(input.triggers ?? []);
    const frontmatterJson = input.frontmatter_json ?? "{}";
    const enabled = input.enabled !== false ? 1 : 0;
    this.db.run(
      `INSERT INTO tal_skills (id, name, slug, description, markdown_content, frontmatter_json, triggers_json, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.slug,
      input.description ?? "",
      input.markdown_content,
      frontmatterJson,
      triggersJson,
      enabled,
      ts,
      ts,
    );
    return this.get(id)!;
  }

  update(id: string, patch: SkillUpdate): Skill {
    const existing = this.get(id);
    if (!existing) throw new NotFoundError("Skill not found");
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [now()];

    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push("description = ?");
      params.push(patch.description);
    }
    if (patch.markdown_content !== undefined) {
      sets.push("markdown_content = ?");
      params.push(patch.markdown_content);
    }
    if (patch.frontmatter_json !== undefined) {
      sets.push("frontmatter_json = ?");
      params.push(patch.frontmatter_json);
    }
    if (patch.triggers !== undefined) {
      sets.push("triggers_json = ?");
      params.push(JSON.stringify(patch.triggers));
    }
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(patch.enabled ? 1 : 0);
    }

    params.push(id);
    this.db.run(`UPDATE tal_skills SET ${sets.join(", ")} WHERE id = ?`, ...params);
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM tal_skills WHERE id = ?`, id);
  }

  /**
   * Evaluates prompt text against enabled skills. A skill matches if:
   * 1. No triggers defined (always on, general skill), OR
   * 2. Any trigger keyword/phrase appears in the lowercase prompt.
   */
  matchSkills(promptText: string): Skill[] {
    const enabled = this.list(true);
    const lower = promptText.toLowerCase();
    return enabled.filter((s) => {
      if (!s.triggers || s.triggers.length === 0) return true;
      return s.triggers.some((t) => lower.includes(t.toLowerCase()));
    });
  }

  private toSkill(row: SkillRow): Skill {
    let triggers: string[] = [];
    try {
      triggers = JSON.parse(row.triggers_json);
    } catch {
      triggers = [];
    }
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      markdown_content: row.markdown_content,
      frontmatter_json: row.frontmatter_json,
      triggers,
      enabled: row.enabled === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
