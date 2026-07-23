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

# NB: do NOT set $ErrorActionPreference='Stop'. `az` writes warnings and
# not-found probes to stderr, which Windows PowerShell turns into terminating
# errors under Stop. Critical steps are guarded with explicit exit-code checks.

function Write-Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Note($t) { Write-Host "    $t" -ForegroundColor DarkGray }
function Assert-Ok($msg) { if ($LASTEXITCODE -ne 0) { throw $msg } }

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
    Assert-Ok 'Failed to create the API app registration.'
    Write-Note "created ($apiAppId)"
}
else { Write-Note "reusing ($apiAppId)" }

$apiObjId = az ad app show --id $apiAppId --query id -o tsv
$identifierUri = "api://$apiAppId"

# Set the App ID URI (the audience) — the appId-based form needs no domain
# verification. Idempotent.
az ad app update --id $apiAppId --identifier-uris $identifierUri | Out-Null
Assert-Ok "Failed to set the App ID URI ($identifierUri)."

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
Assert-Ok 'Failed to configure the API app (token version / app role).'
Remove-Item $patchFile -Force
Write-Note "App ID URI: $identifierUri"
Write-Note "app role  : $Scope ($roleId)"

# The API needs a service principal to receive app-role assignments. `sp list`
# returns [] cleanly when absent (no stderr), unlike `sp show`.
$apiSpId = az ad sp list --filter "appId eq '$apiAppId'" --query "[0].id" -o tsv
if (-not $apiSpId) {
    $apiSpId = az ad sp create --id $apiAppId --query id -o tsv
    Assert-Ok 'Failed to create the API service principal.'
}

# --- 2. client app (a caller) ----------------------------------------------

Write-Step "Client app registration '$ClientName'"
$clientAppId = App-Id $ClientName
if (-not $clientAppId) {
    $clientAppId = az ad app create --display-name $ClientName --sign-in-audience AzureADMyOrg --query appId -o tsv
    Assert-Ok 'Failed to create the client app registration.'
    Write-Note "created ($clientAppId)"
}
else { Write-Note "reusing ($clientAppId)" }

$clientSpId = az ad sp list --filter "appId eq '$clientAppId'" --query "[0].id" -o tsv
if (-not $clientSpId) {
    $clientSpId = az ad sp create --id $clientAppId --query id -o tsv
    Assert-Ok 'Failed to create the client service principal.'
}

Write-Note 'resetting client secret...'
$clientSecret = az ad app credential reset --id $clientAppId --years $SecretYears --query password -o tsv
Assert-Ok 'Failed to create the client secret.'

# --- 3. grant the app role to the client -----------------------------------

Write-Step 'Granting the app role to the client'
$assignBody = @{ principalId = $clientSpId; resourceId = $apiSpId; appRoleId = $roleId } | ConvertTo-Json
$assignFile = New-TemporaryFile
Set-Content -Path $assignFile -Value $assignBody -Encoding utf8

# Verify first — an already-present assignment makes the POST a no-op we skip.
$already = az rest --method GET `
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/$apiSpId/appRoleAssignedTo" `
    --query "value[?appRoleId=='$roleId' && principalId=='$clientSpId'] | [0].id" -o tsv 2>$null
if ($already) {
    Write-Note 'already granted'
}
else {
    # A freshly-created client SP can take a few seconds to be assignable; retry.
    $granted = $false
    foreach ($attempt in 1..6) {
        az rest --method POST `
            --url "https://graph.microsoft.com/v1.0/servicePrincipals/$apiSpId/appRoleAssignedTo" `
            --headers 'Content-Type=application/json' --body "@$assignFile" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $granted = $true; break }
        Write-Note "grant attempt $attempt failed (principal propagating) - retrying..."
        Start-Sleep -Seconds 5
    }
    if ($granted) { Write-Note 'granted' }
    else { throw "Could not assign the '$Scope' app role to the client. Re-run this script to retry." }
}
Remove-Item $assignFile -Force

# --- output ----------------------------------------------------------------

Write-Step 'Done'
Write-Host ''
Write-Host '  Gateway .env (protects /v1):' -ForegroundColor Green
Write-Host "    AUTH_ISSUER=$issuer"
# v2 access tokens carry the bare appId GUID in `aud` (not the api:// URI, which
# is only used to request the scope). Verified against a live token.
Write-Host "    AUTH_AUDIENCE=$apiAppId"
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
Write-Host '  NOTE: AUTH_AUDIENCE is the bare appId GUID - that is what a v2 access' -ForegroundColor Yellow
Write-Host '  token carries in `aud`. The api:// URI is only the resource identifier' -ForegroundColor Yellow
Write-Host '  used to request the .default scope. If you ever see a 401 on audience,' -ForegroundColor Yellow
Write-Host '  decode the token at https://jwt.ms and match AUTH_AUDIENCE to its `aud`.' -ForegroundColor Yellow
Write-Host ''
Write-Host "  Remove later: ./setup-oauth.ps1 -Delete" -ForegroundColor DarkGray
