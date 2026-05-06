import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
import { createTokenHubRuntime } from "../src/server.js";

describe("GitHub module", () => {
  test("summarizes public repo metadata and issue facts compactly", async () => {
    const result = await summarizeGitHubRepo({
      owner: "example",
      repo: "demo",
      fetchImpl: async (url) =>
        new Response(
          JSON.stringify(
            url.toString().includes("/issues")
              ? [{ number: 7, title: "Crash on boot", state: "open", html_url: "https://github.com/example/demo/issues/7" }]
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
    expect(JSON.stringify(result)).not.toContain("html_url");
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
});

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
            repository: { url: "git+https://github.com/example/demo.git" }
          }),
          { status: 200 }
        )
    });

    expect(result.summary).toContain("demo@2.0.0");
    expect(result.versions).toEqual(["2.0.0", "1.0.0"]);
  });
});

describe("sentry module", () => {
  test("clusters Sentry issues by culprit and strips noisy raw fields", () => {
    const result = summarizeSentryIssues([
      { title: "TypeError: boom", culprit: "src/app.ts", count: "12", userCount: 5, permalink: "https://sentry/1" },
      { title: "TypeError: boom again", culprit: "src/app.ts", count: "3", userCount: 2, permalink: "https://sentry/2" }
    ]);

    expect(result.clusters[0]).toEqual({ culprit: "src/app.ts", issues: 2, events: 15, users: 7 });
    expect(JSON.stringify(result)).not.toContain("permalink");
  });
});

describe("browser module", () => {
  test("captures compact Playwright state and stores screenshot as a resource", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenhub-browser-"));
    const store = new ResourceStore({ rootDir: join(dir, ".tokenhub", "resources") });
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
      expect(result.state.consoleErrors).toContain("fixture error");
      expect(result.resources[0]).toMatch(/^tokenhub:\/\/resource\//);
    } finally {
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
      const capabilities = runtime.discoverCapabilities({ query: "github browser sentry postgres sqlite docs search", limit: 20 });

      expect(capabilities.map((capability) => capability.id)).toEqual(
        expect.arrayContaining([
          "github.summary",
          "browser.capture",
          "web.search",
          "database.sqlite",
          "database.postgres",
          "docs.npm",
          "observability.sentry"
        ])
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
