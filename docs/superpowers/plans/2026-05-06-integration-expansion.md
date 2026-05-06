# Integration Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub, compact browser capture, real web search provider hooks, Postgres/SQLite, package docs lookup, and Sentry summaries behind TokenHub's six-tool MCP surface.

**Architecture:** Each capability is a focused internal module registered in the deferred capability registry. Public access stays through `retrieve_context`, `capture_state`, `read_resource`, and discovery, with `returnMode: "compact"` used where raw standalone tools would otherwise win on tiny fixtures.

**Tech Stack:** Node 22, TypeScript, official MCP SDK, Playwright, `pg`, `sql.js`, public GitHub/npm APIs, optional search/Sentry provider tokens.

---

### Task 1: Integration Modules

**Files:**
- Create: `src/modules/github.ts`
- Create: `src/modules/browser.ts`
- Create: `src/modules/search.ts`
- Create: `src/modules/database.ts`
- Create: `src/modules/docs.ts`
- Create: `src/modules/sentry.ts`
- Test: `tests/integrations.test.ts`

- [x] **Step 1: Write failing tests**

Tests cover compact GitHub summaries, Playwright state capture, provider result normalization, SQLite/Postgres projection, npm package lookup, and Sentry issue clustering.

- [x] **Step 2: Implement modules**

Each module returns summaries, bounded fields, redacted secrets, and token estimates rather than raw provider payloads.

- [x] **Step 3: Verify**

Run `npm test tests/integrations.test.ts`.

### Task 2: Runtime Routing

**Files:**
- Modify: `src/server.ts`
- Test: `tests/integrations.test.ts`

- [x] **Step 1: Register deferred capabilities**

Add registry entries for GitHub, browser, search, SQLite, Postgres, docs/npm, and Sentry.

- [x] **Step 2: Route through `retrieve_context`**

Support new `source` values plus `returnMode: "compact"` for browser, search, SQLite, and Sentry.

- [x] **Step 3: Verify**

Run `npm test tests/integrations.test.ts`.

### Task 3: Competitive Benchmark Expansion

**Files:**
- Modify: `scripts/run-benchmarks.mjs`
- Modify: `src/bench/competitors.ts`
- Generate: `artifacts/benchmarks/competitive-report.json`

- [x] **Step 1: Add free baselines**

Include public GitHub REST, Playwright raw HTML, provider JSON, SQL.js raw rows, npm registry JSON, and raw Sentry-shaped issues, with standalone tool overhead counted consistently.

- [x] **Step 2: Improve weak spots**

Compact routing was added for browser, search, SQLite, and Sentry after benchmarks showed full internal objects were too large.

- [x] **Step 3: Verify**

Run `npm run bench` and require every task to clear the significantly-better threshold.
