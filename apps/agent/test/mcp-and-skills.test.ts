import { describe, expect, it } from "vitest";
import { inAgent, loggedIn } from "./helpers";
import { SkillService } from "../src/skills/service";

describe("Dynamic Skills (SKILL.md) and Remote MCP", () => {
  describe("SkillService parser", () => {
    it("parses standard SKILL.md with yaml frontmatter and markdown body", () => {
      const service = new SkillService({} as any);
      const markdown = `---
name: GitHub PR Reviewer
slug: github-pr-reviewer
description: Analyzes pull request changes and code improvements.
triggers: ["github", "pull request", "review"]
---

# GitHub PR Reviewer Instructions
When reviewing pull requests:
1. Examine intent first.
2. Check for security vulnerabilities.
`;
      const parsed = service.parseSkillMarkdown(markdown);
      expect(parsed.name).toBe("GitHub PR Reviewer");
      expect(parsed.slug).toBe("github-pr-reviewer");
      expect(parsed.description).toBe("Analyzes pull request changes and code improvements.");
      expect(parsed.triggers).toEqual(["github", "pull request", "review"]);
      expect(parsed.markdown).toContain("# GitHub PR Reviewer Instructions");
    });

    it("handles fallback slug and missing frontmatter", () => {
      const service = new SkillService({} as any);
      const raw = "# Quick Note Skill\nJust write notes concisely.";
      const parsed = service.parseSkillMarkdown(raw, "quick-notes");
      expect(parsed.name).toBe("quick-notes");
      expect(parsed.slug).toBe("quick-notes");
      expect(parsed.markdown).toBe(raw);
    });
  });

  describe("Durable Object storage and API integration", () => {
    it("manages MCP servers and tool lifecycle in SQLite", async () => {
      await inAgent(async (agent) => {
        const repo = agent.services.mcpRepo;

        // 1. Create remote MCP server
        const server = repo.createServer({
          name: "Test MCP Server",
          endpoint: "https://mcp.example.com/sse",
          transport: "sse",
          auth_header: "Bearer test-key",
        });

        expect(server.id).toBeDefined();
        expect(server.name).toBe("Test MCP Server");
        expect(server.transport).toBe("sse");
        expect(server.auth_header).toBe("Bearer test-key");

        // 2. Sync tools from server
        repo.syncTools(server.id, [
          {
            name: "fetch_weather",
            description: "Gets weather for a location",
            schema_json: JSON.stringify({ type: "object", properties: { city: { type: "string" } } }),
            requires_approval: false,
          },
          {
            name: "reboot_server",
            description: "Reboots server instance",
            schema_json: JSON.stringify({ type: "object", properties: { force: { type: "boolean" } } }),
            requires_approval: true,
          },
        ]);

        const tools = repo.listTools(server.id);
        expect(tools).toHaveLength(2);
        expect(tools.find((t) => t.name === "fetch_weather")?.requires_approval).toBe(false);
        expect(tools.find((t) => t.name === "reboot_server")?.requires_approval).toBe(true);

        // 3. Verify tool definitions generated for agent runner
        const defs = agent.services.mcp.getToolDefinitions();
        const weatherDef = defs.find((d) => d.name === "fetch_weather");
        const rebootDef = defs.find((d) => d.name === "reboot_server");

        expect(weatherDef).toBeDefined();
        expect(weatherDef?.permission).toBe("write");

        expect(rebootDef).toBeDefined();
        expect(rebootDef?.permission).toBe("destructive");
        if (rebootDef?.permission === "destructive") {
          const prep = await rebootDef.prepare({ force: true }, {
            services: agent.services,
            timezone: "UTC",
            mode: "chat",
            conversationId: "test-conv",
          });
          expect(prep.summary).toContain("reboot_server");
        }

        // 4. Clean up
        repo.deleteServer(server.id);
        expect(repo.getServer(server.id)).toBeNull();
        expect(repo.listTools(server.id)).toHaveLength(0);
      });
    });

    it("manages dynamic skills and resolves prompt context", async () => {
      await inAgent(async (agent) => {
        const skills = agent.services.skills;
        const repo = agent.services.skillsRepo;

        const skill = skills.importSkill(`---
name: Database Architect
slug: db-architect
description: Guides SQL migrations and index design.
triggers: ["sql", "database", "migration", "indexes"]
---

Always use EXPLAIN QUERY PLAN before adding an index.
`);

        expect(skill.name).toBe("Database Architect");
        expect(skill.slug).toBe("db-architect");

        // Test prompt resolution
        const resolutionMatch = skills.resolveForPrompt("How should I write this sql migration?");
        expect(resolutionMatch).toContain("Database Architect");
        expect(resolutionMatch).toContain("EXPLAIN QUERY PLAN");

        const noMatch = skills.resolveForPrompt("Tell me a bedtime story");
        expect(noMatch).toBeNull();

        // Clean up
        repo.delete(skill.id);
        expect(repo.get(skill.id)).toBeNull();
      });
    });

    it("exposes MCP and Skills HTTP endpoints", async () => {
      const c = await loggedIn();

      // Test MCP server routes
      const createRes = await c.call("/api/mcp/servers", {
        method: "POST",
        body: {
          name: "API Test Server",
          endpoint: "https://example.com/mcp",
          transport: "http",
        },
      });
      expect(createRes.status).toBe(201);
      const { server } = (await createRes.json()) as any;
      expect(server.name).toBe("API Test Server");

      const listRes = await c.call("/api/mcp/servers");
      expect(listRes.status).toBe(200);
      const listData = (await listRes.json()) as any;
      expect(listData.servers.some((s: any) => s.id === server.id)).toBe(true);

      // Delete server
      const delRes = await c.call(`/api/mcp/servers/${server.id}`, { method: "DELETE" });
      expect(delRes.status).toBe(200);

      // Test Skill import via API
      const skillRes = await c.call("/api/skills", {
        method: "POST",
        body: {
          markdown: `---
name: Poetry Expert
slug: poetry-expert
description: Writes haikus.
triggers: ["haiku", "poem"]
---
Always follow 5-7-5 syllable structure.
`,
        },
      });
      expect(skillRes.status).toBe(201);
      const { skill } = (await skillRes.json()) as any;
      expect(skill.name).toBe("Poetry Expert");

      // Delete skill
      const delSkillRes = await c.call(`/api/skills/${skill.id}`, { method: "DELETE" });
      expect(delSkillRes.status).toBe(200);
    });
  });
});
