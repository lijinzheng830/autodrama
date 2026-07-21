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
      { key: 'qwen-image-plus', name: 'Qwen Image Plus', type: 'image', free: false },
      { key: 'qwen-image-2.0', name: 'Qwen Image 2.0 图编', type: 'image', free: true },
      { key: 'qwen-image-2.0-pro', name: 'Qwen Image 2.0 Pro 图编', type: 'image', free: false },
      { key: 'wan2.7-i2v-2026-04-25', name: 'Wan2.7 图生视频', type: 'video', free: true }
    ],
    implemented: true
  },
  {
    key: 'apimart',
    name: 'Apimart',
    baseURL: 'https://api.apib.ai/v1',
    models: [
      { key: 'gpt-image-2-official', name: 'GPT-Image-2 Official', type: 'image', free: false },
      { key: 'doubao-seedance-2.0', name: 'doubao-seedance-2.0', type: 'video', free: false },
      { key: 'grok-imagine-1.5-video-apimart', name: 'Grok Imagine Video 1.5', type: 'video', free: false }
    ],
    implemented: true
  },
  {
    key: 'wubianjie',
    name: '无边界AI',
    baseURL: 'https://api.lk888.ai/api/v1',
    models: [
      { key: 'gpt-image-2', name: 'GPT-Image-2', type: 'image', free: false },
      { key: 'grok-imagine-video-1.5-preview', name: 'grok-video-3.5', type: 'video', free: false }
    ],
    implemented: true
  },
  {
    key: 'hcc',
    name: 'HCC (HermesRoute)',
    baseURL: 'https://hermesroute.vwuxiameng.cn/v1',
    models: [
      { key: 'gpt-5.5', name: 'GPT-5.5', type: 'text', free: false },
      { key: 'gpt-5.4', name: 'GPT-5.4', type: 'text', free: false },
      { key: 'claude-opus-4-8', name: 'Claude Opus 4.8', type: 'text', free: false },
      { key: 'claude-opus-4-7', name: 'Claude Opus 4.7', type: 'text', free: false },
      { key: 'claude-opus-4-6', name: 'Claude Opus 4.6', type: 'text', free: false },
      { key: 'gpt-image-2', name: 'GPT-Image-2', type: 'image', free: false },
      { key: 'seedance-2-fast', name: 'Seedance 2 Fast', type: 'video', free: false }
    ],
    implemented: true
  },
  {
    key: 'manxueapi',
    name: '满血API',
    baseURL: 'https://manxueapi.com/v1',
    models: [
      { key: 'vyro-seedance-2-fast', name: 'Vyro Seedance 2.0 Fast', type: 'video', free: false }
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
