import { getDb } from './db'
import { getProviders } from './settings'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { jsonrepair } from 'jsonrepair'
import { logger } from '../utils/logger'

// 文本 AI 超时（剧本解析/角色提取/关联/翻译）
const TEXT_AI_TIMEOUT = 600_000

const TEMPLATE_FILES: Record<string, string> = {
  script_parse: 'v0-01-script-parse.md',
  seedance_9grid: 'v0-02-seedance-9grid.md',
  era_detect: 'v0-02-era-detect.md',
  asset_extract: 'v1-12-asset-extract.md',
  character_image: 'v1-04-character-image.md',
  scene_image: 'v1-05-scene-image.md',
  prop_image: 'v1-06-prop-image.md',
  grid_storyboard: 'v1-07-grid-storyboard.md',
  video_director: 'v1-15-video-director.md',
  translate_cn_to_en: 'v0-06-translate-cn-en.md',
  script_review_check: 'v0-03-script-review-check.md',
  script_review_fix_all: 'v0-04-script-review-fix-all.md',
  script_review_fix_one: 'v0-05-script-review-fix-one.md',
}

/** 从文件加载提示词模板，未找到则回退到给定的默认值 */
export function loadPromptTemplate(usage: string, fallback: string): string {
  const fileName = TEMPLATE_FILES[usage]
  if (!fileName) return fallback
  const tryPaths = [
    join(app.getAppPath(), 'main', 'data', 'prompt-templates'),
    join(app.getAppPath(), 'src', 'main', 'data', 'prompt-templates'),
    join(app.getAppPath(), '..', 'src', 'main', 'data', 'prompt-templates'),
    join(__dirname, '..', 'data', 'prompt-templates'),
    join(__dirname, 'data', 'prompt-templates'),
  ]
  for (const dir of tryPaths) {
    try {
      const p = join(dir, fileName)
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8').trim()
        logger.info(`[loadPromptTemplate] ${usage} loaded from ${p} (${content.length} chars, starts: ${content.slice(0, 50)})`)
        return content
      }
    } catch { /* continue */ }
  }
  logger.warn(`[loadPromptTemplate] ${usage}: template file ${fileName} NOT FOUND, using fallback (${fallback.length} chars)`)
  return fallback
}

export interface AutoProcessOptions {
  promptTemplate?: string
  era?: string
  aspectRatio?: string
  model?: string
  mode?: 'full' | 'append'
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ProgressData {
  step: number
  status: 'running' | 'done' | 'error'
  message: string
}

export interface ShotDataChapter {
  title?: string
  shots: {
    frame_index?: number
    description?: string
    description_zh?: string
    description_en?: string
    dialogue?: string
    inner_monologue?: string
    narration?: string
    shot_type?: string
    shot_scene?: string
    camera_movement?: string
    camera_angle?: string
    lighting_mood?: string
    character_actions?: string
    video_prompt?: string
    video_prompt_zh?: string
  }[]
}

export interface ShotData {
  chapters: ShotDataChapter[]
}

export interface ExtractData {
  characters?: { name?: string; description?: string }[]
  scenes?: { name?: string; description?: string }[]
  props?: { name?: string; description?: string }[]
}

export interface AssocItem {
  chapter_index?: number
  shot_index?: number
  character_names?: string[]
  scene_name?: string
  prop_names?: string[]
}

export interface AssocData {
  associations?: AssocItem[]
}

export interface AIConfig {
  provider: string
  model: string
  apiKey: string
}

export function getAIConfig(): AIConfig {
  const db = getDb()
  const providerRow = db.prepare("SELECT value FROM settings WHERE key = 'provider'").get() as
    | { value: string }
    | undefined
  const modelRow = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as
    | { value: string }
    | undefined
  const provider = providerRow?.value || 'qwen'
  const model = modelRow?.value || 'qwen3.6-flash'
  const apiKeyRow = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(`api_key_${provider}`) as { value: string } | undefined
  return {
    provider,
    model,
    apiKey: apiKeyRow?.value || ''
  }
}

export async function callAI(
  messages: AIMessage[],
  providerKey?: string,
  modelKey?: string
): Promise<string> {
  const config = getAIConfig()
  let provider = providerKey || config.provider
  let model = modelKey || config.model

  // 如果 model 是 "provider:modelKey" 格式，拆分
  if (model && model.includes(':')) {
    const parts = model.split(':')
    provider = parts[0]
    model = parts.slice(1).join(':')
  }

  // 从用户配置的供应商中匹配（优先）
  const userProviders = getProviders()
  const userProvider = userProviders.find((p) => p.key === provider || p.id === provider)

  let baseURL = userProvider?.baseURL
  let apiKey = userProvider?.apiKey || config.apiKey

  if (!baseURL) {
    throw new Error(`未找到供应商配置: ${provider}`)
  }
  if (!apiKey) {
    throw new Error(`未配置 ${provider} 的 API Key，请前往设置页面配置`)
  }

  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`

  /** 判断错误是否可重试（瞬态：超时/5xx/429/网络） */
  const isRetryable = (err: unknown): boolean => {
    if (err instanceof Error && err.name === 'AbortError') return true
    const m = err instanceof Error ? err.message : String(err)
    return /5\d\d|429|fetch|重试/.test(m)
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TEXT_AI_TIMEOUT)

    try {
      logger.info(`[ai] Attempt ${attempt + 1}: POST ${url} model=${model}`)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          top_p: 1,
          seed: 1024,
          frequency_penalty: 0,
          presence_penalty: 0,
          max_tokens: 32000,
        }),
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (!response.ok) {
        const status = response.status
        let errMsg = `API请求失败`
        let rawErr = ''
        try {
          const errData = await response.json()
          rawErr = errData.error?.message || ''
          errMsg = rawErr || errMsg
        } catch {
          // ignore
        }

        if (status === 401) {
          throw new Error(`API Key 无效 (401: ${rawErr || errMsg})`)
        } else if (status === 429) {
          throw new Error(`请求过于频繁，请稍后再试 (429: ${rawErr || errMsg})`)
        } else if (status === 402 || status === 403) {
          throw new Error(`API 余额不足或权限受限 (${status}: ${rawErr || errMsg})`)
        } else if (status >= 500) {
          throw new Error(`AI 服务暂时不可用 (${status}: ${rawErr || errMsg})`)
        } else {
          throw new Error(`AI 调用失败 (${status}: ${rawErr || errMsg})`)
        }
      }

      const data = await response.json()
      const content = validateChatResponse(data)
      return content
    } catch (err: unknown) {
      clearTimeout(timeout)
      lastErr = err

      // 不可重试的错误立即抛出
      const msg = err instanceof Error ? err.message : String(err)
      if (/API Key|余额|权限|未找到供应商|未配置/.test(msg)) throw err

      // 可重试：退避后继续
      if (attempt < 2 && isRetryable(err)) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }

      // 最后一次尝试或不可重试 → 格式化错误消息
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`AI 调用超时（${TEXT_AI_TIMEOUT / 1000}秒），请检查网络或换用更快的模型`)
      }

      const errName = err instanceof Error ? err.name : ''
      if (errName === 'TypeError' || msg.includes('fetch')) {
        logger.error(`[ai] fetch failed to ${url} model=${model} err=${msg} attempt=${attempt + 1}`)
        lastErr = new Error(`网络连接失败: ${msg}`)
        continue
      }

      throw new Error(`AI 调用出错: ${msg}`)
    }
  }

  throw lastErr
}

/** 校验 OpenAI 兼容 chat/completions 响应结构，提取 content */
function validateChatResponse(data: unknown): string {
  if (!data || typeof data !== 'object') {
    throw new Error('AI 返回格式异常：非 JSON 对象')
  }
  const d = data as Record<string, unknown>
  const choices = d.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('AI 返回缺少 choices 数组')
  }
  const first = choices[0] as Record<string, unknown> | undefined
  const message = first?.message
  if (!message || typeof message !== 'object') {
    throw new Error('AI 返回缺少 message 字段')
  }
  const content = (message as Record<string, unknown>).content
  if (typeof content !== 'string' || !content.trim()) {
    logger.error('[callAI] Unexpected response:', JSON.stringify(data).substring(0, 500))
    throw new Error('AI 返回内容为空，请重试')
  }
  return content
}

function cleanJSON(text: string): string {
  let cleaned = text.trim()
  // 移除 markdown 代码块标记
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  // 去除 JSON 外的解释文字（保留旧版边界提取逻辑）
  const jsonStart = cleaned.search(/[\{\[]/)
  if (jsonStart > 0) cleaned = cleaned.slice(jsonStart)
  const lastBrace = cleaned.lastIndexOf('}')
  const lastBracket = cleaned.lastIndexOf(']')
  const jsonEnd = Math.max(lastBrace, lastBracket)
  if (jsonEnd > 0 && jsonEnd < cleaned.length - 1) cleaned = cleaned.slice(0, jsonEnd + 1)
  // LLM 格式问题交给 jsonrepair（缺引号、单引号、多余逗号、混合编码等）
  try {
    return jsonrepair(cleaned)
  } catch {
    logger.error('[cleanJSON] jsonrepair failed, raw text:', cleaned.slice(0, 500))
    throw new Error('无法从AI返回内容中提取有效JSON，请重试')
  }
}

export function extractJSON(text: string): string {
  // 尝试直接解析
  try {
    JSON.parse(text)
    return text
  } catch {
    // continue
  }

  // 提取 ```json ... ``` 或 ``` ... ``` 包裹的内容
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    const candidate = cleanJSON(codeBlockMatch[1])
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // continue
    }
  }

  // 尝试 cleaning 后直接解析
  {
    const candidate = cleanJSON(text)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // continue
    }
  }

  // 提取第一个 { 到最后一个 } 之间的内容
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleanJSON(text.slice(firstBrace, lastBrace + 1))
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // continue
    }
  }

  // 提取第一个 [ 到最后一个 ] 之间的内容
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const candidate = cleanJSON(text.slice(firstBracket, lastBracket + 1))
    try { JSON.parse(candidate); return candidate } catch { /* fall through */ }
  }

  // 调试：记录无法解析的内容前 500 个字符
  logger.error('[extractJSON] 无法提取有效的JSON。AI返回前500字符:', text.substring(0, 500))

  throw new Error('无法从AI返回内容中提取有效JSON，请重试')
}
