# TODO / backlog

The single place for open work. Decisions that are settled live in
[`decisions/`](decisions) as ADRs; unresolved design threads live in
[`discussions/`](discussions). This file is what's *queued*.

---

## Queued

### 1. Code coverage badge ✅ done

- [x] Coverage via `@vitest/coverage-v8` (`npm run coverage`), excluding the process
      entrypoint and the static demo page.
- [x] Thresholds set at the measured baseline (statements 78 / branches 58 /
      functions 83 / lines 80) — CI fails on a regression below them.
- [x] `ci.yml` workflow runs typecheck + tests + coverage on every push/PR (previously
      nothing ran the tests in CI at all) and uploads the report as an artifact.
- [x] README badge shows **81% lines**.

**Follow-up (open):** the badge number is currently static, kept honest by the enforced
floor — it can under-report if coverage improves, but never over-report. Swap it for a
live badge when convenient:
- [ ] shields.io **endpoint badge** backed by a gist updated from CI (needs a gist +
      a PAT secret), or **Codecov** (tokenless for public repos, adds a third party).
- [ ] Raise **branch coverage (58%)** — the weakest metric. Most of the gap is
      error/degradation paths (adapter fallbacks, telemetry exporter branches).

### 2. Sensitive-data routing — ADR written ✅, implementation open

The plan is written up as
**[ADR 0009 — Routing Sensitive Data to Approved Providers](decisions/0009-sensitive-data-routing.md)**
(status: *Proposed*). Core decision: data-handling policy is a **hard constraint, never a
score**, and it **fails closed** — with `policy > bypass > strategy` precedence.

Implementation queue (from the ADR's follow-ups):

- [ ] Catalog schema: `data_classes`, `region`, `retention`, `trains_on_data`, `self_hosted`.
- [ ] Policy config schema (global + per-key/tenant), fail-fast validated at startup.
- [ ] Deterministic detector library (PII/PAN/secrets/internal markers) — offline, unit-tested.
- [ ] `DataPolicyConstraint` implementing `ConstraintRule`; wire into the filter stage.
- [ ] Apply policy to the bypass path (currently a one-header hole through any control).
- [ ] Dry-run/report mode — log what *would* be refused before enforcing.
- [ ] Gold tests: a restricted request never routes to an unapproved provider, across **all**
      strategies and with bypass set.
- [ ] Blocked on the self-hosted/Ollama backend for a genuinely local target to route to.

---

## Carried over

Already tracked elsewhere; listed here so this file is the single view.

- [ ] **RouteLLM shadow-eval → promotion** — the sidecar and `SignalProvider` are built;
      the accuracy lift vs. the heuristic is not yet benchmarked through the judge
      ([ADR 0006](decisions/0006-leveraging-learned-routing.md)).
- [ ] **Native transformers for the remaining vendors** (Gemini, Cohere, …) — they work
      today over OpenAI-compatible endpoints; native adapters are a fidelity upgrade
      ([transformers checklist](transformers.md)).
- [ ] **Self-hosted / Ollama backend** — also unblocks the sensitive-data work above, since
      it provides a genuinely local "trusted provider".
- [ ] **Offline, telemetry-fed ML router** ([ADR 0005](decisions/0005-offline-ml-module.md)).
- [ ] **Automatic cross-provider failover.**
- [ ] **Eval harness Phase 2/3** — larger judged dataset, then telemetry-sourced
      ([eval-harness spec](eval-harness.md)).
