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
    key: 'qwen',
    name: '阿里云百炼',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    implemented: true,
    models: [
      { key: 'qwen3.6-flash', name: 'Qwen3.6 Flash', type: 'text', free: true },
      { key: 'qwen3.5-plus', name: 'Qwen3.5 Plus', type: 'text', free: false },
      { key: 'qwen3.6-max-preview', name: 'Qwen3.6 Max', type: 'text', free: false }
    ]
  },
  {
    key: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseURL: 'https://api.moonshot.cn/v1',
    implemented: false,
    models: [
      { key: 'moonshot-v1-8k', name: 'Moonshot 8K', type: 'text', free: true },
      { key: 'moonshot-v1-32k', name: 'Moonshot 32K', type: 'text', free: false },
      { key: 'moonshot-v1-128k', name: 'Moonshot 128K', type: 'text', free: false }
    ]
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    implemented: false,
    models: [
      { key: 'deepseek-chat', name: 'DeepSeek Chat', type: 'text', free: true },
      { key: 'deepseek-reasoner', name: 'DeepSeek Reasoner', type: 'text', free: false }
    ]
  }
]

export function getProvider(key: string): Provider | undefined {
  return PROVIDERS.find(p => p.key === key)
}

export function getModel(providerKey: string, modelKey: string): Model | undefined {
  const provider = getProvider(providerKey)
  if (!provider) return undefined
  return provider.models.find(m => m.key === modelKey)
}

export function getImplementedProviders(): Provider[] {
  return PROVIDERS.filter(p => p.implemented)
}

export function getModelsForProvider(providerKey: string): Model[] {
  const provider = getProvider(providerKey)
  return provider ? provider.models : []
}
