import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { ResourceStore } from "../core/resources.js";
import { assertAllowedNetworkUrl, type UrlAddressLookup } from "../core/url-policy.js";
import type { NetworkSecurityPolicy } from "../core/security-policy.js";
import type { Page } from "playwright";

const MAX_BROWSER_EVENT_ITEMS = 50;

type BrowserLike = {
  newPage: () => Promise<any>;
  close: () => Promise<void>;
};

type BrowserPoolEntry = {
  browser: BrowserLike;
  createdAt: number;
  lastUsedAt: number;
  uses: number;
};

export class BrowserPool {
  private entry?: BrowserPoolEntry;

  constructor(
    private readonly options: {
      ttlMs: number;
      maxUses: number;
      launch?: () => Promise<BrowserLike>;
    }
  ) {}

  async acquire(): Promise<{ browser: BrowserLike; release: () => Promise<void> }> {
    const entry = await this.entryForUse();
    return {
      browser: entry.browser,
      release: async () => {
        entry.uses += 1;
        entry.lastUsedAt = Date.now();
        if (entry.uses >= this.options.maxUses) {
          await this.close();
        }
      }
    };
  }

  stats(): { active: boolean; uses: number } {
    return { active: Boolean(this.entry), uses: this.entry?.uses ?? 0 };
  }

  async close(): Promise<void> {
    const entry = this.entry;
    this.entry = undefined;
    await entry?.browser.close().catch(() => undefined);
  }

  private async entryForUse(): Promise<BrowserPoolEntry> {
    if (this.entry && Date.now() - this.entry.lastUsedAt <= this.options.ttlMs) {
      return this.entry;
    }
    await this.close();
    const browser = await this.launchBrowser();
    this.entry = {
      browser,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      uses: 0
    };
    return this.entry;
  }

  private async launchBrowser(): Promise<BrowserLike> {
    if (this.options.launch) {
      return this.options.launch();
    }
    const { chromium } = await import("playwright");
    return chromium.launch();
  }
}

export type BrowserCaptureInput = {
  url: string;
  resourceStore: ResourceStore;
  includeScreenshot?: boolean;
  budgetTokens?: number;
  urlLookup?: UrlAddressLookup;
  browserPool?: BrowserPool;
  networkPolicy?: NetworkSecurityPolicy;
};

export async function captureBrowserState(input: BrowserCaptureInput): Promise<{
  summary: string;
  state: {
    title: string;
    url: string;
    headings: string[];
    links: Array<{ text: string; href: string }>;
    buttons: string[];
    textSnippets: string[];
    consoleErrors: string[];
    failedRequests: string[];
    elements: Array<{ ref: string; role: "link" | "button" | "input"; text: string; href?: string; name?: string }>;
  };
  resources: string[];
  tokenEstimate: number;
}> {
  await assertAllowedNetworkUrl(input.url, { lookupAddress: input.urlLookup, networkPolicy: input.networkPolicy });
  const pooled = input.browserPool ? await input.browserPool.acquire() : undefined;
  const ownedBrowser = pooled ? undefined : await launchBrowser();
  const browser = pooled?.browser ?? ownedBrowser;
  if (!browser) {
    throw new Error("Unable to launch browser.");
  }
  let page: Page | undefined;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  try {
    page = (await browser.newPage()) as Page;
    page.on("console", (message) => {
      if (message.type() === "error") {
        pushBounded(consoleErrors, message.text());
      }
    });
    page.on("requestfailed", (request) => pushBounded(failedRequests, request.url()));

    await page.route("**/*", async (route) => {
      try {
        await assertAllowedNetworkUrl(route.request().url(), { lookupAddress: input.urlLookup, networkPolicy: input.networkPolicy });
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const elements = await page.locator("a[href],button,input,textarea,select").evaluateAll((nodes) =>
      nodes.slice(0, 40).map((node, index) => {
        const tag = node.tagName.toLowerCase();
        const input = node as HTMLInputElement;
        const anchor = node as HTMLAnchorElement;
        const role: "link" | "button" | "input" =
          tag === "a" ? "link" : tag === "button" || input.type === "button" || input.type === "submit" ? "button" : "input";
        return {
          ref: `e${index + 1}`,
          role,
          text: (node.textContent || input.value || input.placeholder || input.getAttribute("aria-label") || "").trim(),
          href: role === "link" ? anchor.href : undefined,
          name: input.name || input.id || undefined
        };
      })
    );
    const state = {
      title: await page.title(),
      url: page.url(),
      headings: await page.locator("h1,h2,h3").evaluateAll((nodes) =>
        nodes.slice(0, 12).map((node) => (node.textContent ?? "").trim()).filter(Boolean)
      ),
      links: await page.locator("a[href]").evaluateAll((nodes) =>
        nodes.slice(0, 20).map((node) => ({
          text: (node.textContent ?? "").trim(),
          href: (node as HTMLAnchorElement).href
        }))
      ),
      buttons: await page.locator("button,input[type=button],input[type=submit]").evaluateAll((nodes) =>
        nodes.slice(0, 20).map((node) => (node.textContent || (node as HTMLInputElement).value || "").trim()).filter(Boolean)
      ),
      textSnippets: await page.locator("p,main,article").evaluateAll((nodes) =>
        nodes
          .slice(0, 8)
          .map((node) => (node.textContent ?? "").trim().replace(/\s+/g, " "))
          .filter(Boolean)
      ),
      consoleErrors,
      failedRequests,
      elements
    };
    const resources: string[] = [];
    if (input.includeScreenshot) {
      const screenshot = await page.screenshot({ fullPage: true });
      const link = await input.resourceStore.writeText({
        kind: "screenshot",
        label: `browser screenshot ${state.title || state.url}`,
        source: state.url,
        content: screenshot
      });
      resources.push(link.uri);
    }
    const summary = truncateToTokens(
      `Page ${state.title} ${state.url}\nHeadings: ${state.headings.join(" | ")}\nText: ${state.textSnippets.join(" | ")}\nLinks: ${state.links
        .map((link, index) => `[${index + 1}] ${link.text} -> ${link.href}`)
        .join(" | ")}\nElements: ${state.elements
        .map((element) => `${element.ref}:${element.role}:${element.text || element.name || ""}`)
        .join(" | ")}\nConsole errors: ${consoleErrors.length}; failed requests: ${failedRequests.length}`,
      input.budgetTokens ?? 500
    ).text;
    return { summary, state, resources, tokenEstimate: estimateTokens(summary) };
  } finally {
    await page?.close?.().catch(() => undefined);
    if (pooled) {
      await pooled.release();
    } else {
      await ownedBrowser?.close();
    }
  }
}

async function launchBrowser(): Promise<BrowserLike> {
  const { chromium } = await import("playwright");
  return chromium.launch();
}

function pushBounded(items: string[], item: string): void {
  if (items.length < MAX_BROWSER_EVENT_ITEMS) {
    items.push(item);
  }
}
