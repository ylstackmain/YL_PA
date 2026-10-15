import { useState } from "react";
import type { McpServer, Skill } from "@talorys/shared";
import { Network, Plus, RefreshCw, Trash2, BookOpen } from "lucide-react";
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Input, Label, Select, Spinner, Switch, Textarea } from "./ui";
import { keys, useApiMutation, useMcpServers, useSkills } from "../hooks/queries";
import { api } from "../lib/api";


const SAMPLE_SKILL_MD = `---
name: GitHub PR Reviewer
slug: github-pr-reviewer
description: Analyzes pull request changes, explains architectural impact, and suggests code improvements.
triggers: ["github", "pull request", "review pr", "code review"]
---

# GitHub PR Reviewer Skill
When reviewing code or pull requests:
1. Examine the intent of the changes before inspecting specific diff lines.
2. Check for security vulnerabilities, edge cases, and missing error handlers.
3. Suggest concrete, minimal code improvements using markdown code blocks.
4. Keep feedback constructive, concise, and focused on maintainability.
`;

export function McpSkillsCard() {
  const { data: servers, isLoading: loadingServers, error: serverError } = useMcpServers();
  const { data: skills, isLoading: loadingSkills, error: skillError } = useSkills();

  const [addServerOpen, setAddServerOpen] = useState(false);
  const [serverName, setServerName] = useState("");
  const [serverEndpoint, setServerEndpoint] = useState("");
  const [serverTransport, setServerTransport] = useState<"http" | "sse">("http");
  const [serverAuth, setServerAuth] = useState("");

  const [importSkillOpen, setImportSkillOpen] = useState(false);
  const [skillMarkdown, setSkillMarkdown] = useState(SAMPLE_SKILL_MD);

  const [deletingServer, setDeletingServer] = useState<McpServer | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);

  // Mutations
  const createServer = useApiMutation(
    () =>
      api("/mcp/servers", {
        method: "POST",
        body: {
          name: serverName,
          endpoint: serverEndpoint,
          transport: serverTransport,
          auth_header: serverAuth.trim() || null,
        },
      }),
    {
      invalidate: [keys.mcpServers],
      success: "MCP Server added and syncing tools",
      onSuccess: () => {
        setAddServerOpen(false);
        setServerName("");
        setServerEndpoint("");
        setServerAuth("");
      },
    },
  );

  const syncServer = useApiMutation((id: string) => api(`/mcp/servers/${id}/sync`, { method: "POST" }), {
    invalidate: [keys.mcpServers],
    success: "Tools synchronized",
  });

  const toggleServer = useApiMutation(
    (s: McpServer) => api(`/mcp/servers/${s.id}`, { method: "PATCH", body: { enabled: !s.enabled } }),
    { invalidate: [keys.mcpServers] },
  );

  const deleteServer = useApiMutation((id: string) => api(`/mcp/servers/${id}`, { method: "DELETE" }), {
    invalidate: [keys.mcpServers],
    success: "Server removed",
    onSuccess: () => setDeletingServer(null),
  });

  const importSkill = useApiMutation(() => api("/skills", { method: "POST", body: { markdown: skillMarkdown } }), {
    invalidate: [keys.skills],
    success: "Skill imported successfully",
    onSuccess: () => setImportSkillOpen(false),
  });

  const toggleSkill = useApiMutation(
    (s: Skill) => api(`/skills/${s.id}`, { method: "PATCH", body: { enabled: !s.enabled } }),
    { invalidate: [keys.skills] },
  );

  const deleteSkill = useApiMutation((id: string) => api(`/skills/${id}`, { method: "DELETE" }), {
    invalidate: [keys.skills],
    success: "Skill removed",
    onSuccess: () => setDeletingSkill(null),
  });

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Remote MCP Servers Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-fg">Remote MCP Servers</h2>
            <p className="text-xs text-fg-subtle">
              Connect external tools via Model Context Protocol (Streamable HTTP & SSE transports).
            </p>
          </div>
          <Button size="sm" onClick={() => setAddServerOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Server
          </Button>
        </div>

        <Card>
          {loadingServers ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : serverError ? (
            <div className="p-4 text-xs text-danger">Failed to load MCP servers.</div>
          ) : !servers?.length ? (
            <EmptyState icon={<Network className="h-8 w-8" />} title="No remote MCP servers connected">
              Connect external tools from GitHub, Notion, linear, or private Cloudflare Workers to expand Talorys's capabilities.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {servers.map((s) => (
                <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-fg">{s.name}</span>
                      <span className="text-xs text-fg-subtle">·</span>
                      <span className="text-xs uppercase font-mono text-fg-subtle">{s.transport}</span>
                      <span className="text-xs text-fg-subtle">·</span>
                      <span className="text-xs text-fg-subtle">{s.tool_count ?? 0} tools active</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs font-mono text-fg-muted">{s.endpoint}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={s.enabled}
                      onChange={() => toggleServer.mutate(s)}
                      label={`Toggle ${s.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => syncServer.mutate(s.id)}
                      loading={syncServer.isPending}
                      aria-label="Synchronize tools"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingServer(s)}
                      aria-label="Delete server"
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* Dynamic Skills (SKILL.md) Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-fg">Dynamic Skills (SKILL.md)</h2>
            <p className="text-xs text-fg-subtle">
              Modular prompt instructions and domain guidelines loaded on-demand based on prompt context.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setImportSkillOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Import Skill
          </Button>
        </div>

        <Card>
          {loadingSkills ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : skillError ? (
            <div className="p-4 text-xs text-danger">Failed to load skills.</div>
          ) : !skills?.length ? (
            <EmptyState icon={<BookOpen className="h-8 w-8" />} title="No custom skills registered">
              Import a SKILL.md file to teach Talorys domain-specific workflows, code review habits, or specialized prompts.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {skills.map((skill) => (
                <li key={skill.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-fg">{skill.name}</span>
                      <span className="text-xs text-fg-subtle">·</span>
                      <span className="text-xs font-mono text-fg-subtle">{skill.slug}</span>
                    </div>
                    {skill.description && (
                      <p className="mt-1 text-xs text-fg-muted">{skill.description}</p>
                    )}
                    {skill.triggers.length > 0 && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-fg-subtle">
                        <span>Triggers:</span>
                        <span>{skill.triggers.join(", ")}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Switch
                      checked={skill.enabled}
                      onChange={() => toggleSkill.mutate(skill)}
                      label={`Toggle ${skill.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingSkill(skill)}
                      aria-label="Delete skill"
                    >
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* Add Server Dialog */}
      <Dialog
        open={addServerOpen}
        onClose={() => setAddServerOpen(false)}
        title="Connect Remote MCP Server"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddServerOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createServer.mutate(undefined)}
              loading={createServer.isPending}
              disabled={!serverName || !serverEndpoint}
            >
              Connect & Sync Tools
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="mcp-name">Server Name</Label>
            <Input
              id="mcp-name"
              placeholder="e.g. GitHub Tools or Cloudflare API"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="mcp-endpoint">Endpoint URL</Label>
            <Input
              id="mcp-endpoint"
              placeholder="https://mcp.example.com/sse or https://.../mcp"
              value={serverEndpoint}
              onChange={(e) => setServerEndpoint(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="mcp-transport">Transport Protocol</Label>
            <Select
              id="mcp-transport"
              value={serverTransport}
              onChange={(e) => setServerTransport(e.target.value as "http" | "sse")}
            >
              <option value="http">Streamable HTTP (MCP 2025+ Standard)</option>
              <option value="sse">Server-Sent Events (SSE)</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="mcp-auth">Authorization Header (Optional)</Label>
            <Input
              id="mcp-auth"
              placeholder="Bearer secret-token-here"
              value={serverAuth}
              onChange={(e) => setServerAuth(e.target.value)}
            />
          </div>
        </div>
      </Dialog>

      {/* Import Skill Dialog */}
      <Dialog
        open={importSkillOpen}
        onClose={() => setImportSkillOpen(false)}
        title="Import SKILL.md"
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportSkillOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => importSkill.mutate(undefined)}
              loading={importSkill.isPending}
              disabled={!skillMarkdown.trim()}
            >
              Save Skill
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-fg-subtle">
            Paste a markdown file with YAML frontmatter. Talorys will extract the triggers, name, and instructions.
          </p>
          <Textarea
            rows={14}
            className="font-mono text-xs leading-relaxed"
            value={skillMarkdown}
            onChange={(e) => setSkillMarkdown(e.target.value)}
          />
        </div>
      </Dialog>

      {/* Confirm Delete Server */}
      <ConfirmDialog
        open={!!deletingServer}
        onCancel={() => setDeletingServer(null)}
        onConfirm={() => {
          if (deletingServer) deleteServer.mutate(deletingServer.id);
        }}
        title={`Remove ${deletingServer?.name ?? ""}?`}
        message="All tools provided by this server will be unregistered from the agent."
        confirmLabel="Remove Server"
      />

      {/* Confirm Delete Skill */}
      <ConfirmDialog
        open={!!deletingSkill}
        onCancel={() => setDeletingSkill(null)}
        onConfirm={() => {
          if (deletingSkill) deleteSkill.mutate(deletingSkill.id);
        }}
        title={`Delete skill ${deletingSkill?.name ?? ""}?`}
        message="This skill will no longer be matched or loaded during chat turns."
        confirmLabel="Delete Skill"
      />
    </div>
  );
}
