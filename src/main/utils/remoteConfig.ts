/**
 * 远程配置模块
 * MVP1：空实现，预留接口
 * MVP2：接入远程配置拉取逻辑
 */

export interface RemoteConfig {
  version: number
  prompt_templates?: unknown[]
  model_defaults?: Record<string, unknown>
  system_prompt?: string
}

// TODO(MVP2): 实现远程配置拉取 — 从 CDN/API 拉取最新模型推荐和提示词模板
export async function fetchRemoteConfig(): Promise<RemoteConfig | null> {
  return null
}

// TODO(MVP2): 实现智能合并 — 官方模板不动，远程新增直接加，自定义冲突保留用户版本
export function mergePresets(localTemplates: unknown[], _remoteTemplates: unknown[]): unknown[] {
  return localTemplates
}
