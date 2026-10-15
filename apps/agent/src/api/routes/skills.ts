import { Hono } from "hono";
import { skillCreateSchema, skillUpdateSchema } from "@talorys/shared";
import { z } from "zod";
import type { AppEnv } from "../app";
import { body } from "../middleware";

export const skillRoutes = new Hono<AppEnv>();

const skillImportSchema = z.object({
  markdown: z.string().min(1).max(100_000),
  slug: z.string().trim().max(64).optional(),
});

skillRoutes.get("/skills", (c) => {
  const s = c.env.agent.services;
  return c.json({ skills: s.skillsRepo.list() });
});

skillRoutes.post("/skills", async (c) => {
  const s = c.env.agent.services;
  const json = await c.req.json();

  if ("markdown" in json) {
    const parsed = skillImportSchema.parse(json);
    const skill = s.skills.importSkill(parsed.markdown, parsed.slug);
    return c.json({ skill }, 201);
  }

  const input = skillCreateSchema.parse(json);
  const skill = s.skillsRepo.create(input);
  return c.json({ skill }, 201);
});

skillRoutes.get("/skills/:id", (c) => {
  const s = c.env.agent.services;
  const skill = s.skillsRepo.get(c.req.param("id"));
  if (!skill) return c.json({ error: { code: "NOT_FOUND", message: "Skill not found" } }, 404);
  return c.json({ skill });
});

skillRoutes.patch("/skills/:id", async (c) => {
  const patch = await body(c, skillUpdateSchema);
  const s = c.env.agent.services;
  const skill = s.skillsRepo.update(c.req.param("id"), patch);
  return c.json({ skill });
});

skillRoutes.delete("/skills/:id", (c) => {
  const s = c.env.agent.services;
  s.skillsRepo.delete(c.req.param("id"));
  return c.json({ deleted: true });
});
