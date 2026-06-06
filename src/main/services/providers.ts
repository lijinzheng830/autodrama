export interface Model {
  key: string
  name: string
  type: 'text' | 'image' | 'video'
  free: boolean
}

export interface Provider {
  key: string
  name: string
  baseURL: string
  models: Model[]
  implemented: boolean
}

export const PROVIDERS: Provider[] = []

export function getProvider(key: string): Provider | undefined {
  return PROVIDERS.find((p) => p.key === key)
}

export function getModel(providerKey: string, modelKey: string): Model | undefined {
  const provider = getProvider(providerKey)
  if (!provider) return undefined
  return provider.models.find((m) => m.key === modelKey)
}

export function getImplementedProviders(): Provider[] {
  return PROVIDERS.filter((p) => p.implemented)
}

export function getModelsForProvider(providerKey: string): Model[] {
  const provider = getProvider(providerKey)
  return provider ? provider.models : []
}
