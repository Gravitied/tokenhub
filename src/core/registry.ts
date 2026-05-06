export type CapabilityManifest = {
  id: string;
  module: string;
  title: string;
  summary: string;
  keywords: string[];
  costHintTokens: number;
  inputSchema?: unknown;
};

export type DiscoveredCapability = Omit<CapabilityManifest, "inputSchema" | "keywords"> & {
  score: number;
  matchedKeywords: string[];
};

export class CapabilityRegistry {
  private readonly manifests = new Map<string, CapabilityManifest>();

  register(manifest: CapabilityManifest): void {
    this.manifests.set(manifest.id, manifest);
  }

  list(): CapabilityManifest[] {
    return [...this.manifests.values()];
  }

  discover(query: string, options: { limit?: number } = {}): DiscoveredCapability[] {
    const terms = tokenize(query);
    const scored = [...this.manifests.values()]
      .map((manifest) => {
        const haystack = tokenize(`${manifest.id} ${manifest.module} ${manifest.title} ${manifest.summary}`);
        const matchedKeywords = manifest.keywords.filter((keyword) => terms.includes(keyword.toLowerCase()));
        const keywordScore = matchedKeywords.length * 5;
        const textScore = terms.filter((term) => haystack.includes(term)).length;
        return {
          id: manifest.id,
          module: manifest.module,
          title: manifest.title,
          summary: manifest.summary,
          costHintTokens: manifest.costHintTokens,
          score: keywordScore + textScore,
          matchedKeywords
        };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.costHintTokens - b.costHintTokens);

    return scored.slice(0, options.limit ?? 5);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/g)
    .filter(Boolean);
}
