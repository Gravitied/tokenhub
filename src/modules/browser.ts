import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { ResourceStore } from "../core/resources.js";
import { assertAllowedNetworkUrl, type UrlAddressLookup } from "../core/url-policy.js";

export type BrowserCaptureInput = {
  url: string;
  resourceStore: ResourceStore;
  includeScreenshot?: boolean;
  budgetTokens?: number;
  urlLookup?: UrlAddressLookup;
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
  await assertAllowedNetworkUrl(input.url, { lookupAddress: input.urlLookup });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  try {
    await page.route("**/*", async (route) => {
      try {
        await assertAllowedNetworkUrl(route.request().url(), { lookupAddress: input.urlLookup });
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
    await browser.close();
  }
}
