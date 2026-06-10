/**
 * 模型路由服务
 * 提供四级模型配置降级链 + 供应商配置解析
 */

import { getSetting, getProviders } from './settings'

/** 解析后的模型配置 */
export interface ResolvedModelConfig {
  model: string | undefined
  channel: string | undefined
  apiKey: string | undefined
}

/**
 * 四级模型配置降级解析（消除 generateImage / generateShotImage / generateShotVideo 三处重复）
 * L1: input 参数 → L2: 项目配置 → L3: 全局 model_routes → L4a: 全局 provider/model → L4b: 自动匹配供应商
 */
export function resolveModelConfig(
  purposeKey: string,
  projectConfig: Record<string, any>,
  inputModel?: string,
  inputChannel?: string,
  inputApiKey?: string
): ResolvedModelConfig {
  let model = inputModel
  let channel = inputChannel
  let apiKey = inputApiKey

  // L1/L2: input 参数 + 项目配置
  if (!model || !channel) {
    const purposeConfig = projectConfig[purposeKey] || {}
    if (!model) model = purposeConfig.model
    if (!channel) channel = purposeConfig.channel
  }

  // L3: 全局模型路由（settings 中的 model_routes）
  if (!model || !channel) {
    const modelRoutesRaw = getSetting('model_routes')
    if (modelRoutesRaw) {
      try {
        const modelRoutes = JSON.parse(modelRoutesRaw as string)
        const routeConfig = modelRoutes[purposeKey]
        if (routeConfig) {
          if (!model && routeConfig.model) model = routeConfig.model
          if (!channel && routeConfig.channel) channel = routeConfig.channel
        }
      } catch { /* ignore parse error */ }
    }
  }

  // L4a: 全局默认（settings 中的 provider/model）
  if (!model || !channel) {
    const globalProvider = getSetting('provider')
    const globalModel = getSetting('model')
    if (globalProvider && globalModel) {
      if (!model) model = `${globalProvider}:${globalModel}`
      if (!channel) channel = globalProvider
    }
  }

  // L4b: 自动从供应商列表匹配第一个有 apiKey 的供应商
  if (!model || !channel) {
    const providers = getProviders()
    for (const p of providers) {
      const pApiKey = (p as any).apiKey
      if (pApiKey && p.baseURL) {
        const firstModel = p.models?.[0]
        if (firstModel) {
          const modelKey = typeof firstModel === 'string' ? firstModel : firstModel.key
          const pKey = p.key || p.id
          if (!channel) channel = pKey
          if (!model) model = `${pKey}:${modelKey}`
          break
        }
      }
    }
  }

  // 统一解析 providerKey，从供应商配置读取 apiKey
  let providerKey = channel || (model?.includes(':') ? model.split(':')[0] : '')
  if (!apiKey && providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.apiKey) apiKey = resolved.apiKey
  }

  // 修复：如果四级降级后仍拿不到 apiKey，强制清空 model/channel 重新自动匹配
  if (!apiKey) {
    model = undefined
    channel = undefined
    const providers = getProviders()
    for (const p of providers) {
      const pApiKey = (p as any).apiKey
      if (pApiKey && p.baseURL) {
        const firstModel = p.models?.[0]
        if (firstModel) {
          const modelKey = typeof firstModel === 'string' ? firstModel : firstModel.key
          const pKey = p.key || p.id
          channel = pKey
          model = `${pKey}:${modelKey}`
          break
        }
      }
    }
    providerKey = channel || (model?.includes(':') ? model.split(':')[0] : '')
    if (!apiKey && providerKey) {
      const resolved = resolveProviderConfig(providerKey)
      if (resolved?.apiKey) apiKey = resolved.apiKey
    }
  }

  return { model, channel, apiKey }
}

/**
 * 统一解析供应商配置：从用户配置 → 硬编码 fallback
 */
export function resolveProviderConfig(providerKey: string): { baseURL: string; apiKey: string } | null {
  if (!providerKey) return null

  // 1. 从用户配置的供应商中匹配（先按key/id）
  const userProviders = getProviders()
  let userProvider = userProviders.find((p: any) => p.key === providerKey || p.id === providerKey)

  // 兜底：旧数据可能存的是name，按name再匹配一次
  if (!userProvider) {
    userProvider = userProviders.find((p: any) => p.name === providerKey)
  }

  if (userProvider) {
    const apiKey = (userProvider as any)?.apiKey
    if (apiKey && userProvider.baseURL) {
      return { baseURL: userProvider.baseURL.trim(), apiKey }
    }
  }

  return null
}
