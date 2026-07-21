import { getDb } from './db'
import { logger } from '../utils/logger'
import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import type { Provider } from './providers'

export interface ProviderRecord extends Provider {
  id?: string
  apiKey?: string  // 用户配置时传入，存储在 providers JSON 中
  created_at?: number
  updated_at?: number
}

/** 加密 API Key，返回 base64 编码的密文 */
function encryptApiKey(plainText: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('safeStorage 不可用，API Key 将以明文存储')
    return plainText
  }
  return safeStorage.encryptString(plainText).toString('base64')
}

/** 解密 API Key，返回明文 */
function decryptApiKey(cipherText: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return cipherText
  }
  try {
    return safeStorage.decryptString(Buffer.from(cipherText, 'base64'))
  } catch {
    // 解密失败说明是旧版明文数据，直接返回原值
    return cipherText
  }
}

export function getSetting(key: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return null
  return key.startsWith('apikey') ? decryptApiKey(row.value) : row.value
}

export function setSetting(key: string, value: string): void {
  const db = getDb()
  const encryptedValue = key.startsWith('apikey') ? encryptApiKey(value) : value
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, encryptedValue)
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
  if (!id) return
  const providers = getProviders()
  const filtered = providers.filter((p: ProviderRecord) => p.id !== id && p.key !== id)
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
  return `你是一位专业的影视剧分镜师，擅长将剧本拆解为可执行的分镜列表。将用户提供的剧本文本拆分为分镜列表。

## 拆解规则

### 章节
按剧本自然段落拆分为章节，每章5-15个分镜。情感转折/高潮拆细，过渡可合并。

### shot_description（画面描述）
中文。只写纯视觉内容，不含镜头语言、不含对白。具体到人/物/位置/姿态。

### dialogue（对白）
格式"角色名：台词（语气）"。语气如（急切）（冷淡）（哽咽）。旁白用"旁白：内容"。无则留空。

### narration（旁白/独白）
内心独白或画外音原文。无则留空。

### shot_type（景别）7选1，必须填
大远景 / 远景 / 全景 / 中景 / 近景 / 特写 / 大特写
环境交代用远景，对话用中近景，情绪强调用特写。

### camera_movement（运镜）8选1，必须填
固定 / 缓慢推进 / 缓慢拉远 / 左摇 / 右摇 / 跟随 / 环绕 / 升降
静态对话用"固定"，运动用"跟随"，揭露用"缓慢推进"。

### character_actions（角色动作）
JSON数组：[{"character_name":"角色名","action":"具体动词+程度副词"}]
如"缓缓转身""猛地站起"。禁止模糊词。无动作写"静立"。

### lighting_mood（光影氛围）必须填
光线条件+情绪氛围。如"暖金色侧光，柔和明亮"。

### first_frame_prompt / last_frame_prompt
英文。包含景别、角色站位、表情/动作、场景、光影、构图方式。这是发给AI生图API的指令。
示例："Medium shot of Lin Xiaowei standing center stage, gentle expression, warm golden spotlight, LED wall behind, soft bokeh, rule of thirds"
first_frame_prompt_zh / last_frame_prompt_zh 是中文版本。

### video_prompt
英文。描述镜头运动和转场。
video_prompt_zh 是中文版本。

## 输出格式
严格JSON数组，每项一个分镜：
[{
  "shot_description": "中文画面描述",
  "dialogue": "角色名：台词（语气）",
  "narration": "旁白内容",
  "shot_type": "中景",
  "camera_movement": "固定",
  "lighting_mood": "暖金色聚光灯，柔和明亮",
  "character_actions": [{"character_name":"林小薇","action":"静立"}],
  "first_frame_prompt": "English prompt for image generation API",
  "first_frame_prompt_zh": "中文首帧提示词",
  "last_frame_prompt": "English last frame prompt",
  "last_frame_prompt_zh": "中文尾帧提示词",
  "video_prompt": "English video prompt",
  "video_prompt_zh": "中文视频提示词",
  "used_character_names": ["角色名"],
  "used_scene_name": "场景名",
  "used_prop_names": ["道具名"]
}]`

}
