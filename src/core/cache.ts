export type CacheStatus = "hit" | "miss" | "stale" | "none";

export type MemoryCacheOptions = {
  ttlMs: number;
  maxEntries?: number;
};

type CacheRecord<T> = {
  value: T;
  createdAt: number;
  lastUsedAt: number;
};

export class MemoryCache<T> {
  private readonly records = new Map<string, CacheRecord<T>>();

  constructor(private readonly options: MemoryCacheOptions) {}

  get(key: string): T | undefined {
    const record = this.records.get(key);
    if (!record) {
      return undefined;
    }
    if (Date.now() - record.createdAt > this.options.ttlMs) {
      this.records.delete(key);
      return undefined;
    }
    record.lastUsedAt = Date.now();
    return record.value;
  }

  set(key: string, value: T): void {
    this.records.set(key, {
      value,
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    });
    this.evictIfNeeded();
  }

  stats(): { entries: number; ttlMs: number } {
    return { entries: this.records.size, ttlMs: this.options.ttlMs };
  }

  private evictIfNeeded(): void {
    const maxEntries = this.options.maxEntries ?? 250;
    if (this.records.size <= maxEntries) {
      return;
    }
    const oldest = [...this.records.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0]?.[0];
    if (oldest) {
      this.records.delete(oldest);
    }
  }
}
