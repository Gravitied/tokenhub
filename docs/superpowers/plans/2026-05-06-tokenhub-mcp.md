# TokenHub MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working initial `tokenhub-mcp` package with six top-level MCP tools and token-disciplined internal modules.

**Architecture:** TypeScript package using the official MCP SDK over stdio. Internal modules are registered in a deferred registry and return compact summaries plus resource handles for large artifacts.

**Tech Stack:** Node 22, TypeScript 5.9, Vitest 4, `@modelcontextprotocol/sdk` 1.29, Zod 4, Playwright 1.59.

---

### Task 1: Telemetry, Registry, And Resources

**Files:**
- Create: `src/core/token.ts`
- Create: `src/core/telemetry.ts`
- Create: `src/core/registry.ts`
- Create: `src/core/resources.ts`
- Test: `tests/core.test.ts`

- [x] **Step 1: Write failing tests**

Tests assert ROI graduation, compact discovery ranking, resource handle creation, range reads, and budget truncation.

- [ ] **Step 2: Implement minimal core**

Implement approximate token counting, an in-memory telemetry ledger, a keyword-ranked registry, and a disk-backed resource store under `.tokenhub/resources`.

- [ ] **Step 3: Verify**

Run `npm test tests/core.test.ts`.

### Task 2: Retrieval Modules

**Files:**
- Create: `src/modules/filesystem.ts`
- Create: `src/modules/git.ts`
- Create: `src/modules/web.ts`
- Test: `tests/retrieval.test.ts`

- [x] **Step 1: Write failing tests**

Tests assert file search returns snippets and resource links, Git summary handles non-repo and repo states, and HTML fetch/scrape returns clean text rather than raw markup.

- [ ] **Step 2: Implement modules**

Use bounded recursive file scanning, `git` subprocess calls, native `fetch`, simple HTML cleanup, and token-budgeted outputs.

- [ ] **Step 3: Verify**

Run `npm test tests/retrieval.test.ts`.

### Task 3: Workflows And MCP Surface

**Files:**
- Create: `src/workflows/index.ts`
- Create: `src/server.ts`
- Create: `src/cli.ts`
- Test: `tests/server.test.ts`

- [x] **Step 1: Write failing tests**

Tests assert only six public tools are advertised and workflows batch project scans plus validation commands.

- [ ] **Step 2: Implement server**

Register `discover_capabilities`, `run_workflow`, `retrieve_context`, `read_resource`, `capture_state`, and `estimate_cost` with compact schemas.

- [ ] **Step 3: Verify**

Run `npm test tests/server.test.ts`.

### Task 4: Proof Artifacts

**Files:**
- Create: `scripts/generate-proof-page.mjs`
- Generate: `artifacts/proof/index.html`
- Generate: `artifacts/proof/tokenhub-proof.png`

- [ ] **Step 1: Implement proof generator**

Run the verification commands, create a local HTML status page, and use Playwright to capture a PNG screenshot.

- [ ] **Step 2: Verify**

Run `npm run proof` and confirm `artifacts/proof/tokenhub-proof.png` exists and is a PNG.

### Task 5: Publish Prep

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Modify: `.gitignore`

- [ ] **Step 1: Document install and usage**

Document `npx tokenhub-mcp`, `uvx` future intent, the six-tool surface, optional provider keys, and token ROI telemetry.

- [ ] **Step 2: Commit and publish**

Commit the complete work. Create a public GitHub repo if local GitHub credentials are available; otherwise leave the repo ready to publish and record the authentication blocker.
