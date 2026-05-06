export type RequestIntent = "answer" | "research" | "compare" | "implement" | "debug" | "extract" | "plan";
export type RequestSubject = "fact" | "code" | "docs" | "paper" | "package" | "api" | "repo" | "data" | "error" | "unknown";
export type OutputShape = "paragraph" | "list" | "table" | "plan" | "patch_plan" | "citations" | "structured_data" | "agent_context";
export type SourceStrategy = "local_files" | "web_search" | "web_pages" | "github_repo" | "github_code" | "docs" | "package_registry";
export type RequestDepth = "fast" | "standard" | "deep" | "exhaustive";
export type EvidenceMode = "none" | "sources" | "snippets" | "resource_links" | "raw_extracts";
export type ExecutionMode = "answer_only" | "plan_only" | "implement" | "implement_and_verify";

export type RequestHints = {
  intent?: RequestIntent;
  subject?: RequestSubject;
  outputShape?: OutputShape;
  sources?: SourceStrategy[];
  depth?: RequestDepth;
  evidence?: EvidenceMode;
  execution?: ExecutionMode;
};

export type NormalizedRequestHints = {
  depth: RequestDepth;
  evidence: EvidenceMode;
  execution: ExecutionMode;
};

export type RequestPlan = {
  request: string;
  intent: RequestIntent;
  subject: RequestSubject;
  outputShape: OutputShape;
  sources: SourceStrategy[];
  depth: RequestDepth;
  evidence: EvidenceMode;
  execution: ExecutionMode;
  searchQueries: string[];
  localQueries: string[];
  constraints: string[];
  confidence: number;
  rationale: string[];
};

export function normalizeRequestHints(hints: RequestHints): NormalizedRequestHints {
  return {
    depth: hints.depth ?? "standard",
    evidence: hints.evidence ?? "resource_links",
    execution: hints.execution ?? "answer_only"
  };
}
