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
tokenhub-mcp extensions lint --root /path/to/workspace
tokenhub-mcp extensions test --root /path/to/workspace --extension local-echo --tool run --input-json '{"message":"hello"}'
tokenhub-mcp registry search filesystem
tokenhub-mcp registry install filesystem --root /path/to/workspace
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
| `TOKENHUB_POLICY` | Optional path to a security policy file. The default path is `tokenhub.policy.json` in the workspace root. |
| `TOKENHUB_ENABLE_BROWSER_POOL` | Enables a bounded warm Playwright browser pool for repeated browser capture calls when set to `true`. |

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

Retrieval calls also accept:

| Input | Values | Purpose |
| --- | --- | --- |
| `responseProfile` | `minimal`, `standard`, `detailed`, `audit` | Selects verbosity, default token budget scaling, compact projections, and evidence density. |
| `returnMode` | `summary`, `compact` | Explicitly requests the legacy summary shape or compact tuple shape where supported. |
| `budgetTokens` | positive integer | Overrides the profile's default token budget ceiling. |

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
      "tools": ["lookup"],
      "pool": { "enabled": true, "ttlMs": 30000, "maxUses": 100 }
    }
  ]
}
```

The optional `pool` block is available only for MCP extensions. It reuses the configured MCP client for repeated calls until the TTL or max-use limit is reached.

For trusted-local registry installs, TokenHub can generate an MCP extension entry from the official MCP Registry:

```bash
tokenhub-mcp registry search filesystem
tokenhub-mcp registry install filesystem --root /path/to/workspace --tools read_file,write_file
```

If `--tools` is omitted, the installer writes `"tools": ["*"]`. Wildcard entries are still checked against the MCP server's advertised tool list at call time.

Call extensions through `run_workflow`:

```json
{
  "name": "extension_call",
  "extensionId": "fixture-mcp",
  "toolName": "lookup",
  "input": { "query": "alpha" }
}
```

## Security Policy

An optional `tokenhub.policy.json` can constrain runtime dispatch:

```json
{
  "version": 1,
  "workflows": { "deny": ["validate"] },
  "sources": { "allow": ["files", "git", "web"] },
  "extensions": { "deny": ["experimental-tool"] },
  "network": {
    "allowPrivateNetwork": false,
    "allowedHosts": ["docs.example.com"],
    "blockedHosts": ["blocked.example.com"]
  }
}
```

Policy checks happen before workflow, retrieval source, or extension adapter execution. Host allowlists apply to web and browser URL retrieval.
