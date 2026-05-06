# Parity Benchmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close TokenHub feature-parity gaps and make competitor benchmarks fair, explicit, and more detailed.

**Architecture:** Keep the public MCP surface small while expanding internal modules and benchmark evidence. The report will separate feature coverage from output quality and token efficiency so TokenHub cannot claim parity from a narrow task score.

**Tech Stack:** TypeScript, Vitest, MCP SDK clients, Playwright, sql.js, pg, npm registry/GitHub/Sentry HTTP APIs, Node benchmark scripts.

---

### Task 1: Benchmark Fairness Metadata

**Files:**
- Modify: `src/bench/scoring.ts`
- Modify: `src/bench/competitors.ts`
- Modify: `scripts/run-benchmarks.mjs`
- Test: `tests/bench.test.ts`

- [ ] Add normalized task metadata for task goal, tested capabilities, baseline method, whether the baseline is live MCP, raw API, or CLI, and known parity gaps.
- [ ] Calculate quality, token, and coverage scores separately.
- [ ] Estimate public tool overhead from the actual six public schemas used by the MCP server, not only tool names.
- [ ] Make reports identify strongest competitor and whether TokenHub has full, partial, or missing feature coverage.

### Task 2: Product Parity Improvements

**Files:**
- Modify: `src/modules/filesystem.ts`
- Modify: `src/modules/git.ts`
- Modify: `src/modules/browser.ts`
- Modify: `src/modules/github.ts`
- Modify: `src/modules/database.ts`
- Modify: `src/modules/docs.ts`
- Modify: `src/modules/sentry.ts`
- Modify: `src/server.ts`
- Test: `tests/integrations.test.ts`
- Test: `tests/server.test.ts`

- [ ] Add safe filesystem write/move/delete/read-tree action support behind `run_workflow`.
- [ ] Add safe Git branch/status/diff/show/stage/commit helper support with destructive operations excluded.
- [ ] Add compact browser element refs and optional action capture for click/fill/navigation summaries.
- [ ] Add GitHub PR and workflow-run summaries.
- [ ] Add Postgres and SQLite introspection detail with safe read-only query enforcement.
- [ ] Add package docs metadata including repository, homepage, changelog/readme links without returning raw readmes by default.
- [ ] Add Sentry issue-detail summarization fields without leaking URLs or raw event payloads by default.

### Task 3: Stronger Competitor Set

**Files:**
- Modify: `src/bench/competitors.ts`
- Modify: `scripts/run-benchmarks.mjs`
- Test: `tests/bench.test.ts`

- [ ] Add official Postgres MCP, official Brave Search MCP, official GitHub MCP, and compact-browser/Charlotte-style reference metadata where free/runnable.
- [ ] Prefer live MCP invocation where no provider key or OAuth is required.
- [ ] Mark provider-key/OAuth competitors as metadata-only unless credentials are present.
- [ ] Compare against the best available competitor per task, not a handpicked weak output.

### Task 4: Verification and Proof

**Files:**
- Modify: `src/proof.ts`
- Run: `npm test`
- Run: `npm run build`
- Run: `npm run bench`
- Run: `npm run proof`

- [ ] Include feature coverage, strongest competitor, quality score, token score, and caveats in the generated proof page.
- [ ] Generate a PNG proof artifact after benchmarks complete.
- [ ] Commit only after fresh verification output is read.
