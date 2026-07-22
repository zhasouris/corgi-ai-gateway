<#
.SYNOPSIS
  Deploy llm-model-router to Azure Container Apps.

.DESCRIPTION
  Three phases, each independently re-runnable:

    1. infra.bicep   - registry, Log Analytics, App Insights, ACA environment, identity
    2. az acr build  - builds the image *in Azure* from this repo (no local Docker needed)
    3. app.bicep     - the container app, wired to the image and to secrets from .env

  Secrets are read from the .env file at the repo root and passed as secure
  parameters. They are never written to a parameters file and never echoed.

.EXAMPLE
  ./deploy.ps1 -ResourceGroup rg-llm-router -Location eastus

.EXAMPLE
  ./deploy.ps1 -ResourceGroup rg-llm-router -Location eastus -DemoEnabled
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroup,

    [string]$Location = 'eastus',

    # Seeds the registry and app names.
    [ValidatePattern('^[a-z][a-z0-9]{2,16}$')]
    [string]$NamePrefix = 'llmrouter',

    # Defaults to the .env at the repo root.
    [string]$EnvFile,

    [string]$SubscriptionId,

    # Serve /demo and /v1/router/explain publicly. Off by default: those routes
    # are unauthenticated by design and every call spends classifier tokens.
    [switch]$DemoEnabled,

    [int]$MinReplicas = 0,
    [int]$MaxReplicas = 3,

    # Skip the image build and redeploy the app against an existing tag.
    [string]$ImageTag
)

$ErrorActionPreference = 'Stop'

# Join-Path takes only two path segments on Windows PowerShell 5.1.
$repoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path
if (-not $EnvFile) { $EnvFile = Join-Path $repoRoot '.env' }

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Write-Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }

# --- preflight -------------------------------------------------------------

Write-Step 'Preflight'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "The Azure CLI ('az') is not on PATH. Install from https://aka.ms/installazurecli, then run 'az login'."
}

$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) { throw "Not logged in. Run 'az login' first." }

if ($SubscriptionId) {
    az account set --subscription $SubscriptionId
    $account = az account show | ConvertFrom-Json
}
Write-Note "Subscription: $($account.name) [$($account.id)]"

# The containerapp commands live in an extension; install up front so the
# deployment does not stop halfway to prompt.
az extension add --name containerapp --upgrade --only-show-errors 2>$null | Out-Null
az provider register --namespace Microsoft.App --only-show-errors 2>$null | Out-Null
az provider register --namespace Microsoft.OperationalInsights --only-show-errors 2>$null | Out-Null

# --- secrets from .env -----------------------------------------------------

Write-Step 'Reading secrets'

if (-not (Test-Path $EnvFile)) {
    throw "Env file not found: $EnvFile. Copy .env.example to .env and fill in the provider keys."
}

$envMap = @{}
foreach ($line in Get-Content $EnvFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }
    $envMap[$trimmed.Substring(0, $idx).Trim()] = $trimmed.Substring($idx + 1).Trim()
}

function Get-EnvValue($name) {
    if ($envMap.ContainsKey($name)) { return $envMap[$name] }
    return ''
}

$routerApiKeys = Get-EnvValue 'ROUTER_API_KEYS'
if (-not $routerApiKeys) {
    throw @"
ROUTER_API_KEYS is empty in $EnvFile.

This deployment is publicly reachable with no gateway in front of it, so an
empty value would leave /v1/chat/completions open to the internet - anyone
could spend your provider credits. Set at least one bearer token and re-run.
"@
}

# Report which keys were found, never their values.
foreach ($k in @('OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLASSIFIER_API_KEY', 'ROUTER_API_KEYS')) {
    $state = if (Get-EnvValue $k) { 'set' } else { 'absent' }
    Write-Note ("{0,-24} {1}" -f $k, $state)
}

# --- 1. infrastructure -----------------------------------------------------

Write-Step "Resource group '$ResourceGroup' in $Location"
az group create --name $ResourceGroup --location $Location --only-show-errors --output none
if ($LASTEXITCODE -ne 0) { throw 'Could not create the resource group.' }

Write-Step 'Deploying infrastructure (infra.bicep)'
$infraJson = az deployment group create `
    --resource-group $ResourceGroup `
    --name "$NamePrefix-infra" `
    --template-file (Join-Path $PSScriptRoot 'infra.bicep') `
    --parameters "location=$Location" "namePrefix=$NamePrefix" `
    --query properties.outputs `
    --output json
if ($LASTEXITCODE -ne 0) { throw 'Infrastructure deployment failed.' }

$infra = $infraJson | ConvertFrom-Json
$acrName = $infra.acrName.value
$acrLoginServer = $infra.acrLoginServer.value
Write-Note "Registry:    $acrLoginServer"
Write-Note "Environment: $($infra.environmentId.value.Split('/')[-1])"

# --- 2. image --------------------------------------------------------------

if (-not $ImageTag) {
    $ImageTag = (& git -C $repoRoot rev-parse --short HEAD).Trim()
    if (-not $ImageTag) { $ImageTag = 'latest' }

    Write-Step "Building image in ACR (tag: $ImageTag)"
    Write-Note 'Built by Azure from this source tree - no local Docker required.'
    az acr build `
        --registry $acrName `
        --image "llm-model-router:$ImageTag" `
        --file (Join-Path $repoRoot 'Dockerfile') `
        --only-show-errors `
        $repoRoot
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed.' }
}
else {
    Write-Step "Skipping build, using existing tag: $ImageTag"
}

$image = "$acrLoginServer/llm-model-router:$ImageTag"

# --- 3. the app ------------------------------------------------------------

Write-Step 'Deploying container app (app.bicep)'

# Built as an array so a value containing spaces or punctuation cannot be
# re-split by the shell on its way to az.
$appParams = @(
    "location=$Location"
    "namePrefix=$NamePrefix"
    "environmentId=$($infra.environmentId.value)"
    "identityId=$($infra.identityId.value)"
    "acrLoginServer=$acrLoginServer"
    "appInsightsName=$($infra.appInsightsName.value)"
    "image=$image"
    "routerApiKeys=$routerApiKeys"
    "openaiApiKey=$(Get-EnvValue 'OPENAI_API_KEY')"
    "anthropicApiKey=$(Get-EnvValue 'ANTHROPIC_API_KEY')"
    "classifierApiKey=$(Get-EnvValue 'CLASSIFIER_API_KEY')"
    "demoEnabled=$($DemoEnabled.IsPresent.ToString().ToLower())"
    "minReplicas=$MinReplicas"
    "maxReplicas=$MaxReplicas"
)

$appJson = az deployment group create `
    --resource-group $ResourceGroup `
    --name "$NamePrefix-app" `
    --template-file (Join-Path $PSScriptRoot 'app.bicep') `
    --parameters $appParams `
    --query properties.outputs `
    --output json
if ($LASTEXITCODE -ne 0) { throw 'App deployment failed.' }

$appOut = $appJson | ConvertFrom-Json
$url = $appOut.url.value

# --- smoke test ------------------------------------------------------------

Write-Step 'Smoke test'

$healthy = $false
foreach ($attempt in 1..10) {
    try {
        $health = Invoke-WebRequest -Uri "$url/healthz" -TimeoutSec 20 -UseBasicParsing
        if ($health.StatusCode -eq 200) { $healthy = $true; break }
    }
    catch {
        Write-Note "waiting for the first revision to come up ($attempt/10)..."
        Start-Sleep -Seconds 10
    }
}

if ($healthy) {
    Write-Host '    /healthz   200 OK' -ForegroundColor Green
}
else {
    Write-Warning "/healthz did not answer. Check: az containerapp logs show -n $NamePrefix-app -g $ResourceGroup --follow"
}

# /v1/* must reject an unauthenticated call - it is the only thing standing
# between the public internet and your provider credits.
try {
    Invoke-WebRequest -Uri "$url/v1/models" -TimeoutSec 20 -UseBasicParsing | Out-Null
    Write-Warning '/v1/models answered WITHOUT a key - proxy auth is NOT protecting the API surface.'
}
catch {
    $code = $null
    if ($_.Exception.Response) { $code = $_.Exception.Response.StatusCode.value__ }
    if ($code -eq 401) {
        Write-Host '    /v1/models 401 without a key (auth is enforced)' -ForegroundColor Green
    }
    else {
        Write-Note "/v1/models returned $code"
    }
}

Write-Step 'Done'
Write-Host "  URL:     $url"
Write-Host "  Swagger: $url/docs"
if ($DemoEnabled) {
    Write-Host "  Demo:    $url/demo   (public, unauthenticated, spends classifier tokens)" -ForegroundColor Yellow
}
Write-Host "  Logs:    az containerapp logs show -n $NamePrefix-app -g $ResourceGroup --follow"
Write-Host "  Remove:  ./teardown.ps1 -ResourceGroup $ResourceGroup"
