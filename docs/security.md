# Security

TokenHub is a local developer service. Its security model depends on clear workspace boundaries, explicit mutation opt-in, and careful handling of provider credentials.

## Workspace Boundary

The configured `--root` bounds filesystem and git operations. Path handling covers:

- POSIX paths
- Windows drive paths
- UNC-like roots
- cross-drive rejection
- lexical workspace escape rejection
- realpath checks for deterministic symlink/junction escapes during mutation actions

The service should still be treated as a trusted-local developer tool, not as a multi-tenant sandbox.

## Filesystem Mutations

Read/list operations are available by default. Write, move, and delete are disabled by default because portable Node.js path validation cannot completely eliminate all path-swap races in a writable workspace.

Enable mutations only in trusted workspaces:

```bash
TOKENHUB_ENABLE_FS_MUTATIONS=true tokenhub-mcp --root /path/to/workspace
```

## Secrets

TokenHub redacts secret-looking values in file snippets, validation logs, and stored text resources before they are returned to the model-facing client. Do not rely on regex redaction as the only secret-control layer. Prefer passing credentials as request inputs rather than embedding them in natural-language prompts.

## Network Calls

These capabilities may contact external services:

- web fetch
- web search providers
- GitHub
- npm registry
- Sentry
- Postgres
- browser capture targets

Treat URLs, tokens, connection strings, returned pages, and screenshots as sensitive data. Browser screenshots may contain visible secrets even when text resources are redacted.

Web and browser retrieval validate outbound targets before fetching. By default they allow only verified public `http` and `https` URLs and reject localhost, private LAN, metadata, reserved, and DNS-unverified targets. For trusted local debugging, start the service with:

```bash
TOKENHUB_ALLOW_PRIVATE_NETWORK=true tokenhub-mcp --root /path/to/workspace
```

## Extensions

Extensions are trusted-local configuration loaded from `tokenhub.extensions.json`, `--extensions <path>`, or `TOKENHUB_EXTENSIONS`. They are not a remote plugin sandbox.

`extension_call` cannot choose arbitrary executables or args. It can only call extension ids and tool names present in the manifest. Command extensions run without shell interpolation and receive JSON input on stdin. MCP extensions expose only the tool names listed in the manifest.

Extension child processes inherit a small safe environment plus explicit variable names listed in each extension's `env` array. Do not add broad secret-bearing environment names unless the extension genuinely needs them.

## Git Actions

`git_action` can stage, commit, and branch when explicitly requested. Run it only in a workspace where agent-driven git changes are acceptable, and review staged changes before pushing.

## Resource Handles

`tokenhub://resource/...` handles point to locally stored artifacts. Anyone with access to the workspace resource directory and the handle can read the resource through TokenHub. Do not share resource handles with clients that should not see workspace-derived content.
