export type DiagnosticLogLevel = "silent" | "error" | "info" | "debug";

export type DiagnosticSink = (line: string) => void;

export type DiagnosticLogger = {
  level: DiagnosticLogLevel;
  error: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  debug: (event: string, fields?: Record<string, unknown>) => void;
};

export type DiagnosticLoggerOptions = {
  level?: DiagnosticLogLevel;
  sink?: DiagnosticSink;
  now?: () => Date;
};

const LEVEL_RANK: Record<DiagnosticLogLevel, number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3
};

const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|connectionstring|connection_string)/i;
const SECRET_FRAGMENT_PATTERN =
  /\b(api[_-]?key|token|secret|password|authorization|connectionString|connection_string)(\s*[:=]\s*)["']?[^"'\s;]+["']?/gi;

export function createDiagnosticLogger(options: DiagnosticLoggerOptions = {}): DiagnosticLogger {
  const level = options.level ?? "silent";
  const sink = options.sink ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  function emit(messageLevel: Exclude<DiagnosticLogLevel, "silent">, event: string, fields: Record<string, unknown> = {}) {
    if (LEVEL_RANK[level] < LEVEL_RANK[messageLevel]) {
      return;
    }
    sink(
      JSON.stringify({
        time: now().toISOString(),
        level: messageLevel,
        event,
        ...(redactLogValue(fields) as Record<string, unknown>)
      })
    );
  }

  return {
    level,
    error: (event, fields) => emit("error", event, fields),
    info: (event, fields) => emit("info", event, fields),
    debug: (event, fields) => emit("debug", event, fields)
  };
}

export function logLevelFromEnv(env: NodeJS.ProcessEnv = process.env): DiagnosticLogLevel {
  return parseLogLevel(env.TOKENHUB_LOG_LEVEL);
}

export function parseLogLevel(value: string | undefined): DiagnosticLogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "error" || normalized === "info" || normalized === "debug") {
    return normalized;
  }
  return "silent";
}

export function isLogLevel(value: string | undefined): value is Exclude<DiagnosticLogLevel, "silent"> {
  return value === "error" || value === "info" || value === "debug";
}

export function redactLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_FRAGMENT_PATTERN, "$1$2[redacted]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactLogValue(entry)
    ])
  );
}
