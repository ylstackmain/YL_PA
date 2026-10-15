import { Hono } from "hono";
import { mcpServerCreateSchema, mcpServerUpdateSchema, mcpToolUpdateSchema } from "@talorys/shared";
import type { AppEnv } from "../app";
import { body } from "../middleware";

export const mcpRoutes = new Hono<AppEnv>();

mcpRoutes.get("/mcp/servers", (c) => {
  const s = c.env.agent.services;
  return c.json({ servers: s.mcpRepo.listServers() });
});

mcpRoutes.post("/mcp/servers", async (c) => {
  const input = await body(c, mcpServerCreateSchema);
  const s = c.env.agent.services;
  const server = s.mcpRepo.createServer(input);

  // Automatically attempt initial tool synchronization in background / best-effort
  try {
    await s.mcp.syncServerTools(server.id);
  } catch (err) {
    console.warn(`Initial tool sync for MCP server ${server.name} failed:`, err);
  }

  return c.json({ server: s.mcpRepo.getServer(server.id) }, 201);
});

mcpRoutes.get("/mcp/servers/:id", (c) => {
  const s = c.env.agent.services;
  const server = s.mcpRepo.getServer(c.req.param("id"));
  if (!server) return c.json({ error: { code: "NOT_FOUND", message: "Server not found" } }, 404);
  const tools = s.mcpRepo.listTools(server.id);
  return c.json({ server, tools });
});

mcpRoutes.patch("/mcp/servers/:id", async (c) => {
  const patch = await body(c, mcpServerUpdateSchema);
  const s = c.env.agent.services;
  const server = s.mcpRepo.updateServer(c.req.param("id"), patch);
  return c.json({ server });
});

mcpRoutes.delete("/mcp/servers/:id", (c) => {
  const s = c.env.agent.services;
  s.mcpRepo.deleteServer(c.req.param("id"));
  return c.json({ deleted: true });
});

mcpRoutes.post("/mcp/servers/:id/sync", async (c) => {
  const s = c.env.agent.services;
  const tools = await s.mcp.syncServerTools(c.req.param("id"));
  return c.json({ tools });
});

mcpRoutes.get("/mcp/tools", (c) => {
  const s = c.env.agent.services;
  const serverId = c.req.query("server_id");
  return c.json({ tools: s.mcpRepo.listTools(serverId) });
});

mcpRoutes.patch("/mcp/tools/:id", async (c) => {
  const patch = await body(c, mcpToolUpdateSchema);
  const s = c.env.agent.services;
  const tool = s.mcpRepo.updateTool(c.req.param("id"), patch);
  return c.json({ tool });
});
