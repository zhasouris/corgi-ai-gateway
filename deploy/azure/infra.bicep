// ---------------------------------------------------------------------------
// corgi-gateway — Azure infrastructure (everything except the app itself).
//
// Split from app.bicep on purpose: the container app can't be created until an
// image exists in the registry, and the registry is created here. Deploy this
// first, push the image, then deploy app.bicep.
//
// Scope: resource group.
// ---------------------------------------------------------------------------

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Prefix for resource names. Lowercase letters and digits only.')
@minLength(3)
@maxLength(17)
param namePrefix string = 'llmrouter'

@description('Log Analytics retention, in days.')
param logRetentionDays int = 30

param tags object = {
  application: 'corgi-gateway'
  managedBy: 'bicep'
}

// A registry name must be globally unique and alphanumeric-only.
var acrName = toLower('${replace(namePrefix, '-', '')}acr${uniqueString(resourceGroup().id)}')
var lawName = '${namePrefix}-logs'
var appInsightsName = '${namePrefix}-insights'
var environmentName = '${namePrefix}-env'
var identityName = '${namePrefix}-identity'

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    // The container app authenticates with a managed identity instead, so the
    // shared admin account stays off (it is a long-lived credential).
    adminUserEnabled: false
  }
}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: logRetentionDays
  }
}

// Workspace-based Application Insights — the backend for the Azure Monitor
// OpenTelemetry exporter the app already supports (ADR 0008).
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

// User-assigned identity, so the container app can pull from ACR without the
// registry admin credentials.
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output environmentId string = containerEnv.id
output identityId string = identity.id
output appInsightsName string = appInsights.name
output logAnalyticsName string = law.name
