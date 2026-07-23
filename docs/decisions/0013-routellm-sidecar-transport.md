# ADR 0013 — RouteLLM Sidecar Transport: Keep the HTTP Service, Fix the Embedding Hop

- **Status:** Accepted (decision to keep the HTTP sidecar; local-embedding optimization is an open follow-up)
- **Date:** 2026-07-23
- **Context repo:** `corgi-gateway`

## Context

[ADR 0006](0006-leveraging-learned-routing.md) runs RouteLLM as a persistent Python service
that the TypeScript router calls over HTTP. Now that the sidecar sits on the `latency`
strategy's hot path ([ADR 0012](0012-classifier-latency.md)), its ~250 ms cost is worth
questioning — and the obvious question is: **would a CLI replace the HTTP API cheaply and
make it faster?**

The answer turns entirely on *where the 250 ms actually goes*, which we measured rather than
assumed:

| What | Time |
|---|---|
| `batch_calculate_win_rate` called directly, in the container | 0.16–0.39 s |
| `/score` over HTTP **from inside the container** | 0.17–0.22 s |
| Container-to-container (`router → routellm-sidecar:8001`) | ~180–300 ms |
| The win-rate matrix-factorization math itself | ~0 ms |
| Host → published port (Windows Docker Desktop) | 2.2 s ← a measurement artifact, not real |

The two decisive facts:

1. **The transport adds nothing.** `/score` over HTTP from inside the container (~0.2 s) is
   indistinguishable from calling the function directly (~0.16–0.39 s). FastAPI, uvicorn and
   the Docker network are already free.
2. **The cost is the embedding call.** The `mf` router embeds the prompt via OpenAI's
   embeddings API on every score. That external round trip (~200 ms) *is* the ~250 ms.

So the transport is not the bottleneck, and changing it cannot help.

## Decision

**Keep the persistent HTTP sidecar. Do not move to a CLI or a co-process. The real latency
lever is the embedding call, not the transport.**

### Why a per-request CLI is worse, not cheaper

Invoking `python score.py "<prompt>"` per request re-pays, *every call*, the cost the
persistent server pays **once at boot**:

- Python interpreter startup (~200 ms),
- `import torch` (**1–3 s on its own**),
- loading the RouteLLM checkpoint from the HuggingFace cache (seconds).

That turns a ~250 ms call into a multi-second one. The sidecar is a long-lived service
precisely to amortize this — its own docstring says it "loads a trained RouteLLM router once
at startup." A per-request CLI throws that amortization away. **Rejected outright.**

### Why a persistent co-process doesn't help either

A subtler variant: Node spawns one long-lived Python process and talks to it over
stdin/stdout instead of HTTP. This keeps the model loaded, so it avoids the CLI's fatal
flaw — but it only removes the transport, and the transport is already ~0 ms. **No latency
win.** It also costs:

- Node now owns a Python subprocess lifecycle: crash detection, restart, backpressure.
- Concurrency regresses. One stdin/stdout pipe serializes requests behind Python's GIL;
  uvicorn services them in parallel today (three concurrent `/score` calls complete in about
  the time of one).
- Process-boundary isolation is weaker than a separate container's.

The *one* thing a co-process buys is operational: no second container, no internal ingress,
no `ROUTELLM_URL` — on a demo-only Azure deployment it would collapse two container apps into
one. That is a deployment-simplicity argument, not a latency one, and it is outweighed by the
subprocess-management and concurrency costs. **Rejected for now; revisit only if
single-container deployment becomes a hard requirement.**

### The real lever — a local embedding model

The ~200 ms that dominates is the OpenAI embeddings round trip. Replacing it with a **local
embedding model** in the sidecar (e.g. a small `sentence-transformers` model, ~10–50 ms on
CPU) is where the latency actually is. It also:

- **removes RouteLLM's dependency on `OPENAI_API_KEY`**, which today blocks running the
  sidecar in the `-DemoOnly` Azure deployment (that deployment ships no provider keys), and
- makes the win-rate fully offline and deterministic given the checkpoint.

Combined with prompt-hash caching ([ADR 0012](0012-classifier-latency.md), Layer 1), this
takes RouteLLM from ~250 ms to well under 100 ms cold and ~0 ms on a repeat — without
touching the transport at all.

## Consequences

**Positive**

- The HTTP sidecar's clean process isolation, independent scaling, and parallel request
  handling are retained.
- The team is pointed at the change that actually moves the number (embedding) instead of the
  one that feels structural but does not (transport).
- A local embedding model would additionally unblock RouteLLM in demo-only deployments.

**Negative / accepted trade-offs**

- **The two-container deployment stays.** RouteLLM remains a separate service with its own
  image (PyTorch, ~GB) and its own `ROUTELLM_URL` wiring. We accept that operational weight
  in exchange for isolation and concurrency.
- **A local embedding model changes the signal.** RouteLLM's `mf` router was trained with a
  specific embedding; substituting a different one may shift win-rates. This must be
  validated against the judged eval before it replaces the OpenAI embedding, not assumed
  equivalent — the same discipline ADR 0012 demanded.
- **Recording a rejection has a shelf life.** If single-container deployment ever becomes a
  hard requirement (e.g. an environment that forbids sidecars), the co-process trade-off
  should be re-opened — this ADR rejects it on *today's* priorities, not permanently.

## Follow-ups / TODO

- [ ] Prototype a local embedding model in the sidecar; measure latency **and** judged
      accuracy vs. the OpenAI-embedding baseline.
- [ ] If accuracy holds, drop the sidecar's `OPENAI_API_KEY` dependency and enable RouteLLM
      in the demo-only Azure deployment.
- [ ] Prompt-hash cache in front of `/score` (shared with [ADR 0012](0012-classifier-latency.md) Layer 1).
- [ ] Only if single-container deployment becomes mandatory: revisit the stdin/stdout
      co-process, with an explicit plan for concurrency (a process pool) and lifecycle.

## Related

- [ADR 0006 — Leveraging Learned Routing (RouteLLM)](0006-leveraging-learned-routing.md) (established the HTTP sidecar)
- [ADR 0012 — Classifier Latency](0012-classifier-latency.md) (put RouteLLM on the hot path; the ~2.2 s measurement artifact; caching)
- [ADR 0008 — Observability](0008-observability.md) (measuring the embedding vs. transport split as span attributes)
