import { MemoryCache, type CacheStatus } from "../core/cache.js";
import { estimateTokens, responseProfileBudget, type ResponseProfile } from "../core/token.js";
import { searchFiles } from "../modules/filesystem.js";
import { fetchAndScrape, type CachedWebPage } from "../modules/web.js";
import { summarizeGit } from "../modules/git.js";
import { summarizeGitHubRepo } from "../modules/github.js";
import { searchWeb } from "../modules/search.js";
import { inspectPostgres, inspectSqlite } from "../modules/database.js";
import { lookupNpmPackage } from "../modules/docs.js";
import { fetchSentryIssues, summarizeSentryIssues } from "../modules/sentry.js";
import { BrowserPool, captureBrowserState } from "../modules/browser.js";
import { SourceRegistry, type RetrievalSourceModule, type RetrieveContextInput } from "./registry.js";

export function createDefaultSourceRegistry(): SourceRegistry {
  const registry = new SourceRegistry();
  const webCache = new MemoryCache<CachedWebPage>({ ttlMs: 5 * 60 * 1000, maxEntries: 250 });
  const browserPool =
    process.env.TOKENHUB_ENABLE_BROWSER_POOL === "true"
      ? new BrowserPool({ ttlMs: 30000, maxUses: 100 })
      : undefined;
  for (const source of defaultSources({ webCache, browserPool })) {
    registry.register(source);
  }
  return registry;
}

function defaultSources(options: { webCache: MemoryCache<CachedWebPage>; browserPool?: BrowserPool }): RetrievalSourceModule[] {
  return [
    {
      name: "files",
      title: "Search workspace files",
      defaultBudgetTokens: 800,
      retrieve: async (input, context) => {
        const result = await searchFiles({
          root: context.root,
          query: input.query,
          limit: input.limit,
          budgetTokens: budgetFor(input, 800),
          resourceStore: context.resourceStore
        });
        if (wantsCompact(input)) {
          const compact = {
            m: result.matches.map((match) => [
              match.path,
              match.line,
              compactMatchingLine(match.snippet, input.query),
              match.resourceUri
            ])
          };
          return input.responseProfile ? withMetrics(compact, input, "files") : compact;
        }
        return withMetrics(result, input, "files");
      }
    },
    {
      name: "git",
      title: "Summarize Git state",
      defaultBudgetTokens: 500,
      retrieve: async (input, context) =>
        withMetrics(
          await summarizeGit({ root: context.root, resourceStore: context.resourceStore, budgetTokens: budgetFor(input, 500) }),
          input,
          "git"
        )
    },
    {
      name: "web",
      title: "Fetch and scrape web page",
      defaultBudgetTokens: 800,
      retrieve: async (input, context) => {
        if (!input.url) {
          throw new Error("retrieve_context source=web requires url.");
        }
        return withMetrics(
          await fetchAndScrape({
            url: input.url,
            resourceStore: context.resourceStore,
            budgetTokens: budgetFor(input, 800),
            includeRaw: input.includeRaw,
            cache: options.webCache,
            networkPolicy: context.securityPolicy?.networkPolicy()
          }),
          input,
          "web"
        );
      }
    },
    {
      name: "github",
      title: "Summarize GitHub repository",
      defaultBudgetTokens: 400,
      retrieve: async (input) => {
        if (!input.owner || !input.repo) {
          throw new Error("retrieve_context source=github requires owner and repo.");
        }
        return withMetrics(
          await summarizeGitHubRepo({
            owner: input.owner,
            repo: input.repo,
            token: input.token,
            limit: input.limit,
            budgetTokens: budgetFor(input, 400)
          }),
          input,
          "github"
        );
      }
    },
    {
      name: "search",
      title: "Search web providers",
      defaultBudgetTokens: 500,
      retrieve: async (input) => {
        if (!input.query) {
          throw new Error("retrieve_context source=search requires query.");
        }
        const result = await searchWeb({
          query: input.query,
          provider: input.provider,
          apiKey: input.apiKey,
          limit: input.limit,
          budgetTokens: budgetFor(input, 500)
        });
        if (wantsCompact(input)) {
          const compact = { r: result.results.map((item) => [item.title, item.url, item.provider, item.confidence]) };
          return input.responseProfile ? withMetrics(compact, input, "search") : compact;
        }
        return withMetrics(result, input, "search");
      }
    },
    {
      name: "sqlite",
      title: "Inspect SQLite",
      defaultBudgetTokens: 400,
      retrieve: async (input) => {
        if (!input.databaseBase64) {
          throw new Error("retrieve_context source=sqlite requires databaseBase64.");
        }
        const result = await inspectSqlite({
          databaseBytes: Buffer.from(input.databaseBase64, "base64"),
          query: input.query,
          limit: input.limit,
          budgetTokens: budgetFor(input, 400)
        });
        if (wantsCompact(input)) {
          const compact = {
            s: result.schema.map((table) => [table.table, table.columns]),
            r: result.rows.map((row) => Object.values(row))
          };
          return input.responseProfile ? withMetrics(compact, input, "sqlite") : compact;
        }
        return withMetrics(result, input, "sqlite");
      }
    },
    {
      name: "postgres",
      title: "Inspect Postgres",
      defaultBudgetTokens: 400,
      retrieve: async (input) => {
        if (!input.connectionString) {
          throw new Error("retrieve_context source=postgres requires connectionString.");
        }
        return withMetrics(
          await inspectPostgres({
            connectionString: input.connectionString,
            query: input.query,
            limit: input.limit,
            budgetTokens: budgetFor(input, 400)
          }),
          input,
          "postgres"
        );
      }
    },
    {
      name: "docs",
      title: "Lookup npm package docs",
      defaultBudgetTokens: 300,
      retrieve: async (input) => {
        if (!input.packageName && !input.query) {
          throw new Error("retrieve_context source=docs requires packageName or query.");
        }
        return withMetrics(
          await lookupNpmPackage({ name: input.packageName ?? input.query ?? "", budgetTokens: budgetFor(input, 300) }),
          input,
          "docs"
        );
      }
    },
    {
      name: "sentry",
      title: "Summarize Sentry issues",
      defaultBudgetTokens: 400,
      retrieve: async (input) => {
        if (input.issues) {
          const result = summarizeSentryIssues(input.issues, { budgetTokens: budgetFor(input, 400) });
          if (wantsCompact(input)) {
            const compact = { c: result.clusters.map((cluster) => [cluster.culprit, cluster.issues, cluster.events, cluster.users]) };
            return input.responseProfile ? withMetrics(compact, input, "sentry") : compact;
          }
          return withMetrics(result, input, "sentry");
        }
        if (!input.organization || !input.token) {
          throw new Error("retrieve_context source=sentry requires issues or organization and token.");
        }
        return withMetrics(
          await fetchSentryIssues({
            organization: input.organization,
            project: input.project,
            token: input.token,
            query: input.query,
            budgetTokens: budgetFor(input, 400)
          }),
          input,
          "sentry"
        );
      }
    },
    {
      name: "browser",
      title: "Capture compact browser state",
      defaultBudgetTokens: 500,
      retrieve: async (input, context) => {
        if (!input.url) {
          throw new Error("retrieve_context source=browser requires url.");
        }
        const result = await captureBrowserState({
          url: input.url,
          resourceStore: context.resourceStore,
          includeScreenshot: input.includeRaw,
          budgetTokens: budgetFor(input, 500),
          browserPool: options.browserPool,
          networkPolicy: context.securityPolicy?.networkPolicy()
        });
        if (wantsCompact(input)) {
          const compact = {
            h: result.state.headings,
            t: result.state.textSnippets,
            l: result.state.links.map((link) => [link.text, link.href]),
            e: [result.state.consoleErrors.length, result.state.failedRequests.length],
            r: result.resources
          };
          return input.responseProfile ? withMetrics(compact, input, "browser") : compact;
        }
        return withMetrics(result, input, "browser");
      },
      close: async () => {
        await options.browserPool?.close();
      }
    }
  ];
}

function wantsCompact(input: RetrieveContextInput): boolean {
  return input.returnMode === "compact" || input.responseProfile === "minimal";
}

function budgetFor(input: RetrieveContextInput, defaultBudget: number): number {
  return responseProfileBudget(input.responseProfile ?? "standard", input.budgetTokens ?? defaultBudget);
}

function withMetrics<T extends Record<string, unknown>>(
  value: T,
  input: RetrieveContextInput,
  source: string
): T & { profile: ResponseProfile; metrics: { source: string; estimatedTokens: number; cache: CacheStatus; elapsedMs: number } } {
  const startedAt = Date.now();
  return {
    ...value,
    profile: input.responseProfile ?? "standard",
    metrics: {
      source,
      estimatedTokens: typeof value.tokenEstimate === "number" ? value.tokenEstimate : estimateTokens(JSON.stringify(value)),
      cache: typeof value.cacheStatus === "string" ? (value.cacheStatus as CacheStatus) : "none",
      elapsedMs: Date.now() - startedAt
    }
  };
}

function compactMatchingLine(snippet: string, query?: string): string {
  const lines = snippet.split(/\r?\n/).filter(Boolean);
  if (!query) {
    return lines[0] ?? "";
  }
  const matchingLine = lines.find((line) => line.toLowerCase().includes(query.toLowerCase()));
  return matchingLine ?? lines[0] ?? "";
}
