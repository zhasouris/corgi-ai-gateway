# Deploying to Azure

Deploys `llm-model-router` to **Azure Container Apps**, publicly reachable over
HTTPS, with **no gateway or app registration in front of it**.

```
internet ──HTTPS──▶ Container Apps ingress ──▶ router container (:8000)
                                                    │
                                    App Insights ◀──┘ (OpenTelemetry, ADR 0008)
```

## Read this before deploying

The app is on the public internet with nothing in front of it, so the app's
**own bearer auth is the only thing protecting it**. Two consequences:

1. **`ROUTER_API_KEYS` must be set** in `.env`. `deploy.ps1` refuses to run
   otherwise — an empty value disables auth (`auth.enabled` in `server.yaml`
   still gates it, but an empty key set means no valid tokens exist), which
   would leave `/v1/chat/completions` open to anyone who finds the URL and let
   them spend your provider credits.
2. **The demo is off by default.** `/demo` and `/v1/router/explain` are
   deliberately *unauthenticated* — that is what makes the inspector usable —
   but every call runs the classifier, which costs real tokens. Pass
   `-DemoEnabled` only if a public inspector is the point, and understand that
   an unauthenticated, LLM-spending endpoint on a public URL is an abuse
   vector. `maxReplicas` bounds how fast that can run away, not whether it can.

Neither of these is hypothetical: the URL is guessable-adjacent (it contains a
generated suffix, which is obscurity, not security) and crawlers do find things.

## Prerequisites

- **Azure CLI** — <https://aka.ms/installazurecli>, then `az login`
- An Azure subscription you can create resource groups in
- `.env` at the repo root, populated (`cp .env.example .env`)
- **No local Docker required** — the image is built in Azure by `az acr build`

## Deploy

```powershell
cd deploy/azure
./deploy.ps1 -ResourceGroup rg-llm-router -Location eastus
```

With the public inspector page:

```powershell
./deploy.ps1 -ResourceGroup rg-llm-router -Location eastus -DemoEnabled
```

Useful switches:

| Switch | Default | Notes |
|---|---|---|
| `-Location` | `eastus` | Any region with Container Apps |
| `-NamePrefix` | `llmrouter` | Seeds all resource names; 3–17 lowercase alphanumerics |
| `-DemoEnabled` | off | Exposes `/demo` + `/v1/router/explain` unauthenticated |
| `-MinReplicas` | `0` | Scale to zero — costs nothing idle, cold start on first hit |
| `-MaxReplicas` | `3` | Ceiling on concurrency, and on runaway spend |
| `-ImageTag` | git short SHA | Pass an existing tag to redeploy without rebuilding |
| `-SubscriptionId` | current | Target a specific subscription |

## What gets created

| Resource | Purpose |
|---|---|
| Container Registry (Basic) | Holds the image. Admin account **disabled** — the app pulls with a managed identity. |
| Log Analytics workspace | Container stdout/stderr, 30-day retention |
| Application Insights | Backend for the Azure Monitor OTel exporter the app already supports |
| User-assigned managed identity | `AcrPull` on the registry, so no registry credentials exist to leak |
| Container Apps environment | Runtime, wired to Log Analytics |
| Container App | The router: external ingress, HTTPS only, probes on `/healthz` |

## How the pieces fit

`deploy.ps1` runs three independently re-runnable phases:

1. **`infra.bicep`** — everything except the app. Separate because the app
   cannot be created until an image exists, and the registry is created here.
2. **`az acr build`** — builds the image *in Azure* from this source tree and
   tags it with the git short SHA, so a deployed revision is traceable to a commit.
3. **`app.bicep`** — the container app, wired to the image and to secrets.

Re-running is safe. To ship a code change, re-run `deploy.ps1`: it builds a new
tag and rolls a new revision.

## Secrets

Read from `.env` at deploy time and passed as `@secure()` parameters, so they
land in Container Apps secrets and are referenced by `secretRef` rather than
being inlined as environment values. They are never written to a parameters
file and never printed — the script reports only whether each key was *found*.

`.env` itself stays gitignored. Nothing in this folder contains a credential.

Provider keys are optional individually. A vendor whose key is absent simply is
not wired in; its models stay in the catalog for inspection but cannot be
forwarded to. `ROUTER_API_KEYS` is the one required value.

## Config overrides

`config/*.yaml` is baked into the image, so the deployment flips the few
switches that legitimately differ from local dev via environment variables
(handled centrally in `src/config.ts`):

| Variable | Set to | Why |
|---|---|---|
| `AZURE_MONITOR_ENABLED` | `true` | Turn on the App Insights exporter |
| `OTEL_CONSOLE_EXPORT` | `false` | Otherwise every span is duplicated into container stdout |
| `DEMO_ENABLED` | `-DemoEnabled` | Inspector off unless asked for |
| `ROUTELLM_ENABLED` | `false` | No sidecar in this deployment |

## Operating it

```powershell
# tail logs
az containerapp logs show -n llmrouter-app -g rg-llm-router --follow

# revisions
az containerapp revision list -n llmrouter-app -g rg-llm-router -o table

# roll back
az containerapp ingress traffic set -n llmrouter-app -g rg-llm-router --revision-weight <older-revision>=100
```

Traces, request metrics, and per-model cost attribution land in Application
Insights — see [docs/help/observability.md](../../docs/help/observability.md).

## Cost

With `-MinReplicas 0` the app scales to zero and the compute bill at rest is
nil; you pay for the registry (Basic, a few dollars a month), Log Analytics
ingestion, and App Insights ingestion. The real variable cost is **provider
tokens**, which is why the auth and demo warnings above matter more than the
Azure bill.

## Teardown

```powershell
./teardown.ps1 -ResourceGroup rg-llm-router
```

Deletes the whole resource group — registry, images, logs and App Insights
history included. It prints the contents and prompts before doing it.

## Not included

- Custom domain / TLS certificate (Container Apps gives you a `*.azurecontainerapps.io`
  hostname with a managed certificate)
- The RouteLLM sidecar (ADR 0006) — it needs a second container app and pulls
  PyTorch; the deployment sets `ROUTELLM_ENABLED=false`
- A CI/CD pipeline — this is a scripted manual deploy. GitHub Actions with OIDC
  federation to Azure would be the natural next step.
