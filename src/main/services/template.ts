import { getDb } from './db'
import { randomUUID } from 'crypto'

export interface PromptTemplate {
  id: string
  project_id: string | null
  usage: string
  name: string
  content: string
  is_default: number
  created_at: string
  updated_at: string
}

// 官方预设模板（硬编码，作为兜底；db.ts 中会尝试同步到数据库）
export const OFFICIAL_TEMPLATES: PromptTemplate[] = [
  {
    id: 'official-shot-image-standard',
    project_id: null,
    usage: 'shot_image',
    name: '标准分镜模板',
    content:
      '【占位】标准分镜描述模板，用于生成常规分镜图像。包含场景描述、角色动作、镜头角度等要素。',
    is_default: 1,
    created_at: '',
    updated_at: ''
  },
  {
    id: 'official-shot-image-detailed',
    project_id: null,
    usage: 'shot_image',
    name: '精细镜头拆分模板',
    content: '【占位】精细镜头拆分模板，用于详细拆解每个镜头的构图、角色表情、光影效果和动作细节。',
    is_default: 1,
    created_at: '',
    updated_at: ''
  },
  {
    id: 'official-shot-image-pure',
    project_id: null,
    usage: 'shot_image',
    name: '纯分镜模板',
    content: '【占位】纯分镜模板，不包含额外描述，仅输出分镜的基本画面信息。',
    is_default: 1,
    created_at: '',
    updated_at: ''
  },
  {
    id: 'official-shot-video',
    project_id: null,
    usage: 'shot_video',
    name: '短视频制作模板',
    content: '【占位】短视频制作模板，用于生成视频分镜描述，包含运镜方式、时长、转场等要素。',
    is_default: 1,
    created_at: '',
    updated_at: ''
  }
]

export function getPromptTemplates(projectId: string, usage?: string): PromptTemplate[] {
  const db = getDb()

  let sql: string
  const params: unknown[] = []

  if (projectId) {
    sql = 'SELECT * FROM prompt_templates WHERE project_id = ? AND is_default = 0'
    params.push(projectId)
  } else {
    sql = 'SELECT * FROM prompt_templates WHERE project_id IS NULL AND is_default = 0'
  }

  if (usage) {
    sql += ' AND "usage" = ?'
    params.push(usage)
  }

  const customTemplates = db.prepare(sql).all(...params) as PromptTemplate[]

  // 合并官方模板
  let officialTemplates = OFFICIAL_TEMPLATES.map((t) => ({ ...t }))
  if (usage) {
    officialTemplates = officialTemplates.filter((t) => t.usage === usage)
  }

  return [...officialTemplates, ...customTemplates]
}

export function savePromptTemplate(
  projectId: string,
  input: { usage: string; name: string; content: string }
): Record<string, unknown> {
  const db = getDb()
  const id = randomUUID()
  const dbProjectId = projectId || null

  db.prepare(
    `
    INSERT INTO prompt_templates (id, project_id, "usage", name, content, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `
  ).run(id, dbProjectId, input.usage, input.name, input.content)

  return { id, project_id: dbProjectId, ...input, is_default: 0 }
}

export function updatePromptTemplate(
  templateId: string,
  input: { name?: string; usage?: string; content?: string }
): void {
  const db = getDb()
  const sets: string[] = []
  const params: unknown[] = []

  if (input.name !== undefined) {
    sets.push('name = ?')
    params.push(input.name)
  }
  if (input.usage !== undefined) {
    sets.push('"usage" = ?')
    params.push(input.usage)
  }
  if (input.content !== undefined) {
    sets.push('content = ?')
    params.push(input.content)
  }
  if (sets.length === 0) return

  sets.push("updated_at = datetime('now')")
  params.push(templateId)

  db.prepare(`UPDATE prompt_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function deletePromptTemplate(templateId: string): void {
  const db = getDb()

  const template = db
    .prepare('SELECT is_default FROM prompt_templates WHERE id = ?')
    .get(templateId) as { is_default: number } | undefined
  if (!template) return

  if (template.is_default === 1) {
    throw new Error('官方模板不能删除')
  }

  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(templateId)
}
