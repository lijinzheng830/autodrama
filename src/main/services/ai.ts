import { getDb } from './db'
import { getProvider } from './providers'
import { STORYBOARD_PROMPT, EXTRACT_PROMPT, ASSOCIATE_PROMPT } from './prompts'
import { updateProjectScript } from './project'

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ProgressData {
  step: number
  status: 'running' | 'done' | 'error'
  message: string
}

export interface AIConfig {
  provider: string
  model: string
  apiKey: string
}

export function getAIConfig(): AIConfig {
  const db = getDb()
  const providerRow = db.prepare("SELECT value FROM settings WHERE key = 'provider'").get() as { value: string } | undefined
  const modelRow = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined
  const provider = providerRow?.value || 'qwen'
  const model = modelRow?.value || 'qwen3.6-flash'
  const apiKeyRow = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(`api_key_${provider}`) as { value: string } | undefined
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
  const provider = providerKey || config.provider
  const model = modelKey || config.model

  const providerConfig = getProvider(provider)
  if (!providerConfig) {
    throw new Error(`未找到供应商配置: ${provider}`)
  }
  if (!providerConfig.implemented) {
    throw new Error(`供应商 ${providerConfig.name} 尚未实现，请选择其他供应商`)
  }

  const apiKey = config.apiKey
  if (!apiKey) {
    throw new Error(`未配置 ${providerConfig.name} 的 API Key，请前往设置页面配置`)
  }

  const url = `${providerConfig.baseURL}/chat/completions`

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
        temperature: 0.7
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
      throw new Error('AI 返回内容为空，请重试')
    }
    return content
  } catch (err: any) {
    clearTimeout(timeout)

    if (err.name === 'AbortError') {
      throw new Error('AI 调用超时（500秒），请检查网络或换用更快的模型')
    }

    if (err.message && err.message.includes('请')) {
      throw err
    }

    if (err.name === 'TypeError' || err.message?.includes('fetch')) {
      throw new Error(`网络连接失败: ${err.message}`)
    }

    throw new Error(`AI 调用出错: ${err.message || String(err)}`)
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

  // 提取 ```json ... ``` 包裹的内容
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    const candidate = codeBlockMatch[1].trim()
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
    const candidate = text.slice(firstBrace, lastBrace + 1).trim()
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
    const candidate = text.slice(firstBracket, lastBracket + 1).trim()
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // continue
    }
  }

  throw new Error('无法从AI返回内容中提取有效JSON，请重试')
}

// ========== 自动挡流程 ==========

export async function autoProcess(
  projectId: string,
  script: string,
  onProgress: (data: ProgressData) => void,
  sendProgress: (data: ProgressData) => void
): Promise<{ shotsData: any; extractData: any; assocData: any }> {
  // 保存剧本到项目
  try {
    updateProjectScript(projectId, script)
  } catch {
    // 忽略保存失败
  }

  // 步骤1：分镜
  onProgress({ step: 1, status: 'running', message: '正在分析剧本、拆分镜头...' })
  sendProgress({ step: 1, status: 'running', message: '正在分析剧本、拆分镜头...' })

  const shotsResult = await callAI([
    { role: 'system', content: STORYBOARD_PROMPT },
    { role: 'user', content: script }
  ])
  const shotsData = JSON.parse(extractJSON(shotsResult))

  onProgress({ step: 1, status: 'done', message: '分析剧本、拆分镜头 完成' })
  sendProgress({ step: 1, status: 'done', message: '分析剧本、拆分镜头 完成' })

  // 步骤2：提取角色和场景
  onProgress({ step: 2, status: 'running', message: '正在提取角色和场景...' })
  sendProgress({ step: 2, status: 'running', message: '正在提取角色和场景...' })

  const extractResult = await callAI([
    { role: 'system', content: EXTRACT_PROMPT },
    { role: 'user', content: JSON.stringify(shotsData) }
  ])
  const extractData = JSON.parse(extractJSON(extractResult))

  onProgress({ step: 2, status: 'done', message: '提取角色和场景 完成' })
  sendProgress({ step: 2, status: 'done', message: '提取角色和场景 完成' })

  // 步骤3：批量关联
  onProgress({ step: 3, status: 'running', message: '正在关联角色和场景到分镜...' })
  sendProgress({ step: 3, status: 'running', message: '正在关联角色和场景到分镜...' })

  const assocResult = await callAI([
    { role: 'system', content: ASSOCIATE_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        chapters: shotsData.chapters,
        characters: extractData.characters,
        scenes: extractData.scenes
      })
    }
  ])
  const assocData = JSON.parse(extractJSON(assocResult))

  onProgress({ step: 3, status: 'done', message: '关联角色和场景到分镜 完成' })
  sendProgress({ step: 3, status: 'done', message: '关联角色和场景到分镜 完成' })

  // 步骤4：保存到数据库
  onProgress({ step: 4, status: 'running', message: '正在保存项目...' })
  sendProgress({ step: 4, status: 'running', message: '正在保存项目...' })

  await saveToDatabase(projectId, shotsData, extractData, assocData)

  onProgress({ step: 4, status: 'done', message: '完成！' })
  sendProgress({ step: 4, status: 'done', message: '完成！' })

  return { shotsData, extractData, assocData }
}

async function saveToDatabase(
  projectId: string,
  shotsData: any,
  extractData: any,
  assocData: any
): Promise<void> {
  const db = getDb()
  const crypto = await import('crypto')

  db.transaction(() => {
    // 清理旧数据
    // 先删关联，再删shots/chapters，再删characters/scenes
    const oldShots = db
      .prepare(
        `SELECT s.id FROM shots s JOIN chapters c ON s.chapter_id = c.id WHERE c.project_id = ?`
      )
      .all(projectId) as { id: string }[]
    for (const s of oldShots) {
      db.prepare('DELETE FROM shot_characters WHERE shot_id = ?').run(s.id)
      db.prepare('DELETE FROM shot_scenes WHERE shot_id = ?').run(s.id)
    }
    db.prepare('DELETE FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)').run(projectId)
    db.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM characters WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(projectId)

    // 插入角色
    const charIdMap = new Map<string, string>()
    const insertChar = db.prepare(
      'INSERT INTO characters (id, project_id, name, description) VALUES (?, ?, ?, ?)'
    )
    for (const c of extractData.characters || []) {
      const id = crypto.randomUUID()
      charIdMap.set(c.name, id)
      insertChar.run(id, projectId, c.name, c.description || '')
    }

    // 插入场景
    const sceneIdMap = new Map<string, string>()
    const insertScene = db.prepare(
      'INSERT INTO scenes (id, project_id, name, description) VALUES (?, ?, ?, ?)'
    )
    for (const s of extractData.scenes || []) {
      const id = crypto.randomUUID()
      sceneIdMap.set(s.name, id)
      insertScene.run(id, projectId, s.name, s.description || '')
    }

    // 插入章节和分镜
    const insertChapter = db.prepare(
      'INSERT INTO chapters (id, project_id, chapter_index, title) VALUES (?, ?, ?, ?)'
    )
    const insertShot = db.prepare(
      'INSERT INTO shots (id, chapter_id, shot_index, description, first_frame_prompt, last_frame_prompt, video_prompt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const insertShotChar = db.prepare('INSERT INTO shot_characters (shot_id, character_id) VALUES (?, ?)')
    const insertShotScene = db.prepare('INSERT INTO shot_scenes (shot_id, scene_id) VALUES (?, ?)')

    const chapters: any[] = shotsData.chapters || []
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapter = chapters[ci]
      const chapterId = crypto.randomUUID()
      insertChapter.run(chapterId, projectId, ci, chapter.title || `第${ci + 1}章`)

      const shots: any[] = chapter.shots || []
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

        // 关联角色和场景
        const assoc = (assocData.associations || []).find(
          (a: any) => a.chapter_index === ci && a.shot_index === shot.shot_index
        )
        if (assoc) {
          for (const charName of assoc.character_names || []) {
            const charId = charIdMap.get(charName)
            if (charId) {
              insertShotChar.run(shotId, charId)
            }
          }
          const sceneId = sceneIdMap.get(assoc.scene_name)
          if (sceneId) {
            insertShotScene.run(shotId, sceneId)
          }
        }
      }
    }

    // 更新项目时间
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
  })()
}
