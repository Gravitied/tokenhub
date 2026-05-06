export type BenchmarkScoreInput = {
  name: string;
  outputText: string;
  estimatedTokens: number;
  expectedFacts: string[];
  requiredPatterns: RegExp[];
  forbiddenPatterns: RegExp[];
  lowerIsBetterTokenBaseline?: number;
};

export type BenchmarkScore = {
  name: string;
  estimatedTokens: number;
  qualityScore: number;
  tokenEfficiencyScore: number;
  totalScore: number;
  missingFacts: string[];
  missingRequiredPatterns: string[];
  forbiddenHits: string[];
};

export type TaskComparison = {
  task: string;
  goal?: string;
  baselines?: Array<{ name: string; method: "live-mcp" | "raw-api" | "cli" | "fixture"; live: boolean; notes?: string }>;
  coverage?: {
    tokenhubCapabilities: string[];
    competitorCapabilities: string[];
    parity: "full" | "partial" | "missing";
    gaps: string[];
  };
  tokenhub: BenchmarkScore;
  competitors: BenchmarkScore[];
};

export type ComparedTask = TaskComparison & {
  strongestCompetitor?: BenchmarkScore;
  coverageScore: number;
  passed: boolean;
  reason: string;
};

export function scoreBenchmarkResult(input: BenchmarkScoreInput): BenchmarkScore {
  const output = input.outputText.toLowerCase();
  const missingFacts = input.expectedFacts.filter((fact) => !output.includes(fact.toLowerCase()));
  const missingRequiredPatterns = input.requiredPatterns
    .filter((pattern) => !pattern.test(input.outputText))
    .map((pattern) => pattern.source);
  const forbiddenHits = input.forbiddenPatterns
    .filter((pattern) => pattern.test(input.outputText))
    .map((pattern) => pattern.source);

  const factScore =
    input.expectedFacts.length === 0
      ? 60
      : ((input.expectedFacts.length - missingFacts.length) / input.expectedFacts.length) * 60;
  const requiredScore =
    input.requiredPatterns.length === 0
      ? 15
      : ((input.requiredPatterns.length - missingRequiredPatterns.length) / input.requiredPatterns.length) * 15;
  const safetyPenalty = forbiddenHits.length * 35;
  const bloatPenalty = input.outputText.length > 6000 ? 10 : 0;
  const qualityScore = clamp(factScore + requiredScore + 25 - safetyPenalty - bloatPenalty, 0, 100);

  const tokenBaseline = input.lowerIsBetterTokenBaseline ?? Math.max(input.estimatedTokens, 1);
  const tokenEfficiencyScore = clamp((tokenBaseline / Math.max(input.estimatedTokens, 1)) * 50, 0, 100);
  const totalScore = Math.round(qualityScore * 0.7 + tokenEfficiencyScore * 0.3);

  return {
    name: input.name,
    estimatedTokens: input.estimatedTokens,
    qualityScore: Math.round(qualityScore),
    tokenEfficiencyScore: Math.round(tokenEfficiencyScore),
    totalScore,
    missingFacts,
    missingRequiredPatterns,
    forbiddenHits
  };
}

export function assertSignificantlyBetter(tokenhub: BenchmarkScore, competitor: BenchmarkScore): {
  passed: boolean;
  reason: string;
} {
  const qualityLead = tokenhub.qualityScore - competitor.qualityScore;
  const tokenReduction = 1 - tokenhub.estimatedTokens / Math.max(competitor.estimatedTokens, 1);
  const scoreLead = tokenhub.totalScore - competitor.totalScore;
  const passed =
    (tokenhub.qualityScore >= competitor.qualityScore + 5 && tokenReduction >= 0.25 && scoreLead >= 5) ||
    (tokenhub.qualityScore >= competitor.qualityScore && tokenReduction >= 0.4);

  return {
    passed,
    reason: passed
      ? `quality +${qualityLead}, tokens ${(tokenReduction * 100).toFixed(0)}% lower, total +${scoreLead}`
      : `needed quality +5 with tokens 25% lower, or equal quality with tokens 40% lower; got quality +${qualityLead}, tokens ${(tokenReduction * 100).toFixed(0)}% lower, total +${scoreLead}`
  };
}

export function compareBenchmarkResults(tasks: TaskComparison[]): {
  taskResults: ComparedTask[];
  weakTasks: string[];
} {
  const taskResults = tasks.map((task) => {
    const strongestCompetitor = [...task.competitors].sort((a, b) => b.totalScore - a.totalScore)[0];
    if (!strongestCompetitor) {
      return {
        ...task,
        coverageScore: scoreCoverage(task.coverage),
        passed: true,
        reason: "No competitor result was available."
      };
    }
    const result = assertSignificantlyBetter(task.tokenhub, strongestCompetitor);
    return {
      ...task,
      strongestCompetitor,
      coverageScore: scoreCoverage(task.coverage),
      passed: result.passed,
      reason: result.reason
    };
  });

  return {
    taskResults,
    weakTasks: taskResults.filter((task) => !task.passed).map((task) => task.task)
  };
}

function scoreCoverage(coverage: TaskComparison["coverage"]): number {
  if (!coverage) {
    return 50;
  }
  const competitor = new Set(coverage.competitorCapabilities);
  const covered = coverage.tokenhubCapabilities.filter((capability) => competitor.has(capability)).length;
  const overlap = competitor.size === 0 ? 100 : (covered / competitor.size) * 100;
  const parityBonus = coverage.parity === "full" ? 15 : coverage.parity === "partial" ? 10 : -25;
  const gapPenalty = Math.min(30, coverage.gaps.length * 5);
  return Math.round(clamp(overlap + parityBonus - gapPenalty, 0, 100));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
