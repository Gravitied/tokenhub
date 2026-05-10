import type { ResourceStore } from "../core/resources.js";
import type { SecurityPolicy } from "../core/security-policy.js";
import type { ResponseProfile } from "../core/token.js";

export type RetrievalSourceName =
  | "files"
  | "git"
  | "web"
  | "github"
  | "search"
  | "sqlite"
  | "postgres"
  | "docs"
  | "sentry"
  | "browser";

export type RetrieveContextInput = {
  source: RetrievalSourceName;
  query?: string;
  url?: string;
  owner?: string;
  repo?: string;
  provider?: "brave" | "exa" | "tavily" | "serpapi" | "duckduckgo";
  apiKey?: string;
  packageName?: string;
  databaseBase64?: string;
  connectionString?: string;
  organization?: string;
  project?: string;
  token?: string;
  issues?: Array<Record<string, unknown>>;
  budgetTokens?: number;
  limit?: number;
  includeRaw?: boolean;
  returnMode?: "summary" | "compact";
  responseProfile?: ResponseProfile;
};

export type RetrievalContext = {
  root: string;
  resourceStore: ResourceStore;
  securityPolicy?: SecurityPolicy;
};

export type RetrievalSourceModule = {
  name: RetrievalSourceName;
  title: string;
  defaultBudgetTokens: number;
  retrieve(input: RetrieveContextInput, context: RetrievalContext): Promise<unknown>;
  close?: () => Promise<void>;
};

export class SourceRegistry {
  private readonly sources = new Map<RetrievalSourceName, RetrievalSourceModule>();

  register(source: RetrievalSourceModule): void {
    this.sources.set(source.name, source);
  }

  names(): RetrievalSourceName[] {
    return [...this.sources.keys()];
  }

  list(): RetrievalSourceModule[] {
    return [...this.sources.values()];
  }

  async retrieve(input: RetrieveContextInput, context: RetrievalContext): Promise<unknown> {
    const source = this.sources.get(input.source);
    if (!source) {
      throw new Error(`Unknown retrieval source: ${input.source}`);
    }
    const startedAt = Date.now();
    const result = await source.retrieve(input, context);
    return attachElapsedMetric(result, startedAt);
  }

  async close(): Promise<void> {
    await Promise.all(this.list().map((source) => source.close?.()));
  }
}

function attachElapsedMetric(result: unknown, startedAt: number): unknown {
  if (!result || typeof result !== "object" || !("metrics" in result)) {
    return result;
  }
  const metrics = (result as { metrics?: unknown }).metrics;
  if (!metrics || typeof metrics !== "object") {
    return result;
  }
  return {
    ...(result as Record<string, unknown>),
    metrics: {
      ...(metrics as Record<string, unknown>),
      elapsedMs: Date.now() - startedAt
    }
  };
}
