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

export async function fetchRemoteConfig(): Promise<RemoteConfig | null> {
  // TODO: implement in MVP2
  return null
}

export function mergePresets(localTemplates: unknown[], _remoteTemplates: unknown[]): unknown[] {
  // TODO: implement in MVP2
  // 官方模板不动，远程新增的直接加
  return localTemplates
}
