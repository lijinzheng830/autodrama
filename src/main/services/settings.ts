import { getDb } from './db'
import { randomUUID } from 'crypto'
import type { Provider } from './providers'

export interface ProviderRecord extends Provider {
  id?: string
  created_at?: number
  updated_at?: number
}

export function getSetting(key: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function setSetting(key: string, value: string): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

// Providers CRUD
export function getProviders(): ProviderRecord[] {
  const raw = getSetting('providers')
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function addProvider(provider: ProviderRecord): ProviderRecord {
  const providers = getProviders()
  const id = randomUUID()
  const newProvider = { id, ...provider, created_at: Date.now() }
  providers.push(newProvider)
  setSetting('providers', JSON.stringify(providers))
  return newProvider
}

export function updateProvider(id: string, data: ProviderRecord): ProviderRecord {
  const providers = getProviders()
  const idx = providers.findIndex((p: ProviderRecord) => p.id === id)
  if (idx === -1) throw new Error('供应商不存在')
  providers[idx] = { ...providers[idx], ...data, updated_at: Date.now() }
  setSetting('providers', JSON.stringify(providers))
  return providers[idx]
}

export function deleteProvider(id: string): void {
  const providers = getProviders()
  const filtered = providers.filter((p: ProviderRecord) => p.id !== id)
  setSetting('providers', JSON.stringify(filtered))
}

// System prompt
export function getSystemPrompt(): string {
  return getSetting('system_prompt') || defaultSystemPrompt()
}

export function setSystemPrompt(prompt: string): void {
  setSetting('system_prompt', prompt)
}

function defaultSystemPrompt(): string {
  return `你是一位专业的影视分镜导演和剧本分析师。你的任务是将用户提供的剧本或故事文本，解析成结构化的分镜数据。

请按以下要求输出：
1. 将故事拆分为合理的章节
2. 每个章节拆分为多个分镜
3. 提取所有出现的角色、场景和道具
4. 为每个分镜生成画面描述、对白、首帧提示词和尾帧提示词

输出格式必须是合法的JSON。`
}
