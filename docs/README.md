# TokenHub Documentation

This directory is the operator and contributor manual for TokenHub MCP. The root README is optimized for npm and GitHub visitors; these docs explain how the service is built, configured, operated, secured, and released.

## Contents

| Document | Audience | Covers |
| --- | --- | --- |
| [Architecture](architecture.md) | Maintainers and integrators | MCP server shape, public tool surface, internal modules, workflow routing, extension flow, resource storage, eval artifacts. |
| [Configuration](configuration.md) | Operators and MCP client users | CLI usage, MCP JSON examples, provider inputs, environment variables, extension manifests, filesystem mutation opt-in. |
| [Operations](operations.md) | Operators and support owners | Install, run, validate, smoke test, common failures, maintenance commands. |
| [Security](security.md) | Security reviewers and operators | Workspace boundaries, filesystem mutation risk, secrets, network calls, Git actions, resource access. |
| [Release](release.md) | Release owners | Verification gate, npm pack contract, smoke install, eval evidence, rollback checklist. |
| [Performance, token, quality, and modularity research](research/2026-05-09-performance-token-quality-modularity.md) | Maintainers | Research-backed improvement methods for performance, token savings, output quality, verbosity, and modularity. |

Root-level public release files:

- [CHANGELOG.md](../CHANGELOG.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [SECURITY.md](../SECURITY.md)
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)

## Production Contract

TokenHub is distributed as the `tokenhub-mcp` npm package and starts with:

```bash
npx tokenhub-mcp --root /path/to/workspace
```

It exposes exactly six public MCP tools:

- `discover_capabilities`
- `run_workflow`
- `retrieve_context`
- `read_resource`
- `capture_state`
- `estimate_cost`

Larger capabilities are intentionally deferred behind workflows, retrieval sources, and configured extensions so MCP clients do not need to load every schema up front.

## Verification Summary

The production release gate is:

```bash
npm run verify:release
```

That command runs linting, tests, build, local evals, live source-quality evals, npm pack dry run, and installed-package smoke testing.
