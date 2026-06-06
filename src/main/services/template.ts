import { getDb } from './db'
import { randomUUID } from 'crypto'

export interface PromptTemplate {
  id: string
  project_id: string | null
  usage: string
  name: string
  content: string
  template_version?: string | null
  is_default: number
  created_at: string
  updated_at: string
}

/** 从数据库统一读取模板（官方 + 自定义），不再使用硬编码 */
export function getPromptTemplates(projectId: string, usage?: string): PromptTemplate[] {
  const db = getDb()

  let sql = 'SELECT * FROM prompt_templates WHERE (project_id IS NULL'
  const params: unknown[] = []

  if (projectId) {
    sql += ' OR project_id = ?'
    params.push(projectId)
  }
  sql += ')'

  if (usage) {
    sql += ' AND "usage" = ?'
    params.push(usage)
  }

  sql += ' ORDER BY is_default DESC, created_at ASC'

  return db.prepare(sql).all(...params) as PromptTemplate[]
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
    VALUES (?, ?, ?, ?, ?, 0, datetime('now', 'localtime'), datetime('now', 'localtime'))
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

  sets.push("updated_at = datetime('now', 'localtime')")
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
