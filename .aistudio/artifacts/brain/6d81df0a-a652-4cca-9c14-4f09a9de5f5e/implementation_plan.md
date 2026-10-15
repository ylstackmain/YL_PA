# Talorys Architecture Plan: Remote MCP & Dynamic Skills Integration

A comprehensive architectural redesign and implementation roadmap to integrate Model Context Protocol (MCP) remote servers (over Streamable HTTP and SSE) and dynamic, on-demand Skills (`SKILL.md`) into Talorys on Cloudflare Workers and Durable Objects, alongside a clean git revert of temporary migration artifacts.

***

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed based on your preferences:
> 1. **Repository State**: Revert all previous migration changes (`package.json`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, and `mock-api.ts`) back to the pristine original commit, keeping the codebase clean without requiring an active dev server for this architecture phase.
> 2. **MCP Transport Standard**: Use remote **Streamable HTTP** and **Server-Sent Events (SSE)** client transports natively supported by `@modelcontextprotocol/client` and Cloudflare's `agents` SDK.
> 3. **Hybrid Tool & Skill Engine**: Preserve Talorys's battle-tested built-in core tools (tasks, notes, memories, reminders) while adding a dynamic remote registry persisted in SQLite inside the owner's Durable Object, loading external MCP tools and skill prompt instructions on demand.

***

## 1. Overview & Core Concept

### What It Does
Talorys is a private, self-hosted personal AI assistant running inside a single Cloudflare Durable Object SQLite instance. This redesign upgrades Talorys into an extensible agent platform:
- **Remote MCP Client**: Connects securely to external MCP tool servers (hosted anywhere on the internet, on private servers, or inside other Cloudflare Workers) over HTTP POST and SSE.
- **Dynamic Skills (`SKILL.md`) Engine**: Allows the owner to register or import modular skills (specialized domain instructions, scripts, and tool requirements formatted according to the standard `SKILL.md` specification).
- **On-Demand Tool & Prompt Resolution**: Instead of overloading the model context with hundreds of static tool schemas on every turn, the agent dynamically discovers, filters, and loads only the tools and instructions needed for the current prompt.

### Feasibility Assessment: "How Hard Is It?"
- **Overall Complexity**: **Moderate (5/10)**.
- **Why it is much easier than expected**:
  1. Talorys **already uses Cloudflare's `agents` SDK** (`agents: ^0.28.0` in `apps/agent/package.json`), which already has native MCP client support built-in (`addMcpServer()`, `SSEClientTransport`, and `StreamableHTTPClientTransport` from `@modelcontextprotocol/client`).
  2. Cloudflare's `agents` package already includes the `@cloudflare/agents/skills` subsystem with `parseSkillMarkdown`, `parseSkillFrontmatter`, and `SkillRegistry`.
  3. Talorys already possesses an extensible `ToolExecutor` and `defineTool` registry in `apps/agent/src/tools/registry.ts`, making it straightforward to wrap remote MCP tool calls into Talorys's existing safety, rate-limiting, and owner-approval system.

***

## 2. User Experience & Visual Design

The UI will gain an **Agent Studio & Integrations** tab inside the existing Talorys web workspace, designed strictly according to the clean, quiet aesthetic constitution (no pill-shaped badges, no fake cockpit scoreboards, no pulsing status dots):

### Key User Flows
1. **MCP Server Connection**:
   - The owner opens **Settings → Integrations & MCP**.
   - Clicks "Add Remote MCP Server", enters the server URL (e.g., `https://mcp.example.com/sse` or `https://my-worker.workers.dev/mcp`), optional API token/header, and connection label.
   - The backend connects, runs protocol handshake, lists available tools, and shows them cleanly in a tabular grid with permission toggles (`Read-only`, `Requires Approval`, `Direct Execution`).
2. **Skills Library & Inspector**:
   - The owner can view active skills (e.g., `github-management`, `financial-research`, `code-review`) or add new ones by pasting a `SKILL.md` or loading from a remote URL.
   - The UI parses YAML frontmatter (name, description, triggers) and previews instructions.
3. **Interactive Chat with Remote Tools**:
   - In chat, when the user asks a question requiring an external service (e.g. "Check open PRs on GitHub" or "Query external database"), Talorys invokes the remote MCP tool via HTTP/SSE.
   - If marked as destructive or requiring approval, Talorys uses its existing `ApprovalCard` component to let the user approve or reject before execution.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Talorys  ·  Integrations & Model Context Protocol (MCP)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ REMOTE MCP SERVERS                                                          │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Name              Endpoint                      Status    Tools  Action │ │
│ │ GitHub Tools      https://mcp.github.com/sse    Connected  12    Edit   │ │
│ │ Cloudflare DNS    https://mcp.cloudflare.com/   Connected   2    Edit   │ │
│ │ Notion Workspace  https://notion-mcp.app/sse    Connected   8    Delete │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ [+ Connect New MCP Server]                                                  │
│                                                                             │
│ DYNAMIC SKILLS (SKILL.MD)                                                   │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Skill             Trigger / Domain              Source    Mode          │ │
│ │ Financial Planner Budgeting, stocks, portfolio  Custom    Always On     │ │
│ │ Code Reviewer     Diffs, pull requests, PRs     GitHub    On-Demand     │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ [+ Import Skill from URL or Markdown]                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

***

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Transport Protocol for Remote MCP
- **Chosen Approach**: Remote **Streamable HTTP** (MCP 2025+ standard) with fallback to **Server-Sent Events (SSE)**.
- **Why**: Cloudflare Workers environment natively supports Web Standard `fetch()`, `ReadableStream`, and SSE parsing. Standard `stdio` transports cannot run in edge worker isolates because there is no local shell or spawned child process.
- **Trade-off**: Requires MCP servers to be accessible via HTTPS endpoints (either hosted publicly, behind Cloudflare Access / Zero Trust tunnels, or on services like ngrok/tailscale).

### Decision 2: Durable Object State & Persistence
- **Chosen Approach**: Persist server credentials, remote tool metadata, and skill manifests directly inside the agent's SQLite database (`mcp_servers`, `mcp_tools`, and `skills` tables).
- **Why**: Keeps all connection parameters and configurations completely private in the owner's Durable Object. Sessions reconnect lazily when the agent receives a turn.

### Decision 3: Context-Window Budgeting & Tool Selection
- **Chosen Approach**: Two-tiered tool exposure. Core tools (tasks, notes, memories) are always active. Remote MCP tools are either pinned or dynamically selected based on query intent embeddings/keyword scoring, preventing context window bloat.
- **Why**: Exposing 50+ remote MCP tools simultaneously can exhaust small context windows (Llama 3.3 70B) and increase prompt costs. Dynamic filtering keeps turns fast and inexpensive.

***

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TALORYS FRONTEND (Web)                            │
│           Chat Page  ·  Tasks  ·  Notes  ·  Integrations & MCP UI           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ /api/chat & /api/mcp
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TALORYS AGENT WORKER (Durable Object)                    │
│                                                                             │
│  ┌───────────────────────┐             ┌─────────────────────────────────┐  │
│  │     AgentRunner       │◄────────────┤         SkillRegistry           │  │
│  │ (Context, Prompt, LLM)│             │ (Parses SKILL.md, frontmatter)  │  │
│  └───────────┬───────────┘             └────────────────┬────────────────┘  │
│              │                                          │                   │
│              ▼                                          ▼                   │
│  ┌───────────────────────┐             ┌─────────────────────────────────┐  │
│  │     ToolExecutor      │             │        DO SQLite Storage        │  │
│  │ (Safety, Approvals)   │             │ (mcp_servers, skills, settings) │  │
│  └─────┬───────────┬─────┘             └─────────────────────────────────┘  │
│        │           │                                                        │
│        ▼           ▼                                                        │
│   [Core Tools]  [MCP Client Manager]                                        │
│   • Tasks        • StreamableHTTPClientTransport                            │
│   • Notes        • SSEClientTransport                                       │
│   • Memories     • Dynamic schema conversion (JSONSchema -> Zod)            │
└────────┼───────────┼────────────────────────────────────────────────────────┘
         │           │
         │           │ HTTP/SSE fetch()
         ▼           ▼
   [Local State]  [Remote MCP Servers] (e.g., GitHub, Cloudflare, Databases)
```

### Proposed Database Schema Additions (DO SQLite)

```sql
-- Registered remote MCP servers
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  transport TEXT NOT NULL CHECK(transport IN ('http', 'sse')),
  auth_header TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Cached remote tools catalog
CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schema_json TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced TEXT NOT NULL
);

-- Dynamic skills catalog (SKILL.md)
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  markdown_content TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Phase-by-Phase Execution Plan

#### Step 1: Revert Codebase to Clean Original State
- Revert all modified files back to the original git commit:
  - `package.json`
  - `apps/web/package.json`
  - `apps/web/vite.config.ts`
  - `apps/web/index.html`
- Remove temporary mock files:
  - `apps/web/mock-api.ts`
  - `metadata.json` (or retain applet identification metadata)
- Verify repository tree is pristine.

#### Step 2: Implement MCP Client Layer (`apps/agent/src/mcp/`)
- Create `McpClientManager` leveraging `@modelcontextprotocol/client`:
  - `StreamableHTTPClientTransport` for standard remote HTTP endpoints.
  - `SSEClientTransport` for event-stream based MCP servers.
- Add tool transformer: converts MCP JSON-Schema definitions into runtime `ProviderTool` objects and registers them into `ToolExecutor`.
- Implement security guards: any remote tool can be configured with `permission: "destructive"`, automatically plugging into Talorys's existing `approvalGuards`.

#### Step 3: Implement Skills Subsystem (`apps/agent/src/skills/`)
- Create `SkillService` in `apps/agent/src/skills/service.ts`:
  - Uses `parseSkillMarkdown` and `parseSkillFrontmatter` from `agents/skills`.
  - Ingests standard `SKILL.md` markdown files.
  - Injects relevant skill guidance into `buildSystemPrompt()` during chat turns.

#### Step 4: Add Backend Routes & Frontend Management UI
- Add API routes in `apps/agent/src/api/routes/mcp.ts` and `skills.ts`:
  - `GET /api/mcp/servers`, `POST /api/mcp/servers`, `DELETE /api/mcp/servers/:id`
  - `POST /api/mcp/servers/:id/sync` (refreshes tool list via MCP `tools/list`)
  - `GET /api/skills`, `POST /api/skills`, `PATCH /api/skills/:id`
- Add UI view in `apps/web/src/pages/SettingsPage.tsx` or new `IntegrationsPage.tsx` for managing connections and viewing skills.
