# ADR 0011 — Lexicographic Tie-Break ("prefer X among near-equals")

- **Status:** Proposed (plan; not yet implemented)
- **Date:** 2026-07-22
- **Context repo:** `corgi-gateway`

## Context

A strategy today is a **weight vector** over the scoring rules, and the winner is the highest
weighted sum ([ADR 0003](0003-rule-and-scoring-engine.md)). That expresses smooth trade-offs
well and one common intent not at all:

> *"Give me the best quality — but when ten models are basically tied on quality and their
> prices differ tenfold, take the cheapest."*

**No weight vector can say that.** A weighted sum trades continuously: any weight on cost
large enough to break a near-tie is also large enough to sacrifice quality when the gap is
real. What is being described is **lexicographic**: rank by a primary objective, then
re-rank the near-equals by a secondary one.

We already do this at zero tolerance. Exact ties break by cheaper blended cost, then by id.
And it fires in practice — a `quality` request for a Rust concurrency problem produced a
genuine three-way tie at the top:

```
gemini-2.5-pro (tier 5, 6.30)   deepseek-reasoner (tier 5, 6.30)   o4-mini (tier 5, 6.30)
```

with materially different prices. So the honest framing is not "add hybrid strategies". It
is: **the tie-break already exists and already matters; make its tolerance configurable.**

## Decision

**Add one orthogonal knob — a tolerance band plus a secondary preference — that composes
with any strategy. Named hybrids become presets, not new machinery.**

### 1. The knob

```yaml
strategies:
  quality-prefer-cost:
    <<: *quality_weights
    tie_break:
      within: 0.25     # band width, relative to the score spread (see below)
      prefer: cost     # secondary objective within the band
```

Per-request override via a header, consistent with [ADR 0002](0002-router-header-contract.md):

```
X-Router-Tie-Break: cost
X-Router-Tie-Break-Within: 0.25
```

`prefer` accepts any registered rule name (`cost`, `latency`, …), so this composes with
future rules including per-task competency ([ADR 0010](0010-per-task-competency-scores.md))
without further design.

### 2. Band width is relative to the observed spread, never a fixed percentage

This is the part that will be got wrong if it is not stated plainly.

**Scores cluster far more tightly than intuition suggests.** Measured on this catalog, the
top seven candidates under `cost` spanned `5.500 → 5.446` — a spread of about **1%**. A
naive `within: 0.05` ("within 5%") would therefore sweep in nearly the entire catalog, and
the secondary objective would silently become the *primary* one. `quality-prefer-cost` would
quietly be `cost`.

So the band is defined against the spread of the candidate scores, not their magnitude:

```
band  = topScore − within × (topScore − medianScore)
admit = score >= band
```

`within: 0` reproduces today's exact-tie behaviour. `within: 1` admits everything down to the
median. Using the **median** rather than the minimum keeps a single far-out straggler from
widening the band for everyone.

### 3. Ordering: routability before the secondary sort

```
constraints → score → band → routable → secondary sort → pick
```

Routability must be applied **inside** the band, before the secondary sort. Otherwise
`quality-prefer-cost` will confidently pick the cheapest model in the band and then fail to
forward to it because no API key resolves — precisely the failure the routable-preference
work removed.

The final ordering stays deterministic: secondary objective, then blended cost, then id.

### 4. It must explain itself

When the band changes the outcome, `X-Router-Reason` says so — the pick alone is misleading
if it is not the top-scored model:

```
quality: complexity (score 6.30) - tie-break: 3 models within band, cheapest chosen
(o4-mini $0.0154 vs gemini-2.5-pro $0.0275)
```

The demo inspector should mark the band, the same way it now marks the chosen row versus the
top scorer.

### 5. Named strategies are presets

`quality-prefer-cost` and `cost-prefer-quality` ship as entries in `strategies.yaml` that
combine existing weights with a `tie_break` block. They are configuration, not code. This
avoids an N² table of named strategies as rules are added, while still giving callers the
memorable names they actually want to type.

## Consequences

**Positive**

- Expresses an intent the weighted-sum model structurally cannot, without abandoning it.
- Generalises a mechanism that already exists and already fires, rather than adding a
  parallel one.
- Orthogonal: any strategy × any secondary objective, no combinatorial config.
- Directly measurable. A successful `quality-prefer-cost` shows **mean cost down with judged
  accuracy flat**. If accuracy drops, the band is too wide — the eval harness answers this
  rather than opinion.

**Negative / accepted trade-offs**

- **Band width is delicate.** Too wide and the secondary silently becomes primary; too narrow
  and the feature does nothing. The spread-relative definition mitigates this but does not
  remove the need to tune and measure per catalog.
- **Score spreads shift as the catalog grows.** A band tuned against 32 models may behave
  differently at 60. The definition is relative, so it adapts — but it should be re-measured
  when the catalog changes materially.
- **Two knobs where there was one.** Callers can now express a strategy *and* a tie-break,
  which is more to understand and more to get wrong. The presets exist to keep the common
  cases to a single name.
- **Near-equality is not real equality.** Two models scoring 6.30 are equal *to this scoring
  function*, which is an approximation of quality, not quality. Widening the band widens the
  reliance on that approximation being right.

## Follow-ups / TODO

- [ ] `tie_break` schema in `strategies.yaml` + Zod validation (`prefer` must name a
      registered rule).
- [ ] Implement band selection in `scoreModels`, after scoring and before the pick.
- [ ] Apply routability inside the band (see ordering above) — with a test that would fail
      if the order were swapped.
- [ ] `X-Router-Tie-Break` / `-Within` headers (ADR 0002 contract update).
- [ ] Reason string and demo rendering for a band-driven pick.
- [ ] Ship `quality-prefer-cost` and `cost-prefer-quality` presets.
- [ ] Calibrate `within` against the current catalog, and record the measured spread in the
      config comment so the next person sees why the number is what it is.
- [ ] Judge-harness run: cost delta vs. accuracy delta for each preset.

## Related

- [ADR 0003 — Rule & Scoring Engine](0003-rule-and-scoring-engine.md) (weight vectors, the
  existing exact-tie break, `fixedScale`)
- [ADR 0002 — Router Header Contract](0002-router-header-contract.md) (per-request override)
- [ADR 0010 — Per-Task Competency Scores](0010-per-task-competency-scores.md) (a likely
  source of near-equal scores worth breaking on cost)
- [ADR 0009 — Sensitive-Data Routing](0009-sensitive-data-routing.md) (policy is a hard
  constraint and is unaffected: a tie-break can only reorder models already admitted)
