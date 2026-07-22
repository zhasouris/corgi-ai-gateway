<#
.SYNOPSIS
  Delete everything this deployment created, by removing its resource group.

.DESCRIPTION
  Deliberately blunt: the deployment puts every resource in one resource group,
  so removing the group removes all of it — registry, images, logs, App
  Insights history included. There is no partial teardown.

.EXAMPLE
  ./teardown.ps1 -ResourceGroup rg-llm-router
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroup,

    [string]$SubscriptionId,

    # Return immediately instead of waiting for the delete to finish.
    [switch]$NoWait
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "The Azure CLI ('az') is not on PATH."
}

if ($SubscriptionId) { az account set --subscription $SubscriptionId }

$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) { throw "Not logged in. Run 'az login' first." }

$exists = az group exists --name $ResourceGroup | ConvertFrom-Json
if (-not $exists) {
    Write-Host "Resource group '$ResourceGroup' does not exist. Nothing to do."
    return
}

Write-Host "About to DELETE resource group '$ResourceGroup'" -ForegroundColor Yellow
Write-Host "  Subscription: $($account.name) [$($account.id)]" -ForegroundColor Yellow
Write-Host ""
Write-Host "Contents:" -ForegroundColor Yellow
az resource list --resource-group $ResourceGroup --query "[].{name:name, type:type}" --output table

if ($PSCmdlet.ShouldProcess($ResourceGroup, 'Delete resource group and all resources in it')) {
    # Not $args - that is an automatic variable in PowerShell.
    $azArgs = @('group', 'delete', '--name', $ResourceGroup, '--yes')
    if ($NoWait) { $azArgs += '--no-wait' }
    az @azArgs
    Write-Host "Deleted." -ForegroundColor Green
}
