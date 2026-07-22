# TODO / backlog

The single place for open work. Decisions that are settled live in
[`decisions/`](decisions) as ADRs; unresolved design threads live in
[`discussions/`](discussions). This file is what's *queued*.

---

## Queued

### 1. Code coverage badge

Report and publish test coverage, and surface it as a README badge next to the
existing `tests` badge.

- [ ] Enable coverage in `vitest.config.ts` (`@vitest/coverage-v8`), with sensible
      excludes (`eval/`, `test/`, generated output).
- [ ] Decide a realistic threshold and fail CI below it (start at the current number,
      ratchet up — don't invent a target we then paper over).
- [ ] Publish the number. Options, cheapest first:
      - a shields.io **endpoint badge** backed by a gist updated from CI (no third party
        beyond gist);
      - **Codecov**/Coveralls (nicer PR annotations, adds an external service + token);
      - a committed static badge (simplest, but goes stale — least honest).
- [ ] Wire it into the SAST workflow or a small `test` workflow so it refreshes on push.

*Note:* coverage should be reported honestly. Large parts of this repo are thin glue
(config loading, adapters) where a high number is easy; the parts worth covering are the
scoring engine, constraints, and adapters — which the 69 tests already exercise.

### 2. ADR — routing sensitive data to approved/trusted providers

Write an ADR describing how an organization can guarantee that requests containing
internal or regulated data only ever reach **approved endpoints on trusted providers**.

Groundwork that already exists:

- The signal layer emits **`dataSensitivity` (0..1)** per request
  ([ADR 0003](decisions/0003-rule-and-scoring-engine.md)).
- A `data_sensitivity` **scoring rule** already biases toward local/self-hosted providers
  — but it is a *soft weight*, currently inert (no local provider configured).

The ADR needs to cover the jump from "soft preference" to "hard guarantee":

- [ ] **Detection** — how sensitivity is determined, and why a classifier score alone is
      not sufficient for a compliance control. Likely a union of: deterministic detectors
      (PII/PAN/secret regexes, internal-domain markers), caller-asserted classification
      (a trusted header or API-key-scoped policy), and the LLM signal as a *backstop* only.
- [ ] **Policy model** — how "approved" is expressed: a provider/model allowlist, data
      residency/region, on-prem-only, contractual flags (no-training, zero-retention).
      Config shape, and whether policy is global, per-tenant, or per-API-key.
- [ ] **Enforcement point** — this must be a **hard constraint** in the filter stage
      (like the vision/audio capability constraints), *not* a weighted score, so no
      strategy or weight tuning can ever override it.
- [ ] **Fail-closed behaviour** — if no approved model survives the filter, the router must
      **refuse** (a clear 4xx), never silently fall back to a non-approved provider. This is
      the opposite of our current graceful-degradation default and needs to be explicit.
- [ ] **Bypass interaction** — `X-Router-Bypass` currently forces any model verbatim; the
      ADR must say whether policy overrides bypass (it should) and how that's enforced.
- [ ] **Auditability** — what gets recorded (decision, matched policy, why a provider was
      excluded) without ever logging the sensitive content itself
      ([ADR 0008](decisions/0008-observability.md) already forbids logging bodies/keys).
- [ ] **Residual risk** — be honest that a prompt-classifier can be evaded, so detection
      should be layered and the safe default is restrictive.

Related: [ADR 0003](decisions/0003-rule-and-scoring-engine.md) (constraints vs. scores),
[ADR 0007](decisions/0007-per-model-api-keys.md) (per-model credentials),
[ADR 0001](decisions/0001-multi-provider-translation-strategy.md) (provider adapters).

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
