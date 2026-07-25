# ADR 0020 — Generation-Parameter Compatibility as a Routing Constraint

- **Status:** Accepted (implementing)
- **Date:** 2026-07-25
- **Context repo:** `corgi-ai-gateway`

## Context

The router filters candidates by hard **capability** constraints (`vision`, `tools`,
`structured_output`, `audio`) and context window, then optimises cost/quality/latency
([ADR 0003](0003-rule-and-scoring-engine.md), [ADR 0017](0017-frontier-then-optimize-strategies.md)).
It did **not** consider whether a candidate model accepts the **generation parameters** in the
request body — and the gateway forwards that body verbatim (passthrough, [ADR 0001](0001-multi-provider-translation-strategy.md)).

That gap produces hard, routing-dependent 400s. A caller sending `temperature: 0` for
determinism (extraction, evals, structured output) gets intermittent failures: when `value`
lands on `o4-mini`, OpenAI returns `400 invalid_request_error / unsupported_value` —
*"'temperature' does not support 0 with this model. Only the default (1) value is supported."*
The **same request** succeeds on `gpt-4.1-nano`. The caller can't fix it; the router chose the
incompatible model, and the failure looks like flakiness rather than a clean "unsupported."

OpenAI reasoning models (the o-series — `o4-mini`, `o3`, `o1` — and GPT-5 reasoning variants)
only accept the default `temperature` (1). This is **not** the same as "reasoning": Claude,
Gemini, DeepSeek, and Grok reasoning models accept a custom temperature fine.

## Decision

**Treat generation-parameter compatibility as a hard constraint, using the existing
`detect → constrain → filter` pattern** — so an incompatible model drops out of the candidate
set *before* scoring and the router naturally picks a compatible one. No router changes:
`filterCandidates` already applies `ALL_CONSTRAINTS`.

- **Detect** ([detect.ts](../../src/core/detect.ts)): `requiresCustomTemperature = req.temperature != null && req.temperature !== 1`.
- **Constrain** ([constraints.ts](../../src/core/constraints.ts)): `temperatureConstraint` admits a
  model unless the request needs a custom temperature and the model is fixed-temperature.
- **Catalog flag** ([models.yaml](../../config/models.yaml)): an explicit `fixed_temperature: true`
  on the o-series (`o4-mini`, `o3`), **not** a proxy for the `reasoning` capability — that
  equivalence is an OpenAI coincidence, and keying on it would wrongly exclude the five
  non-OpenAI reasoning models that accept custom sampling.

## Consequences

- A request with a non-default `temperature` is only ever routed to a model that accepts it, so
  passthrough never produces a parameter-rejection 400 — callers keep determinism without knowing
  the catalog. Proven by a gold case (`temperature-avoids-o-series`): the √2-irrationality prompt
  routes to `o4-mini` at temperature 1, and to `claude-opus-4-8` at temperature 0.
- The exclusion is **visible** in `/router/explain` (`o4-mini` appears under `excluded` with a
  `temperature` failed constraint), so the behaviour is inspectable, not silent.

## Follow-up (not required here)

`temperature` is one instance of the general rule *"the router must not select a model that will
reject the request body."* The o-series also reject `top_p`, `presence_penalty`,
`frequency_penalty`, `logit_bias`, `logprobs`, and expect `max_completion_tokens` rather than
`max_tokens`. The first three are further **exclusion** constraints on the same `fixed_temperature`
models (a broader `fixed_sampling` flag is the natural generalisation); the `max_tokens` remap is a
**transform** concern for the forwarder, not an exclusion.
