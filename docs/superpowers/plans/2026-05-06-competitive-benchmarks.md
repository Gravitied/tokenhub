# Competitive Benchmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare TokenHub against free developer MCPs and CLI tools with deterministic quality/token tests, then improve TokenHub where it is weaker.

**Architecture:** Add a benchmark package under `src/bench` with fixture creation, MCP client helpers, scorer functions, and a report writer. Tests exercise the scorer and require TokenHub to clear a "significantly better" threshold before external benchmarks are run manually by `npm run bench`.

**Tech Stack:** Node 22, TypeScript, Vitest, official MCP TypeScript client, free MCP baselines through `npx` and `uvx`.

---

### Task 1: Scoring Model

**Files:**
- Create: `src/bench/scoring.ts`
- Test: `tests/bench.test.ts`

- [x] **Step 1: Write failing tests**

Assert that scores reward expected facts, resource links, warnings, and low token use while penalizing secrets and raw-output bloat.

- [ ] **Step 2: Implement scoring**

Create `scoreBenchmarkResult` and `assertSignificantlyBetter` with deterministic thresholds.

- [ ] **Step 3: Verify**

Run `npm test tests/bench.test.ts`.

### Task 2: Local Competitor Harness

**Files:**
- Create: `src/bench/fixtures.ts`
- Create: `src/bench/mcpClient.ts`
- Create: `src/bench/competitors.ts`
- Create: `scripts/run-benchmarks.mjs`
- Test: `tests/bench.test.ts`

- [x] **Step 1: Write failing tests**

Assert fixture creation, competitor metadata, and report shape.

- [ ] **Step 2: Implement harness**

Use `@modelcontextprotocol/sdk/client` with `StdioClientTransport` to call official Filesystem, Git, and Fetch MCP servers when available. Include CLI baselines for `rg` and `git`.

- [ ] **Step 3: Verify**

Run `npm test tests/bench.test.ts`.

### Task 3: TokenHub Improvements

**Files:**
- Modify: `src/modules/filesystem.ts`
- Modify: `src/modules/git.ts`
- Modify: `src/modules/web.ts`
- Modify: `src/server.ts`
- Test: `tests/retrieval.test.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Add failing tests for weak spots**

If benchmarks show TokenHub loses quality or token efficiency, encode the failing case before changing implementation.

- [ ] **Step 2: Improve the module**

Prefer resource links, compact structured facts, cursors, better snippets, and redaction over larger raw output.

- [ ] **Step 3: Verify**

Run `npm test`, `npm run build`, and `npm run bench`.
