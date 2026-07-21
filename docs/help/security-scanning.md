# Security scanning (SAST + DAST)

Static analysis (SAST) runs on every push/PR + weekly; dynamic analysis (DAST)
runs the app and scans it, on a schedule + manual trigger. SAST findings appear in
**Security → Code scanning**; DAST results are workflow artifacts.

## SAST — what runs (`.github/workflows/security-sast.yml`)

| Job | Tool | Covers |
|---|---|---|
| CodeQL | GitHub CodeQL | JS/TS + Python code vulnerabilities (security-extended queries) |
| Semgrep | Semgrep OSS | code + secrets + OWASP Top-10 rulesets, plus custom rules below |
| gitleaks | gitleaks | secrets in the full git history |
| Trivy | Trivy | dependency CVEs, IaC/Dockerfile misconfig, secrets (filesystem scan) |
| Bandit | Bandit | Python SAST for the RouteLLM sidecar |
| hadolint | hadolint | Dockerfile linting (both images) |

Dependency updates + alerts come from **`.github/dependabot.yml`** (npm, pip,
docker, and github-actions).

## DAST — what runs (`.github/workflows/security-dast.yml`)

Brings the proxy up via `docker compose` (dummy provider keys — no real secrets)
and scans it. Runs weekly + on manual **workflow_dispatch** (Actions → security-dast
→ Run workflow), since it's slower than SAST.

| Step | Tool | Covers |
|---|---|---|
| OpenAPI fuzzing | Schemathesis | property-fuzzes every endpoint in `/openapi.json` — 500s, crashes, schema violations |
| Baseline scan | OWASP ZAP | header injection, missing security headers, common API/web issues |
| Auth boundary | curl assertions | `/v1/chat/completions` & `/v1/models` → 401 without a key; `/v1/router/explain` (demo) → 200 |

The auth-boundary assertions **hard-fail** the job on a regression (a real security
guarantee); Schemathesis and ZAP are informational and uploaded as the
`dast-reports` artifact. Upstream provider calls just 401 under the dummy key, so no
real LLM calls are made.

## Custom rules (`.semgrep/rules.yml`)

This proxy handles provider API keys and forwards user request bodies, so two
project-specific rules guard against leaking them:

- **no-secret-in-log** — flags logging an identifier named like a secret.
- **no-secret-in-span-attribute** — flags putting a secret on an OTel span.

Both are conservative exact-name matches (they won't flag benign names like
`inputTokens`).

## One manual step (highest value)

Turn on **secret-scanning push protection**:
Settings → Code security → *Secret scanning* → enable **Push protection**.
Given this repo handles API keys, this is the single most valuable control — it
blocks a key from being pushed in the first place. It's a repo setting, not a file.

## Reading results

- **Security → Code scanning** — CodeQL/Semgrep/Trivy/Bandit/hadolint findings (SARIF).
- **Security → Secret scanning** — gitleaks / GitHub secret detections.
- **Security → Dependabot** — vulnerable dependencies + update PRs.

## Notes

- Scans never need real secrets; they run offline on the code.
- Non-blocking by default (findings are reported, not hard-failing the build) so
  the pipeline stays green while you triage — tighten to blocking once the backlog
  is clean.
- The `.env` is gitignored and never scanned/committed; `.env.example` holds only
  placeholders.
