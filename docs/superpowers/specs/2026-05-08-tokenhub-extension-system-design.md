# TokenHub Extension System Design

## Goal

Add a plug-and-play extension system that lets users add their own MCP servers and local command tools to TokenHub without increasing the always-loaded public MCP surface.

The first release supports two trusted-local extension types:

- MCP stdio servers configured by command, arguments, environment allowlist, and tool allowlist.
- Local command tools configured by command, fixed arguments, input schema, timeout, and output policy.

Extensions are discovered and executed through TokenHub's existing public tools, primarily `discover_capabilities` and `run_workflow`.

## Non-Goals

- Dynamic npm package plugin execution.
- Remote HTTP MCP transports.
- Registering each extension as a new top-level public MCP tool.
- Allowing prompt input to choose arbitrary executables.
- Sandboxing untrusted extensions beyond TokenHub's existing trusted-local process boundary.

## User Configuration

TokenHub loads an optional JSON file named `tokenhub.extensions.json` from the workspace root by default. A CLI flag or environment variable can point to a different file.

The manifest has a version and an extension list:

```json
{
  "version": 1,
  "extensions": [
    {
      "id": "demo-mcp",
      "type": "mcp",
      "title": "Demo MCP",
      "command": "node",
      "args": ["tools/demo-mcp/server.mjs"],
      "env": ["DEMO_TOKEN"],
      "tools": ["lookup"]
    },
    {
      "id": "local-lint",
      "type": "command",
      "title": "Local Lint Helper",
      "command": "node",
      "args": ["tools/lint-helper.mjs"],
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" }
        },
        "additionalProperties": false
      },
      "timeoutMs": 30000,
      "output": "summary"
    }
  ]
}
```

## Runtime Architecture

`createTokenHubRuntime` accepts an optional extension config path. During runtime creation, TokenHub attempts to load the manifest if it exists. Invalid manifests fail closed and surface a clear configuration error when extension capabilities are used.

Valid extensions are converted into capability manifests with ids under the `extension.` namespace. Examples:

- `extension.demo-mcp.lookup`
- `extension.local-lint.run`

These manifests appear in `discover_capabilities` alongside built-in capabilities, but they do not change `publicToolNames`.

Execution uses a new workflow name, `extension_call`, with these inputs:

- `extensionId`
- `toolName`
- `input`
- optional `budgetTokens`
- optional `includeRaw`

`run_workflow` dispatches `extension_call` to an extension manager. The manager finds the configured extension and calls the matching adapter.

## MCP Adapter

MCP extensions use stdio transport and are started lazily on first use. TokenHub lists tools from the MCP server, filters them by the configured allowlist, and caches the result for discovery.

Calls are routed only to tools exposed by the extension config. The adapter passes structured input as JSON-RPC/MCP tool input, records execution duration, stores large results as resources, and returns compact text content to the caller.

The first implementation can keep MCP server process lifetime simple: start on demand, reuse while the TokenHub process lives, and close when the process exits.

## Local Command Adapter

Command extensions execute only configured commands and fixed args. User input is passed as JSON on stdin. TokenHub does not invoke a shell and does not interpolate user strings into command lines.

The adapter uses:

- workspace root as cwd by default
- configurable timeout with a safe maximum
- bounded stdout/stderr collection
- secret redaction before response/resource storage
- nonzero exit handling with warnings instead of silent success

## Security Model

The extension manifest is trusted-local configuration, similar to MCP client configuration. Prompt or MCP client input cannot add new extension commands or override configured executables.

Environment variables are inherited only by explicit name allowlist for MCP extensions and command tools. This avoids leaking the entire TokenHub process environment to extensions.

Extension outputs are treated as untrusted model-facing text. TokenHub redacts common secret patterns and stores large raw output behind `tokenhub://resource/...` handles.

## Documentation

Docs must cover:

- `tokenhub.extensions.json` manifest shape.
- CLI/env config path selection.
- How to add an external MCP stdio server.
- How to add a local command tool.
- Security and trust expectations.
- Example `run_workflow` calls.

## Testing

Tests should be written before implementation for:

- manifest loading and validation
- discovery without changing the six public top-level tools
- local command extension execution through `run_workflow`
- rejection of unknown extension ids, tool names, and unconfigured commands
- MCP extension discovery and call via a fixture MCP server
- docs contract coverage for the new workflow and configuration

## Release Criteria

The feature is complete when:

- Users can add MCP stdio servers and local command tools with no source-code changes.
- Extensions are discoverable through `discover_capabilities`.
- Extensions are callable through `run_workflow` using `extension_call`.
- Existing public MCP tool names remain unchanged.
- Tests, lint, benchmark, evals, package dry run, and install smoke checks pass.
