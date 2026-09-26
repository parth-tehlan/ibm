# IBM Bob IDE — MCP Server Documentation: Implementation Facts

Scraped sources (all retrieved successfully, no login required):
- https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob
- https://bob.ibm.com/docs/ide/configuration/mcp/server-transports
- https://bob.ibm.com/docs/ide/configuration/mcp/understanding-mcp
- https://bob.ibm.com/docs/ide/configuration/custom-modes

All pages returned live content. None 404'd and none required login.

---

## 1. How to define an MCP server in Bob IDE config

**Format: JSON only.** Both config files are JSON with an `mcpServers` object containing named server configurations.

Two configuration **levels** (both JSON):

| Level | File path | Usage |
|---|---|---|
| **Global** | `~/.bob/settings/mcp.json` | Applies across all workspaces |
| **Project** | `.bob/mcp.json` (project root) | Team sharing via version control |

- Project-level config takes **precedence** over global when server names conflict.
- Bob creates `.bob/mcp.json` automatically if it does not exist (when you use "Edit Project MCP" from the settings menu).

**Where to edit via UI:**
1. Click the settings gear icon in the Bob panel
2. Select the **MCP** tab
3. Choose **Edit Global MCP** or **Edit Project MCP**

> Security note (from Understanding MCP): never hardcode API keys/tokens in MCP config files. Use environment variables or a vault; do NOT commit config files containing secrets to source control (add to `.gitignore`).

---

## 2. Transport types supported

The main page documents **two**; the transports page documents **three**:

1. **STDIO** — local servers running on your machine (child process, JSON-RPC 2.0 over stdin/stdout).
2. **Streamable HTTP** — modern standard for remote servers over HTTP/HTTPS (`type: "streamable-http"`, single MCP endpoint).
3. **SSE (legacy)** — legacy remote option; the docs say "For new remote servers, use Streamable HTTP transport instead."

**Reporter's note:** The MCP-in-Bob nav sidebar lists only "Understanding MCP / MCP server transports / Using MCP in Bob / MCP OAuth" — but the **server-transports** page itself documents all three transports (STDIO, Streamable HTTP, SSE-legacy) with implementation examples.

Transport comparison (from server-transports page):

| Consideration | STDIO | Streamable HTTP / SSE |
|---|---|---|
| Location | Local machine only | Local or remote |
| Clients | Single client | Multiple clients |
| Network access | **Not needed** | Required |
| Security | Inherently secure | Requires explicit measures |
| Deployment | Per-user installation | Centralized installation |

---

## 3. Exact schema / example for a local STDIO server

**Config parameters (STDIO transport):**

| Parameter | Required | Description |
|---|---|---|
| `command` | **Yes** | Executable to run (e.g. `node`, `python`, `npx`) |
| `args` | No | Array of arguments to pass to the command |
| `cwd` | No | Working directory for the server process |
| `env` | No | Environment variables for the server process |
| `alwaysAllow` | No | Array of tool names to auto-approve |
| `disabled` | No | Set to `true` to disable this server |

**Exact example from the docs:**

```json
{
  "mcpServers": {
    "local-server": {
      "command": "node",
      "args": ["server.js"],
      "cwd": "/path/to/project/root",
      "env": {
        "API_KEY": "your_api_key"
      },
      "alwaysAllow": ["tool1", "tool2"],
      "disabled": false
    }
  }
}
```

**STDIO transport mechanics** (server-transports page):
- Bob spawns the MCP server as a **child process**.
- Communication via process streams: Bob writes to server's STDIN, server responds on STDOUT.
- Each message delimited by a **newline**; messages are **JSON-RPC 2.0**.
- One-to-one relationship between client and server.
- Server starts and stops with Bob (child process lifecycle).

**Streamable HTTP example** (main page) for completeness:

```json
{
  "mcpServers": {
    "remote-server": {
      "type": "streamable-http",
      "url": "https://your-server-url.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      },
      "alwaysAllow": ["tool3"],
      "disabled": false
    }
  }
}
```

Note: the `type` field appears in the HTTP example but **not** in the STDIO example — STDIO servers do not require a `type` field in the documented schema.

---

## 4. How MCP tools are exposed / authorized (tool group `mcp`)

**Important distinction — what the docs actually say:**

- The **MCP-in-Bob page does NOT mention a tool group called `mcp`** anywhere. It does not describe MCP tools as being under any named "tool group" on that page.
- The concept of `mcp` as a **tool group** comes from the **Custom modes** page, where `mcp` is one of the **available tool groups** a mode can be granted access to: "`mcp`: Access MCP servers".

**Tool authorization model (from MCP-in-Bob page):**

- **Global on/off:** The "Use MCP Servers" setting (enabled by default). When disabled, Bob removes MCP logic from the system prompt, cannot connect to servers, and the `use_mcp_tool` and `access_mcp_resource` tools become unavailable. This implies Bob exposes MCP capabilities via built-in tools called `use_mcp_tool` and `access_mcp_resource`.
- **Per-server/per-tool control:** Under the MCP tab you can expand a server and toggle **individual tools** on/off. This controls which capabilities Bob can access and reduces context-window usage by excluding unused tool definitions.
- **Per-server actions:** Delete, Restart, Enable/Disable (power toggle), and a **Network timeout** (30 seconds to 5 minutes, default 1 minute).
- **Auto-approve (per-tool, off by default):**
  1. Enable the global "Use MCP servers" option in **Auto-approving actions**.
  2. In the MCP server settings, locate the tool and check **Always allow**.
  3. The global setting takes precedence — if disabled, no MCP tools auto-approve. Auto-approval can also be granted per-server via the `alwaysAllow` array in the server config.

**Workflow:** You type a request → Bob analyzes the request and available MCP tools → Bob proposes tool use → you approve (unless auto-approved).

> This is precisely what we need for TRIUMPH: a local STDIO server with a JSON fixture tool delivered via `use_mcp_tool`, exposed to the session, approved per-tool or via `alwaysAllow`.

---

## 5. How the `mcp` tool group works in Custom modes

From the **Custom modes** page (MCP-in-Bob does not cover this):

- Custom modes are defined in **YAML** (global `~/.bob/settings/custom_modes.yaml` or project `.bob/custom_modes.yaml`), as an array of modes.
- Tool access is granted via the `groups:` key, and **`mcp` is one of the valid, supported tool groups**: "`mcp`: Access MCP servers".

Example mode definition granting `mcp`:

```yaml
customModes:
  - slug: my-mode
    name: My Mode
    roleDefinition: You are an assistant.
    groups:
      - read
      - mcp
```

**Validation rules that apply to tool groups:**
- Use **only supported group names**. Unknown group names do **not** grant access.
- If you **omit `groups`**, the mode gets **no grouped tools**.
- You can override default modes (e.g. Ask) by defining a mode with the same `slug`; project overrides win over global overrides, which win over defaults.
- The `ask` default-mode override example in the docs includes `mcp` in its groups: `groups: [read, mcp, skill]`.

---

## 6. Limits and gotchas

From the **deployment considerations** section (server-transports page):

**STDIO (local) constraints — relevant to serving local fixtures:**
- The server executable **must be installed on each user's machine** (no centralized install in the IDE).
- Started and stopped with Bob (child-process lifecycle).
- Uses local machine CPU/memory/disk.
- Access control relies on the local machine's filesystem permissions.
- All dependencies must be installed on the user's machine.

**Security gotchas (MCP-in-Bob "security considerations" section):**
- **Local MCP servers run with the same permissions as Bob**, can access the file system, environment variables, and system resources, and may execute arbitrary code / modify files. Only install from trusted sources.
- External/remote servers may send data to third parties — avoid with sensitive code; prefer local servers for confidential projects.
- Organizational compliance: align with security policy (GDPR/HIPAA), keep an inventory, audit usage.

**Other gotchas:**
- **Security (Understanding MCP):** protect credentials; use env vars; do not commit secret-bearing config files.
- **No pre-installed MCP servers** — IBM Bob does not ship built-in MCP servers. You build your own (MCP SDK, https://github.com/modelcontextprotocol/) or use community servers.
- **"MCP server creation" setting** is a separate toggle from "Use MCP servers" (both enabled by default). Disabling "server creation" removes instructions for Bob to *write* new MCP servers while retaining context to operate existing ones.
- **Transport choice:** STDIO needs no network (offline-safe); HTTP/SSE requires network access. If the hackathon environment is air-gapped/offline, STDIO is the only viable transport.

---

## Key facts for TRIUMPH implementation (summary)

- Config file: project-level `.bob/mcp.json` (JSON, `mcpServers` map) — checked into the repo for team sharing.
- Transport: **STDIO** (local, no network needed, child process, JSON-RPC 2.0 over stdin/stdout). No `type` field required for STDIO.
- Server: any executable (`node`/`python`/`npx`) serving JSON fixtures. It runs with Bob's permissions and can read local fixture files/`cwd`.
- Expose fixtures as an MCP tool; Bob calls it via `use_mcp_tool`. Authorize per-tool via the MCP tab (toggle + "Always allow") or via the `alwaysAllow` array in `mcp.json`.
- To guarantee a charm can call the tool, define a **custom mode** (`.bob/custom_modes.yaml`) whose `groups:` includes `mcp`.
- Watch network timeout (default 1 min) and per-tool context budget (disable unused tools).

---

*Compiled from official IBM Bob IDE docs. Citations inline per section; all facts are as documented — nothing invented. Where the docs were silent (e.g. no literal `type` field for STDIO, no `mcp` tool group mentioned in the MCP-in-Bob page), that gap is noted explicitly.*