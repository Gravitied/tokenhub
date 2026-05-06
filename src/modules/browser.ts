import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { ResourceStore } from "../core/resources.js";

export type BrowserCaptureInput = {
  url: string;
  resourceStore: ResourceStore;
  includeScreenshot?: boolean;
  budgetTokens?: number;
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
  };
  resources: string[];
  tokenEstimate: number;
}> {
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
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 20000 });
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
      failedRequests
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
        .join(" | ")}\nConsole errors: ${consoleErrors.length}; failed requests: ${failedRequests.length}`,
      input.budgetTokens ?? 500
    ).text;
    return { summary, state, resources, tokenEstimate: estimateTokens(summary) };
  } finally {
    await browser.close();
  }
}
