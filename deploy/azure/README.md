# Deploying to Azure

Deploys `llm-model-router` to **Azure Container Apps**, publicly reachable over
HTTPS, with **no gateway or app registration in front of it**.

```
internet ──HTTPS──▶ Container Apps ingress ──▶ router container (:8000)
                                                    │
                                    App Insights ◀──┘ (OpenTelemetry, ADR 0008)
```

## Two shapes

| | `-DemoOnly` (recommended) | Full proxy |
|---|---|---|
| Purpose | Publish the decision inspector | Actually route traffic |
| Keys deployed | Classifier only | Classifier + provider keys |
| `ROUTER_API_KEYS` | **Unset on purpose** | Required |
| `/demo`, `/v1/router/explain` | Public | Only with `-DemoEnabled` |
| `/v1/chat/completions` | **401 to everyone** | Bearer token required |
| Worst-case spend | One cheap classifier call per inspect | Real model calls |

### Demo-only

```powershell
./deploy.ps1 -ResourceGroup rg-llm-router -Location eastus -DemoOnly
```

This ships the classifier key and **no provider keys at all**, so nothing can
be forwarded upstream even in principle, and deliberately leaves
`ROUTER_API_KEYS` unset.

That last part is the non-obvious bit, and it is worth understanding rather
than trusting: **an empty key set does not disable auth.** `makeAuth` treats
`valid.size === 0` as "no token can ever match" and returns 401, so the whole
`/v1` surface is closed. The inspector still works because `/demo` and
`/v1/router/explain` are registered *ahead* of the auth middleware — Hono runs
matching handlers in registration order.

The container app's root URL lands on the inspector — `/` redirects to `/demo`
(302), so the hostname Azure hands you is the shareable link with no path to
remember. With the inspector off, `/` falls back to `/docs` instead.

The result is a public page that demonstrates the routing decision, and a
deployment whose maximum possible cost is one `gpt-4.1-nano` call per click.
`test/demoonly.test.ts` pins this posture so a future reordering of the routes
cannot quietly turn the inspector off — or the proxy on.

### Full proxy

```powershell
./deploy.ps1 -ResourceGroup rg-llm-router -Location eastus
```

Here the app is on the public internet with nothing in front of it, so its own
bearer auth is the only thing protecting it. `ROUTER_API_KEYS` must be set;
`deploy.ps1` refuses to run otherwise. Add `-DemoEnabled` to also expose the
inspector — but note that combination puts an unauthenticated, token-spending
endpoint on a public URL. `maxReplicas` bounds how fast that can run away, not
whether it can. The hostname contains a generated suffix, which is obscurity,
not security; crawlers find things.

## Prerequisites

- **Azure CLI** — <https://aka.ms/installazurecli>, then `az login`
- An Azure subscription you can create resource groups in
- `.env` at the repo root, populated (`cp .env.example .env`)
- **No local Docker required** — the image is built in Azure by `az acr build`

## Switches

| Switch | Default | Notes |
|---|---|---|
| `-Location` | `eastus` | Any region with Container Apps |
| `-NamePrefix` | `llmrouter` | Seeds all resource names; 3–17 lowercase alphanumerics |
| `-DemoOnly` | off | Inspector only: classifier key, no provider keys, `/v1` closed |
| `-DemoEnabled` | off | Exposes `/demo` + `/v1/router/explain` unauthenticated (implied by `-DemoOnly`) |
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
not wired in; its models stay in the catalog **for inspection** but cannot be
forwarded to. This is exactly what makes `-DemoOnly` work: the inspector ranks
all 32 models and explains the decision without any ability to act on it.

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
ingestion, and App Insights ingestion.

The variable cost is **provider tokens**, which is why the shape you pick
matters more than the Azure bill. Under `-DemoOnly` the ceiling is one
`gpt-4.1-nano` classifier call per inspection — fractions of a cent, and no
model call is even possible. Under the full proxy with `-DemoEnabled`, an
unauthenticated caller can trigger classifier calls at whatever rate
`maxReplicas` allows.

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
