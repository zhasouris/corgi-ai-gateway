// ---------------------------------------------------------------------------
// RouteLLM signal sidecar (ADR 0006) as a second container app.
//
// Internal ingress only: nothing outside the Container Apps environment can
// reach it. The router addresses it as http://<name> over the environment's
// internal DNS, which is why the app name is part of the contract.
//
// It loads a trained router from HuggingFace at startup and answers a win-rate
// for a prompt without calling any model — but the `mf` router does embed the
// prompt via OpenAI, so this container needs an OpenAI key even though it never
// runs a completion.
//
// Scope: resource group.
// ---------------------------------------------------------------------------

param location string = resourceGroup().location

@minLength(3)
@maxLength(17)
param namePrefix string = 'llmrouter'

param environmentId string
param identityId string
param acrLoginServer string

@description('Fully qualified sidecar image reference.')
param image string

@description('Used by the mf router to embed prompts. No completion is ever run with it.')
@secure()
param openaiApiKey string

@description('RouteLLM router type. mf = matrix factorization (ADR 0006).')
param routerType string = 'mf'

@description('Weights are downloaded from HuggingFace and the model is loaded at startup, which takes minutes. At 0 the sidecar sheds that state when idle and the first inspection after a scale-down reports RouteLLM as unavailable while it warms up; at 1 it stays resident and always answers, but bills continuously.')
param minReplicas int = 1

param maxReplicas int = 1

param tags object = {
  application: 'corgi-ai-gateway'
  component: 'routellm-sidecar'
  managedBy: 'bicep'
}

resource sidecar 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-sidecar'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        // Internal: reachable only from inside the environment.
        external: false
        targetPort: 8001
        transport: 'auto'
        allowInsecure: true
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: acrLoginServer
          identity: identityId
        }
      ]
      secrets: [
        {
          name: 'openai-api-key'
          value: openaiApiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'sidecar'
          image: image
          env: [
            {
              name: 'OPENAI_API_KEY'
              secretRef: 'openai-api-key'
            }
            {
              name: 'ROUTELLM_ROUTER'
              value: routerType
            }
          ]
          // PyTorch plus the downloaded checkpoint. Under-provisioning memory
          // here shows up as the container being killed mid-load, which reads
          // like a crash loop rather than an OOM.
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          probes: [
            {
              // /healthz answers 200 with status:"loading" before the model is
              // ready, so this only proves the process is alive — readiness is
              // deliberately left off and callers get a 503 from /score until
              // the controller has loaded. The router treats that as "signal
              // unavailable" and carries on.
              type: 'Liveness'
              httpGet: {
                path: '/healthz'
                port: 8001
              }
              initialDelaySeconds: 120
              periodSeconds: 30
              failureThreshold: 5
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output sidecarName string = sidecar.name
// Internal DNS name within the environment. Ingress listens on 80 regardless of
// the container's target port.
output internalUrl string = 'http://${sidecar.name}'
