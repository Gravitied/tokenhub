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

  const intent = hints.intent ?? inferIntent(lower);
  const subject = hints.subject ?? inferSubject(lower);
  const outputShape = hints.outputShape ?? inferOutputShape(lower, intent, subject);
  const sources = hints.sources ?? inferSources(lower, intent, subject);
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

function inferIntent(lower: string): RequestIntent {
  if (/\b(implement|fix|add|patch|close the gaps|then implement)\b/.test(lower)) return "implement";
  if (/\b(compare|versus|vs\.?|difference|gaps)\b/.test(lower)) return "compare";
  if (/\b(debug|error|failing|stack trace|exception)\b/.test(lower)) return "debug";
  if (/\b(extract|scrape|collect|dataset|table)\b/.test(lower)) return "extract";
  if (/\b(plan|roadmap|steps|commands|deploy|deployment|migrate|migration)\b/.test(lower)) return "plan";
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
