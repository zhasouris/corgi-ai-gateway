# ADR 0021 — Strategy Taxonomy: Objective × Capability-Gate

- **Status:** Accepted (implementing)
- **Date:** 2026-07-25
- **Context repo:** `corgi-ai-gateway`

## Context

[ADR 0017](0017-frontier-then-optimize-strategies.md) shipped three strategies — `best`,
`value`, `fast` — each optimising one objective *within the capability frontier*. Two problems
surfaced in use:

1. **The names hid the model.** `value` = "cheapest **in the frontier**" and `fast` = "fastest
   **in the frontier**", but the names don't say the pick is capability-gated, and `best`/`value`/`fast`
   don't line up on any obvious axis.
2. **There was no capability-*ungated* option.** `value` is "strongest that's also economical" — on
   a hard prompt it stays on a strong model. Some callers genuinely want the **absolute cheapest**
   (or fastest) eligible model — bulk / low-stakes / cost-capped work — and the router had no way to
   express that. `value` will never drop below the frontier.

## Decision

**Model a strategy as two axes — the objective (capability / cost / latency) and whether it is
gated to the capability frontier — and name it accordingly.**

| Strategy | Objective | Frontier gate | Was |
| --- | --- | --- | --- |
| `best` | capability | (defines the frontier) | `best` |
| `cheapest-capable` | cost | **within** the frontier | `value` |
| `cheapest` | cost | **none** (all eligible) | *(new)* |
| `fastest-capable` | latency | **within** the frontier | `fast` |
| `fastest` | latency | **none** (all eligible) | *(new)* |

Convention: **`-capable` = gated to the capability frontier; the bare name optimises over every
eligible model.** Capability has no gated/ungated split (the strongest model is the strongest
either way), so `best` stands alone.

**Mechanism.** The ungated strategies reuse frontier-then-optimize with a per-strategy
**`frontier_delta = 1.0`** (`config/strategies.yaml` → `strategy_frontier_delta`): a full-width
frontier means the whole eligible set is "in frontier", so the cost/latency sort runs over all of
it and the globally cheapest/fastest wins. Gated strategies keep the shared `frontier_delta` (0.12).
The displayed capability frontier stays the gated one, so an ungated pick shows as *outside* it.

**Backward compatibility.** `value` and `fast` remain accepted as **deprecated aliases** of
`cheapest-capable` / `fastest-capable` (they're synonym entries in the strategy config, so no
normalization is needed and every existing caller, gold case, and test keeps working). The header
parser emits a deprecation warning when an alias is used. The default strategy is now
`cheapest-capable`.

## Consequences

- Callers get an explicit **capability escape hatch** (`cheapest`/`fastest`) that ADR 0017 lacked —
  at the cost of the capability-first guarantee, which is the whole point of asking for it. On a
  hard prompt, `cheapest` will route to a weak cheap model (it *is* the `always-cheapest` baseline
  the eval uses as a yardstick); `X-Router-Reason` says so ("cheapest eligible model, no capability
  gate") and the pick shows outside the displayed frontier.
- The names now read off the two axes, and the demo/eval/baseline enumerate the **canonical** five
  (`CANONICAL_STRATEGIES`) so aliases don't duplicate rows.
- This is a deliberate loosening of ADR 0017's "decide who's good enough first" thesis, scoped to
  the two opt-in ungated strategies; the gated defaults are unchanged.
