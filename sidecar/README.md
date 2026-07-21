# RouteLLM signal sidecar

A persistent Python service that serves RouteLLM's trained **win-rate** (the
probability the strong model is needed) for a prompt, without calling any model.
The TS proxy consumes it via `RouteLLMProvider` (ADR 0006).

## Why a sidecar (not inline)

RouteLLM is Python and loads model weights that are expensive to initialize.
Spawning Python per request would reload the model every call. Instead this runs
as a **long-lived service** — weights load once at startup — and the TS app calls
it over localhost HTTP. See ADR 0006 and the eval-harness spec.

## Run

```bash
# from repo root
docker build -t routellm-sidecar ./sidecar
docker run --rm -p 8001:8001 -e OPENAI_API_KEY=$OPENAI_API_KEY routellm-sidecar
# first start downloads the mf router weights from HuggingFace
```

The `mf` router embeds prompts with OpenAI embeddings, so `OPENAI_API_KEY` is
required. Use `ROUTELLM_ROUTER=bert` for a fully local router (heavier compute).

## API

```
GET  /healthz          -> { status, router }
POST /score { prompt } -> { winRate, confidence, router }
```

## Show RouteLLM's score in the /demo page

The decision inspector (`/demo`) shows RouteLLM's win-rate alongside the classifier
signal when the sidecar is running and RouteLLM is enabled:

```bash
# start the sidecar + router together
docker compose --profile routellm up --build
```

Then enable RouteLLM on the router, either in `config/server.yaml`:

```yaml
routellm:
  enabled: true
  url: http://routellm-sidecar:8001
```

…or at runtime with `ROUTELLM_ENABLED=true` (and `ROUTELLM_URL` if the sidecar is
elsewhere). The demo's "RouteLLM (learned signal)" card then shows the win-rate and
confidence; if the sidecar is unreachable it shows "unavailable" (the router keeps working).

## Use with the eval harness

```bash
ROUTELLM_URL=http://localhost:8001 npm run eval -- --provider routellm
```

Compare its `report.md` against the heuristic run to measure the accuracy lift.
