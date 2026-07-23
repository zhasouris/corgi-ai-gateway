# Adding Vendors & Local LLMs

Everything the router routes to is **config**, not code — as long as the endpoint speaks the
OpenAI Chat Completions format. This guide covers adding a new cloud vendor, adding
individual models, and pointing the router at a **local** model (Ollama, vLLM, LM Studio,
llama.cpp), including the one non-obvious snag with keyless local endpoints.

Two files do the work:

- **`config/server.yaml`** — the **providers**: where to reach each vendor and how to talk to it.
- **`config/models.yaml`** — the **catalog**: the individual models and their routing metadata.

Both are validated at startup, so a mistake fails fast with a clear message rather than at
request time.

---

## 1. Add a provider

A provider is an upstream endpoint. Add an entry under `providers:` in `config/server.yaml`:

```yaml
providers:
  deepseek:
    base_url: https://api.deepseek.com/v1   # the OpenAI-compatible base URL
    api_key_env: DEEPSEEK_API_KEY            # env var holding the key (see below)
    adapter: openai                          # how to translate; `openai` = passthrough (default)
```

| Field | Meaning |
|---|---|
| `base_url` | The vendor's OpenAI-compatible base. The router appends `/chat/completions`. |
| `api_key_env` | **Name** of the environment variable that holds the key — never the key itself. |
| `adapter` | Which transformer to use. Optional; defaults to `openai`. |

**Keys never live in config.** `api_key_env` names an environment variable; the real value
goes in `.env` (gitignored). Add a matching placeholder to `.env.example` so the next person
knows it exists:

```bash
# .env
DEEPSEEK_API_KEY=sk-...
```

### Adapters (transformers)

The `adapter` field selects the vendor dialect ([ADR 0001](../decisions/0001-multi-provider-translation-strategy.md)):

| Adapter | Use for |
|---|---|
| `openai` (default) | OpenAI **and every OpenAI-compatible vendor** — Google (OpenAI endpoint), Mistral, DeepSeek, xAI, Groq, Together, Cohere, and local runtimes. This is the common case. |
| `anthropic` | Anthropic's native Messages API (translates OpenAI ⇄ Messages both ways, including streaming). |

If a vendor exposes an OpenAI-compatible endpoint, use `openai` and you are done. Only reach
for a native adapter when a vendor has no compatible endpoint or you want higher fidelity —
see the [transformers checklist](../transformers.md).

---

## 2. Add models

Each routable model is one entry under `models:` in `config/models.yaml`:

```yaml
  - id: deepseek-chat
    provider: deepseek            # must match a provider key in server.yaml
    tier: 3                       # 1 (cheapest/weakest) .. 5 (strongest)
    context_window: 65536         # max input tokens the model accepts
    max_output_tokens: 8192       # max it will generate
    cost_per_1k_input: 0.14       # USD per 1k input tokens
    cost_per_1k_output: 0.28      # USD per 1k output tokens
    avg_latency_ms: 900           # typical response latency; measure it
    capabilities: [tools, structured_output]
    # api_key_env: DEEPSEEK_API_KEY_CHAT   # optional — a per-model key (ADR 0007)
```

| Field | Drives |
|---|---|
| `tier` | Quality scoring — `quality`/`balanced` favour higher tiers on hard prompts. |
| `context_window` / `max_output_tokens` | A **hard constraint** — a request that won't fit is filtered out, never routed here. |
| `cost_per_1k_input` / `cost_per_1k_output` | The `cost` strategy and the demo's estimated cost. **Wrong prices don't error — they silently misroute.** Check them against the vendor's pricing page. |
| `avg_latency_ms` | The `latency` strategy's dominant term. |
| `capabilities` | Hard constraints: only `vision`, `tools`, `structured_output`, `audio`, `reasoning`. Claim only what the model genuinely supports — a vision request will never route to a model without `vision`. |

`api_key_env` on a **model** is optional: set it to give one model its own key (so the vendor
bills it separately — [ADR 0007](../decisions/0007-per-model-api-keys.md)); omit it to use the
provider default.

### Verify it before trusting it

Availability only checks that a **key is present** — not that the model **works**. A vendor
can retire a model id while the key still authenticates, and the request then 404s at forward
time. After adding models, probe them with a real call:

```bash
curl http://localhost:8000/v1/router/providers \
  -H "Authorization: Bearer $ROUTER_KEY"
```

`ok` means the key and the model both work; `bad_key` (401) means fix the credential;
`model_gone` (404) means the id is retired — fix the catalog. See
[the providers probe](../../src/probe.ts).

---

## 3. Local LLMs (Ollama, vLLM, LM Studio, llama.cpp)

Local runtimes expose an OpenAI-compatible endpoint, so they are just a provider with a
`localhost` base URL and the default adapter.

```yaml
# config/server.yaml
providers:
  ollama:
    base_url: http://localhost:11434/v1   # Ollama's OpenAI-compatible API
    api_key_env: OLLAMA_API_KEY
    adapter: openai
```

```yaml
# config/models.yaml
  - id: llama3.1:8b
    provider: ollama
    tier: 1
    context_window: 131072
    max_output_tokens: 8192
    cost_per_1k_input: 0.0        # self-hosted — no per-token cost
    cost_per_1k_output: 0.0
    avg_latency_ms: 300           # measure on your hardware
    capabilities: [tools]         # claim only what your model + runtime support
```

> Use the provider name **`ollama`**, **`local`**, or **`self_hosted`**. The scoring engine
> recognises those names and biases the `data_sensitivity` signal toward them — the
> foundation for routing sensitive data to a trusted local endpoint
> ([ADR 0009](../decisions/0009-sensitive-data-routing.md)).

### The keyless snag — read this

A local runtime needs **no API key**. But the router currently treats *"a key resolves"* as
*"this model is reachable"* — it powers the routable-model preference, the `available` flag on
`/v1/router/models`, and the 🟢/⚪ dots in the demo. So a local model with **no key set** is
marked unavailable and gets **scored but skipped**, the same fallback built for a missing
cloud key — misfiring on an endpoint that is genuinely up.

Until first-class keyless-provider support lands (roadmap: *Self-hosted / Ollama backends*),
the workaround is a **dummy key**:

```bash
# .env
OLLAMA_API_KEY=local      # any non-empty value; Ollama ignores the Authorization header
```

That marks the model routable and it forwards normally. It is a placeholder to satisfy the
reachability check, not a real credential.

### Two things that follow from `cost: 0.0`

- **A free local model wins `cost` and `latency` outright, every time.** That is usually the
  point of running local — but those strategies then stop considering cloud models at all.
  Be deliberate, especially if the local model is weaker than the cloud options.
- **You can make the whole routing decision local and free.** Point the classifier at the
  local model too:

  ```yaml
  # config/server.yaml
  classifier:
    provider: ollama
    model: llama3.1:8b
  ```

  Now no cloud call happens on the hot path — routing is fully offline. The trade-off is that
  a small local model classifies less accurately; measure it with `npm run eval:judge`
  before relying on it.

---

## Checklist

1. **`config/server.yaml`** — add the provider (`base_url`, `api_key_env`, `adapter`).
2. **`config/models.yaml`** — add the model(s); match `provider`, set honest `capabilities`
   and **verified** prices.
3. **`.env`** — set the key (or a dummy value for a keyless local endpoint); add a placeholder
   to **`.env.example`**.
4. Restart (config is read at startup). With Docker: `docker compose up -d --build`.
5. **`GET /v1/router/providers`** — confirm the key and every new model id actually answer.
6. **`GET /v1/router/models`** or the demo — confirm the new models show 🟢 and rank where
   you expect.

Nothing here is a code change — adding a vendor or a local model is an edit and a restart.

## Related

- [ADR 0001 — Multi-Provider Translation](../decisions/0001-multi-provider-translation-strategy.md) (adapters)
- [ADR 0007 — Per-Model API Keys](../decisions/0007-per-model-api-keys.md) (per-model billing)
- [ADR 0009 — Sensitive-Data Routing](../decisions/0009-sensitive-data-routing.md) (why local providers matter)
- [transformers.md](../transformers.md) (native adapter status & how to add one)
