import { getDb } from './db'
import { getProvider } from './providers'
import { getProviders } from './settings'
import { STORYBOARD_PROMPT, EXTRACT_PROMPT, ASSOCIATE_PROMPT } from './prompts'
import { updateProjectScript, Character, Scene, Prop } from './project'
import { checkLicense } from '../utils/license'

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
    dialogue?: string
    first_frame_prompt?: string
    last_frame_prompt?: string
    video_prompt?: string
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

  // fallback 到硬编码配置取 baseURL
  if (!baseURL) {
    const hardcoded = getProvider(provider)
    if (hardcoded) {
      baseURL = hardcoded.baseURL
      if (!apiKey && hardcoded.implemented) {
        // 硬编码供应商没有 apiKey，继续用旧配置
      }
    }
  }

  if (!baseURL) {
    throw new Error(`未找到供应商配置: ${provider}`)
  }
  if (!apiKey) {
    throw new Error(`未配置 ${provider} 的 API Key，请前往设置页面配置`)
  }

  const url = `${baseURL.replace(/\/$/, '')}/chat/completions`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 500000)

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
    console.log('[callAI] Response status:', response.status, 'model:', model)
    console.log('[callAI] Response data keys:', Object.keys(data))
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      console.error('[callAI] Unexpected response structure:', JSON.stringify(data).substring(0, 500))
      throw new Error('AI 返回内容为空，请重试')
    }
    console.log('[callAI] Content received, length:', content.length)
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
    shotsData = JSON.parse(extractJSON(shotsResult))
  } catch (e) {
    const fs = await import('fs')
    const logPath = 'C:/Users/Administrator/ai_response_debug.log'
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
    extractData = JSON.parse(extractJSON(extractResult))
  } catch (e) {
    console.error('[autoProcess] 提取步骤 JSON 提取失败. AI返回前1000字符:', extractResult.substring(0, 1000))
    console.error('[autoProcess] Parse error:', (e as Error).message)
    throw e
  }

  onProgress({ step: 2, status: 'done', message: '提取角色、场景和道具 完成' })
  sendProgress({ step: 2, status: 'done', message: '提取角色、场景和道具 完成' })

  // 步骤3：批量关联
  onProgress({ step: 3, status: 'running', message: '正在关联角色、场景和道具到分镜...' })
  sendProgress({ step: 3, status: 'running', message: '正在关联角色、场景和道具到分镜...' })

  const assocResult = await callAI(
    [
      { role: 'system', content: ASSOCIATE_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          chapters: shotsData.chapters,
          characters: extractData.characters,
          scenes: extractData.scenes,
          props: extractData.props
        })
      }
    ],
    undefined,
    modelOverride
  )
  let assocData: AssocData
  try {
    assocData = JSON.parse(extractJSON(assocResult))
  } catch (e) {
    console.error('[autoProcess] 关联步骤 JSON 提取失败. AI返回前1000字符:', assocResult.substring(0, 1000))
    console.error('[autoProcess] Parse error:', (e as Error).message)
    throw e
  }

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

async function saveToDatabase(
  projectId: string,
  shotsData: ShotData,
  extractData: ExtractData,
  assocData: AssocData,
  mode: 'full' | 'append' = 'full'
): Promise<void> {
  const db = getDb()
  const crypto = await import('crypto')

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
    // 1. full 模式：删除所有分镜数据；append 模式：保留已有
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
    }

    // 2. 角色：已存在则复用 ID，不存在则新建
    const charIdMap = new Map<string, string>()
    const insertChar = db.prepare(
      'INSERT INTO characters (id, project_id, name, description) VALUES (?, ?, ?, ?)'
    )
    for (const c of extractData.characters || []) {
      const trimmedName = (c.name || '').trim()
      if (!trimmedName) continue
      const existingId = existingCharMap.get(trimmedName)
      if (existingId) {
        charIdMap.set(trimmedName, existingId)
      } else {
        const id = crypto.randomUUID()
        charIdMap.set(trimmedName, id)
        insertChar.run(id, projectId, trimmedName, c.description || '')
      }
    }

    // 3. 场景：同上
    const sceneIdMap = new Map<string, string>()
    const insertScene = db.prepare(
      'INSERT INTO scenes (id, project_id, name, description) VALUES (?, ?, ?, ?)'
    )
    for (const s of extractData.scenes || []) {
      const trimmedName = (s.name || '').trim()
      if (!trimmedName) continue
      const existingId = existingSceneMap.get(trimmedName)
      if (existingId) {
        sceneIdMap.set(trimmedName, existingId)
      } else {
        const id = crypto.randomUUID()
        sceneIdMap.set(trimmedName, id)
        insertScene.run(id, projectId, trimmedName, s.description || '')
      }
    }

    // 4. 道具：同上
    const propIdMap = new Map<string, string>()
    const insertProp = db.prepare(
      'INSERT INTO props (id, project_id, name, description) VALUES (?, ?, ?, ?)'
    )
    for (const p of extractData.props || []) {
      const trimmedName = (p.name || '').trim()
      if (!trimmedName) continue
      const existingId = existingPropMap.get(trimmedName)
      if (existingId) {
        propIdMap.set(trimmedName, existingId)
      } else {
        const id = crypto.randomUUID()
        propIdMap.set(trimmedName, id)
        insertProp.run(id, projectId, trimmedName, p.description || '')
      }
    }

    // 5. 插入章节和分镜
    const insertChapter = db.prepare(
      'INSERT INTO chapters (id, project_id, chapter_index, title) VALUES (?, ?, ?, ?)'
    )
    const insertShot = db.prepare(
      'INSERT INTO shots (id, chapter_id, shot_index, description, first_frame_prompt, last_frame_prompt, video_prompt) VALUES (?, ?, ?, ?, ?, ?, ?)'
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
      const chapterId = crypto.randomUUID()
      const actualChapterIndex = mode === 'append' ? existingMaxChapterIndex + 1 + ci : ci
      insertChapter.run(
        chapterId,
        projectId,
        actualChapterIndex,
        chapter.title || `第${actualChapterIndex + 1}章`
      )

      const shots = chapter.shots || []
      for (const shot of shots) {
        const shotId = crypto.randomUUID()
        insertShot.run(
          shotId,
          chapterId,
          shot.shot_index || 0,
          (shot.description || '') + (shot.dialogue ? `\n对白: ${shot.dialogue}` : ''),
          shot.first_frame_prompt || '',
          shot.last_frame_prompt || '',
          shot.video_prompt || ''
        )

        // 关联角色、场景、道具
        const assoc = (assocData.associations || []).find(
          (a: AssocItem) => a.chapter_index === ci && a.shot_index === shot.shot_index
        )
        if (assoc) {
          for (const charName of assoc.character_names || []) {
            const charId = charIdMap.get((charName || '').trim())
            if (charId) {
              insertShotChar.run(shotId, charId)
            }
          }
          const sceneId = sceneIdMap.get((assoc.scene_name || '').trim())
          if (sceneId) {
            insertShotScene.run(shotId, sceneId)
          }
          for (const propName of assoc.prop_names || []) {
            const propId = propIdMap.get((propName || '').trim())
            if (propId) {
              insertShotProp.run(crypto.randomUUID(), shotId, propId)
            }
          }
        }
      }
    }

    // 更新项目时间
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
  })()
}
