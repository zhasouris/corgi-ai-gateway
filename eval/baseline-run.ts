/**
 * Base-model delta report (ADR 0018). Answers "vs. always using ONE model, what
 * did the router save and where did it get sharper?" — two distinct KPIs (cost,
 * targeted accuracy), for best/value/fast. Hermetic dry-run by default; add
 * `--judge N` for the real LLM-judged lens on a sample (spends, needs OPENAI_API_KEY).
 *
 *   npm run eval:baseline -- --base gpt-4.1-mini --dataset eval/datasets/curated.jsonl
 *   npm run eval:baseline -- --base gpt-4.1-mini --judge 6 --judge-strategy value
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { isStrategy, type Strategy } from "../src/types.js";
import { baselineReport, type BaselineReport, type StrategyStat } from "./src/baseline.js";
import { loadDataset } from "./src/dataset.js";
import { judgeBaseline, type JudgedSummary } from "./src/judge-baseline.js";
import { forwarderCaller, openaiJudge } from "./src/openai-judge.js";

interface Args {
  base: string;
  dataset: string;
  out: string;
  judge: number;
  judgeStrategy: Strategy;
}

function parseArgs(argv: string[]): Args {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, "");
    if (k) a[k] = argv[i + 1] ?? "";
  }
  const js = a["judge-strategy"] ?? "";
  return {
    base: a.base ?? "gpt-4.1-mini",
    dataset: a.dataset ?? "eval/datasets/curated.jsonl",
    out: a.out ?? "eval/out",
    judge: a.judge ? Number(a.judge) : 0,
    judgeStrategy: isStrategy(js) ? js : "value",
  };
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const sUsd = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
const signed = (n: number | null, d = 2) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}`);

function promptOf(request: { messages?: { content?: unknown }[] }): string {
  const c = request.messages?.[0]?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const part = c.find((p): p is { text: string } => typeof (p as { text?: unknown })?.text === "string");
    return part ? part.text : "";
  }
  return "";
}

/** Deterministic evenly-spaced sample of up to n items. */
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]!);
}

function strategySection(s: StrategyStat): string {
  const c = s.counts;
  const p = (x: number) => `${Math.round((x / s.n) * 100)}%`;
  const cost = s.cost;
  const acc = s.accuracy;
  return [
    `### Strategy \`${s.strategy}\``,
    "",
    `**Routing vs base:** ${p(c.downgrade)} downgraded · ${p(c.upgrade)} upgraded · ` +
      `${p(c["forced-upgrade"])} forced-upgrade (base can't serve) · ${p(c.unchanged)} unchanged`,
    "",
    "**Cost** *(illustrative units; ratios are what matter)*",
    "",
    "| | |",
    "| --- | --- |",
    `| always-base | ${usd(cost.base)} |`,
    `| routed | ${usd(cost.router)} (**${pct(-cost.netPct)}**) |`,
    `| cost Δ on downgrades | ${sUsd(-cost.savedOnDowngrades)} |`,
    `| cost Δ on upgrades | ${sUsd(cost.spentOnUpgrades)} |`,
    "",
    "**Accuracy — where you need it** *(router − base; benchmark-derived task capability, 0–100)*",
    "",
    `- **Hard prompts** (${acc.needN}, accuracy needed): **${signed(acc.targetedBenchDelta, 1)} pts** ` +
      `(competency ${signed(acc.targetedCompetencyDelta, 3)})`,
    `- Easy prompts (${acc.easyN}): ${signed(acc.easyBenchDelta, 1)} pts ` +
      `(competency ${signed(acc.easyCompetencyDelta, 3)})`,
    "",
  ].join("\n");
}

function toMarkdown(r: BaselineReport): string {
  const head = [
    `# Base-model delta report — always \`${r.base}\``,
    "",
    `Dataset: \`${r.dataset}\` · ${r.scenarios} prompts · signal: heuristic (hermetic).`,
    `Compares the router's pick under each strategy against *always using ${r.base}*.`,
    "Accuracy: **task-appropriate benchmark** (SWE-bench for coding, AIME for math, GPQA for reasoning, …)",
    "and per-task **competency** (ADR 0010). Upgrade/downgrade is by task competency vs the base.",
    "",
  ].join("\n");
  return head + "\n" + r.strategies.map(strategySection).join("\n");
}

function renderJudged(s: JudgedSummary, strategy: Strategy): string {
  const up = s.upgrades;
  const down = s.downgrades;
  return [
    `## LLM-judged validation — strategy \`${strategy}\` · ${s.n} prompts *(real answers; spends)*`,
    "",
    `- **Upgrades:** ${up.paidOff}/${up.n} paid off — the stronger pick answered *meaningfully better* than the base.`,
    `- **Downgrades:** ${down.safe}/${down.n} safe (no measurable quality loss) · ${down.lost} lost quality.`,
    "",
    `~${s.n * 2} completion calls + ${s.n} judge calls made.`,
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = loadDataset(args.dataset);
  const name = args.dataset.split(/[\\/]/).pop() ?? args.dataset;
  const report = await baselineReport(dataset, args.base, name);

  mkdirSync(args.out, { recursive: true });
  writeFileSync(`${args.out}/baseline.json`, JSON.stringify(report, null, 2) + "\n");
  const md = toMarkdown(report);
  writeFileSync(`${args.out}/baseline.md`, md + "\n");
  console.log(md);

  if (args.judge > 0) {
    const promptById = new Map(dataset.map((sc) => [sc.id, promptOf(sc.request)]));
    const eligible = report.deltas.filter(
      (d) => d.strategy === args.judgeStrategy && d.change !== "unchanged" && promptById.get(d.id),
    );
    const items = sample(eligible, args.judge).map((d) => ({
      id: d.id,
      prompt: promptById.get(d.id)!,
      change: d.change,
      routerModel: d.routerModel,
    }));
    console.error(`\nJudging ${items.length} base-vs-router disagreements (real model calls)...`);
    const summary = await judgeBaseline(items, args.base, forwarderCaller(), openaiJudge());
    writeFileSync(`${args.out}/baseline-judged.json`, JSON.stringify(summary, null, 2) + "\n");
    const jmd = renderJudged(summary, args.judgeStrategy);
    appendFileSync(`${args.out}/baseline.md`, "\n" + jmd + "\n");
    console.log("\n" + jmd);
  }

  console.log(`\nWrote ${args.out}/baseline.md and baseline.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
