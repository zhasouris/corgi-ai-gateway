# Security scanning (SAST)

Static analysis runs in CI on every push/PR (and weekly). Findings appear in the
repo's **Security → Code scanning** tab. DAST (running-app scanning) is a planned
follow-up; this covers the static side.

## What runs (`.github/workflows/security-sast.yml`)

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
