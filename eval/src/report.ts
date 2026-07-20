import type { RunResult } from "./types.js";

export interface GroupStat {
  group: string;
  n: number;
  meanCost: number;
  totalCost: number;
  accuracy: number | null; // fraction correct among labeled rows
  distribution: Record<string, number>; // model id -> count
}

export interface Report {
  dataset: string;
  scenarios: number;
  provider: string;
  stats: GroupStat[];
}

export function aggregate(results: RunResult[]): GroupStat[] {
  const groups = new Map<string, RunResult[]>();
  for (const r of results) {
    let arr = groups.get(r.group);
    if (!arr) {
      arr = [];
      groups.set(r.group, arr);
    }
    arr.push(r);
  }

  const stats: GroupStat[] = [];
  for (const [group, rows] of groups) {
    const totalCost = rows.reduce((s, r) => s + r.estCost, 0);
    const labeled = rows.filter((r) => r.correct != null);
    const correct = labeled.filter((r) => r.correct).length;
    const distribution: Record<string, number> = {};
    for (const r of rows) distribution[r.model] = (distribution[r.model] ?? 0) + 1;

    stats.push({
      group,
      n: rows.length,
      meanCost: totalCost / rows.length,
      totalCost,
      accuracy: labeled.length ? correct / labeled.length : null,
      distribution,
    });
  }

  // Strategies first, then baselines; stable within each.
  stats.sort((a, b) => {
    const rank = (g: string) => (g.startsWith("strategy:") ? 0 : 1);
    return rank(a.group) - rank(b.group) || a.group.localeCompare(b.group);
  });
  return stats;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

export function toMarkdown(report: Report): string {
  const strongest = report.stats.find((s) => s.group === "baseline:always-strongest");
  const ref = strongest?.meanCost ?? null;

  const rows = report.stats.map((s) => {
    const savings = ref && ref > 0 ? pct((ref - s.meanCost) / ref) : "—";
    const acc = s.accuracy == null ? "—" : pct(s.accuracy);
    const top = Object.entries(s.distribution).sort((a, b) => b[1] - a[1])[0];
    return `| ${s.group} | ${s.n} | $${s.meanCost.toFixed(5)} | ${acc} | ${savings} | ${top ? top[0] : "—"} |`;
  });

  return [
    `# Routing Eval Report`,
    ``,
    `- Dataset: \`${report.dataset}\` (${report.scenarios} scenarios)`,
    `- Signal provider: \`${report.provider}\``,
    `- Cost is *estimated* from catalog pricing × token counts (dry-run, no spend).`,
    `- "vs strongest" = mean-cost savings against \`always-strongest\`.`,
    ``,
    `| Group | n | mean $/req | tier accuracy | vs strongest | most-picked |`,
    `|---|---|---|---|---|---|`,
    ...rows,
    ``,
  ].join("\n");
}
