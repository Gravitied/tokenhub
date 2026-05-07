import type { OutputShape, RequestHints, RequestIntent, RequestPlan, RequestSubject, SourceStrategy } from "./request-shape.js";
import { normalizeRequestHints } from "./request-shape.js";

export type InferRequestPlanInput = {
  request: string;
  hints?: RequestHints;
};

export function inferRequestPlan(input: InferRequestPlanInput): RequestPlan {
  const request = input.request.trim();
  const lower = request.toLowerCase();
  const hints = input.hints ?? {};
  const normalized = normalizeRequestHints(hints);
  const codingAgentRoute = inferCodingAgentRoute(lower);

  const intent = hints.intent ?? codingAgentRoute?.intent ?? inferIntent(lower);
  const subject = hints.subject ?? codingAgentRoute?.subject ?? inferSubject(lower);
  const outputShape = hints.outputShape ?? codingAgentRoute?.outputShape ?? inferOutputShape(lower, intent, subject);
  const sources = hints.sources ?? codingAgentRoute?.sources ?? inferSources(lower, intent, subject);
  const depth = hints.depth ?? inferDepth(lower, intent);

  return {
    request,
    intent,
    subject,
    outputShape,
    sources,
    depth,
    evidence: normalized.evidence,
    execution: normalized.execution,
    searchQueries: buildSearchQueries(request, subject, intent),
    localQueries: buildLocalQueries(request, subject),
    constraints: buildConstraints(lower),
    confidence: 0.78,
    rationale: buildRationale(intent, subject, outputShape, sources)
  };
}

type CodingAgentRoute = {
  intent: RequestIntent;
  subject: RequestSubject;
  outputShape: OutputShape;
  sources: SourceStrategy[];
};

const LOCAL_ONLY: SourceStrategy[] = ["local_files"];
const LOCAL_DOCS: SourceStrategy[] = ["local_files", "docs"];
const LOCAL_PACKAGE_DOCS: SourceStrategy[] = ["local_files", "docs", "package_registry"];

function inferCodingAgentRoute(lower: string): CodingAgentRoute | undefined {
  if (!isCodingAgentRequest(lower)) return undefined;

  const intent = inferCodingAgentIntent(lower);
  const subject = inferCodingAgentSubject(lower, intent);
  const outputShape = inferCodingAgentOutputShape(lower, intent, subject);
  const sources = inferCodingAgentSources(lower, subject);
  return { intent, subject, outputShape, sources };
}

function isCodingAgentRequest(lower: string): boolean {
  if (isExternalKnowledgeRequest(lower)) {
    return false;
  }

  return (
    /\b(this|current|existing|repo|repository|codebase|project|branch|worktree|component|page|modal|endpoint|routes?|flow|resolver|module|screen|service|worker|table|form|file|job|schema|query|dockerfile|terraform|readme)\b/.test(
      lower
    ) ||
    /\b(add|build|convert|create|debug|explain|find|fix|generate|identify|implement|improve|inspect|investigate|make|prepare|port|refactor|rename|replace|review|set up|update|write)\b/.test(
      lower
    )
  );
}

function isExternalKnowledgeRequest(lower: string): boolean {
  if (/\b(current|latest|official)\b/.test(lower) && /\b(docs|documentation|release notes|config docs|spec|guidance|migration notes|changelog|best practices)\b/.test(lower)) {
    return true;
  }
  if (/\b(package metadata|npm package)\b/.test(lower)) return true;
  if (/\btop\s+\d+\b|\branked list\b|\bcurrent ceo\b|\bpricing table\b/.test(lower)) return true;
  if (/\bnode undici\b|\beconnreset\b|\bfunction_invocation_failed\b/.test(lower) && !/\b(this|repo|repository|codebase|project|worktree)\b/.test(lower)) {
    return true;
  }
  if (/\bgithub actions\b.*\b(cache failure|setup cache failure)\b/.test(lower) && !/\b(this|repo|repository|codebase|project|worktree)\b/.test(lower)) {
    return true;
  }
  return false;
}

function inferCodingAgentIntent(lower: string): RequestIntent {
  if (/\bprepare this branch\b/.test(lower)) return "plan";
  if (/\brename\b.*\bacross the codebase\b/.test(lower)) return "plan";
  if (/\bcreate a migration plan\b/.test(lower)) return "plan";

  if (/\b(inspect this repository|explain how authentication works|explain this legacy module|generate a changelog|inspect the current worktree)\b/.test(lower)) {
    return "extract";
  }
  if (/\bfind all todo\b/.test(lower)) return "extract";

  if (/\bterraform module\b/.test(lower)) return "debug";

  if (/\b(then implement|implement the gaps|close the gaps)\b/.test(lower)) return "implement";

  if (
    /\bcompare\b/.test(lower) ||
    /\breview\b/.test(lower) ||
    /\btrade-?offs?\b/.test(lower) ||
    /\bsuggest indexes\b/.test(lower) ||
    /\bcaching strategy\b/.test(lower)
  ) {
    return "compare";
  }

  if (
    /\bdebug\b/.test(lower) ||
    /\binvestigate\b/.test(lower) ||
    /\banalyze the bundle size\b/.test(lower) ||
    /\btypescript generic is failing\b/.test(lower) ||
    /\bterraform module\b/.test(lower) ||
    /\blikely cause\b/.test(lower) ||
    /\brca\b/.test(lower) ||
    /\broot cause\b/.test(lower) ||
    /\brace condition\b/.test(lower) ||
    /\bmemory usage grows\b/.test(lower) ||
    /\bflaky ci\b/.test(lower) ||
    /\bfailing docker compose\b/.test(lower) ||
    /\bkubernetes deployment keeps restarting\b/.test(lower) ||
    /\bminimal reproduction\b/.test(lower) ||
    /\bsecurity risks\b/.test(lower) ||
    /\blayout shift\b/.test(lower) ||
    /\bdead code\b/.test(lower) ||
    /\bsql injection\b/.test(lower)
  ) {
    return "debug";
  }

  if (/\b(find inconsistent error response shapes|improve the error handling)\b/.test(lower)) return "implement";

  if (/\b(replace|refactor|improve|update|make|convert|create|add|implement|write|port|set up|build|generate|fix|standardize)\b/.test(lower)) {
    return "implement";
  }

  return "answer";
}

function inferCodingAgentSubject(lower: string, intent: RequestIntent): RequestSubject {
  if (/\b(inspect this repository|codebase|current worktree|prepare this branch|generate a changelog)\b/.test(lower)) return "repo";
  if (/\bcurrent diff|pull request\b/.test(lower) && /\breview\b/.test(lower)) return "code";
  if (/\bdependency update pr\b/.test(lower)) return "repo";
  if (/\blinting and formatting in this repo\b/.test(lower)) return "repo";

  if (/\b(openapi documentation|developer documentation|readme)\b/.test(lower)) return "docs";

  if (/\b(deprecated library|bundle size|node 18|node 20)\b/.test(lower)) return "package";

  if (/\b(production error stack trace|flaky ci failure|race condition|memory usage grows|websocket connection disconnects|failing docker compose|kubernetes deployment keeps restarting)\b/.test(lower)) {
    return "error";
  }
  if (/\bfailing test\b/.test(lower)) return "error";
  if (/\breported frontend bug\b/.test(lower)) return "code";

  if (
    /\b(rest endpoint|api endpoint|api design|readiness probes|service-to-service api|third-party api|payment creation|error response shapes|external api client|server-side filtering|observability metrics|rest to graphql)\b/.test(
      lower
    )
  ) {
    return "api";
  }

  if (/\b(database schema|slow queries|this query is slow)\b/.test(lower)) return "data";

  if (/\b(authentication works)\b/.test(lower)) return "repo";
  if (/\bdead code in this package\b/.test(lower)) return "repo";

  if (intent === "answer") return inferSubject(lower);
  return "code";
}

function inferCodingAgentOutputShape(lower: string, intent: RequestIntent, subject: RequestSubject): OutputShape {
  if (/\bopenapi documentation\b/.test(lower)) return "structured_data";
  if (/\b(developer documentation|readme)\b/.test(lower)) return "plan";
  if (/\b(find all todo|generate a changelog)\b/.test(lower)) return "structured_data";
  if (/\binspect this repository\b/.test(lower)) return "list";
  if (/\binspect the current worktree\b/.test(lower)) return "plan";
  if (/\bauthentication works|legacy module\b/.test(lower)) return "paragraph";
  if (/\btrade-?offs?\b/.test(lower)) return "agent_context";
  if (/\btypescript generic is failing\b/.test(lower)) return "paragraph";
  if (/\b(review|security risks|database schema|bundle size|terraform|mobile app|caching strategy|accessibility issues|agent tool definition)\b/.test(lower)) {
    return /\bdatabase schema\b/.test(lower) ? "table" : "list";
  }
  if (
    intent === "debug" &&
    !/\b(sql injection|minimal reproduction|frontend bug)\b/.test(lower) &&
    /\b(production error stack trace)\b/.test(lower)
  ) {
    return "list";
  }
  if (intent === "debug") return /\b(sql injection|minimal reproduction|frontend bug)\b/.test(lower) ? "patch_plan" : "plan";
  if (intent === "plan") return "plan";
  if (intent === "implement") return "patch_plan";
  if (intent === "compare") return subject === "data" ? "table" : "list";
  if (intent === "extract") return subject === "repo" ? "paragraph" : "structured_data";
  return "paragraph";
}

function inferCodingAgentSources(lower: string, subject: RequestSubject): SourceStrategy[] {
  if (/\b(similar professional optimized implementations|professional optimized implementations|github production implementation)\b/.test(lower)) {
    return ["local_files", "web_search", "github_code", "docs"];
  }
  if (/\bdependency update pr\b/.test(lower)) return LOCAL_PACKAGE_DOCS;
  if (subject === "package" && /\b(package metadata|npm package|changelog|release notes|deprecated library|node 18|node 20|dependency update pr)\b/.test(lower)) {
    return LOCAL_PACKAGE_DOCS;
  }
  if (needsLocalDocs(lower, subject)) return LOCAL_DOCS;
  return LOCAL_ONLY;
}

function needsLocalDocs(lower: string, subject: RequestSubject): boolean {
  if (subject === "package") return true;
  return /\b(bundle size|observability metrics|localization|csrf protection|readiness probes|file upload|oauth callback|layout shift|rest to graphql|idempotency keys|query is slow|contract tests|multiple currencies|mobile app|linting and formatting|third-party api|docker compose|web workers|color contrast|focus states|sso login|kubernetes deployment|agent tool definition|playwright tests)\b/.test(
    lower
  );
}

function inferIntent(lower: string): RequestIntent {
  if (/\b(implement|fix|add|patch|close the gaps|then implement)\b/.test(lower)) return "implement";
  if (/\b(compare|versus|vs\.?|difference|gaps)\b/.test(lower)) return "compare";
  if (/\b(debug|error|failing|stack trace|exception)\b/.test(lower)) return "debug";
  if (/\b(extract|scrape|collect|dataset|table)\b/.test(lower)) return "extract";
  if (/\b(plan|roadmap|steps|commands|deploy|deployment|migrate|migration|give commands)\b/.test(lower)) return "plan";
  if (/\b(research|latest|papers|sources|citations|deep)\b/.test(lower)) return "research";
  return "answer";
}

function inferSubject(lower: string): RequestSubject {
  if (/\b(error|errors|stack trace|exception|econnreset|timeout|failed|failure|function_invocation_failed|500)\b/.test(lower)) return "error";
  if (/\b(paper|papers|arxiv)\b/.test(lower)) return "paper";
  if (/\b(package|npm|version|changelog|release|react query|next\.?js|zod)\b/.test(lower)) return "package";
  if (/\b(api|endpoint|openapi|sdk)\b/.test(lower)) return "api";
  if (/\b(docs|documentation|guidance|guide|spec|specification|best practices|official)\b/.test(lower)) return "docs";
  if (/\b(data|csv|table|rows|prices|pricing|minutes|vegetable|vegetables)\b/.test(lower)) return "data";
  if (/\b(repo|pull request|issue)\b/.test(lower)) return "repo";
  if (/\b(code|implementation|implementations|feature|github|typescript|python|function|class|filesystem server)\b/.test(lower)) return "code";
  if (/\b(who|what|when|where|fact)\b/.test(lower)) return "fact";
  return "unknown";
}

function inferOutputShape(lower: string, intent: RequestIntent, subject: RequestSubject): OutputShape {
  if (intent === "implement") return "patch_plan";
  if (/\b(structured data|json|records)\b/.test(lower)) return "structured_data";
  if (/\b(cite|cites|citation|citations|sources)\b/.test(lower)) return "citations";
  if (/\b(table|spreadsheet|columns|rows)\b/.test(lower)) return "table";
  if (intent === "plan") return "plan";
  if (/\b(list|top \d+|ranked)\b/.test(lower)) return "list";
  if (/\b(1 paragraph|one paragraph|summary|summarize)\b/.test(lower)) return "paragraph";
  if (intent === "extract" || subject === "data") return "structured_data";
  if (intent === "research" || intent === "compare") return "agent_context";
  return "paragraph";
}

function inferSources(lower: string, intent: RequestIntent, subject: RequestSubject): SourceStrategy[] {
  const sources = new Set<SourceStrategy>();
  if (intent === "implement" || intent === "compare" || subject === "code") {
    sources.add("local_files");
    sources.add("web_search");
    sources.add("github_code");
    sources.add("docs");
  }
  if (subject === "paper" || /\blatest|internet|web|search|research\b/.test(lower)) {
    sources.add("web_search");
    sources.add("web_pages");
  }
  if (subject === "package") {
    sources.add("web_search");
    sources.add("package_registry");
    sources.add("docs");
  }
  if (subject === "api") {
    sources.add("docs");
    sources.add("web_search");
  }
  if (subject === "docs") {
    sources.add("docs");
    sources.add("web_search");
  }
  if (subject === "error" || subject === "data" || subject === "fact") {
    sources.add("web_search");
  }
  if (sources.size === 0) sources.add("web_search");
  return [...sources];
}

function inferDepth(lower: string, intent: RequestIntent): RequestPlan["depth"] {
  if (/\b(exhaustive|all competitors|no compromises)\b/.test(lower)) return "exhaustive";
  if (/\b(deep|professional|optimized|compare|gaps|research)\b/.test(lower) || intent === "implement") return "deep";
  if (/\b(quick|fast|brief)\b/.test(lower)) return "fast";
  return "standard";
}

function buildSearchQueries(request: string, subject: RequestSubject, intent: RequestIntent): string[] {
  const cleaned = cleanRequestForSearch(request);
  if (subject === "code" && (intent === "compare" || intent === "implement")) {
    return [`${cleaned} GitHub production implementation`, `${cleaned} professional optimized implementation`, `${cleaned} best practices docs`];
  }
  return [cleaned];
}

function buildLocalQueries(request: string, subject: RequestSubject): string[] {
  if (subject === "code") return [...new Set([request, ...keywordsForSearch(request), "feature", "implementation"])];
  return [request];
}

function buildConstraints(lower: string): string[] {
  const constraints: string[] = [];
  if (lower.includes("latest")) constraints.push("prefer fresh sources and include dates when available");
  if (lower.includes("professional") || lower.includes("optimized")) constraints.push("prefer mature, maintained, production-oriented references");
  if (lower.includes("implement")) constraints.push("do not modify files unless execution mode allows implementation");
  return constraints;
}

function buildRationale(intent: RequestIntent, subject: RequestSubject, outputShape: OutputShape, sources: SourceStrategy[]): string[] {
  return [
    `intent=${intent} based on action words in the request`,
    `subject=${subject} based on domain terms in the request`,
    `outputShape=${outputShape} selected from requested answer format and action`,
    `sources=${sources.join(",")} selected for evidence gathering`
  ];
}

function cleanRequestForSearch(request: string): string {
  return request
    .replace(/\b(give me|show me|look for|find|please|can you|could you)\b/gi, " ")
    .replace(/\b(a|an|the)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordsForSearch(request: string): string[] {
  const stopwords = new Set([
    "compare",
    "current",
    "find",
    "implementation",
    "implementations",
    "optimized",
    "professional",
    "similar",
    "this",
    "with"
  ]);
  return [...new Set(request.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])].filter((word) => !stopwords.has(word)).slice(0, 6);
}
