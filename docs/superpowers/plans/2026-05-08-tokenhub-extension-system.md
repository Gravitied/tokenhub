# TokenHub Extension System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plug-and-play TokenHub extension system for user-provided MCP stdio servers and local command tools.

**Architecture:** Add a focused `src/extensions/` package that loads a trusted-local manifest, registers extension capabilities, and dispatches calls through a new `extension_call` workflow. Keep the six public MCP tools unchanged while making extensions discoverable through the existing registry.

**Tech Stack:** TypeScript, Node.js child process APIs, `@modelcontextprotocol/sdk`, Zod, Vitest.

---

## File Structure

- Create `src/extensions/config.ts` for manifest parsing, validation, and default config path resolution.
- Create `src/extensions/manager.ts` for capability registration and extension call dispatch.
- Create `src/extensions/command-adapter.ts` for local command execution over JSON stdin.
- Create `src/extensions/mcp-adapter.ts` for lazy MCP stdio client connections.
- Modify `src/server.ts` to load extensions, register extension capabilities, accept extension workflow inputs, and pass the manager into workflows.
- Modify `src/workflows/index.ts` to dispatch `extension_call`.
- Modify `src/cli-options.ts` and `src/cli.ts` to support `--extensions <path>` plus `TOKENHUB_EXTENSIONS`.
- Modify `README.md`, `docs/configuration.md`, `docs/architecture.md`, and `docs/security.md` for user documentation.
- Add tests in `tests/extensions.test.ts`, `tests/server.test.ts`, `tests/cli.test.ts`, and docs contract tests.

### Task 1: Manifest Loading

**Files:**
- Create: `src/extensions/config.ts`
- Test: `tests/extensions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExtensionConfig } from "../src/extensions/config.js";

describe("extension config", () => {
  test("loads command and mcp extension manifests from json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-extensions-"));
    try {
      const manifestPath = join(dir, "tokenhub.extensions.json");
      await writeFile(
        manifestPath,
        JSON.stringify({
          version: 1,
          extensions: [
            {
              id: "local-echo",
              type: "command",
              title: "Local Echo",
              command: "node",
              args: ["tools/echo.mjs"],
              inputSchema: { type: "object" },
              timeoutMs: 5000
            },
            {
              id: "demo-mcp",
              type: "mcp",
              title: "Demo MCP",
              command: "node",
              args: ["tools/demo-mcp.mjs"],
              env: ["DEMO_TOKEN"],
              tools: ["lookup"]
            }
          ]
        }),
        "utf8"
      );

      const config = await loadExtensionConfig({ root: dir, configPath: manifestPath });

      expect(config.extensions.map((extension) => extension.id)).toEqual(["local-echo", "demo-mcp"]);
      expect(config.extensions[0]).toMatchObject({ type: "command", timeoutMs: 5000 });
      expect(config.extensions[1]).toMatchObject({ type: "mcp", tools: ["lookup"] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns an empty config when the default manifest is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-no-extensions-"));
    try {
      await expect(loadExtensionConfig({ root: dir })).resolves.toEqual({
        configPath: join(dir, "tokenhub.extensions.json"),
        extensions: [],
        warnings: []
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/extensions.test.ts`

Expected: fail because `src/extensions/config.ts` does not exist.

- [ ] **Step 3: Implement minimal config loader**

Add discriminated Zod schemas for `command` and `mcp` extensions. Validate ids, commands, args, env names, tool names, timeout bounds, and duplicate ids. Resolve the default path to `<root>/tokenhub.extensions.json`.

- [ ] **Step 4: Run green test**

Run: `npm test -- tests/extensions.test.ts`

Expected: pass.

### Task 2: Command Extension Calls

**Files:**
- Create: `src/extensions/command-adapter.ts`
- Create: `src/extensions/manager.ts`
- Modify: `src/workflows/index.ts`
- Modify: `src/server.ts`
- Test: `tests/extensions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("discovers and runs a configured local command extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tokenhub-command-extension-"));
  try {
    await mkdir(join(dir, "tools"), { recursive: true });
    await writeFile(
      join(dir, "tools", "echo.mjs"),
      [
        "let body = '';",
        "process.stdin.on('data', chunk => body += chunk);",
        "process.stdin.on('end', () => {",
        "  const input = JSON.parse(body || '{}');",
        "  console.log(JSON.stringify({ ok: true, message: input.message }));",
        "});"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(dir, "tokenhub.extensions.json"),
      JSON.stringify({
        version: 1,
        extensions: [
          {
            id: "local-echo",
            type: "command",
            title: "Local Echo",
            command: process.execPath,
            args: ["tools/echo.mjs"],
            inputSchema: { type: "object" },
            timeoutMs: 5000
          }
        ]
      }),
      "utf8"
    );

    const runtime = createTokenHubRuntime({ root: dir });
    const capabilities = runtime.discoverCapabilities({ query: "echo", limit: 5 });
    expect(capabilities.map((capability) => capability.id)).toContain("extension.local-echo.run");

    const result = await runtime.runWorkflow({
      name: "extension_call",
      extensionId: "local-echo",
      toolName: "run",
      input: { message: "hello" },
      budgetTokens: 200
    });

    expect(result.summary).toContain("hello");
    expect(result.telemetry.estimatedSavedTokens).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/extensions.test.ts --testNamePattern "discovers and runs"`

Expected: fail because `extension_call` is unknown.

- [ ] **Step 3: Implement manager and command adapter**

The manager registers command extensions as `extension.<id>.run`, validates `extensionId` and `toolName`, and calls `runCommandExtension`. The command adapter uses `execFile` or `spawn` without a shell, sends JSON input on stdin, enforces timeout and max output, redacts output, writes raw output to the resource store, and returns summary/resources/warnings.

- [ ] **Step 4: Run green test**

Run: `npm test -- tests/extensions.test.ts --testNamePattern "discovers and runs"`

Expected: pass.

### Task 3: Safety Rejections

**Files:**
- Modify: `tests/extensions.test.ts`
- Modify: `src/extensions/manager.ts`
- Modify: `src/extensions/command-adapter.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("rejects unknown extension ids and unconfigured tool names", async () => {
  const runtime = createTokenHubRuntime({ root: process.cwd() });

  await expect(
    runtime.runWorkflow({ name: "extension_call", extensionId: "missing", toolName: "run", input: {} })
  ).rejects.toThrow("Unknown extension: missing");

  await expect(
    runtime.runWorkflow({ name: "extension_call", extensionId: "local-echo", toolName: "delete_everything", input: {} })
  ).rejects.toThrow(/Unknown extension|does not expose tool/);
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/extensions.test.ts --testNamePattern "rejects unknown"`

Expected: fail until errors are implemented consistently.

- [ ] **Step 3: Implement precise errors and limits**

Ensure command, args, cwd, and env come only from config. Clamp timeouts to a maximum of 120 seconds. Limit captured output to 4 MiB. Return warnings for nonzero exits.

- [ ] **Step 4: Run green test**

Run: `npm test -- tests/extensions.test.ts --testNamePattern "rejects unknown"`

Expected: pass.

### Task 4: MCP Extension Adapter

**Files:**
- Create: `src/extensions/mcp-adapter.ts`
- Modify: `src/extensions/manager.ts`
- Test: `tests/extensions.test.ts`

- [ ] **Step 1: Write failing tests with fixture MCP server**

```ts
test("discovers and calls an allowlisted MCP extension tool", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tokenhub-mcp-extension-"));
  try {
    await mkdir(join(dir, "tools"), { recursive: true });
    await writeFile(join(dir, "tools", "fixture-mcp.mjs"), MCP_FIXTURE_SERVER, "utf8");
    await writeFile(
      join(dir, "tokenhub.extensions.json"),
      JSON.stringify({
        version: 1,
        extensions: [
          {
            id: "fixture-mcp",
            type: "mcp",
            title: "Fixture MCP",
            command: process.execPath,
            args: ["tools/fixture-mcp.mjs"],
            tools: ["lookup"]
          }
        ]
      }),
      "utf8"
    );

    const runtime = createTokenHubRuntime({ root: dir });
    const capabilities = await runtime.discoverCapabilities({ query: "lookup", limit: 5 });
    expect(JSON.stringify(capabilities)).toContain("extension.fixture-mcp.lookup");

    const result = await runtime.runWorkflow({
      name: "extension_call",
      extensionId: "fixture-mcp",
      toolName: "lookup",
      input: { query: "alpha" }
    });

    expect(result.summary).toContain("fixture lookup: alpha");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/extensions.test.ts --testNamePattern "allowlisted MCP"`

Expected: fail because the MCP adapter does not exist.

- [ ] **Step 3: Implement MCP adapter**

Use `Client` from `@modelcontextprotocol/sdk/client/index.js` and `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`. Build an env object from configured names. Connect lazily, call `listTools`, filter by allowlist, and call tools by name.

- [ ] **Step 4: Run green test**

Run: `npm test -- tests/extensions.test.ts --testNamePattern "allowlisted MCP"`

Expected: pass.

### Task 5: CLI and Docs

**Files:**
- Modify: `src/cli-options.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `docs/configuration.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security.md`
- Modify: `tests/cli.test.ts`
- Modify: `tests/docs-contract.test.ts`
- Modify: `tests/feature-contract.test.ts`

- [ ] **Step 1: Write failing CLI/docs tests**

Add tests asserting `--extensions <path>` parses, missing value errors, help text includes the option, README documents `extension_call`, and docs mention `tokenhub.extensions.json`.

- [ ] **Step 2: Run red tests**

Run: `npm test -- tests/cli.test.ts tests/docs-contract.test.ts tests/feature-contract.test.ts`

Expected: fail until CLI/docs are updated.

- [ ] **Step 3: Implement CLI/docs updates**

Thread `extensionsPath` through `parseCliArgs`, `startServer`, and `createMcpServer`. Document default manifest path, `TOKENHUB_EXTENSIONS`, examples, and trust model.

- [ ] **Step 4: Run green tests**

Run: `npm test -- tests/cli.test.ts tests/docs-contract.test.ts tests/feature-contract.test.ts`

Expected: pass.

### Task 6: Full Verification

**Files:**
- Modify only if verification exposes real issues.

- [ ] **Step 1: Run targeted extension tests**

Run: `npm test -- tests/extensions.test.ts`

Expected: pass.

- [ ] **Step 2: Run standard verification**

Run: `npm run lint && npm test && npm run bench && npm run eval:resolve-request && npm run eval:resolve-request:live && npm pack --dry-run && npm run smoke:install`

Expected: all pass. Generated benchmark/eval artifacts should be reviewed and restored unless intentionally updated.

- [ ] **Step 3: Commit implementation**

```bash
git add src tests README.md docs
git commit -m "feat: add tokenhub extension system"
```

- [ ] **Step 4: Push branch**

```bash
git push origin codex/dynamic-request-router
```

## Self-Review

Spec coverage:

- MCP stdio extensions: Task 4.
- Local command tools: Task 2 and Task 3.
- Existing six public tools unchanged: Task 2 test and existing server contract.
- CLI/env config selection: Task 5.
- Security boundaries: Task 3 and docs in Task 5.
- Verification: Task 6.

Placeholder scan: no open placeholders remain.

Type consistency: the plan uses `extension_call`, `extensionId`, `toolName`, and `input` consistently across tests, runtime dispatch, and docs.
