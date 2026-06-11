import { getDb } from './db'
import { getProviders } from './settings'
import { STORYBOARD_PROMPT, EXTRACT_PROMPT } from './prompts'
import { updateProjectScript, Character, Scene, Prop } from './project'
import { checkLicense } from '../utils/license'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'

// 文本 AI 超时（剧本解析/角色提取/关联/翻译）
const TEXT_AI_TIMEOUT = 30_000

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
    shot_index?: number
    description?: string
    description_zh?: string
    dialogue?: string
    narration?: string
    shot_type?: string
    camera_movement?: string
    lighting_mood?: string
    first_frame_prompt?: string
    first_frame_prompt_zh?: string
    last_frame_prompt?: string
    last_frame_prompt_zh?: string
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
  // LICENSE CHECK
  if (!checkLicense()) {
    console.warn('License check failed, but allowing AI call in MVP1')
  }

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
  const userProvider = userProviders.find((p: any) => p.key === provider || p.id === provider)

  let baseURL = userProvider?.baseURL
  let apiKey = (userProvider as any)?.apiKey || config.apiKey

  if (!baseURL) {
    throw new Error(`未找到供应商配置: ${provider}`)
  }
  if (!apiKey) {
    throw new Error(`未配置 ${provider} 的 API Key，请前往设置页面配置`)
  }

  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TEXT_AI_TIMEOUT)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        response_format: { type: 'json_object' }
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
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error('[callAI] Unexpected response structure:', JSON.stringify(data).substring(0, 500))
      throw new Error('AI 返回内容为空，请重试')
    }
    return content
  } catch (err: unknown) {
    clearTimeout(timeout)

    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('AI 调用超时（500秒），请检查网络或换用更快的模型')
    }

    const errMsg = err instanceof Error ? err.message : String(err)
    const errName = err instanceof Error ? err.name : ''

    if (errMsg.includes('请')) {
      throw err
    }

    if (errName === 'TypeError' || errMsg.includes('fetch')) {
      throw new Error(`网络连接失败: ${errMsg}`)
    }

    throw new Error(`AI 调用出错: ${errMsg}`)
  }
}

function cleanJSON(text: string): string {
  // 移除 BOM 和首尾空白
  let cleaned = text.trim()
  // 移除 markdown 代码块标记（可能跨多行或单行）
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  // 修复常见问题：尾部多余逗号
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')
  // 修复单引号键名
  cleaned = cleaned.replace(/'([^']+)'\s*:/g, '"$1":')
  // 修复没有引号的键名
  cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
  // 移除 JSON 前后的解释性文字（尝试找到真正的 JSON 起始位置）
  const jsonStart = cleaned.search(/[\{\[]/)
  if (jsonStart > 0) {
    cleaned = cleaned.slice(jsonStart)
  }
  const lastBrace = cleaned.lastIndexOf('}')
  const lastBracket = cleaned.lastIndexOf(']')
  const jsonEnd = Math.max(lastBrace, lastBracket)
  if (jsonEnd > 0 && jsonEnd < cleaned.length - 1) {
    cleaned = cleaned.slice(0, jsonEnd + 1)
  }
  return cleaned.trim()
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
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // continue
    }
  }

  // 调试：记录无法解析的内容前 500 个字符
  console.error('[extractJSON] 无法提取有效的JSON。AI返回前500字符:', text.substring(0, 500))

  throw new Error('无法从AI返回内容中提取有效JSON，请重试')
}

// ========== 数据规范化 ==========

function normalizeShotData(raw: any): ShotData {
  if (!raw || typeof raw !== 'object') return { chapters: [] }

  // AI 直接返回数组 [{shot_description: ..., ...}] → 包装为章节
  if (Array.isArray(raw) && raw.length > 0 && !raw[0]?.shots) {
    return {
      chapters: [{
        title: '第1章',
        shots: raw.map((s: any, i: number) => {
          const desc = s.shot_description || s.description || ''
          const descZh = s.description_zh || s.shot_description || ''
          const st = s.shot_type || ''
          const cm = s.camera_movement || ''
          const lm = s.lighting_mood || ''
          // character_actions 从对象格式转为数组
          let charActions = s.character_actions
          if (charActions && typeof charActions === 'object' && !Array.isArray(charActions)) {
            charActions = Object.entries(charActions).map(([name, action]) => ({ character_name: name, action }))
          }
          const charActionsStr = Array.isArray(charActions) ? JSON.stringify(charActions) : ''
          // 自动生成 first_frame_prompt（如果 AI 没提供）
          const ffPrompt = s.first_frame_prompt || s.firstFramePrompt || `${st} shot: ${desc}${lm ? ', ' + lm : ''}`
          const ffPromptZh = s.first_frame_prompt_zh || descZh
          const lfPrompt = s.last_frame_prompt || s.lastFramePrompt || `${st} shot, closing composition: ${desc}`
          const lfPromptZh = s.last_frame_prompt_zh || descZh
          const vPrompt = s.video_prompt || s.videoPrompt || `${cm || 'static'} camera, ${desc}. Smooth cinematic motion.`
          const vPromptZh = s.video_prompt_zh || descZh

          return {
            shot_index: s.shot_index ?? s.shot_id ?? i + 1,
            description: desc,
            description_zh: descZh,
            dialogue: s.dialogue || '',
            narration: s.narration || '',
            shot_type: st,
            camera_movement: cm,
            lighting_mood: lm,
            character_actions: charActionsStr,
            first_frame_prompt: ffPrompt,
            first_frame_prompt_zh: ffPromptZh,
            last_frame_prompt: lfPrompt,
            last_frame_prompt_zh: lfPromptZh,
            video_prompt: vPrompt,
            video_prompt_zh: vPromptZh
          }
        })
      }]
    }
  }

  // Already has chapters array → return as-is
  if (Array.isArray(raw.chapters)) {
    return {
      chapters: raw.chapters.map((ch: any) => ({
        title: ch.title || ch.scene_name || '',
        shots: (ch.shots || []).map((s: any, i: number) => ({
          shot_index: s.shot_index ?? s.shot_id ?? i + 1,
          description: s.description || '',
          dialogue: s.dialogue || '',
          narration: s.narration || '',
          shot_type: s.shot_type || '',
          camera_movement: s.camera_movement || '',
          lighting_mood: s.lighting_mood || '',
          first_frame_prompt: s.first_frame_prompt || s.firstFramePrompt || '',
          first_frame_prompt_zh: s.first_frame_prompt_zh || '',
          last_frame_prompt: s.last_frame_prompt || s.lastFramePrompt || '',
          last_frame_prompt_zh: s.last_frame_prompt_zh || '',
          video_prompt: s.video_prompt || s.videoPrompt || '',
          video_prompt_zh: s.video_prompt_zh || ''
        }))
      }))
    }
  }

  // Has scenes array → convert to chapters
  if (Array.isArray(raw.scenes)) {
    const hasShots = raw.scenes.some((sc: any) => sc.shots && sc.shots.length > 0)
    if (hasShots) {
      return {
        chapters: raw.scenes.map((sc: any) => ({
          title: sc.scene_name || sc.title || sc.name || '',
          shots: (sc.shots || []).map((s: any, i: number) => ({
            shot_index: s.shot_index ?? s.shot_id ?? i + 1,
            description: s.description || '',
            dialogue: s.dialogue || '',
            shot_type: s.shot_type || '',
            camera_movement: s.camera_movement || '',
            lighting_mood: s.lighting_mood || '',
            first_frame_prompt: s.first_frame_prompt || s.firstFramePrompt || '',
            first_frame_prompt_zh: s.first_frame_prompt_zh || '',
            last_frame_prompt: s.last_frame_prompt || s.lastFramePrompt || '',
            last_frame_prompt_zh: s.last_frame_prompt_zh || '',
            video_prompt: s.video_prompt || s.videoPrompt || '',
            video_prompt_zh: s.video_prompt_zh || ''
          }))
        }))
      }
    }
    return {
      chapters: [{
        title: '第1章',
        shots: raw.scenes.map((sc: any, i: number) => ({
          shot_index: sc.shot_index ?? sc.id ?? sc.shot_id ?? i + 1,
          description: sc.description || '',
          dialogue: sc.dialogue || '',
          shot_type: sc.shot_type || '',
          camera_movement: sc.camera_movement || '',
          lighting_mood: sc.lighting_mood || '',
          first_frame_prompt: sc.first_frame_prompt || sc.firstFramePrompt || '',
          first_frame_prompt_zh: sc.first_frame_prompt_zh || '',
          last_frame_prompt: sc.last_frame_prompt || sc.lastFramePrompt || '',
          last_frame_prompt_zh: sc.last_frame_prompt_zh || '',
          video_prompt: sc.video_prompt || sc.videoPrompt || '',
          video_prompt_zh: sc.video_prompt_zh || ''
        }))
      }]
    }
  }

  return { chapters: [] }
}

// ========== 程序化关联（替代 AI 第三步，准确率远高于 AI 判断）==========

/** 从文本中检测所有已知名词的出现 */
function findNamesInText(text: string, names: string[]): string[] {
  if (!text) return []
  return names.filter(n => text.includes(n))
}

/** 程序化关联：扫描每个镜头的对白/旁白/描述/动作，精确匹配角色/场景/道具名 */
function buildAssociations(shotsData: ShotData, extractData: ExtractData): AssocData {
  const charNames = (extractData.characters || []).map(c => (c.name || '').trim()).filter(Boolean)
  const sceneNames = (extractData.scenes || []).map(s => (s.name || '').trim()).filter(Boolean)
  const propNames = (extractData.props || []).map(p => (p.name || '').trim()).filter(Boolean)

  const associations: AssocItem[] = []

  // 用于场景传播：同一章内未匹配的镜头继承最近的已知场景
  let lastKnownScene = ''

  const chapters = shotsData.chapters || []
  for (let ci = 0; ci < chapters.length; ci++) {
    const shots = chapters[ci].shots || []
    for (const shot of shots) {
      // 收集该镜头所有可搜索文本
      const searchText = [
        shot.dialogue || '',
        shot.narration || '',
        shot.description || '',
        (shot as any).description_zh || '',
        (shot as any).first_frame_prompt_zh || '',
        (shot as any).last_frame_prompt_zh || '',
        // character_actions 里的角色名
        ((shot as any).character_actions || [])
          .map((a: any) => a.character_name || '')
          .join(' '),
      ].join(' ')

      // 角色匹配：文本中出现角色名 → 关联
      const matchedChars = findNamesInText(searchText, charNames)
      // 额外：对白/旁白中解析"角色名："前缀
      const dialogueNarration = (shot.dialogue || '') + ' ' + (shot.narration || '')
      const prefixNames = (dialogueNarration.match(/(?<=^|[。！？])\s*([^。！？：:]+)[：:]/g) || [])
        .map(m => m.replace(/[。！？\s：:]/g, '').trim())
        .filter(n => charNames.includes(n))
      const allCharNames = [...new Set([...matchedChars, ...prefixNames])]

      // 场景匹配
      let matchedScene = findNamesInText(searchText, sceneNames)[0] || ''
      if (!matchedScene) {
        // 传播上一镜头的场景
        matchedScene = lastKnownScene
      } else {
        lastKnownScene = matchedScene
      }

      // 道具匹配
      const matchedProps = findNamesInText(searchText, propNames)

      associations.push({
        chapter_index: ci,
        shot_index: shot.shot_index || 0,
        character_names: allCharNames,
        scene_name: matchedScene,
        prop_names: matchedProps,
      })
    }
  }

  return { associations }
}

// ========== 自动挡流程 ==========

export async function autoProcess(
  projectId: string,
  script: string,
  onProgress: (data: ProgressData) => void,
  sendProgress: (data: ProgressData) => void,
  options?: AutoProcessOptions
): Promise<{ shotsData: ShotData; extractData: ExtractData; assocData: AssocData }> {
  const db = getDb()
  const mode = options?.mode || 'full'

  // 保存剧本到项目
  try {
    if (mode === 'append') {
      const existing = db
        .prepare('SELECT script_text FROM projects WHERE id = ?')
        .get(projectId) as { script_text: string } | undefined
      const combined =
        (existing?.script_text || '') + (existing?.script_text ? '\n\n' : '') + script
      updateProjectScript(projectId, combined)
    } else {
      updateProjectScript(projectId, script)
    }
  } catch {
    // 忽略保存失败
  }

  // 更新 era / aspectRatio
  if (options?.era) {
    db.prepare('UPDATE projects SET era = ? WHERE id = ?').run(options.era, projectId)
  }
  if (options?.aspectRatio) {
    db.prepare('UPDATE projects SET aspect_ratio = ? WHERE id = ?').run(
      options.aspectRatio,
      projectId
    )
  }

  let storyboardPrompt = options?.promptTemplate || STORYBOARD_PROMPT
  // 确保 prompt 包含 "json" 关键词，满足 response_format: json_object 的要求
  if (!/json/i.test(storyboardPrompt)) {
    storyboardPrompt += '\n请以 JSON 格式返回'
  }
  const modelOverride = options?.model

  // 步骤1：分镜
  onProgress({ step: 1, status: 'running', message: '正在分析剧本、拆分镜头...' })
  sendProgress({ step: 1, status: 'running', message: '正在分析剧本、拆分镜头...' })

  const shotsResult = await callAI(
    [
      { role: 'system', content: storyboardPrompt },
      { role: 'user', content: script }
    ],
    undefined,
    modelOverride
  )
  let shotsData: ShotData
  try {
    const extracted = extractJSON(shotsResult)
    // 始终保存 AI 原始响应用于调试
    const fs = await import('fs')
    const logPath = join(app.getPath('userData'), 'ai_shot_response.json')
    fs.writeFileSync(logPath, extracted, 'utf8')
    shotsData = JSON.parse(extracted)
    // Normalize: AI may return different structures depending on the template
    shotsData = normalizeShotData(shotsData)
  } catch (e) {
    const fs = await import('fs')
    const logPath = join(app.getPath('userData'), 'ai_response_debug.log')
    fs.writeFileSync(logPath, shotsResult, 'utf8')
    console.error('[autoProcess] 分镜步骤 JSON 提取失败. 完整响应已写入:', logPath)
    console.error('[autoProcess] Parse error:', (e as Error).message)
    throw e
  }

  onProgress({ step: 1, status: 'done', message: '分析剧本、拆分镜头 完成' })
  sendProgress({ step: 1, status: 'done', message: '分析剧本、拆分镜头 完成' })

  // 步骤2：提取角色、场景和道具
  onProgress({ step: 2, status: 'running', message: '正在提取角色、场景和道具...' })
  sendProgress({ step: 2, status: 'running', message: '正在提取角色、场景和道具...' })

  const extractResult = await callAI(
    [
      { role: 'system', content: EXTRACT_PROMPT },
      { role: 'user', content: JSON.stringify(shotsData) }
    ],
    undefined,
    modelOverride
  )
  let extractData: ExtractData
  try {
    const fs = await import('fs')
    const logPath = join(app.getPath('userData'), 'ai_extract_response.json')
    fs.writeFileSync(logPath, extractJSON(extractResult), 'utf8')
    extractData = JSON.parse(extractJSON(extractResult))
  } catch (e) {
    console.error('[autoProcess] 提取步骤 JSON 提取失败. AI返回前1000字符:', extractResult.substring(0, 1000))
    console.error('[autoProcess] Parse error:', (e as Error).message)
    throw e
  }

  onProgress({ step: 2, status: 'done', message: '提取角色、场景和道具 完成' })
  sendProgress({ step: 2, status: 'done', message: '提取角色、场景和道具 完成' })

  // 步骤3：程序化关联（替代AI——精确匹配，不受AI幻觉影响）
  onProgress({ step: 3, status: 'running', message: '正在关联角色、场景和道具到分镜...' })
  sendProgress({ step: 3, status: 'running', message: '正在关联角色、场景和道具到分镜...' })

  const assocData: AssocData = buildAssociations(shotsData, extractData)

  onProgress({ step: 3, status: 'done', message: '关联角色、场景和道具到分镜 完成' })
  sendProgress({ step: 3, status: 'done', message: '关联角色、场景和道具到分镜 完成' })

  // 步骤4：保存到数据库
  onProgress({ step: 4, status: 'running', message: '正在保存项目...' })
  sendProgress({ step: 4, status: 'running', message: '正在保存项目...' })

  await saveToDatabase(projectId, shotsData, extractData, assocData, mode)

  onProgress({ step: 4, status: 'done', message: '完成！' })
  sendProgress({ step: 4, status: 'done', message: '完成！' })

  return { shotsData, extractData, assocData }
}

// 检测提示词是否有效（非占位、非过长指令）
function isValidPrompt(prompt?: string): boolean {
  if (!prompt || !prompt.trim()) return false
  const p = prompt.trim()
  if (p.includes('占位')) return false
  if (p.length > 1500) return false  // 过长的是模板指令文本
  // 如果以markdown标题或指令开头，视为无效
  if (/^(#{1,3}\s|##\s|你是一名|你是|核心|任务)/.test(p)) return false
  return true
}

// 根据分镜描述自动生成首帧/尾帧提示词
function buildAutoFramePrompt(description: string, frameType: 'first' | 'last', charNames: string[], sceneName: string): string {
  const parts: string[] = []
  if (sceneName) parts.push(`in ${sceneName}`)
  if (charNames.length > 0) parts.push(`featuring ${charNames.join(', ')}`)
  const context = parts.length > 0 ? parts.join(', ') : ''
  const prefix = frameType === 'first' ? 'Opening shot' : 'Closing shot'
  return `${prefix}: ${description}${context ? ', ' + context : ''}`
}

// 自动生成视频提示词
function buildAutoVideoPrompt(description: string, charNames: string[], sceneName: string): string {
  const parts: string[] = [description]
  if (sceneName) parts.push(`Scene: ${sceneName}`)
  if (charNames.length > 0) parts.push(`Characters: ${charNames.join(', ')}`)
  parts.push('Smooth camera movement, cinematic lighting, 4 seconds')
  return parts.join('. ')
}

async function saveToDatabase(
  projectId: string,
  shotsData: ShotData,
  extractData: ExtractData,
  assocData: AssocData,
  mode: 'full' | 'append' = 'full'
): Promise<void> {
  const db = getDb()

  // 预先查询已有资产（名称 → ID 映射），用于「只创建、不覆盖」
  const existingChars = db
    .prepare('SELECT * FROM characters WHERE project_id = ?')
    .all(projectId) as Character[]
  const existingScenes = db
    .prepare('SELECT * FROM scenes WHERE project_id = ?')
    .all(projectId) as Scene[]
  const existingProps = db
    .prepare('SELECT * FROM props WHERE project_id = ?')
    .all(projectId) as Prop[]

  const existingCharMap = new Map<string, string>()
  for (const c of existingChars) existingCharMap.set(c.name.trim(), c.id)

  const existingSceneMap = new Map<string, string>()
  for (const s of existingScenes) existingSceneMap.set(s.name.trim(), s.id)

  const existingPropMap = new Map<string, string>()
  for (const p of existingProps) existingPropMap.set(p.name.trim(), p.id)

  // append 模式：获取已有最大 chapter_index
  let existingMaxChapterIndex = -1
  if (mode === 'append') {
    const row = db
      .prepare('SELECT MAX(chapter_index) as max FROM chapters WHERE project_id = ?')
      .get(projectId) as { max: number } | undefined
    existingMaxChapterIndex = row?.max ?? -1
  }

  db.transaction(() => {
    // 1. full 模式：清空分镜+角色+场景+道具数据；append 模式：保留已有
    if (mode === 'full') {
      const oldShots = db
        .prepare(
          `SELECT s.id FROM shots s JOIN chapters c ON s.chapter_id = c.id WHERE c.project_id = ?`
        )
        .all(projectId) as { id: string }[]
      for (const s of oldShots) {
        db.prepare('DELETE FROM shot_characters WHERE shot_id = ?').run(s.id)
        db.prepare('DELETE FROM shot_scenes WHERE shot_id = ?').run(s.id)
        db.prepare('DELETE FROM shot_props WHERE shot_id = ?').run(s.id)
      }
      db.prepare(
        'DELETE FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)'
      ).run(projectId)
      db.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId)
      // full 模式同时清空角色/场景/道具，确保 description_zh 等字段全新
      db.prepare('DELETE FROM characters WHERE project_id = ?').run(projectId)
      db.prepare('DELETE FROM scenes WHERE project_id = ?').run(projectId)
      db.prepare('DELETE FROM props WHERE project_id = ?').run(projectId)
    }

    // 2. 角色：已存在则复用 ID，不存在则新建
    const charIdMap = new Map<string, string>()
    const insertChar = db.prepare(
      'INSERT INTO characters (id, project_id, name, description, description_zh) VALUES (?, ?, ?, ?, ?)'
    )
    for (const c of extractData.characters || []) {
      const trimmedName = (c.name || '').trim()
      if (!trimmedName) continue
      const existingId = existingCharMap.get(trimmedName)
      if (existingId) {
        charIdMap.set(trimmedName, existingId)
        // 更新已有角色的描述（含 description_zh）
        const descZh = (c as any).description_zh || c.description || ''
        db.prepare('UPDATE characters SET description = ?, description_zh = ? WHERE id = ?').run(c.description || '', descZh, existingId)
      } else {
        const id = randomUUID()
        charIdMap.set(trimmedName, id)
        const descZh = (c as any).description_zh || c.description || ''
        insertChar.run(id, projectId, trimmedName, c.description || '', descZh)
      }
    }

    // 3. 场景：同上
    const sceneIdMap = new Map<string, string>()
    const insertScene = db.prepare(
      'INSERT INTO scenes (id, project_id, name, description, description_zh) VALUES (?, ?, ?, ?, ?)'
    )
    for (const s of extractData.scenes || []) {
      const trimmedName = (s.name || '').trim()
      if (!trimmedName) continue
      const existingId = existingSceneMap.get(trimmedName)
      if (existingId) {
        sceneIdMap.set(trimmedName, existingId)
        const descZh = (s as any).description_zh || s.description || ''
        db.prepare('UPDATE scenes SET description = ?, description_zh = ? WHERE id = ?').run(s.description || '', descZh, existingId)
      } else {
        const id = randomUUID()
        sceneIdMap.set(trimmedName, id)
        const descZh = (s as any).description_zh || s.description || ''
        insertScene.run(id, projectId, trimmedName, s.description || '', descZh)
      }
    }

    // 4. 道具：同上
    const propIdMap = new Map<string, string>()
    const insertProp = db.prepare(
      'INSERT INTO props (id, project_id, name, description, description_zh) VALUES (?, ?, ?, ?, ?)'
    )
    for (const p of extractData.props || []) {
      const trimmedName = (p.name || '').trim()
      if (!trimmedName) continue
      const existingId = existingPropMap.get(trimmedName)
      if (existingId) {
        propIdMap.set(trimmedName, existingId)
        const pDescZh = (p as any).description_zh || p.description || ''
        db.prepare('UPDATE props SET description = ?, description_zh = ? WHERE id = ?').run(p.description || '', pDescZh, existingId)
      } else {
        const id = randomUUID()
        propIdMap.set(trimmedName, id)
        const pDescZh = (p as any).description_zh || p.description || ''
        insertProp.run(id, projectId, trimmedName, p.description || '', pDescZh)
      }
    }

    // 5. 插入章节和分镜
    const insertChapter = db.prepare(
      'INSERT INTO chapters (id, project_id, chapter_index, title) VALUES (?, ?, ?, ?)'
    )
    const insertShot = db.prepare(
      'INSERT INTO shots (id, chapter_id, shot_index, description, description_zh, dialogue, narration, shot_type, camera_movement, lighting_mood, first_frame_prompt, first_frame_prompt_zh, last_frame_prompt, last_frame_prompt_zh, video_prompt, video_prompt_zh) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const insertShotChar = db.prepare(
      'INSERT INTO shot_characters (shot_id, character_id) VALUES (?, ?)'
    )
    const insertShotScene = db.prepare('INSERT INTO shot_scenes (shot_id, scene_id) VALUES (?, ?)')
    const insertShotProp = db.prepare(
      'INSERT INTO shot_props (id, shot_id, prop_id) VALUES (?, ?, ?)'
    )

    const chapters: ShotDataChapter[] = shotsData.chapters || []
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapter = chapters[ci]
      const chapterId = randomUUID()
      const actualChapterIndex = mode === 'append' ? existingMaxChapterIndex + 1 + ci : ci
      insertChapter.run(
        chapterId,
        projectId,
        actualChapterIndex,
        chapter.title || `第${actualChapterIndex + 1}章`
      )

      const shots = chapter.shots || []
      for (const shot of shots) {
        const shotId = randomUUID()
        // 收集此分镜关联的角色和场景名（用于自动生成提示词）
        const shotAssoc = (assocData.associations || []).find(
          (a: AssocItem) => a.chapter_index === ci && a.shot_index === shot.shot_index
        )
        const shotCharNames = (shotAssoc?.character_names || []).map((n: string) => n.trim()).filter(Boolean)
        const shotSceneName = (shotAssoc?.scene_name || '').trim()
        // 自动生成首帧/尾帧提示词（如果AI生成的是占位符或过长指令）
        const autoFFPrompt = buildAutoFramePrompt(shot.description || '', 'first', shotCharNames, shotSceneName)
        const autoLFPrompt = buildAutoFramePrompt(shot.description || '', 'last', shotCharNames, shotSceneName)
        const ffPrompt = isValidPrompt(shot.first_frame_prompt) ? shot.first_frame_prompt : autoFFPrompt
        const lfPrompt = isValidPrompt(shot.last_frame_prompt) ? shot.last_frame_prompt : autoLFPrompt
        const vPrompt = (shot.video_prompt && shot.video_prompt.trim()) ? shot.video_prompt : buildAutoVideoPrompt(shot.description || '', shotCharNames, shotSceneName)
        const ffPromptZh = shot.first_frame_prompt_zh || shot.description || ''
        const lfPromptZh = shot.last_frame_prompt_zh || shot.description || ''
        const vPromptZh = shot.video_prompt_zh || shot.description || ''
        const dialogueText = shot.dialogue || ''
        insertShot.run(
          shotId,
          chapterId,
          shot.shot_index || 0,
          shot.description || '',
          shot.description_zh || shot.description || '',
          dialogueText,
          shot.narration || '',
          shot.shot_type || '',
          shot.camera_movement || '',
          shot.lighting_mood || '',
          ffPrompt,
          ffPromptZh,
          lfPrompt,
          lfPromptZh,
          vPrompt,
          vPromptZh
        )

        // 关联角色、场景、道具（复用上面已查找的 shotAssoc）
        if (shotAssoc) {
          for (const charName of shotAssoc.character_names || []) {
            const charId = charIdMap.get((charName || '').trim())
            if (charId) {
              insertShotChar.run(shotId, charId)
            }
          }
          const sceneId = sceneIdMap.get((shotAssoc.scene_name || '').trim())
          if (sceneId) {
            insertShotScene.run(shotId, sceneId)
          }
          for (const propName of shotAssoc.prop_names || []) {
            const propId = propIdMap.get((propName || '').trim())
            if (propId) {
              insertShotProp.run(randomUUID(), shotId, propId)
            }
          }
        }
      }
    }

    // 更新项目时间
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
  })()
}

// ===== 翻译服务 =====

/** 检测文本是否包含中文 */
function hasChinese(text: string): boolean {
  return /[一-鿿]/.test(text)
}

/**
 * 将中文提示词翻译为英文（调用 AI 文本模型）
 * 仅当文本包含中文时才翻译，否则直接返回原文
 */
export async function translateToEnglish(text: string): Promise<string> {
  if (!text || !hasChinese(text)) return text

  try {
    const result = await callAI([
      {
        role: 'system',
        content: 'You are a translator for AI image/video generation prompts. Translate the given Chinese prompt into English. Keep all technical terms in their standard English form. You MUST respond with a JSON object: {"translated": "the English translation here"}. Do NOT include any other text outside the JSON.'
      },
      { role: 'user', content: `Translate this Chinese text to English for AI image generation. Respond in JSON format.\n\n${text}` }
    ])
    // 解析 JSON 响应
    try {
      const parsed = JSON.parse(extractJSON(result))
      return (parsed.translated || result).trim()
    } catch {
      return result.trim()
    }
  } catch (e) {
    console.error('[translateToEnglish] Translation failed, returning original:', e)
    return text // 翻译失败时返回原文，不阻塞保存
  }
}
