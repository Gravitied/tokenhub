# TokenHub Public Release Feature Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the next production-release feature pack: workspace indexing, extension authoring CLI checks, security policy enforcement, native MCP resources, browser scenarios, diagnostics packs, and MCP Registry install support.

**Architecture:** Keep the six public MCP tools stable while adding internal modules and selected workflow names. Local authoring and install operations live in CLI subcommands; potentially dangerous MCP-triggered behavior is guarded by explicit policy and existing mutation opt-ins.

**Tech Stack:** TypeScript, Node.js, Vitest, MCP TypeScript SDK, Playwright, Zod, `rg` when available with a filesystem fallback.

---

### Task 1: Workspace Index And rg Search

**Files:**
- Create: `src/core/workspace-index.ts`
- Modify: `src/modules/filesystem.ts`
- Test: `tests/workspace-index.test.ts`

- [ ] Add tests for workspace indexing with ignored directories, stable relative POSIX paths, and injected `rg` search results.
- [ ] Implement an index builder that uses `rg --files` when available and falls back to the existing walker.
- [ ] Route `searchFiles` through the index/search backend and include backend metadata without changing compact output.

### Task 2: Extension Lint And Test CLI

**Files:**
- Create: `src/extensions/doctor.ts`
- Modify: `src/cli-options.ts`
- Modify: `src/cli.ts`
- Test: `tests/extensions.test.ts`
- Test: `tests/cli.test.ts`

- [ ] Add parser tests for `extensions lint` and `extensions test`.
- [ ] Add doctor tests for manifest validation, command path checks, and local command smoke execution.
- [ ] Implement `lintExtensionManifest` and `testExtensionManifest`.
- [ ] Wire CLI subcommands that exit nonzero on failed checks and print concise diagnostics.

### Task 3: Security Policy Engine

**Files:**
- Create: `src/core/security-policy.ts`
- Modify: `src/core/url-policy.ts`
- Modify: `src/server.ts`
- Modify: `src/sources/registry.ts`
- Modify: `src/sources/defaults.ts`
- Test: `tests/security-policy.test.ts`

- [ ] Add tests for denied workflows, denied retrieval sources, extension deny rules, and allowed-host URL policy.
- [ ] Load optional `tokenhub.policy.json` with fail-closed validation.
- [ ] Enforce workflow/source/extension rules in runtime dispatch.
- [ ] Thread network host policy into web and browser fetch paths.

### Task 4: MCP-Native Resources And Templates

**Files:**
- Modify: `src/core/resources.ts`
- Modify: `src/server.ts`
- Test: `tests/mcp-resources.test.ts`

- [ ] Add tests for `ResourceStore.list()`.
- [ ] Add MCP client tests for `resources/templates/list`, `resources/list`, and `resources/read`.
- [ ] Register a `tokenhub://resource/{id}` template and list stored TokenHub resources natively.

### Task 5: Browser Scenario Runner

**Files:**
- Create: `src/modules/browser-scenario.ts`
- Modify: `src/workflows/index.ts`
- Modify: `src/server.ts`
- Test: `tests/browser-scenario.test.ts`

- [ ] Add tests for step parsing, success traces, failed expectations, screenshot resources, and network policy.
- [ ] Implement scenario steps for `click`, `fill`, `press`, `waitForText`, `expectText`, and `screenshot`.
- [ ] Add the `browser_scenario` workflow using structured `input.steps`.

### Task 6: Structured Diagnostics Packs

**Files:**
- Create: `src/core/diagnostics-pack.ts`
- Modify: `src/workflows/index.ts`
- Modify: `src/server.ts`
- Test: `tests/diagnostics-pack.test.ts`

- [ ] Add tests for a redacted JSON diagnostics pack with runtime, git, workspace, source, workflow, policy, and extension sections.
- [ ] Implement a bounded collector that stores the pack as a resource.
- [ ] Add the `diagnostics_pack` workflow.

### Task 7: MCP Registry Install Flow

**Files:**
- Create: `src/extensions/mcp-registry.ts`
- Modify: `src/extensions/config.ts`
- Modify: `src/extensions/mcp-adapter.ts`
- Modify: `src/extensions/manager.ts`
- Modify: `src/cli-options.ts`
- Modify: `src/cli.ts`
- Test: `tests/mcp-registry.test.ts`
- Test: `tests/cli.test.ts`

- [ ] Add tests for registry search normalization and manifest installation from an npm stdio package.
- [ ] Support `tools: ["*"]` for trusted local MCP extensions installed from the registry while still verifying advertised tools at call time.
- [ ] Add `registry search` and `registry install` CLI subcommands.
- [ ] Keep registry install as a local CLI flow, not a public MCP mutation workflow.

### Final Verification

- [ ] Run targeted tests for new files.
- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run verify:release`.
- [ ] Run `git diff --check`.
