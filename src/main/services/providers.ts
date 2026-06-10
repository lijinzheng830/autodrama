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

export const PROVIDERS: Provider[] = [
  {
    key: 'dashscope',
    name: '阿里云 DashScope',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { key: 'qwen3.6-flash', name: 'Qwen 3.6 Flash', type: 'text', free: false },
      { key: 'qwen-plus', name: 'Qwen Plus', type: 'text', free: false },
      { key: 'qwen-image-plus', name: 'Qwen Image Plus', type: 'image', free: false }
    ],
    implemented: true
  }
]

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
