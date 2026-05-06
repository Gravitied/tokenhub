import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ProofCommand = {
  command: string;
  exitCode: number;
  summary: string;
};

export type ProofPageInput = {
  outDir: string;
  generatedAt: string;
  commands: ProofCommand[];
  repoState: string;
  benchmarkSummary?: string;
};

export async function createProofPage(input: ProofPageInput): Promise<string> {
  await mkdir(input.outDir, { recursive: true });
  const html = renderProofPage(input);
  const htmlPath = join(input.outDir, "index.html");
  await writeFile(htmlPath, html, "utf8");
  return htmlPath;
}

function renderProofPage(input: ProofPageInput): string {
  const rows = input.commands
    .map(
      (command) => `<tr>
        <td style="vertical-align:top;padding:14px 16px;border-bottom:1px solid #cbd2d9">${escapeHtml(command.command)}</td>
        <td style="vertical-align:top;padding:14px 16px;border-bottom:1px solid #cbd2d9;color:${command.exitCode === 0 ? "#0b6b2c" : "#a61b1b"};font-weight:800">${command.exitCode}</td>
        <td style="vertical-align:top;padding:14px 16px;border-bottom:1px solid #cbd2d9">${escapeHtml(command.summary)}</td>
      </tr>`
    )
    .join("");
  const passed = input.commands.every((command) => command.exitCode === 0);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TokenHub MCP Proof</title>
</head>
<body style="margin:0;background:#f7f7f4;color:#1f2933;font-family:Inter,Segoe UI,Arial,sans-serif">
  <main style="max-width:1080px;margin:0 auto;padding:48px 32px">
    <header style="display:flex;align-items:flex-end;justify-content:space-between;gap:24px;border-bottom:3px solid #111827;padding-bottom:20px">
      <div>
        <h1 style="margin:0;font-size:44px;line-height:1;letter-spacing:0">TokenHub MCP Proof</h1>
        <p>Local self-check screenshot generated from real command results.</p>
      </div>
      <div style="border:2px solid #111827;padding:10px 14px;font-weight:700;background:${passed ? "#b8f3c6" : "#ffd1d1"}">${passed ? "Verification Passed" : "Verification Failed"}</div>
    </header>
    <section style="margin:24px 0;display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="border:2px solid #111827;background:#fff;padding:18px"><div style="font-size:12px;text-transform:uppercase;font-weight:800;color:#52606d">Generated</div><div style="margin-top:8px;font-size:18px;font-weight:650">${escapeHtml(input.generatedAt)}</div></div>
      <div style="border:2px solid #111827;background:#fff;padding:18px"><div style="font-size:12px;text-transform:uppercase;font-weight:800;color:#52606d">Repository State</div><div style="margin-top:8px;font-size:18px;font-weight:650">${escapeHtml(input.repoState)}</div></div>
    </section>
    ${
      input.benchmarkSummary
        ? `<section style="margin:24px 0;border:2px solid #111827;background:#fff;padding:18px"><div style="font-size:12px;text-transform:uppercase;font-weight:800;color:#52606d">Benchmark Result</div><div style="margin-top:8px;font-size:18px;font-weight:650">${escapeHtml(input.benchmarkSummary)}</div></section>`
        : ""
    }
    <table style="width:100%;border-collapse:collapse;background:#fff;border:2px solid #111827">
      <thead><tr><th style="text-align:left;padding:14px 16px;background:#e4e7eb">Command</th><th style="text-align:left;padding:14px 16px;background:#e4e7eb">Exit</th><th style="text-align:left;padding:14px 16px;background:#e4e7eb">Evidence Summary</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
