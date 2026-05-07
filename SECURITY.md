# Security Policy

TokenHub MCP is a local developer service. Please report vulnerabilities privately before opening public issues.

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting A Vulnerability

Report security issues through GitHub private vulnerability reporting for `Gravitied/tokenhub` when available. If that is not available, contact the repository owner privately and include:

- affected version or commit
- vulnerable entry point or MCP tool
- reproduction steps or proof of concept
- expected impact
- any relevant logs with secrets redacted

Do not include live credentials, private tokens, or unrelated host data in a report.

## Security Boundaries

- Filesystem reads and writes are scoped to the configured `--root` workspace.
- Write, move, and delete actions require process-level `TOKENHUB_ENABLE_FS_MUTATIONS=true`.
- Web and browser retrieval reject localhost, private LAN, metadata, reserved, and DNS-unverified targets by default.
- `TOKENHUB_ALLOW_PRIVATE_NETWORK=true` should be used only for trusted local debugging.
- Resource handles can expose locally stored artifacts to any client that can call `read_resource`; treat handles as sensitive.

## Dependency Updates

Run this before a public release:

```bash
npm audit --audit-level=moderate
npm run verify:release
```
