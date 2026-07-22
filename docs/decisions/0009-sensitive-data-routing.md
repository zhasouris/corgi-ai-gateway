# ADR 0009 — Routing Sensitive Data to Approved Providers

- **Status:** Proposed (plan; not yet implemented)
- **Date:** 2026-07-22
- **Context repo:** `llm-model-router`

## Context

An organization running this proxy will have requests it cannot allow to reach an
arbitrary vendor: customer PII, health or payment data, source code, internal documents,
anything under a residency or contractual constraint. The router today does the opposite
of what that requires — it picks whichever of **32 models across 9 vendors** scores best.

Some groundwork exists, but it does not add up to a control:

- The signal layer emits **`dataSensitivity` (0..1)** per request
  ([ADR 0003](0003-rule-and-scoring-engine.md)).
- A **`data_sensitivity` scoring rule** biases toward local/self-hosted providers.

That rule is a **weighted score**. Anything weighted can be outvoted — a `cost` strategy
with a heavy cost weight will happily outrank it, and the weights are user-editable config.
A control that can be tuned away is not a control. The same ADR already draws the right
distinction: **hard capability constraints filter the catalog; scores only rank what
survives.** Sensitivity belongs on the constraint side, and today it is on the wrong one.

This ADR is the plan for moving it.

## Decision

**Data-handling policy is a hard constraint, never a score, and it fails closed.**

### 1. Classification — how a request is judged sensitive

Layered, because no single source is trustworthy alone:

| Layer | Mechanism | Role |
|---|---|---|
| **Caller assertion** | `X-Router-Data-Class: public \| internal \| restricted`, and/or a default class bound to the API key | **Authoritative.** The calling system knows what it is sending; the router cannot know better. |
| **Deterministic detectors** | Regex/checksum for PII, PAN (Luhn), secrets/keys, internal hostnames, document markers | Cheap, offline, auditable, explainable. Catches unlabelled traffic. |
| **Model signal** | The classifier's `dataSensitivity` | **Backstop only.** Probabilistic and evadable; may raise a class, never lower one. |

The **effective class is the most restrictive** of the three. A caller may *raise* the
class above the policy default; it may never lower it below the floor for its key.

### 2. Policy model — what "approved" means

Declarative config, so policy is reviewable and diffable rather than buried in code:

- Catalog models gain handling attributes: `data_classes`, `region`, `retention`
  (e.g. `zero`/`30d`), `trains_on_data` (bool), `self_hosted` (bool).
- Policy maps each data class to the attributes a model must satisfy — an allowlist plus
  requirements (e.g. `restricted` → `self_hosted: true`, `region: eu`, `retention: zero`).
- Scope: a global default, overridable **per tenant / per API key**, so one deployment can
  serve groups with different obligations.

### 3. Enforcement — a constraint rule, in the filter stage

Implemented as a `ConstraintRule` alongside vision/audio/context-window, evaluated
**before scoring**:

```
admits(model, req, analysis) =
  model.data_classes includes effectiveClass
  AND model satisfies every attribute required by the policy for that class
```

Because it filters the candidate set, **no strategy, weight, or tuning can override it.**
This is precisely why ADR 0003 separated constraints from scores.

### 4. Fail-closed

- If **no model survives** the policy filter, the router **refuses** — a `403` naming the
  policy and the class — and never falls back to a non-approved provider. This deliberately
  inverts the router's usual graceful-degradation default.
- If the **signal provider is degraded/unavailable**, the effective class is derived from
  the caller assertion and deterministic detectors only. "Unknown" must resolve to the
  configured floor, **never to `public`**.

### 5. Precedence — policy outranks everything

`X-Router-Bypass` currently forces any model verbatim and skips the pipeline. Left as-is
that is a one-header hole straight through the control. Under this ADR:

> **policy > bypass > strategy**

Bypass becomes "pick any *policy-approved* model," not "pick anything." `X-Router-Max-Cost`
and strategy selection likewise cannot relax policy.

### 6. Auditability

Record on the span and log record ([ADR 0008](0008-observability.md)): the effective data
class, which layer determined it, the policy that matched, the models excluded and why, and
the model chosen. **Never the content** — ADR 0008 already forbids logging bodies or keys.
That yields a defensible trail: *"classified `restricted`; only self-hosted EU models were
eligible; routed to X."*

### 7. The proxy is itself in the trust boundary

If the router sees restricted data, it *is* a processor: it must be deployed inside the
boundary, and its **own** egress must obey the same policy — notably telemetry. Shipping
spans to a third-party APM is a data flow too (relevant to the Azure Monitor exporter in
ADR 0008).

## Consequences

**Positive**

- A structural guarantee rather than a preference — enforceable and testable, in the same
  place as the existing gold constraint tests (*"a vision request never routes to a
  non-vision model"* becomes *"restricted data never routes to an unapproved provider"*).
- Reuses existing machinery: constraint rules, catalog attributes, OTel — small surface.
- Per-key/tenant policy makes multi-tenant deployment viable.
- Fail-closed + audit trail is the posture a reviewer or auditor expects.

**Negative / accepted trade-offs**

- **Availability trade.** Fail-closed means a misconfigured policy hard-refuses real
  traffic. Needs precise error messages and a **dry-run/report mode** to shake out policy
  before enforcing.
- **Classification is imperfect.** Detectors over-restrict (false positives) and miss
  (false negatives); the LLM signal is evadable by an adversarial user. Layering reduces
  this; it does not eliminate it. Caller assertion must carry the most weight.
- **Guarantee is only as good as the metadata.** `region`/`retention`/`trains_on_data` are
  procurement and legal facts, not technical ones. Wrong catalog metadata produces a
  confidently wrong guarantee. This is the single biggest risk in the design.
- **Needs somewhere safe to route.** Until the self-hosted/Ollama backend lands, a
  `restricted` class may have an empty candidate set by construction — correct behaviour
  (refuse), but not useful.

## Follow-ups / TODO

- [ ] Catalog schema: `data_classes`, `region`, `retention`, `trains_on_data`, `self_hosted`.
- [ ] Policy config schema (global + per-key/tenant) with fail-fast validation at startup.
- [ ] Deterministic detector library (PII/PAN/secrets/internal markers) — offline, unit-tested.
- [ ] `DataPolicyConstraint` implementing `ConstraintRule`; wire into the filter stage.
- [ ] Apply policy to the bypass path.
- [ ] Dry-run/report mode (log what *would* be refused, enforce nothing).
- [ ] Gold tests: restricted request never routes to an unapproved provider, across **all**
      strategies and with bypass set.
- [ ] Depends on the self-hosted/Ollama backend for a genuinely local target.

## Related

- [ADR 0003 — Rule & Scoring Engine](0003-rule-and-scoring-engine.md) (constraints vs. scores)
- [ADR 0002 — Router Header Contract](0002-router-header-contract.md) (bypass semantics)
- [ADR 0007 — Per-Model API Keys](0007-per-model-api-keys.md) (per-model credentials/isolation)
- [ADR 0008 — Observability](0008-observability.md) (audit without logging content)
