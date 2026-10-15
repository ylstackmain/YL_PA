import type { McpServer, McpTool } from "@talorys/shared";
import { type Database, newId, now } from "../database";
import { NotFoundError } from "../../api/errors";

export interface McpServerInput {
  name: string;
  endpoint: string;
  transport?: "http" | "sse";
  auth_header?: string | null;
  enabled?: boolean;
}

export interface McpServerUpdate {
  name?: string;
  endpoint?: string;
  transport?: "http" | "sse";
  auth_header?: string | null;
  enabled?: boolean;
}

export interface McpToolInput {
  name: string;
  description?: string;
  schema_json: string;
  requires_approval?: boolean;
  enabled?: boolean;
}

interface McpServerRow {
  id: string;
  name: string;
  endpoint: string;
  transport: "http" | "sse";
  auth_header: string | null;
  enabled: number;
  tool_count?: number;
  created_at: string;
  updated_at: string;
}

interface McpToolRow {
  id: string;
  server_id: string;
  name: string;
  description: string;
  schema_json: string;
  requires_approval: number;
  enabled: number;
  last_synced: string;
}

export class McpRepository {
  constructor(private readonly db: Database) {}

  listServers(): McpServer[] {
    const rows = this.db.all<McpServerRow>(
      `SELECT s.*, (SELECT COUNT(*) FROM tal_mcp_tools t WHERE t.server_id = s.id AND t.enabled = 1) AS tool_count
       FROM tal_mcp_servers s
       ORDER BY s.created_at DESC`,
    );
    return rows.map((r) => this.toServer(r));
  }

  getServer(id: string): McpServer | null {
    const row = this.db.one<McpServerRow>(
      `SELECT s.*, (SELECT COUNT(*) FROM tal_mcp_tools t WHERE t.server_id = s.id AND t.enabled = 1) AS tool_count
       FROM tal_mcp_servers s
       WHERE s.id = ?`,
      id,
    );
    return row ? this.toServer(row) : null;
  }

  createServer(input: McpServerInput): McpServer {
    const id = newId();
    const ts = now();
    const transport = input.transport ?? "http";
    const enabled = input.enabled !== false ? 1 : 0;
    this.db.run(
      `INSERT INTO tal_mcp_servers (id, name, endpoint, transport, auth_header, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.endpoint,
      transport,
      input.auth_header ?? null,
      enabled,
      ts,
      ts,
    );
    return this.getServer(id)!;
  }

  updateServer(id: string, patch: McpServerUpdate): McpServer {
    const server = this.getServer(id);
    if (!server) throw new NotFoundError("MCP server not found");
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [now()];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.endpoint !== undefined) {
      sets.push("endpoint = ?");
      params.push(patch.endpoint);
    }
    if (patch.transport !== undefined) {
      sets.push("transport = ?");
      params.push(patch.transport);
    }
    if (patch.auth_header !== undefined) {
      sets.push("auth_header = ?");
      params.push(patch.auth_header);
    }
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(patch.enabled ? 1 : 0);
    }
    params.push(id);
    this.db.run(`UPDATE tal_mcp_servers SET ${sets.join(", ")} WHERE id = ?`, ...params);
    return this.getServer(id)!;
  }

  deleteServer(id: string): void {
    this.db.run(`DELETE FROM tal_mcp_servers WHERE id = ?`, id);
  }

  listTools(serverId?: string): McpTool[] {
    const rows = serverId
      ? this.db.all<McpToolRow>(`SELECT * FROM tal_mcp_tools WHERE server_id = ? ORDER BY name ASC`, serverId)
      : this.db.all<McpToolRow>(`SELECT * FROM tal_mcp_tools ORDER BY name ASC`);
    return rows.map((r) => this.toTool(r));
  }

  listActiveTools(): Array<McpTool & { server: McpServer }> {
    const rows = this.db.all<McpToolRow & { server_name: string; server_endpoint: string; server_transport: "http" | "sse"; server_auth: string | null }>(
      `SELECT t.*, s.name as server_name, s.endpoint as server_endpoint, s.transport as server_transport, s.auth_header as server_auth
       FROM tal_mcp_tools t
       JOIN tal_mcp_servers s ON t.server_id = s.id
       WHERE t.enabled = 1 AND s.enabled = 1
       ORDER BY t.name ASC`,
    );
    return rows.map((r) => ({
      ...this.toTool(r),
      server: {
        id: r.server_id,
        name: r.server_name,
        endpoint: r.server_endpoint,
        transport: r.server_transport,
        auth_header: r.server_auth,
        enabled: true,
        created_at: "",
        updated_at: "",
      },
    }));
  }

  syncTools(serverId: string, tools: McpToolInput[]): McpTool[] {
    const ts = now();
    return this.db.transaction(() => {
      // Keep user's custom permission toggles if tool name previously existed
      const existing = this.listTools(serverId);
      const existingMap = new Map(existing.map((t) => [t.name, t]));

      this.db.run(`DELETE FROM tal_mcp_tools WHERE server_id = ?`, serverId);

      for (const t of tools) {
        const prev = existingMap.get(t.name);
        const requiresApproval = prev ? (prev.requires_approval ? 1 : 0) : (t.requires_approval ? 1 : 0);
        const enabled = prev ? (prev.enabled ? 1 : 0) : (t.enabled !== false ? 1 : 0);
        const id = newId();
        this.db.run(
          `INSERT INTO tal_mcp_tools (id, server_id, name, description, schema_json, requires_approval, enabled, last_synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          serverId,
          t.name,
          t.description ?? "",
          t.schema_json,
          requiresApproval,
          enabled,
          ts,
        );
      }
      return this.listTools(serverId);
    });
  }

  updateTool(id: string, patch: { requires_approval?: boolean; enabled?: boolean }): McpTool {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.requires_approval !== undefined) {
      sets.push("requires_approval = ?");
      params.push(patch.requires_approval ? 1 : 0);
    }
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      params.push(patch.enabled ? 1 : 0);
    }
    if (sets.length === 0) {
      const tool = this.db.one<McpToolRow>(`SELECT * FROM tal_mcp_tools WHERE id = ?`, id);
      if (!tool) throw new NotFoundError("MCP tool not found");
      return this.toTool(tool);
    }
    params.push(id);
    this.db.run(`UPDATE tal_mcp_tools SET ${sets.join(", ")} WHERE id = ?`, ...params);
    const updated = this.db.one<McpToolRow>(`SELECT * FROM tal_mcp_tools WHERE id = ?`, id);
    if (!updated) throw new NotFoundError("MCP tool not found");
    return this.toTool(updated);
  }

  private toServer(row: McpServerRow): McpServer {
    return {
      id: row.id,
      name: row.name,
      endpoint: row.endpoint,
      transport: row.transport,
      auth_header: row.auth_header,
      enabled: row.enabled === 1,
      tool_count: row.tool_count ?? 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private toTool(row: McpToolRow): McpTool {
    return {
      id: row.id,
      server_id: row.server_id,
      name: row.name,
      description: row.description,
      schema_json: row.schema_json,
      requires_approval: row.requires_approval === 1,
      enabled: row.enabled === 1,
      last_synced: row.last_synced,
    };
  }
}
