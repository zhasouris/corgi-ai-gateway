/**
 * The /demo decision-inspector page (served by the API itself). A prompt box +
 * strategy selector + a sidebar of gold-query presets; on submit it POSTs to
 * /v1/router/explain and renders the router's decision trace human-readably. It
 * never runs the actual completion.
 *
 * Self-contained HTML (inline CSS/JS). The inner script uses string
 * concatenation (no template literals) to avoid clashing with this outer one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Preset {
  id: string;
  label: string;
  strategy: string;
  prompt: string;
  bypass: boolean;
  body: any;
}

/** Load the gold dataset as demo presets. Best-effort — returns [] if absent. */
export function loadPresets(): Preset[] {
  try {
    const path = join(process.cwd(), "eval", "datasets", "gold.jsonl");
    return readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, any>)
      .map((g) => {
        const content = g.request?.messages?.[0]?.content;
        let prompt = "";
        if (typeof content === "string") prompt = content;
        else if (Array.isArray(content)) {
          const part = content.find((p: any) => typeof p?.text === "string");
          prompt = part ? part.text : "(non-text request)";
        }
        return {
          id: g.id as string,
          label: (g.note as string) || (g.id as string),
          strategy: (g.strategy as string) || "value",
          prompt,
          bypass: Boolean(g.bypass),
          body: g.request,
        };
      });
  } catch {
    return [];
  }
}

export interface DemoModel {
  id: string;
  provider: string;
  available: boolean;
}

export interface DemoOptions {
  /** Show a cold-start notice — set on scale-to-zero deployments. */
  coldStartHint?: boolean;
}

export function demoHtml(
  presets: Preset[],
  models: DemoModel[] = [],
  opts: DemoOptions = {},
): string {
  const presetsJson = JSON.stringify(presets).replace(/</g, "\\u003c");
  const availabilityJson = JSON.stringify(
    Object.fromEntries(models.map((m) => [m.id, m.available])),
  ).replace(/</g, "\\u003c");
  // The excluded list carries only model ids, so vendors are looked up here
  // rather than threaded through the explain payload.
  const vendorsJson = JSON.stringify(
    Object.fromEntries(models.map((m) => [m.id, m.provider])),
  ).replace(/</g, "\\u003c");

  // 🟢 routable / ⚪ no key. Carried in the option label because a <select>
  // cannot be styled per-option across browsers.
  const modelOptions = ['<option value="auto">auto (let the router decide)</option>']
    .concat(
      models.map(
        (m) => `<option value="${m.id}">${m.available ? "🟢" : "⚪"} ${m.id}</option>`,
      ),
    )
    .join("");

  const availableCount = models.filter((m) => m.available).length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>corgi-ai-gateway — decision inspector</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1120px;
    margin: 1.5rem auto; line-height: 1.5;
    /* Clear the notch/status bar and rounded corners on iOS (viewport-fit=cover). */
    padding: env(safe-area-inset-top) calc(1rem + env(safe-area-inset-right)) 1rem calc(1rem + env(safe-area-inset-left)); }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .sub { opacity: 0.7; margin-top: 0; font-size: 0.9rem; }
  .coldstart { border: 1px solid #d9770633; background: #d977061a; border-radius: 8px;
    padding: 0.6rem 0.9rem; margin: 0.75rem 0 0; font-size: 0.88rem; }
  .layout { display: flex; gap: 1.25rem; align-items: flex-start; }
  .sidebar { width: 260px; flex-shrink: 0; }
  .main { flex: 1; min-width: 0; }
  .sidebar h2 { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; }
  button.preset { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;
    width: 100%; text-align: left; margin: 0.3rem 0; padding: 0.5rem 0.6rem; border: 1px solid #8883;
    border-radius: 6px; background: transparent; cursor: pointer; font: inherit; }
  button.preset:hover { background: #7c3aed18; border-color: #7c3aed88; }
  .preset .pl { font-size: 0.82rem; }
  .chip { font-size: 0.68rem; padding: 0.05rem 0.4rem; border-radius: 999px; background: #8883; white-space: nowrap; }
  textarea { width: 100%; min-height: 90px; font: inherit; padding: 0.6rem; box-sizing: border-box; }
  .row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin: 0.6rem 0; }
  label { font-size: 0.85rem; opacity: 0.8; }
  select, input { font: inherit; padding: 0.35rem; }
  input.key { flex: 1; min-width: 160px; }
  button.go { font: inherit; padding: 0.5rem 1.1rem; cursor: pointer; border-radius: 6px; border: 1px solid #8888; }
  button.go:disabled { opacity: 0.5; cursor: wait; }
  .card { border: 1px solid #8883; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.8rem 0; }
  .banner { font-size: 1.1rem; }
  .banner b { font-size: 1.25rem; }
  .muted { opacity: 0.7; }
  .legend { font-size: 0.8rem; opacity: 0.75; cursor: help; align-self: center; }
  .vendor { font-size: 0.85em; opacity: 0.8; cursor: help; }
  .lat { display: inline-block; margin-left: 0.5rem; padding: 0.05rem 0.45rem; border-radius: 999px;
    background: #8882; font-size: 0.75rem; font-variant-numeric: tabular-nums; vertical-align: middle;
    cursor: help; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #8882; }
  th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
  th.sortable:hover { text-decoration: underline; }
  /* Side-by-side strategy comparison (P3.3): best | value | fast as columns. */
  .cmp-cols { display: flex; gap: 0.75rem; align-items: stretch; }
  .cmp-col { flex: 1 1 0; min-width: 0; border: 1px solid #8883; border-radius: 8px; padding: 0.6rem 0.7rem; }
  .cmp-h { font-size: 0.9rem; margin-bottom: 0.25rem; }
  .cmp-model { font-size: 1.05rem; margin-top: 0.2rem; word-break: break-word; }
  @media (max-width: 600px) { .cmp-cols { flex-direction: column; } }
  tr.win { background: #7c3aed22; font-weight: 600; }
  /* Outranked the chosen model on score but had no API key to call it with. */
  tr.skipped { opacity: 0.55; }
  tr.skipped td:nth-child(2) { text-decoration: line-through; }
  .tag { display: inline-block; margin-left: 0.4rem; padding: 0.02rem 0.35rem; border-radius: 999px;
    background: #7c3aed33; font-size: 0.7rem; font-weight: 500; vertical-align: middle; }
  .tag.muted { background: #8882; }
  .badges span { display: inline-block; padding: 0.1rem 0.5rem; margin: 0.15rem; border-radius: 999px;
    background: #8882; font-size: 0.8rem; }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 1rem; font-size: 0.9rem; }
  .warn { color: #b45309; }
  details { margin-top: 0.6rem; }
  pre { overflow-x: auto; background: #8881; padding: 0.6rem; border-radius: 6px; font-size: 0.8rem; }
  .err { color: #b91c1c; }
  @media (max-width: 760px) { .layout { flex-direction: column; } .sidebar { width: auto; } }
  /* Below 600px the multi-column candidate tables compress badly, so each row
     becomes a labeled card (P3.2): header row hidden, every cell a label/value pair. */
  @media (max-width: 600px) {
    table.cards, table.cards tbody, table.cards tr, table.cards td { display: block; }
    table.cards tr:first-child { display: none; }
    table.cards tr { border: 1px solid #8883; border-radius: 8px; margin: 0.5rem 0; padding: 0.25rem 0.7rem; }
    table.cards tr.win { border-color: #7c3aed; }
    table.cards td { border: none; display: flex; justify-content: space-between; gap: 1rem; padding: 0.14rem 0; }
    table.cards td::before { content: attr(data-label); opacity: 0.55; }
    table.cards td[data-label=""]::before { content: none; }
    table.cards td[data-label="model"] { font-weight: 600; font-size: 1.02rem; }
  }
</style>
</head>
<body>
  <h1>Router decision inspector</h1>
  <p class="sub">Submit a prompt — or click a gold preset — to see how the router would route it. No completion is run.</p>
  ${
    opts.coldStartHint
      ? `<div class="coldstart">⏳ <b>First request may take a few seconds.</b> This demo scales to zero when idle, so the very first inspection after a quiet spell waits for the container to wake up. Everything after that is fast.</div>`
      : ""
  }

  <div class="layout">
    <aside class="sidebar">
      <h2>Gold presets</h2>
      <div id="presets"></div>
    </aside>

    <main class="main">
      <textarea id="prompt" placeholder="Type a request, e.g. 'Prove the square root of 2 is irrational'"></textarea>
      <div class="row">
        <label>Strategy
          <select id="strategy">
            <option value="value">value</option>
            <option value="best">best</option>
            <option value="fast">fast</option>
          </select>
        </label>
        <label>Force model
          <select id="force">${modelOptions}</select>
        </label>
        <label>Temperature
          <input type="number" id="temperature" min="0" max="2" step="0.1" placeholder="default" style="width:5.5rem"
            title="Sampling temperature to send in the request. OpenAI o-series models (o4-mini, o3) only accept the default (1); set a non-default value (e.g. 0) to watch them get filtered out of routing. Leave blank to send none." />
        </label>
        <button class="go" id="go">Inspect routing</button>
        <button class="go" id="compare" title="Run best / value / fast on this prompt and show the picks side by side">Compare strategies</button>
        <span class="legend" title="A model is routable when this deployment holds an API key for its provider. Models without one are still ranked — the router just can't forward to them.">
          🟢 ${availableCount}/${models.length} routable · ⚪ no key
        </span>
      </div>
      <div id="out"></div>
    </main>
  </div>

<script>
  var PRESETS = ${presetsJson};
  var AVAILABLE = ${availabilityJson};
  var VENDORS = ${vendorsJson};

  // groq (Llama/Gemma inference) and xai (Grok) are easy to confuse at a
  // glance, so the cell carries a tooltip spelling out which is which.
  var VENDOR_HINT = {
    groq: 'Groq - LPU inference for open-weights models (Llama, Gemma). Not xAI.',
    xai: 'xAI - the Grok family. Not Groq.',
    together: 'Together AI - hosted open-weights models',
    google: 'Google - Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic - Claude',
    mistral: 'Mistral',
    deepseek: 'DeepSeek',
    cohere: 'Cohere'
  };

  function vendorCell(provider) {
    var p = provider || '-';
    var hint = VENDOR_HINT[p];
    var title = hint ? ' title="' + esc(hint) + '"' : '';
    return '<span class="vendor"' + title + '>' + esc(p) + '</span>';
  }

  /** For rows that carry only a model id (the excluded list). */
  function vendorOf(model) {
    return vendorCell(VENDORS[model]);
  }

  // 🟢 the deployment holds a key for this model's provider; ⚪ it does not, so
  // the model is ranked but could not actually be forwarded to.
  function avail(model) {
    return AVAILABLE[model] ? '🟢' : '⚪';
  }

  // The router scores on capability and price, not on whether a key exists, so
  // the winner can be a model this deployment cannot actually call. Say so here
  // rather than letting it surface later as a 401 from the provider.
  // groq and grok are one letter apart and mean entirely different things:
  // groq is the LPU inference vendor (Llama, Gemma); Grok is xAI's model family,
  // served by the xai provider. Spell it out wherever a provider is blamed.
  // (No backticks here - this script lives inside an outer template literal.)
  function providerLabel(p) {
    if (p === 'groq') return 'groq <span class="muted">(Llama/Gemma inference — not xAI\\u2019s Grok)</span>';
    if (p === 'xai') return 'xai <span class="muted">(Grok)</span>';
    return esc(p);
  }

  function unroutableNote(decision) {
    if (!decision || AVAILABLE[decision.model]) return '';
    return '<br><span class="warn">⚪ no API key for ' + providerLabel(decision.provider) +
      ' — ranked first, but this deployment could not forward to it</span>';
  }
  var btn = document.getElementById('go');
  var cmpBtn = document.getElementById('compare');
  var out = document.getElementById('out');

  // Client-side sort for the ranked table (P3.3). null col = the router's order.
  var sortState = { col: null, dir: 1 };
  var SORT_KEYS = {
    model: function (r) { return r.model; },
    vendor: function (r) { return r.provider; },
    tier: function (r) { return r.tier; },
    comp: function (r) { return r.competency ? r.competency.score : -1; },
    score: function (r) { return r.score; },
    cost: function (r) { return r.estimatedCost; },
    latency: function (r) { return r.latencyMs; }
  };
  // Default direction on first click: cheapest/fastest/A-Z first where that reads
  // naturally, strongest first for the capability-ish columns.
  var SORT_DIR = { model: 1, vendor: 1, tier: -1, comp: -1, score: -1, cost: 1, latency: 1 };
  function applySort(ranked) {
    var key = SORT_KEYS[sortState.col];
    if (!key) return ranked;
    return ranked.slice().sort(function (a, b) {
      var x = key(a), y = key(b);
      if (typeof x === 'string') return sortState.dir * x.localeCompare(y);
      return sortState.dir * (x - y);
    });
  }
  // Last full render, so a header click can re-sort without re-fetching.
  var lastRender = null;

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  // Per-request costs are fractions of a cent, so a plain "$0.000004" reads as
  // noise. Show them in MILLI-CENTS (m¢ = 1/1000 of a cent = $0.00001): 0.40 m¢,
  // 3.5 m¢, 3,000 m¢ — small readable numbers. Precision tapers as it grows.
  function fmtCost(c) {
    if (!(c > 0)) return '0 m¢';
    var mc = c * 100000;                          // dollars -> milli-cents
    if (mc < 0.01) return '<0.01 m¢';
    var s = mc >= 100 ? Math.round(mc).toLocaleString()
          : mc >= 1   ? mc.toFixed(1)
          :             mc.toFixed(2);
    return s + ' m¢';
  }

  // The response headers a real client would read off /v1/chat/completions.
  // /v1/router/explain emits the same set (ADR 0002).
  function headersCard(hdrs) {
    var names = Object.keys(hdrs || {});
    if (!names.length) return '';
    var rows = names.map(function (n) {
      return '<tr><td><code>' + esc(n) + '</code></td><td>' + esc(hdrs[n]) + '</td></tr>';
    }).join('');
    return '<div class="card"><h3>Response headers</h3>' +
      '<p class="muted">What an OpenAI client reads off the real <code>/v1/chat/completions</code> response.</p>' +
      '<table>' + rows + '</table></div>';
  }

  // Routing latency — the proxy's own overhead, excluding any upstream call.
  function latency(data) {
    if (data.routingMs == null) return '';
    return '<span class="lat" title="Time spent routing: detection, signal, filtering and scoring. ' +
      'Excludes the upstream model call.">' + esc(data.routingMs) + ' ms</span>';
  }

  // What it cost to MAKE this decision — the signal/classifier call the router
  // ran to pick a model. Real spend, distinct from the projected cost of running
  // the request on the chosen model (the "est. cost" column).
  function decisionCostCard(data) {
    var sc = data.classifier && data.classifier.signalCost;
    var prov = data.signalProvider || 'heuristic';
    var body;
    if (sc && sc.usd > 0) {
      var toks = (sc.inputTokens != null && sc.outputTokens != null)
        ? ' · ' + (sc.inputTokens + sc.outputTokens) + ' tokens (' +
          sc.inputTokens + ' in / ' + sc.outputTokens + ' out)'
        : '';
      body = 'Making this decision cost <b>' + fmtCost(sc.usd) + '</b> and <b>' +
        esc(sc.latencyMs) + ' ms</b> — one ' + esc(prov) + ' call' + toks +
        '. No answer was generated; this is only the routing signal.';
    } else {
      body = 'Making this decision cost <b>0 m¢</b> — the ' + esc(prov) +
        ' signal runs locally with no LLM call' +
        (data.routingMs != null ? ', in ' + esc(data.routingMs) + ' ms' : '') + '.';
    }
    return '<div class="card"><h3>Cost of this decision</h3>' +
      '<div class="muted">' + body + '</div></div>';
  }

  // Which signal provider ran — varies by strategy (ADR 0012). fast uses a
  // fast provider (heuristic ~0ms or RouteLLM ~250ms), the rest the classifier.
  function signalSource(data, c) {
    var p = data.signalProvider || (c.degraded ? 'heuristic' : 'llm-classifier');
    var label = { 'llm-classifier': 'LLM classifier (~1s)', 'routellm': 'RouteLLM (~250ms)', 'heuristic': 'heuristic (~0ms)' }[p] || esc(p);
    if (c.degraded && p !== 'heuristic') {
      return '<span class="warn">' + label + ' — degraded to heuristic defaults (key/sidecar unavailable?)</span>';
    }
    return label;
  }

  function render(data, status, hdrs) {
    lastRender = { data: data, status: status, hdrs: hdrs };
    if (status !== 200 || data.error) {
      out.innerHTML = '<div class="card err">Error ' + status + ': ' +
        esc(data && data.error ? (data.error.message || JSON.stringify(data.error)) : 'request failed') +
        '</div>';
      return;
    }
    if (data.bypassed) {
      out.innerHTML = '<div class="card banner">' +
        (data.decision ? avail(data.decision.model) + ' ' : '') +
        'Forced to <b>' + esc(data.decision ? data.decision.model : '-') + '</b> ' +
        (data.decision ? '<span class="muted">(' + esc(data.decision.provider) + ')</span>' : '') +
        latency(data) +
        '<br><span class="muted">routing skipped (X-Router-Bypass) — the model is used verbatim</span>' +
        unroutableNote(data.decision) + '</div>' +
        headersCard(hdrs) +
        '<details><summary>Raw JSON</summary><pre>' + esc(JSON.stringify(data, null, 2)) + '</pre></details>';
      return;
    }

    var html = '';

    if (data.decision) {
      html += '<div class="card banner">' + avail(data.decision.model) + ' Routed to <b>' +
        esc(data.decision.model) + '</b> ' +
        '<span class="muted">(' + esc(data.decision.provider) + ')</span>' + latency(data) + '<br>' +
        '<span class="muted">' + esc(data.decision.reason) + '</span>' +
        unroutableNote(data.decision) + '</div>';
      html += decisionCostCard(data);
    } else {
      html += '<div class="card err">No eligible model for this request.</div>';
    }

    var c = data.classifier || {};
    html += '<div class="card"><h3>Signals</h3><div class="kv">' +
      '<div>complexity</div><div>' + (c.complexity != null ? pct(c.complexity) : '-') + '</div>' +
      '<div>reasoning depth</div><div>' + (c.reasoningDepth != null ? pct(c.reasoningDepth) : '-') + '</div>' +
      '<div>task type</div><div>' + esc(c.taskType || '-') + '</div>' +
      '<div>expected output</div><div>' + esc(c.expectedOutputTokens) + ' tokens</div>' +
      '<div>data sensitivity</div><div>' + (c.dataSensitivity != null ? pct(c.dataSensitivity) : '-') + '</div>' +
      '<div>input tokens</div><div>' + esc(data.inputTokens) + '</div>' +
      '<div>signal source</div><div>' + signalSource(data, c) + '</div>' +
      '</div></div>';

    var rl = data.routellm;
    if (rl) {
      var rlBody;
      if (!rl.enabled) {
        rlBody = '<span class="muted">disabled — enable <code>routellm</code> in server.yaml and run the sidecar</span>';
      } else if (rl.available) {
        rlBody = 'win-rate <b>' + pct(rl.winRate) + '</b> <span class="muted">(P a strong model is needed)</span> · confidence ' + pct(rl.confidence);
      } else {
        rlBody = '<span class="warn">sidecar unavailable</span>';
      }
      html += '<div class="card"><h3>RouteLLM (learned signal)</h3>' + rlBody + '</div>';
    }

    var d = data.detected || {};
    var reqs = [];
    if (d.requiresVision) reqs.push('vision');
    if (d.requiresTools) reqs.push('tools');
    if (d.requiresStructuredOutput) reqs.push('structured output');
    if (d.requiresAudio) reqs.push('audio');
    if (d.requiresCustomTemperature) reqs.push('custom temperature');
    html += '<div class="card"><h3>Detected requirements</h3><div class="badges">' +
      (reqs.length ? reqs.map(function (r) { return '<span>' + esc(r) + '</span>'; }).join('') : '<span class="muted">none</span>') +
      '</div></div>';

    if (data.ranked && data.ranked.length) {
      // Highlight the model actually chosen, which is not always the top score:
      // a higher-ranked model with no API key is passed over. Mark that one too,
      // so the gap between "scored best" and "was used" is visible rather than
      // implied by the ⚪.
      var chosen = data.decision ? data.decision.model : null;
      var topScorer = data.ranked[0].model;
      var passedOver = chosen !== null && topScorer !== chosen;

      function compCell(r) {
        var k = r.competency;
        if (!k) return '<td class="muted" data-label="comp." title="generic task — competency not applied">—</td>';
        var tip = (k.fallback ? 'tier fallback: ' : '') + k.source + (k.updated ? ' · updated ' + k.updated : '');
        return '<td data-label="comp." title="' + esc(tip) + '">' + k.score.toFixed(3) +
          (k.fallback ? '<span class="muted">†</span>' : '') + '</td>';
      }
      // A clickable, sortable column header (P3.3); shows ▲/▼ for the active sort.
      function sortTh(col, label, title) {
        var arrow = sortState.col === col ? (sortState.dir < 0 ? ' ▼' : ' ▲') : '';
        return '<th class="sortable" data-sort="' + col + '"' +
          (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + arrow + '</th>';
      }
      // Competency only applies to benchmark-eligible tasks; for a conversational
      // prompt every row is null. Drop the whole column in that case rather than
      // render a wall of "—" that reads as unfinished (P1.4).
      var hasComp = data.ranked.some(function (r) { return r.competency; });
      var rows = applySort(data.ranked).map(function (r) {
        var cls = r.model === chosen ? 'win' : (passedOver && r.model === topScorer ? 'skipped' : '');
        var note = '';
        if (r.model === chosen) note = ' <span class="tag">chosen</span>';
        else if (passedOver && r.model === topScorer) note = ' <span class="tag muted">top score, no key</span>';
        // The pick gets a ⭐ instead of the routable dot — but only when it is
        // actually routable. An unroutable pick (a fresh install with no keys)
        // keeps its ⚪ so the table never implies it could be forwarded to; the
        // "chosen" tag still identifies it.
        var indicator = (r.model === chosen && AVAILABLE[r.model]) ? '⭐' : avail(r.model);
        // Hover the projected cost to see the stable per-1M list price it derives from.
        var rateTip = r.ratePer1MInput != null
          ? '$' + r.ratePer1MInput + ' / 1M input · $' + r.ratePer1MOutput + ' / 1M output'
          : '';
        return '<tr class="' + cls + '"><td data-label="">' + indicator + '</td><td data-label="model">' +
          esc(r.model) + note + '</td><td data-label="vendor">' + vendorCell(r.provider) + '</td><td data-label="tier">' + esc(r.tier) +
          '</td>' + (hasComp ? compCell(r) : '') + '<td data-label="score">' + r.score.toFixed(3) + '</td>' +
          '<td data-label="est. cost" title="' + esc(rateTip) + '">' + fmtCost(r.estimatedCost) + '</td>' +
          '<td data-label="latency">' + esc(r.latencyMs) + ' ms</td></tr>';
      }).join('');
      var compTask = hasComp && data.ranked[0].competency ? data.ranked[0].competency.task : null;
      var detectedTask = data.classifier ? data.classifier.taskType : null;
      html += '<div class="card"><h3>Ranked candidates</h3>' +
        '<div class="muted" style="font-size:.8rem;margin:.1rem 0 .5rem">⭐ chosen · 🟢 routable · ⚪ no key · <span title="A milli-cent: 1/1000 of a cent, i.e. $0.00001. Per-request costs are fractions of a cent, so this keeps them readable.">m¢ = 1/1000 of a cent</span></div>' +
        '<table class="cards">' +
        '<tr><th></th>' + sortTh('model', 'model', '') + sortTh('vendor', 'vendor', '') + sortTh('tier', 'tier', '') +
        (hasComp ? sortTh('comp', 'comp.', 'Per-task competency (0-1) that fed the task_type rule for the detected task (ADR 0010). Hover a value for its source; † = tier fallback (no benchmark data).') : '') +
        sortTh('score', 'score', 'Capability score Q — how good this model is for the detected task (best optimises this).') +
        sortTh('cost', 'est. cost', 'Projected cost for THIS request (input + output tokens × the model rate), in milli-cents — m¢ = 1/1000 of a cent = $0.00001. value optimises this. Hover a value for the model list price per 1M tokens.') +
        sortTh('latency', 'latency', 'Seed average response latency in ms (fast optimises this; overridden by live telemetry later).') +
        '</tr>' + rows + '</table>' +
        (hasComp
          ? '<div class="muted" style="margin-top:.4rem">comp. = competency for detected task <code>' +
            esc(compTask) + '</code>; † = tier fallback (no benchmark data). Hover a value for its source.</div>'
          : '<div class="muted" style="margin-top:.4rem">No per-task competency column: competency is benchmark-seeded for tasks like coding, math, and reasoning' +
            (detectedTask ? ', but the detected task is <code>' + esc(detectedTask) + '</code>' : '') +
            '. Try a coding or math prompt to see per-model scores.</div>') +
        '</div>';
    }

    if (data.excluded && data.excluded.length) {
      var ex = data.excluded.map(function (e) {
        return '<tr><td data-label="">' + avail(e.model) + '</td><td data-label="model">' + esc(e.model) + '</td><td data-label="vendor">' +
          vendorOf(e.model) + '</td><td class="muted" data-label="failed">' +
          esc((e.failedConstraints || []).join(', ')) + '</td></tr>';
      }).join('');
      html += '<div class="card"><h3>Excluded by constraints</h3><table class="cards">' +
        '<tr><th></th><th>model</th><th>vendor</th><th>failed</th></tr>' + ex + '</table></div>';
    }

    if (data.warnings && data.warnings.length) {
      html += '<div class="card warn">' + data.warnings.map(esc).join('<br>') + '</div>';
    }

    html += headersCard(hdrs);

    html += '<details><summary>Raw JSON</summary><pre>' + esc(JSON.stringify(data, null, 2)) + '</pre></details>';
    out.innerHTML = html;
    // Sortable ranked-table headers (P3.3): click to sort by a column, click
    // again to flip. Numeric columns start descending, text columns ascending.
    Array.prototype.forEach.call(out.querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-sort');
        if (sortState.col === col) sortState.dir = -sortState.dir;
        else { sortState.col = col; sortState.dir = SORT_DIR[col] || 1; }
        render(lastRender.data, lastRender.status, lastRender.hdrs);
      });
    });
  }

  // P3.3 — run all three strategies on ONE prompt and show the picks side by side.
  async function compareStrategies() {
    var prompt = document.getElementById('prompt').value;
    if (!prompt.trim()) return;
    var body = { messages: [{ role: 'user', content: prompt }] };
    var tv = document.getElementById('temperature').value;
    if (tv !== '') body.temperature = Number(tv);
    btn.disabled = true; cmpBtn.disabled = true;
    out.innerHTML = '<div class="card muted">Comparing best / value / fast…</div>';
    try {
      var results = await Promise.all(['best', 'value', 'fast'].map(function (s) {
        return fetch('/v1/router/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Router-Strategy': s },
          body: JSON.stringify(body)
        }).then(function (res) {
          return res.json().then(function (data) { return { strategy: s, data: data }; });
        });
      }));
      renderComparison(results);
    } catch (e) {
      out.innerHTML = '<div class="card err">' + esc(e.message) + '</div>';
    } finally {
      btn.disabled = false; cmpBtn.disabled = false;
    }
  }

  function renderComparison(results) {
    var picks = results.map(function (r) { return r.data.decision ? r.data.decision.model : null; });
    var agree = picks.every(function (m) { return m && m === picks[0]; });
    var note = agree
      ? 'All three strategies agree on <b>' + esc(picks[0]) + '</b> — for this prompt, capability, cost and latency point the same way.'
      : 'The strategies <b>diverge</b>: same prompt, different picks. That is the point — <code>best</code> reserves capability, <code>value</code> takes the cheapest and <code>fast</code> the quickest, each <em>within</em> the capability frontier.';
    var OPT = { best: 'strongest', value: 'cheapest in frontier', fast: 'fastest in frontier' };
    var cols = results.map(function (r) {
      var dec = r.data.decision;
      if (!dec) {
        return '<div class="cmp-col"><div class="cmp-h"><code>' + esc(r.strategy) +
          '</code></div><div class="muted">no eligible model</div></div>';
      }
      var picked = (r.data.ranked || []).filter(function (x) { return x.model === dec.model; })[0];
      var cost = picked ? fmtCost(picked.estimatedCost) : '—';
      var lat = picked ? (esc(picked.latencyMs) + ' ms') : '—';
      var dot = AVAILABLE[dec.model] ? '🟢 ' : '⚪ ';
      return '<div class="cmp-col">' +
        '<div class="cmp-h"><code>' + esc(r.strategy) + '</code> <span class="muted">' + OPT[r.strategy] + '</span></div>' +
        '<div class="cmp-model">' + dot + '<b>' + esc(dec.model) + '</b></div>' +
        '<div class="muted" style="font-size:.85em">' + esc(dec.provider) + '</div>' +
        '<div class="kv" style="margin:.45rem 0;font-size:.85rem">' +
          '<div class="muted">est. cost</div><div>' + cost + '</div>' +
          '<div class="muted">latency</div><div>' + lat + '</div>' +
        '</div>' +
        '<div class="muted" style="font-size:.8em">' + esc(dec.reason) + '</div>' +
      '</div>';
    }).join('');
    out.innerHTML = '<div class="card"><h3>Strategy comparison</h3>' +
      '<p class="muted" style="margin-top:0">' + note + '</p>' +
      '<div class="cmp-cols">' + cols + '</div></div>';
  }

  async function submit(bodyOverride) {
    var prompt = document.getElementById('prompt').value;
    if (!bodyOverride && !prompt.trim()) { return; }
    sortState.col = null;                          // a fresh inspection starts in router order
    var strategy = document.getElementById('strategy').value;
    var force = document.getElementById('force').value;
    var body = bodyOverride || { messages: [{ role: 'user', content: prompt }] };
    // Manual submit: attach the temperature control (presets carry their own).
    if (!bodyOverride) {
      var tv = document.getElementById('temperature').value;
      if (tv !== '') body.temperature = Number(tv);
    }
    var headers = { 'Content-Type': 'application/json', 'X-Router-Strategy': strategy };
    // Force a specific model: pin it in the body and bypass routing.
    if (force && force !== 'auto') {
      body = Object.assign({}, body, { model: force });
      headers['X-Router-Bypass'] = 'true';
    }
    btn.disabled = true;
    out.innerHTML = '<div class="card muted">Inspecting…</div>';
    try {
      var res = await fetch('/v1/router/explain', {
        method: 'POST', headers: headers, body: JSON.stringify(body)
      });
      var data = await res.json();
      var hdrs = {};
      ['X-Router-Model', 'X-Router-Reason', 'X-Router-Duration-Ms', 'X-Router-Warning'].forEach(function (n) {
        var v = res.headers.get(n);
        if (v) hdrs[n] = v;
      });
      render(data, res.status, hdrs);
    } catch (e) {
      out.innerHTML = '<div class="card err">' + esc(e.message) + '</div>';
    } finally {
      btn.disabled = false;
    }
  }

  function runPreset(p) {
    document.getElementById('prompt').value = p.prompt;
    document.getElementById('strategy').value = p.strategy;
    document.getElementById('force').value = (p.bypass && p.body && p.body.model) ? p.body.model : 'auto';
    // Reflect any temperature the preset carries (e.g. the temperature gold case).
    var pt = p.body && p.body.temperature;
    document.getElementById('temperature').value = (pt != null) ? pt : '';
    submit(p.body);
  }

  (function renderPresets() {
    var box = document.getElementById('presets');
    if (!PRESETS.length) { box.innerHTML = '<p class="muted">none found</p>'; return; }
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'preset';
      b.title = p.id;
      b.innerHTML = '<span class="pl">' + esc(p.label) + '</span><span class="chip">' + esc(p.strategy) + '</span>';
      b.addEventListener('click', function () { runPreset(p); });
      box.appendChild(b);
    });
  })();

  btn.addEventListener('click', function () { submit(); });
  cmpBtn.addEventListener('click', function () { compareStrategies(); });
</script>
</body>
</html>`;
}
