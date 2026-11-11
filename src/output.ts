/**
 * Output rendering: a plain table for humans, JSON for CI.
 * Table lines are kept under ~110 characters so the demo GIF stays
 * readable at 1240px.
 */
import type { AuditScore } from "./scoring.js";

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

export function renderTable(result: AuditScore, source: string): string {
  const lines: string[] = [];
  lines.push(`fragility audit - ${source}`);
  lines.push("");
  lines.push(`${pad("Signal", 20)} ${pad("Score", 6)} ${pad("Verdict", 8)} Detail`);
  lines.push("-".repeat(108));
  for (const s of result.signals) {
    const score = s.score === null ? "  -  " : String(s.score).padStart(4) + "  ";
    lines.push(`${pad(s.name, 20)} ${score} ${pad(s.verdict, 8)} ${s.detail}`);
  }
  lines.push("-".repeat(108));
  const skipped = result.signals.filter((s) => s.score === null).map((s) => s.id);
  lines.push(
    `FRAGILITY SCORE ${result.composite === null ? "-" : result.composite + "/100"} - ${result.verdict}` +
      (skipped.length > 0 ? ` (skipped: ${skipped.join(", ")} - no git history)` : ""),
  );
  return lines.join("\n");
}

export function renderJson(result: AuditScore, source: string): string {
  return (
    JSON.stringify(
      {
        tool: "fragility",
        version: "0.1.0",
        source,
        composite: result.composite,
        verdict: result.verdict,
        exitCode: result.exitCode,
        signals: result.signals.map((s) => ({
          id: s.id,
          name: s.name,
          score: s.score,
          verdict: s.verdict,
          detail: s.detail,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}
