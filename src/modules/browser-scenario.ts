import { estimateTokens, truncateToTokens } from "../core/token.js";
import type { ResourceLink, ResourceStore } from "../core/resources.js";
import { assertAllowedNetworkUrl, type UrlAddressLookup } from "../core/url-policy.js";
import type { NetworkSecurityPolicy } from "../core/security-policy.js";
import { BrowserPool } from "./browser.js";

type BrowserLike = {
  newPage: () => Promise<any>;
  close: () => Promise<void>;
};

export type BrowserScenarioStep =
  | { action: "click"; selector: string }
  | { action: "fill"; selector: string; value: string }
  | { action: "press"; selector: string; key: string }
  | { action: "waitForText"; text: string; timeoutMs?: number }
  | { action: "expectText"; text: string }
  | { action: "screenshot"; label?: string };

export type BrowserScenarioInput = {
  url: string;
  steps: BrowserScenarioStep[];
  resourceStore: ResourceStore;
  budgetTokens?: number;
  urlLookup?: UrlAddressLookup;
  networkPolicy?: NetworkSecurityPolicy;
  browserPool?: BrowserPool;
  launch?: () => Promise<BrowserLike>;
};

export async function runBrowserScenario(input: BrowserScenarioInput): Promise<{
  summary: string;
  passed: boolean;
  steps: Array<{ index: number; action: string; ok: boolean; message: string }>;
  resources: ResourceLink[];
  warnings: string[];
  tokenEstimate: number;
}> {
  await assertAllowedNetworkUrl(input.url, { lookupAddress: input.urlLookup, networkPolicy: input.networkPolicy });
  const pooled = input.browserPool ? await input.browserPool.acquire() : undefined;
  const ownedBrowser = pooled ? undefined : await (input.launch ? input.launch() : launchBrowser());
  const browser = pooled?.browser ?? ownedBrowser;
  if (!browser) {
    throw new Error("Unable to launch browser.");
  }

  const resources: ResourceLink[] = [];
  const results: Array<{ index: number; action: string; ok: boolean; message: string }> = [];
  const warnings: string[] = [];
  let page: any;

  try {
    page = await browser.newPage();
    await page.route?.("**/*", async (route: any) => {
      try {
        await assertAllowedNetworkUrl(route.request().url(), { lookupAddress: input.urlLookup, networkPolicy: input.networkPolicy });
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 20000 });

    for (const [index, step] of input.steps.entries()) {
      const result = await runStep({ page, step, resourceStore: input.resourceStore, resources });
      results.push({ index: index + 1, action: step.action, ...result });
      if (!result.ok) {
        warnings.push(result.message);
        break;
      }
    }

    const passed = warnings.length === 0;
    const trace = {
      url: input.url,
      finalUrl: typeof page.url === "function" ? page.url() : input.url,
      title: typeof page.title === "function" ? await page.title() : "",
      passed,
      steps: results
    };
    const traceLink = await input.resourceStore.writeText({
      kind: "log",
      label: `browser scenario ${passed ? "passed" : "failed"}`,
      source: input.url,
      content: JSON.stringify(trace, null, 2)
    });
    resources.push(traceLink);

    const summaryText = `${passed ? "Browser scenario passed" : "Browser scenario failed"}: ${input.url}\n${results
      .map((result) => `${result.index}. ${result.action}: ${result.ok ? "ok" : "failed"} - ${result.message}`)
      .join("\n")}`;
    const summary = truncateToTokens(summaryText, input.budgetTokens ?? 600).text;
    return {
      summary,
      passed,
      steps: results,
      resources,
      warnings,
      tokenEstimate: estimateTokens(summary)
    };
  } finally {
    await page?.close?.().catch(() => undefined);
    if (pooled) {
      await pooled.release();
    } else {
      await ownedBrowser?.close();
    }
  }
}

async function runStep(input: {
  page: any;
  step: BrowserScenarioStep;
  resourceStore: ResourceStore;
  resources: ResourceLink[];
}): Promise<{ ok: boolean; message: string }> {
  const { page, step } = input;
  if (step.action === "click") {
    await page.locator(step.selector).click();
    return { ok: true, message: `Clicked ${step.selector}` };
  }
  if (step.action === "fill") {
    await page.locator(step.selector).fill(step.value);
    return { ok: true, message: `Filled ${step.selector}` };
  }
  if (step.action === "press") {
    await page.locator(step.selector).press(step.key);
    return { ok: true, message: `Pressed ${step.key} in ${step.selector}` };
  }
  if (step.action === "waitForText") {
    await page.locator(`text=${step.text}`).waitFor({ timeout: step.timeoutMs ?? 5000 });
    return { ok: true, message: `Text appeared: ${step.text}` };
  }
  if (step.action === "expectText") {
    const count = await page.locator(`text=${step.text}`).count();
    return count > 0 ? { ok: true, message: `Found text: ${step.text}` } : { ok: false, message: `Expected text not found: ${step.text}` };
  }
  const screenshot = await page.screenshot({ fullPage: true });
  const link = await input.resourceStore.writeText({
    kind: "screenshot",
    label: step.label ?? "browser scenario screenshot",
    source: typeof page.url === "function" ? page.url() : undefined,
    content: screenshot
  });
  input.resources.push(link);
  return { ok: true, message: `Captured screenshot ${link.uri}` };
}

async function launchBrowser(): Promise<BrowserLike> {
  const { chromium } = await import("playwright");
  return chromium.launch();
}
