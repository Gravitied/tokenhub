# Configuration

TokenHub runs as a stdio MCP server. The only required runtime input is the workspace root.

## CLI

Run without installing:

```bash
npx tokenhub-mcp --root /path/to/workspace
```

Run after global install:

```bash
npm install -g tokenhub-mcp
tokenhub-mcp --root /path/to/workspace
```

Useful non-server commands:

```bash
tokenhub-mcp --help
tokenhub-mcp --version
```

Load a custom extension manifest:

```bash
tokenhub-mcp --root /path/to/workspace --extensions /path/to/tokenhub.extensions.json
```

## MCP Client Configuration

Use `npx`:

```json
{
  "mcpServers": {
    "tokenhub": {
      "command": "npx",
      "args": ["tokenhub-mcp", "--root", "/path/to/workspace"]
    }
  }
}
```

Use a global install:

```json
{
  "mcpServers": {
    "tokenhub": {
      "command": "tokenhub-mcp",
      "args": ["--root", "/path/to/workspace"]
    }
  }
}
```

On Windows, keep `--root` and the path as separate JSON args, and escape backslashes:

```json
["--root", "C:\\Users\\you\\workspace"]
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `BRAVE_SEARCH_API_KEY` | Enables Brave Search provider selection. |
| `EXA_API_KEY` | Enables Exa search provider selection. |
| `TAVILY_API_KEY` | Enables Tavily search provider selection. |
| `SERPAPI_API_KEY` | Enables SerpAPI search provider selection. |
| `TOKENHUB_ENABLE_FS_MUTATIONS` | Enables trusted-local filesystem write, move, and delete when set to `true`. |
| `TOKENHUB_ALLOW_PRIVATE_NETWORK` | Allows trusted-local web and browser retrieval of localhost, private LAN, and other non-public network targets when set to `true`. |
| `TOKENHUB_EXTENSIONS` | Optional path to a user extension manifest. The default path is `tokenhub.extensions.json` in the workspace root. |

## Per-Request Inputs

Some providers use explicit request fields instead of environment variables:

| Provider | Input |
| --- | --- |
| GitHub | `owner`, `repo`, optional `token` |
| Sentry | `issues` array, or `organization` plus `token` |
| Postgres | `connectionString` |
| SQLite | `databaseBase64` |
| npm docs | `packageName` or `query` |
| Browser capture | `url` |

## Filesystem Mutation Policy

Filesystem tree listing and search are available by default. Write, move, and delete are disabled unless this explicit process-level opt-in is present:

- process env: `TOKENHUB_ENABLE_FS_MUTATIONS=true`

Use mutation opt-in only for trusted local workspaces.

## Extension Manifest

TokenHub can load trusted-local user extensions from `tokenhub.extensions.json` in the workspace root, `--extensions <path>`, or `TOKENHUB_EXTENSIONS`.

Command tools run a configured executable with fixed args and receive the workflow `input` as JSON on stdin:

```json
{
  "version": 1,
  "extensions": [
    {
      "id": "local-echo",
      "type": "command",
      "title": "Local Echo",
      "command": "node",
      "args": ["tools/echo.mjs"],
      "inputSchema": { "type": "object" },
      "timeoutMs": 5000
    }
  ]
}
```

MCP extensions start a configured stdio MCP server and expose only allowlisted tools:

```json
{
  "version": 1,
  "extensions": [
    {
      "id": "fixture-mcp",
      "type": "mcp",
      "title": "Fixture MCP",
      "command": "node",
      "args": ["tools/fixture-mcp.mjs"],
      "env": ["FIXTURE_TOKEN"],
      "tools": ["lookup"]
    }
  ]
}
```

Call extensions through `run_workflow`:

```json
{
  "name": "extension_call",
  "extensionId": "fixture-mcp",
  "toolName": "lookup",
  "input": { "query": "alpha" }
}
```
