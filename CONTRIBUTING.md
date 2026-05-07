# Contributing

TokenHub MCP is a TypeScript and Node.js MCP server. Contributions should keep the public tool surface small, preserve workspace safety boundaries, and include repeatable validation.

## Local Setup

Use Node.js 20 or newer.

```bash
npm install
npm run build
node dist/cli.js --root .
```

## Development Checks

Run focused tests while developing, then run the release gate before proposing a release:

```bash
npm run lint
npm test
npm run build
npm run smoke:install
```

For release candidates:

```bash
npm run verify:release
```

The live eval portion of `verify:release` uses public web access, so investigate network/provider failures before treating them as product regressions.

## Contribution Expectations

- Add or update tests for behavior changes.
- Keep filesystem mutations disabled unless the service process is explicitly started with `TOKENHUB_ENABLE_FS_MUTATIONS=true`.
- Keep web and browser retrieval public-network-only unless the service process is explicitly started with `TOKENHUB_ALLOW_PRIVATE_NETWORK=true`.
- Do not commit `.tokenhub` resource data, generated package tarballs, local env files, or credential material.
- Update README and `docs/` when a public workflow, retrieval source, configuration input, or security boundary changes.

## Pull Request Checklist

- `npm run lint` passes.
- `npm test` passes.
- `npm run build` passes.
- `npm run smoke:install` passes for package-affecting changes.
- Public docs reflect user-visible changes.
