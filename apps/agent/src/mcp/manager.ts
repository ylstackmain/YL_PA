import {
  Client,
  StreamableHTTPClientTransport,
  SSEClientTransport,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import type { McpServer, McpTool } from "@talorys/shared";
import type { McpRepository } from "../db/repositories/mcp";
import type { ToolDefinition } from "../tools/registry";
import { quoteTitle } from "../tools/registry";

export class McpClientManager {
  private clients = new Map<string, { client: Client; transport: StreamableHTTPClientTransport | SSEClientTransport }>();

  constructor(private readonly repo: McpRepository) {}

  /** Connects or returns a cached client for the given MCP server. */
  async getClient(server: McpServer): Promise<Client> {
    const cached = this.clients.get(server.id);
    if (cached) return cached.client;

    const url = new URL(server.endpoint);
    const headers: Record<string, string> = {};
    if (server.auth_header) {
      headers["Authorization"] = server.auth_header;
    }

    const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined;
    const transport =
      server.transport === "sse"
        ? new SSEClientTransport(url, {
            requestInit,
          })
        : new StreamableHTTPClientTransport(url, {
            requestInit,
          });

    const client = new Client(
      { name: "talorys-agent", version: "0.1.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    this.clients.set(server.id, { client, transport });
    return client;
  }

  /** Syncs tools from the remote MCP server into SQLite storage. */
  async syncServerTools(serverId: string): Promise<McpTool[]> {
    const server = this.repo.getServer(serverId);
    if (!server) throw new Error("MCP server not found");

    const client = await this.getClient(server);
    const listResult = await client.listTools();
    const tools = (listResult.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      schema_json: JSON.stringify(t.inputSchema ?? {}),
      requires_approval: false,
      enabled: true,
    }));

    return this.repo.syncTools(serverId, tools);
  }

  /** Calls a tool on a remote MCP server. */
  async callTool(server: McpServer, toolName: string, args: unknown): Promise<unknown> {
    const client = await this.getClient(server);
    const result = await client.callTool({
      name: toolName,
      arguments: (args as Record<string, unknown>) ?? {},
    });

    if (result.isError) {
      const errText = Array.isArray(result.content)
        ? result.content.map((c: any) => c.text ?? "").join("\n")
        : "Remote MCP tool execution failed";
      throw new Error(`MCP tool error (${toolName}): ${errText}`);
    }

    if (Array.isArray(result.content)) {
      const textParts = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text);
      if (textParts.length > 0) {
        return textParts.join("\n\n");
      }
    }
    return result.content ?? { success: true };
  }

  /**
   * Generates Talorys ToolDefinition objects for all enabled remote MCP tools.
   * If a tool is flagged requires_approval, it is wrapped in a DestructiveTool so the
   * owner must click "Approve" before the remote tool executes.
   */
  getToolDefinitions(): ToolDefinition[] {
    const active = this.repo.listActiveTools();
    const defs: ToolDefinition[] = [];

    for (const item of active) {
      const toolName = item.name;
      const desc = `[${item.server.name}] ${item.description || toolName}`;
      const inputSchema = z.record(z.string(), z.unknown()).optional().default({});

      if (item.requires_approval) {
        defs.push({
          name: toolName,
          description: desc,
          input: inputSchema,
          permission: "destructive",
          label: () => `Running ${quoteTitle(toolName)} via ${item.server.name}`,
          prepare: (input) => ({
            targetId: `${item.server.id}:${toolName}:${crypto.randomUUID()}`,
            summary: `Run remote action ${quoteTitle(toolName)} on ${item.server.name}`,
            preview: JSON.stringify(input, null, 2),
            payload: { server: item.server, toolName, input },
          }),
          snapshot: () => ({ tool: toolName, server: item.server.name }),
          commit: async (_targetId, _ctx, payload: any) => {
            return this.callTool(payload.server, payload.toolName, payload.input);
          },
        });
      } else {
        defs.push({
          name: toolName,
          description: desc,
          input: inputSchema,
          permission: "write",
          label: () => `Running ${quoteTitle(toolName)} via ${item.server.name}`,
          execute: async (input) => {
            return this.callTool(item.server, toolName, input);
          },
        });
      }
    }

    return defs;
  }
}
