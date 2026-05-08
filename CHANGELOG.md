# Changelog

All notable changes to TokenHub MCP are documented here.

## Unreleased

- Added a trusted-local extension system with `tokenhub.extensions.json`, `--extensions <path>`, and `TOKENHUB_EXTENSIONS`.
- Added `extension_call` for invoking configured MCP stdio server tools and local command tools through the existing six-tool public surface.
- Added extension documentation and regression tests for discovery, execution, MCP allowlists, command output resources, and secret redaction.

## 0.1.0 - 2026-05-07

- Added the production MCP server package with the six-tool public surface.
- Added token-budgeted retrieval for files, git, web pages, search, GitHub, npm docs, SQLite, Postgres, Sentry, and browser state.
- Added `resolve_request`, `answer_from_web`, validation, filesystem, git, and project scan workflows.
- Added resource-backed large-output handling through `tokenhub://resource/...` handles.
- Added workspace path confinement, secret redaction, process-level filesystem mutation opt-in, and public-network-only web/browser retrieval by default.
- Added release verification, packaging tests, install smoke testing, security regression tests, and documentation for operators and contributors.
