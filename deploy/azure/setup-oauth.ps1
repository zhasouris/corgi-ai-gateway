<#
.SYNOPSIS
  Create and configure Microsoft Entra ID app registrations for the gateway's
  OAuth client-credentials auth (ADR 0015).

.DESCRIPTION
  Sets up two app registrations and wires them together:

    1. an API app for the gateway  — defines the audience and an app role
    2. a client app for a caller    — gets a secret, granted that app role

  Then prints the values to drop into the gateway's .env (AUTH_ISSUER /
  AUTH_AUDIENCE / AUTH_REQUIRED_SCOPE) and the caller's config (client id /
  secret / token endpoint / scope).

  Entra app-only (client-credentials) tokens carry the app role in the `roles`
  claim — which the gateway's scope check reads (ADR 0015). Idempotent: existing
  registrations with the same display name are reused, not duplicated.

  Requires the Azure CLI, `az login`, and permission to create app registrations
  (Application Developer or higher). It mutates your Entra tenant — review before
  running.

.EXAMPLE
  ./setup-oauth.ps1
.EXAMPLE
  ./setup-oauth.ps1 -ApiName corgi-ai-gateway -Scope router.invoke
.EXAMPLE
  ./setup-oauth.ps1 -Delete        # remove the two app registrations
#>
[CmdletBinding()]
param(
    [string]$ApiName = 'corgi-ai-gateway',
    [string]$ClientName = 'corgi-ai-gateway-client',
    # The app role value; becomes AUTH_REQUIRED_SCOPE on the gateway.
    [string]$Scope = 'router.invoke',
    [int]$SecretYears = 1,
    [string]$SubscriptionId,
    # Delete both app registrations instead of creating them.
    [switch]$Delete
)

$ErrorActionPreference = 'Stop'

function Write-Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Note($t) { Write-Host "    $t" -ForegroundColor DarkGray }

# --- preflight -------------------------------------------------------------

Write-Step 'Preflight'
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "The Azure CLI ('az') is not on PATH. Install from https://aka.ms/installazurecli, then run 'az login'."
}
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) { throw "Not logged in. Run 'az login' first." }
if ($SubscriptionId) { az account set --subscription $SubscriptionId }

$tenantId = (az account show --query tenantId -o tsv)
$issuer = "https://login.microsoftonline.com/$tenantId/v2.0"
$tokenEndpoint = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"
Write-Note "Tenant: $tenantId"

function App-Id($displayName) {
    az ad app list --filter "displayName eq '$displayName'" --query "[0].appId" -o tsv 2>$null
}

# --- delete mode -----------------------------------------------------------

if ($Delete) {
    Write-Step 'Deleting app registrations'
    foreach ($name in @($ClientName, $ApiName)) {
        $id = App-Id $name
        if ($id) { az ad app delete --id $id; Write-Note "deleted $name ($id)" }
        else { Write-Note "$name not found" }
    }
    Write-Host "`nDone." -ForegroundColor Green
    return
}

# --- 1. API app (the gateway / resource server) ----------------------------

Write-Step "API app registration '$ApiName'"
$apiAppId = App-Id $ApiName
if (-not $apiAppId) {
    $apiAppId = az ad app create --display-name $ApiName --sign-in-audience AzureADMyOrg --query appId -o tsv
    Write-Note "created ($apiAppId)"
}
else { Write-Note "reusing ($apiAppId)" }

$apiObjId = az ad app show --id $apiAppId --query id -o tsv
$identifierUri = "api://$apiAppId"

# Set the App ID URI (the audience) — the appId-based form needs no domain
# verification. Idempotent.
az ad app update --id $apiAppId --identifier-uris $identifierUri | Out-Null

# Define (or reuse) an app role with a stable id, and request v2 access tokens
# so the issuer/audience are clean (iss = .../v2.0).
$existingRole = az ad app show --id $apiAppId --query "appRoles[?value=='$Scope'] | [0].id" -o tsv 2>$null
$roleId = if ($existingRole) { $existingRole } else { [guid]::NewGuid().Guid }

$patch = @{
    api      = @{ requestedAccessTokenVersion = 2 }
    appRoles = @(@{
            allowedMemberTypes = @('Application')
            description        = "Callers holding this role may invoke the router ($Scope)."
            displayName        = $Scope
            id                 = $roleId
            isEnabled          = $true
            value              = $Scope
        })
} | ConvertTo-Json -Depth 6
$patchFile = New-TemporaryFile
Set-Content -Path $patchFile -Value $patch -Encoding utf8
az rest --method PATCH --url "https://graph.microsoft.com/v1.0/applications/$apiObjId" `
    --headers 'Content-Type=application/json' --body "@$patchFile" | Out-Null
Remove-Item $patchFile -Force
Write-Note "App ID URI: $identifierUri"
Write-Note "app role  : $Scope ($roleId)"

# The API needs a service principal to receive app-role assignments.
$apiSpId = az ad sp show --id $apiAppId --query id -o tsv 2>$null
if (-not $apiSpId) { $apiSpId = az ad sp create --id $apiAppId --query id -o tsv }

# --- 2. client app (a caller) ----------------------------------------------

Write-Step "Client app registration '$ClientName'"
$clientAppId = App-Id $ClientName
if (-not $clientAppId) {
    $clientAppId = az ad app create --display-name $ClientName --sign-in-audience AzureADMyOrg --query appId -o tsv
    Write-Note "created ($clientAppId)"
}
else { Write-Note "reusing ($clientAppId)" }

$clientSpId = az ad sp show --id $clientAppId --query id -o tsv 2>$null
if (-not $clientSpId) { $clientSpId = az ad sp create --id $clientAppId --query id -o tsv }

Write-Note 'resetting client secret...'
$clientSecret = az ad app credential reset --id $clientAppId --years $SecretYears --query password -o tsv

# --- 3. grant the app role to the client -----------------------------------

Write-Step 'Granting the app role to the client'
$assignBody = @{ principalId = $clientSpId; resourceId = $apiSpId; appRoleId = $roleId } | ConvertTo-Json
$assignFile = New-TemporaryFile
Set-Content -Path $assignFile -Value $assignBody -Encoding utf8
# Already-assigned returns 400/409 — treat as success.
try {
    az rest --method POST `
        --url "https://graph.microsoft.com/v1.0/servicePrincipals/$apiSpId/appRoleAssignedTo" `
        --headers 'Content-Type=application/json' --body "@$assignFile" 2>$null | Out-Null
    Write-Note 'granted'
}
catch { Write-Note 'already granted (or propagating) - continuing' }
Remove-Item $assignFile -Force

# --- output ----------------------------------------------------------------

Write-Step 'Done'
Write-Host ''
Write-Host '  Gateway .env (protects /v1):' -ForegroundColor Green
Write-Host "    AUTH_ISSUER=$issuer"
Write-Host "    AUTH_AUDIENCE=$identifierUri"
Write-Host "    AUTH_REQUIRED_SCOPE=$Scope"
Write-Host ''
Write-Host '  Caller credentials (keep the secret safe):' -ForegroundColor Green
Write-Host "    CLIENT_ID=$clientAppId"
Write-Host "    CLIENT_SECRET=$clientSecret"
Write-Host "    TOKEN_ENDPOINT=$tokenEndpoint"
Write-Host "    SCOPE=$identifierUri/.default"
Write-Host ''
Write-Host '  Get a token and call the gateway:' -ForegroundColor DarkGray
Write-Host '    ACCESS_TOKEN=$(curl -s -X POST "$TOKEN_ENDPOINT" \' -ForegroundColor DarkGray
Write-Host '      -d grant_type=client_credentials -d client_id="$CLIENT_ID" \' -ForegroundColor DarkGray
Write-Host '      -d client_secret="$CLIENT_SECRET" -d scope="$SCOPE" | jq -r .access_token)' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  NOTE: with v2 tokens the `aud` is usually the App ID URI above. If /v1' -ForegroundColor Yellow
Write-Host '  returns 401 on audience, decode the token at https://jwt.ms and set' -ForegroundColor Yellow
Write-Host '  AUTH_AUDIENCE to whatever its `aud` claim actually contains.' -ForegroundColor Yellow
Write-Host ''
Write-Host "  Remove later: ./setup-oauth.ps1 -Delete" -ForegroundColor DarkGray
