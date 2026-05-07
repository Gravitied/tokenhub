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

Filesystem tree listing and search are available by default. Write, move, and delete are disabled unless one of these explicit opt-ins is present:

- process env: `TOKENHUB_ENABLE_FS_MUTATIONS=true`
- per-call input: `allowUnsafeMutations: true`

Use mutation opt-in only for trusted local workspaces.
