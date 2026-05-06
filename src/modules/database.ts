import initSqlJs from "sql.js";
import { Client } from "pg";
import { estimateTokens, truncateToTokens } from "../core/token.js";

export type SqliteInspectInput = {
  databaseBytes: Uint8Array;
  query?: string;
  limit?: number;
  budgetTokens?: number;
};

export type DatabaseSummary = {
  summary: string;
  schema: Array<{ table: string; columns: string[] }>;
  rows: Array<Record<string, unknown>>;
  tokenEstimate: number;
  warnings: string[];
};

export async function inspectSqlite(input: SqliteInspectInput): Promise<DatabaseSummary> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(input.databaseBytes);
  const schema = db
    .exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .flatMap((result) =>
      result.values.map((row) => ({
        table: String(row[0]),
        columns: parseSqliteColumns(String(row[1] ?? ""))
      }))
    );
  const rows = input.query ? runSqliteReadQuery(db, input.query, input.limit ?? 20) : [];
  const summary = truncateToTokens(
    `SQLite schema: ${schema.map((table) => `${table.table}(${table.columns.join(", ")})`).join("; ")}. Rows returned: ${rows.length}.`,
    input.budgetTokens ?? 400
  ).text;
  db.close();

  return {
    summary,
    schema,
    rows,
    tokenEstimate: estimateTokens(summary) + estimateTokens(rows),
    warnings: input.query && !isSafeSelect(input.query) ? ["Only read-only SELECT queries are allowed."] : []
  };
}

export async function inspectPostgres(input: {
  connectionString: string;
  query?: string;
  limit?: number;
  budgetTokens?: number;
}): Promise<DatabaseSummary> {
  const client = new Client({ connectionString: input.connectionString });
  await client.connect();
  try {
    const schemaRows = await client.query(
      "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
    );
    const schema = summarizePostgresSchemaRows(schemaRows.rows);
    const rows =
      input.query && isSafeSelect(input.query)
        ? projectRows((await client.query(withLimit(input.query, input.limit ?? 20))).rows, { limit: input.limit ?? 20 })
        : [];
    const summary = truncateToTokens(
      `Postgres schema: ${schema.map((table) => `${table.table}(${table.columns.join(", ")})`).join("; ")}. Rows returned: ${rows.length}.`,
      input.budgetTokens ?? 400
    ).text;
    return {
      summary,
      schema,
      rows,
      tokenEstimate: estimateTokens(summary) + estimateTokens(rows),
      warnings: input.query && !isSafeSelect(input.query) ? ["Only read-only SELECT queries are allowed."] : []
    };
  } finally {
    await client.end();
  }
}

export function summarizePostgresSchemaRows(
  rows: Array<{ table_name: string; column_name: string; data_type: string }>
): Array<{ table: string; columns: string[] }> {
  const tables = new Map<string, string[]>();
  for (const row of rows) {
    const columns = tables.get(row.table_name) ?? [];
    columns.push(`${row.column_name}:${row.data_type}`);
    tables.set(row.table_name, columns);
  }
  return [...tables.entries()].map(([table, columns]) => ({ table, columns }));
}

export function projectRows(rows: Array<Record<string, unknown>>, options: { limit: number }): Array<Record<string, unknown>> {
  return rows.slice(0, options.limit).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, isSecretKey(key) ? "[redacted]" : value]))
  );
}

function runSqliteReadQuery(db: initSqlJs.Database, query: string, limit: number): Array<Record<string, unknown>> {
  if (!isSafeSelect(query)) {
    return [];
  }
  const results = db.exec(withLimit(query, limit));
  const first = results[0];
  if (!first) {
    return [];
  }
  return first.values.map((values) =>
    Object.fromEntries(first.columns.map((column, index) => [column, isSecretKey(column) ? "[redacted]" : values[index]]))
  );
}

function parseSqliteColumns(sql: string): string[] {
  const body = sql.slice(sql.indexOf("(") + 1, sql.lastIndexOf(")"));
  return body
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0]?.replace(/["`[\]]/g, ""))
    .filter((column) => Boolean(column) && !/^primary$/i.test(column));
}

function isSafeSelect(query: string): boolean {
  return /^\s*select\b/i.test(query) && !/[;]/.test(query.replace(/;\s*$/, ""));
}

function withLimit(query: string, limit: number): string {
  const clean = query.trim().replace(/;\s*$/, "");
  return /\blimit\s+\d+/i.test(clean) ? clean : `${clean} LIMIT ${limit}`;
}

function isSecretKey(key: string): boolean {
  return /(password|secret|token|api[_-]?key|private)/i.test(key);
}
