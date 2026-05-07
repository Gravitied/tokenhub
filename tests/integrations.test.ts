import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { ResourceStore } from "../src/core/resources.js";
import { summarizeGitHubRepo } from "../src/modules/github.js";
import { normalizeSearchResults, searchWeb } from "../src/modules/search.js";
import { inspectSqlite, projectRows, summarizePostgresSchemaRows } from "../src/modules/database.js";
import { lookupNpmPackage } from "../src/modules/docs.js";
import { summarizeSentryIssues } from "../src/modules/sentry.js";
import { captureBrowserState } from "../src/modules/browser.js";
import { applyFilesystemAction } from "../src/modules/filesystem.js";
import { runGitAction, summarizeGit } from "../src/modules/git.js";
import { createTokenHubRuntime } from "../src/server.js";

describe("GitHub module", () => {
  test("summarizes public repo metadata, issue, PR, and workflow facts compactly", async () => {
    const result = await summarizeGitHubRepo({
      owner: "example",
      repo: "demo",
      fetchImpl: async (url) =>
        new Response(
          JSON.stringify(
            url.toString().includes("/issues")
              ? [{ number: 7, title: "Crash on boot", state: "open", html_url: "https://github.com/example/demo/issues/7" }]
              : url.toString().includes("/pulls")
                ? [{ number: 9, title: "Fix boot crash", state: "open", user: { login: "dev" } }]
                : url.toString().includes("/actions/runs")
                  ? { workflow_runs: [{ name: "CI", status: "completed", conclusion: "failure", head_branch: "main" }] }
              : {
                  full_name: "example/demo",
                  description: "Demo repository",
                  stargazers_count: 42,
                  open_issues_count: 3,
                  default_branch: "main",
                  html_url: "https://github.com/example/demo"
                }
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    expect(result.summary).toContain("example/demo");
    expect(result.summary).toContain("42 stars");
    expect(result.issues[0]).toEqual({ number: 7, title: "Crash on boot", state: "open" });
    expect(result.pullRequests[0]).toEqual({ number: 9, title: "Fix boot crash", state: "open", author: "dev" });
    expect(result.workflowRuns[0]).toEqual({ name: "CI", status: "completed", conclusion: "failure", branch: "main" });
    expect(JSON.stringify(result)).not.toContain("html_url");
  });
});

describe("filesystem action module", () => {
  test("rejects write, move, and delete by default with a clear opt-in message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-fs-disabled-"));
    try {
      await writeFile(join(dir, "source.txt"), "hello", "utf8");
      await expect(applyFilesystemAction({ root: dir, action: "write", path: "notes/a.txt", content: "hello" })).rejects.toThrow(
        "filesystem write is disabled by default; set TOKENHUB_ENABLE_FS_MUTATIONS=true only for trusted local workspaces."
      );
      await expect(
        applyFilesystemAction({ root: dir, action: "move", path: "source.txt", destination: "notes/moved.txt" })
      ).rejects.toThrow(
        "filesystem move is disabled by default; set TOKENHUB_ENABLE_FS_MUTATIONS=true only for trusted local workspaces."
      );
      await expect(applyFilesystemAction({ root: dir, action: "delete", path: "source.txt" })).rejects.toThrow(
        "filesystem delete is disabled by default; set TOKENHUB_ENABLE_FS_MUTATIONS=true only for trusted local workspaces."
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("lists the workspace tree without mutation opt-in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-fs-tree-"));
    try {
      await writeFile(join(dir, "notes.txt"), "hello", "utf8");

      const result = await applyFilesystemAction({ root: dir, action: "tree" });

      expect(result.summary).toContain("listed");
      expect(result.entries).toEqual(expect.arrayContaining([{ path: "notes.txt", type: "file" }]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes, moves, and deletes files within the workspace only when mutations are explicitly enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-fs-action-"));
    const previous = process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
    process.env.TOKENHUB_ENABLE_FS_MUTATIONS = "true";
    try {
      const write = await applyFilesystemAction({
        root: dir,
        action: "write",
        path: "notes/a.txt",
        content: "hello"
      });
      const move = await applyFilesystemAction({
        root: dir,
        action: "move",
        path: "notes/a.txt",
        destination: "notes/b.txt"
      });
      const del = await applyFilesystemAction({ root: dir, action: "delete", path: "notes/b.txt" });

      expect(write.summary).toContain("wrote notes/a.txt");
      expect(move.summary).toContain("moved notes/a.txt to notes/b.txt");
      expect(del.summary).toContain("deleted notes/b.txt");
      await expect(
        applyFilesystemAction({ root: dir, action: "write", path: "../escape.txt", content: "no" })
      ).rejects.toThrow(/outside workspace/);
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
      } else {
        process.env.TOKENHUB_ENABLE_FS_MUTATIONS = previous;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("allows trusted local mutations when enabled by environment variable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-fs-env-action-"));
    const previous = process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
    process.env.TOKENHUB_ENABLE_FS_MUTATIONS = "true";
    try {
      const result = await applyFilesystemAction({ root: dir, action: "write", path: "notes/env.txt", content: "hello" });

      expect(result.summary).toContain("wrote notes/env.txt");
      await expect(readFile(join(dir, "notes", "env.txt"), "utf8")).resolves.toBe("hello");
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
      } else {
        process.env.TOKENHUB_ENABLE_FS_MUTATIONS = previous;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects writes through an in-workspace symlinked directory", async (context) => {
    const fixture = await createSymlinkedWorkspace(context);
    if (!fixture) return;
    const previous = process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
    process.env.TOKENHUB_ENABLE_FS_MUTATIONS = "true";
    try {
      await expect(
        applyFilesystemAction({
          root: fixture.root,
          action: "write",
          path: "link/file.txt",
          content: "escaped"
        })
      ).rejects.toThrow(/outside workspace/);
      await expect(readFile(join(fixture.outside, "file.txt"), "utf8")).rejects.toThrow();
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
      } else {
        process.env.TOKENHUB_ENABLE_FS_MUTATIONS = previous;
      }
      await cleanupSymlinkedWorkspace(fixture);
    }
  });

  test("rejects deletes through an in-workspace symlinked directory without deleting outside contents", async (context) => {
    const fixture = await createSymlinkedWorkspace(context);
    if (!fixture) return;
    const previous = process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
    process.env.TOKENHUB_ENABLE_FS_MUTATIONS = "true";
    try {
      await writeFile(join(fixture.outside, "file.txt"), "keep", "utf8");

      await expect(
        applyFilesystemAction({ root: fixture.root, action: "delete", path: "link/file.txt" })
      ).rejects.toThrow(/outside workspace/);
      await expect(
        applyFilesystemAction({ root: fixture.root, action: "delete", path: "link" })
      ).rejects.toThrow(/outside workspace/);
      await expect(readFile(join(fixture.outside, "file.txt"), "utf8")).resolves.toBe("keep");
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
      } else {
        process.env.TOKENHUB_ENABLE_FS_MUTATIONS = previous;
      }
      await cleanupSymlinkedWorkspace(fixture);
    }
  });

  test("rejects move destinations through an in-workspace symlinked directory", async (context) => {
    const fixture = await createSymlinkedWorkspace(context);
    if (!fixture) return;
    const previous = process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
    process.env.TOKENHUB_ENABLE_FS_MUTATIONS = "true";
    try {
      await writeFile(join(fixture.root, "source.txt"), "move me", "utf8");

      await expect(
        applyFilesystemAction({
          root: fixture.root,
          action: "move",
          path: "source.txt",
          destination: "link/file.txt"
        })
      ).rejects.toThrow(/outside workspace/);
      await expect(readFile(join(fixture.outside, "file.txt"), "utf8")).rejects.toThrow();
      await expect(readFile(join(fixture.root, "source.txt"), "utf8")).resolves.toBe("move me");
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENHUB_ENABLE_FS_MUTATIONS;
      } else {
        process.env.TOKENHUB_ENABLE_FS_MUTATIONS = previous;
      }
      await cleanupSymlinkedWorkspace(fixture);
    }
  });
});

describe("git action module", () => {
  test("summarizes changed files and supports safe stage/commit/status actions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-git-action-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync("git", ["init"], { cwd: dir });
      await execFileAsync("git", ["config", "user.email", "bench@example.com"], { cwd: dir });
      await execFileAsync("git", ["config", "user.name", "Bench"], { cwd: dir });
      await writeFile(join(dir, "a.txt"), "one");
      await runGitAction({ root: dir, action: "stage", paths: ["a.txt"] });
      const commit = await runGitAction({ root: dir, action: "commit", message: "initial" });
      await writeFile(join(dir, "a.txt"), "two");

      const summary = await summarizeGit({ root: dir, resourceStore: store });
      const status = await runGitAction({ root: dir, action: "status" });

      expect(commit.summary).toContain("committed");
      expect(summary.changedFiles).toEqual([{ path: "a.txt", status: "modified" }]);
      expect(status.summary).toContain("modified: a.txt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not summarize failed git actions as successful", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-git-fail-"));
    try {
      const result = await runGitAction({ root: dir, action: "commit", message: "nothing" });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.summary).toContain("failed");
      expect(result.summary).not.toContain("committed changes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("web search module", () => {
  test("normalizes provider results with confidence, dedupe, and token fields", () => {
    const results = normalizeSearchResults([
      { title: "Docs", url: "https://example.com/docs", snippet: "Official docs", provider: "brave" },
      { title: "Docs duplicate", url: "https://example.com/docs", snippet: "Same", provider: "exa" }
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBeGreaterThan(0.7);
    expect(results[0].fields).toEqual(["title", "url", "snippet", "provider", "confidence"]);
  });

  test("searches a real provider shape through injectable fetch", async () => {
    const result = await searchWeb({
      query: "tokenhub mcp",
      provider: "brave",
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ web: { results: [{ title: "TokenHub", url: "https://example.com", description: "MCP hub" }] } }),
          { status: 200 }
        )
    });

    expect(result.results[0].title).toBe("TokenHub");
    expect(result.results[0].provider).toBe("brave");
    expect(result.summary).toContain("TokenHub");
  });

  test("uses configured provider tooling from environment keys", async () => {
    const previousBraveKey = process.env.BRAVE_SEARCH_API_KEY;
    process.env.BRAVE_SEARCH_API_KEY = "env-key";
    try {
      const result = await searchWeb({
        query: "tokenhub mcp",
        fetchImpl: async (_url, init) => {
          expect(init?.headers).toEqual(expect.objectContaining({ "x-subscription-token": "env-key" }));
          return new Response(
            JSON.stringify({ web: { results: [{ title: "TokenHub", url: "https://example.com", description: "MCP hub" }] } }),
            { status: 200 }
          );
        }
      });

      expect(result.results[0].provider).toBe("brave");
      expect(result.warnings).toEqual([]);
    } finally {
      if (previousBraveKey === undefined) {
        delete process.env.BRAVE_SEARCH_API_KEY;
      } else {
        process.env.BRAVE_SEARCH_API_KEY = previousBraveKey;
      }
    }
  });

  test("uses a no-key DuckDuckGo fallback when providers are unconfigured", async () => {
    const previousKeys = {
      brave: process.env.BRAVE_SEARCH_API_KEY,
      exa: process.env.EXA_API_KEY,
      tavily: process.env.TAVILY_API_KEY,
      serpapi: process.env.SERPAPI_API_KEY
    };
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.EXA_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPAPI_API_KEY;
    try {
      const result = await searchWeb({
        query: "top 10 most healthy vegetables",
        limit: 10,
        fetchImpl: async (url) => {
          expect(url.toString()).toContain("duckduckgo.com/html/");
          return new Response(duckDuckGoHtml(10), { status: 200 });
        }
      });

      expect(result.results).toHaveLength(10);
      expect(result.results[0].provider).toBe("duckduckgo");
      expect(result.warnings[0]).toContain("DuckDuckGo");
    } finally {
      for (const [key, value] of Object.entries({
        BRAVE_SEARCH_API_KEY: previousKeys.brave,
        EXA_API_KEY: previousKeys.exa,
        TAVILY_API_KEY: previousKeys.tavily,
        SERPAPI_API_KEY: previousKeys.serpapi
      })) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

function duckDuckGoHtml(count: number): string {
  return Array.from(
    { length: count },
    (_value, index) => `<a class="result__a" href="https://example.com/${index + 1}">Result ${index + 1}</a>
      <a class="result__snippet">Snippet ${index + 1}</a>`
  ).join("\n");
}

type SymlinkedWorkspace = {
  root: string;
  outside: string;
};

async function createSymlinkedWorkspace(context: { skip: () => void }): Promise<SymlinkedWorkspace | undefined> {
  const root = await mkdtemp(join(tmpdir(), "tokenhub-fs-symlink-root-"));
  const outside = await mkdtemp(join(tmpdir(), "tokenhub-fs-symlink-outside-"));
  try {
    await symlink(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    return { root, outside };
  } catch {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    context.skip();
    return undefined;
  }
}

async function cleanupSymlinkedWorkspace(fixture: SymlinkedWorkspace): Promise<void> {
  await rm(fixture.root, { recursive: true, force: true });
  await rm(fixture.outside, { recursive: true, force: true });
}

describe("database module", () => {
  test("inspects sqlite schema and projects rows without raw bloat", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, api_key TEXT);");
    db.run("INSERT INTO users VALUES (1, 'a@example.com', 'SECRET_DB_KEY');");
    const bytes = db.export();

    const result = await inspectSqlite({ databaseBytes: bytes, query: "SELECT * FROM users", limit: 5 });

    expect(result.schema[0]).toEqual({ table: "users", columns: ["id", "email", "api_key"] });
    expect(result.rows[0]).toEqual({ id: 1, email: "a@example.com", api_key: "[redacted]" });
    expect(JSON.stringify(result)).not.toContain("SECRET_DB_KEY");
  });

  test("summarizes postgres schema rows and projects query rows", () => {
    const schema = summarizePostgresSchemaRows([
      { table_name: "events", column_name: "id", data_type: "uuid" },
      { table_name: "events", column_name: "message", data_type: "text" }
    ]);
    const rows = projectRows([{ id: "1", message: "boom", password: "SECRET" }], { limit: 1 });

    expect(schema).toEqual([{ table: "events", columns: ["id:uuid", "message:text"] }]);
    expect(rows[0].password).toBe("[redacted]");
  });
});

describe("docs/package module", () => {
  test("looks up npm package metadata with compact version and links", async () => {
    const result = await lookupNpmPackage({
      name: "demo",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            name: "demo",
            description: "Demo package",
            "dist-tags": { latest: "2.0.0" },
            versions: { "1.0.0": {}, "2.0.0": {} },
            homepage: "https://example.com",
            repository: { url: "git+https://github.com/example/demo.git" },
            readme: "# Demo\nlong raw docs"
          }),
          { status: 200 }
        )
    });

    expect(result.summary).toContain("demo@2.0.0");
    expect(result.versions).toEqual(["2.0.0", "1.0.0"]);
    expect(result.docs.changelog).toBe("https://github.com/example/demo/releases");
    expect(result.docs.readmeResource).toBeUndefined();
  });
});

describe("sentry module", () => {
  test("clusters Sentry issues by culprit and strips noisy raw fields", () => {
    const result = summarizeSentryIssues([
      {
        title: "TypeError: boom",
        culprit: "src/app.ts",
        count: "12",
        userCount: 5,
        level: "error",
        status: "unresolved",
        permalink: "https://sentry/1"
      },
      {
        title: "TypeError: boom again",
        culprit: "src/app.ts",
        count: "3",
        userCount: 2,
        level: "error",
        status: "resolved",
        permalink: "https://sentry/2"
      }
    ]);

    expect(result.clusters[0]).toEqual({ culprit: "src/app.ts", issues: 2, events: 15, users: 7 });
    expect(result.issueDetails[0]).toEqual({
      title: "TypeError: boom",
      culprit: "src/app.ts",
      events: 12,
      users: 5,
      level: "error",
      status: "unresolved"
    });
    expect(JSON.stringify(result)).not.toContain("permalink");
  });
});

describe("browser module", () => {
  test("captures compact Playwright state and stores screenshot as a resource", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-browser-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
    const previous = process.env.TOKENHUB_ALLOW_PRIVATE_NETWORK;
    process.env.TOKENHUB_ALLOW_PRIVATE_NETWORK = "true";
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<h1>Browser Fixture</h1><a href='/docs'>Docs</a><button>Run</button><script>console.error('fixture error')</script>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No local browser test port.");
    try {
      const result = await captureBrowserState({
        url: `http://127.0.0.1:${address.port}`,
        resourceStore: store,
        includeScreenshot: true,
        budgetTokens: 120
      });

      expect(result.state.headings).toEqual(["Browser Fixture"]);
      expect(result.state.links[0].text).toBe("Docs");
      expect(result.state.elements[0]).toEqual(expect.objectContaining({ ref: "e1", role: "link", text: "Docs" }));
      expect(result.state.consoleErrors).toContain("fixture error");
      expect(result.resources[0]).toMatch(/^tokenhub:\/\/resource\//);

      const screenshot = await store.read(result.resources[0], { mode: "full" });
      expect(screenshot.content).toMatch(/^data:image\/png;base64,/);
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENHUB_ALLOW_PRIVATE_NETWORK;
      } else {
        process.env.TOKENHUB_ALLOW_PRIVATE_NETWORK = previous;
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runtime routing", () => {
  test("discovers and routes new integration capabilities through the small surface", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-routing-"));
    try {
      const runtime = createTokenHubRuntime({ root: dir });
      const capabilities = runtime.discoverCapabilities({ query: "github browser sentry postgres sqlite docs search answer", limit: 20 });

      expect(capabilities.map((capability) => capability.id)).toEqual(
        expect.arrayContaining([
          "github.summary",
          "browser.capture",
          "web.search",
          "database.sqlite",
            "database.postgres",
            "docs.npm",
            "observability.sentry",
            "web.answer"
          ])
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("compact file retrieval returns the matching line, not the query echo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-compact-files-"));
    try {
      await writeFile(join(dir, "notes.txt"), "alpha\nneedle is here\nomega\n", "utf8");
      const runtime = createTokenHubRuntime({ root: dir });

      const result = await runtime.retrieveContext({ source: "files", query: "needle", returnMode: "compact" });

      expect(result).toEqual({
        m: [[expect.stringContaining("notes.txt"), 2, expect.stringContaining("needle is here"), expect.stringMatching(/^tokenhub:\/\/resource\//)]]
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects unknown workflow names instead of running a hardcoded project scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-unknown-workflow-"));
    try {
      const runtime = createTokenHubRuntime({ root: dir });

      await expect(runtime.runWorkflow({ name: "typo_workflow" })).rejects.toThrow(/Unknown workflow/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
