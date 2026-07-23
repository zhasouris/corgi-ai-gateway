import { writeFileSync } from "node:fs";

// Researched 2026-07-23 (web-sourced; null = not found, never guessed).
// cat = {r:reasoning, c:coding, m:math, k:knowledge_qa, i:instruction_following, l:long_context} on 0-100.
const DATA = [
  // OpenAI (categories = authoritative benchmark agent; pricing/context = pricing agent)
  {id:"gpt-4.1",name:"gpt-4.1-2025-04-14",v:"openai",rd:"2025-04-14",wa:"closed",mod:["text","image"],cw:1047576,mo:32768,ci:2.00,co:8.00,cat:{r:73.5,c:50.2,m:48.1,k:65.9,i:81.9,l:80.0},conf:"mixed"},
  {id:"gpt-4.1-mini",name:"gpt-4.1-mini-2025-04-14",v:"openai",rd:"2025-04-14",wa:"closed",mod:["text","image"],cw:1047576,mo:32768,ci:0.40,co:1.60,cat:{r:65.0,c:23.6,m:49.6,k:87.5,i:76.1,l:null},conf:"verified"},
  {id:"gpt-4.1-nano",name:"gpt-4.1-nano-2025-04-14",v:"openai",rd:"2025-04-14",wa:"closed",mod:["text","image"],cw:1047576,mo:32768,ci:0.10,co:0.40,cat:{r:50.3,c:null,m:29.4,k:80.1,i:65.8,l:null},conf:"verified"},
  {id:"o4-mini",name:"o4-mini-2025-04-16",v:"openai",rd:"2025-04-16",wa:"closed",mod:["text","image"],cw:200000,mo:100000,ci:1.10,co:4.40,cat:{r:81.4,c:77.0,m:93.4,k:null,i:70.6,l:null},conf:"verified"},
  {id:"o3",name:"o3-2025-04-16",v:"openai",rd:"2025-04-16",wa:"closed",mod:["text","image"],cw:200000,mo:100000,ci:2.00,co:8.00,cat:{r:83.3,c:75.0,m:91.6,k:null,i:81.8,l:null},conf:"verified"},
  {id:"gpt-4o",name:"gpt-4o-2024-08-06",v:"openai",rd:"2024-08-06",wa:"closed",mod:["text","image"],cw:128000,mo:16384,ci:2.50,co:10.00,cat:{r:60.3,c:33.2,m:44.5,k:62.0,i:70.6,l:null},conf:"verified"},
  {id:"gpt-4o-mini",name:"gpt-4o-mini-2024-07-18",v:"openai",rd:"2024-07-18",wa:"closed",mod:["text","image"],cw:128000,mo:16384,ci:0.15,co:0.60,cat:{r:63.1,c:null,m:70.2,k:82.0,i:57.4,l:null},conf:"verified"},
  // Anthropic
  {id:"claude-opus-4-8",name:"claude-opus-4-8",v:"anthropic",rd:"2026-05-28",wa:"closed",mod:["text","image"],cw:1000000,mo:128000,ci:5,co:25,cat:{r:93.6,c:88.6,m:null,k:null,i:null,l:null},conf:"mixed"},
  {id:"claude-sonnet-5",name:"claude-sonnet-5",v:"anthropic",rd:"2026-06-30",wa:"closed",mod:["text","image"],cw:1000000,mo:128000,ci:3,co:15,cat:{r:78.0,c:72.7,m:null,k:null,i:null,l:null},conf:"mixed"},
  {id:"claude-haiku-4-5",name:"claude-haiku-4-5-20251001",v:"anthropic",rd:"2025-10-15",wa:"closed",mod:["text","image"],cw:200000,mo:64000,ci:1,co:5,cat:{r:76.7,c:67.7,m:96.3,k:90.8,i:null,l:null},conf:"mixed"},
  // Google
  {id:"gemini-3.1-pro-preview",name:"Gemini 3.1 Pro Preview",v:"google",rd:"2026-02-19",wa:"closed",mod:["text","image","audio","video"],cw:1048576,mo:65536,ci:2.00,co:12.00,cat:{r:94,c:81,m:null,k:93,i:81,l:85},conf:"mixed"},
  {id:"gemini-3.6-flash",name:"Gemini 3.6 Flash",v:"google",rd:"2026-07-21",wa:"closed",mod:["text","image","audio","video"],cw:1048576,mo:65536,ci:1.50,co:7.50,cat:{r:93,c:null,m:null,k:null,i:81,l:54},conf:"mixed"},
  {id:"gemini-3.5-flash",name:"Gemini 3.5 Flash",v:"google",rd:"2026-05-19",wa:"closed",mod:["text","image","audio","video"],cw:1048576,mo:65536,ci:1.50,co:9.00,cat:{r:null,c:56,m:null,k:null,i:null,l:null},conf:"mixed"},
  {id:"gemini-3.5-flash-lite",name:"Gemini 3.5 Flash-Lite",v:"google",rd:"2026-07-21",wa:"closed",mod:["text","image","audio","video"],cw:1048576,mo:65536,ci:0.30,co:2.50,cat:{r:null,c:null,m:null,k:null,i:null,l:72},conf:"mixed"},
  {id:"gemini-3.1-flash-lite",name:"Gemini 3.1 Flash-Lite Preview",v:"google",rd:"2026-03-03",wa:"closed",mod:["text","image","audio","video"],cw:1048576,mo:65536,ci:0.25,co:1.50,cat:{r:82,c:null,m:null,k:null,i:null,l:null},conf:"mixed"},
  // xAI + DeepSeek
  {id:"grok-4",name:"grok-4-0709",v:"xai",rd:"2025-07-10",wa:"closed",mod:["text","image"],cw:256000,mo:null,ci:3.0,co:15.0,cat:{r:87.25,c:79.4,m:94.0,k:null,i:null,l:null},conf:"mixed"},
  {id:"grok-3",name:"grok-3",v:"xai",rd:"2025-02-19",wa:"closed",mod:["text"],cw:131072,mo:null,ci:3.0,co:15.0,cat:{r:82.25,c:79.4,m:93.3,k:null,i:null,l:null},conf:"mixed"},
  {id:"grok-3-mini",name:"grok-3-mini",v:"xai",rd:"2025-02-19",wa:"closed",mod:["text"],cw:131072,mo:null,ci:0.30,co:0.50,cat:{r:84.0,c:80.4,m:95.8,k:null,i:null,l:null},conf:"mixed"},
  {id:"deepseek-chat",name:"DeepSeek-V3.2-Exp",v:"deepseek",rd:"2025-09-29",wa:"open",mod:["text"],cw:1000000,mo:384000,ci:0.14,co:0.28,cat:{r:83.7,c:80.25,m:93.1,k:null,i:null,l:null},conf:"mixed"},
  {id:"deepseek-reasoner",name:"DeepSeek-R1-0528",v:"deepseek",rd:"2025-05-28",wa:"open",mod:["text"],cw:1000000,mo:384000,ci:0.14,co:0.28,cat:{r:83.0,c:65.45,m:87.5,k:null,i:null,l:null},conf:"mixed"},
  // Mistral
  {id:"mistral-large-latest",name:"Mistral Large 3 (mistral-large-2512)",v:"mistral",rd:"2025-12-02",wa:"open",mod:["text","image"],cw:262144,mo:null,ci:0.50,co:1.50,cat:{r:68,c:null,m:null,k:null,i:69.7,l:null},conf:"mixed"},
  {id:"mistral-medium-latest",name:"Mistral Medium 3.5",v:"mistral",rd:"2026-04-29",wa:"open",mod:["text","image"],cw:262144,mo:null,ci:1.50,co:7.50,cat:{r:null,c:78,m:null,k:null,i:null,l:null},conf:"mixed"},
  {id:"mistral-small-latest",name:"Mistral Small 4 (mistral-small-2603)",v:"mistral",rd:"2026-03-16",wa:"open",mod:["text","image"],cw:262144,mo:null,ci:0.15,co:0.60,cat:{r:42,c:null,m:null,k:null,i:null,l:null},conf:"mixed"},
  {id:"codestral-latest",name:"Codestral 2508",v:"mistral",rd:"2025-08-01",wa:"open",mod:["text"],cw:256000,mo:null,ci:0.30,co:0.90,cat:{r:null,c:45,m:null,k:null,i:null,l:null},conf:"mixed"},
  {id:"ministral-8b-latest",name:"Ministral 3 8B (ministral-8b-2512)",v:"mistral",rd:"2025-12-04",wa:"open",mod:["text","image"],cw:262100,mo:null,ci:0.15,co:0.15,cat:{r:66.8,c:null,m:78.7,k:null,i:null,l:null},conf:"mixed"},
  // Open / hosted (Groq / Together / Cohere)
  {id:"llama-3.3-70b-versatile",name:"Meta Llama 3.3 70B Instruct",v:"meta",rd:"2024-12-06",wa:"open",mod:["text"],cw:131072,mo:32768,ci:0.59,co:0.79,cat:{r:60,c:55,m:77,k:78,i:92,l:null},conf:"mixed"},
  {id:"llama-3.1-8b-instant",name:"Meta Llama 3.1 8B Instruct",v:"meta",rd:"2024-07-23",wa:"open",mod:["text"],cw:131072,mo:8192,ci:0.05,co:0.08,cat:{r:30,c:35,m:43,k:68,i:79,l:null},conf:"mixed"},
  {id:"gemma2-9b-it",name:"Google Gemma 2 9B Instruct",v:"google",rd:"2024-06-27",wa:"open",mod:["text"],cw:8192,mo:8192,ci:0.20,co:0.20,cat:{r:40,c:40,m:40,k:71,i:70,l:20},conf:"mixed"},
  {id:"qwen2.5-72b-instruct-turbo",name:"Alibaba Qwen2.5 72B Instruct",v:"alibaba",rd:"2024-09-19",wa:"open",mod:["text"],cw:32768,mo:8192,ci:1.20,co:1.20,cat:{r:60,c:55,m:83,k:82,i:84,l:55},conf:"mixed"},
  {id:"qwen2.5-coder-32b-instruct",name:"Alibaba Qwen2.5 Coder 32B Instruct",v:"alibaba",rd:"2024-11-12",wa:"open",mod:["text"],cw:32768,mo:8192,ci:0.80,co:0.80,cat:{r:35,c:72,m:45,k:55,i:60,l:45},conf:"mixed"},
  {id:"meta-llama-3.1-405b-instruct-turbo",name:"Meta Llama 3.1 405B Instruct",v:"meta",rd:"2024-07-23",wa:"open",mod:["text"],cw:130815,mo:4096,ci:3.50,co:3.50,cat:{r:62,c:58,m:74,k:82,i:89,l:60},conf:"mixed"},
  {id:"command-r-plus",name:"Cohere Command R+ (08-2024)",v:"cohere",rd:"2024-08-30",wa:"open",mod:["text"],cw:128000,mo:4096,ci:2.50,co:10.00,cat:{r:45,c:40,m:35,k:70,i:55,l:55},conf:"estimated"},
  {id:"command-r",name:"Cohere Command R (08-2024)",v:"cohere",rd:"2024-08-30",wa:"open",mod:["text"],cw:128000,mo:4096,ci:0.15,co:0.60,cat:{r:35,c:30,m:28,k:60,i:45,l:50},conf:"estimated"},
];

const W = { reasoning:0.25, coding:0.25, math:0.15, knowledge_qa:0.15, instruction_following:0.10, long_context:0.10 };
const CATKEY = { r:"reasoning", c:"coding", m:"math", k:"knowledge_qa", i:"instruction_following", l:"long_context" };
const round = (x, n=1) => x === null ? null : Math.round(x * 10**n) / 10**n;

// composite with proportional weight redistribution over available categories
for (const d of DATA) {
  const avail = Object.entries(CATKEY).filter(([sk]) => d.cat[sk] !== null);
  const wsum = avail.reduce((s, [, ck]) => s + W[ck], 0);
  let comp = 0;
  for (const [sk, ck] of avail) comp += d.cat[sk] * (W[ck] / wsum);
  d.composite = round(comp, 1);
  d.partial = avail.length < 6;
  d.blended = round((3 * d.ci + d.co) / 4, 3);
  d.cost_eff = d.blended > 0 ? round(d.composite / d.blended, 2) : null;
}

// category ranks
for (const ck of Object.values(CATKEY)) {
  const sk = Object.keys(CATKEY).find(k => CATKEY[k] === ck);
  const ranked = DATA.filter(d => d.cat[sk] !== null).sort((a,b) => b.cat[sk] - a.cat[sk]);
  ranked.forEach((d,i) => { d[`rank_${ck}`] = i+1; });
}

// overall sort by composite
DATA.sort((a,b) => b.composite - a.composite || a.blended - b.blended || (a.id<b.id?-1:1));
DATA.forEach((d,i) => d.rank = i+1);

const rankArr = (sk) => DATA.filter(d => sk==="composite" ? true : d.cat[sk] !== null)
  .slice().sort((a,b) => (sk==="composite"? b.composite-a.composite : b.cat[sk]-a.cat[sk])).map(d => d.name);
const rankCost = () => DATA.filter(d => d.cost_eff !== null).slice().sort((a,b) => b.cost_eff-a.cost_eff).map(d => d.name);

const BENCH = {
  reasoning: ["GPQA_Diamond","MMLU_Pro"], coding: ["SWE_bench_Verified","LiveCodeBench"],
  math: ["AIME","MATH"], knowledge_qa: ["MMLU","SimpleQA"],
  instruction_following: ["IFEval","LMArena_Elo"], long_context: ["RULER","MRCR"],
};

const models = DATA.map(d => ({
  rank: d.rank, model_name: d.name, model_id: d.id, vendor: d.v, release_date: d.rd,
  weights_access: d.wa, modality: d.mod,
  composite: { score: d.composite, partial: d.partial },
  categories: Object.fromEntries(Object.entries(CATKEY).map(([sk,ck]) => [ck, {
    score: d.cat[sk], rank: d[`rank_${ck}`] ?? null,
  }])),
  context: { max_context_tokens: d.cw, max_output_tokens: d.mo },
  cost: { input_per_million_usd: d.ci, output_per_million_usd: d.co, blended_per_million_usd: d.blended, cost_efficiency: d.cost_eff },
  confidence: d.conf,
}));

const out = {
  meta: {
    generated_on: "2026-07-23",
    methodology: "Per-vendor web research (fanned across 6 agents). Each category score is the mean of the available normalized (0-100) benchmarks for that category; null when none was found on the web (never guessed). Composite = weighted average of available category scores with the missing categories' weight redistributed proportionally (composite.partial=true when any category is missing). Assembled deterministically by scratchpad/assemble.mjs.",
    composite_weights: W,
    benchmark_notes: "Benchmark variants differ by vendor: Anthropic/xAI publish mostly GPQA-Diamond + SWE-bench Verified (agentic suite) and little classic academic data; Google reports non-standard variants (SWE-bench Pro, GDM-MRCR, LiveCodeBench-Pro Elo); knowledge_qa uses MMLU (SimpleQA where present); instruction_following blends IFEval with normalized LMArena Elo (normalization differs slightly across agents — treat cross-vendor IF scores as approximate); long_context uses MRCR at differing needle counts/context lengths. Cross-vendor comparison within a category is therefore approximate.",
    caveats: [
      "Benchmark saturation and possible contamination on MMLU/HumanEval-class benchmarks.",
      "Differing test conditions (extended-thinking vs standard, tool-assisted vs no-tools, AIME 2024 vs 2025) across models within a category.",
      "Many 2026 flagship versions (Claude Opus 4.8, Sonnet 5, Gemini 3.x, Grok 4) publish few classic benchmarks -> null-heavy, composite.partial=true.",
      "LMArena Elo normalization is not identical across vendor research passes.",
      "DeepSeek deepseek-chat/deepseek-reasoner endpoints remap to deepseek-v4-flash on 2026-07-24; scores are pinned to V3.2-Exp / R1-0528.",
      "Cohere Command R/R+ category scores are largely 'estimated' (vendor publishes no modern suite).",
    ],
  },
  models,
  rankings: {
    by_composite: rankArr("composite"),
    by_reasoning: rankArr("r"), by_coding: rankArr("c"), by_math: rankArr("m"),
    by_knowledge_qa: rankArr("k"), by_instruction_following: rankArr("i"),
    by_long_context: rankArr("l"), by_cost_efficiency: rankCost(),
  },
};

writeFileSync("docs/process/model-scores.json", JSON.stringify(out, null, 2) + "\n");

// --- competency.yaml (sparse; keyed by catalog model id; task = benchmark category) ---
let yaml = "# Per-task model competency (ADR 0010). Benchmark-seeded quality signal that\n";
yaml += "# overrides the tier fallback in the task_type scoring rule. SPARSE: only tasks\n";
yaml += "# with data appear; a missing (model,task) falls back to tier/MAX_TIER.\n";
yaml += "# Tasks are the router's realigned taskType values (= benchmark categories).\n";
yaml += "# Scores are 0..1 (benchmark category score / 100). Regenerate via\n";
yaml += "# docs/prompts/model-capability-ranking.md -> docs/process/model-scores.json.\n";
yaml += "# `source`/`updated` are REQUIRED on every entry (ADR 0010).\n\nmodels:\n";
for (const d of DATA) {
  const entries = Object.entries(CATKEY).filter(([sk]) => d.cat[sk] !== null);
  if (!entries.length) continue;
  yaml += `  ${d.id}:\n`;
  for (const [sk, ck] of entries) {
    const score = round(d.cat[sk] / 100, 3);
    yaml += `    ${ck}: { score: ${score}, source: "model-scores.json (web 2026-07-23)", updated: 2026-07-23, confidence: ${d.conf} }\n`;
  }
}
writeFileSync("config/competency.yaml", yaml);

console.log("models:", DATA.length);
console.log("top by composite:", DATA.slice(0,6).map(d => `${d.rank}.${d.id} ${d.composite}${d.partial?"*":""}`).join("  "));
console.log("competency entries:", DATA.filter(d => Object.keys(CATKEY).some(sk => d.cat[sk]!==null)).length);
