import { getDb } from './db'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { randomUUID } from 'crypto'

export interface Project {
  id: string
  name: string
  path: string
  style_name: string
  style_prompt: string
  style_negative_prompt: string
  aspect_ratio: string
  created_at: number
  updated_at: number
  era?: string
  negative_prompt?: string
  model_config_json?: string
  parent_project_id?: string
}

export interface CreateProjectInput {
  name: string
  styleName: string
  stylePrompt: string
  styleNegativePrompt: string
  aspectRatio: string
  era?: string
  negativePrompt?: string
  parentProjectId?: string
}

export interface UpdateProjectInput {
  styleName?: string
  stylePrompt?: string
  styleNegativePrompt?: string
  aspectRatio?: string
  era?: string
  negativePrompt?: string
  modelConfigJson?: string
}

export function createProject(input: CreateProjectInput): Project {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  const userDataPath = app.getPath('userData')
  const projectPath = join(userDataPath, 'projects', id)
  mkdirSync(projectPath, { recursive: true })

  const project: Project = {
    id,
    name: input.name,
    path: projectPath,
    style_name: input.styleName,
    style_prompt: input.stylePrompt,
    style_negative_prompt: input.styleNegativePrompt,
    aspect_ratio: input.aspectRatio,
    era: input.era,
    negative_prompt: input.negativePrompt,
    model_config_json: '{}',
    parent_project_id: input.parentProjectId,
    created_at: now,
    updated_at: now
  }

  const stmt = db.prepare(`
    INSERT INTO projects (
      id, name, path, style_name, style_prompt, style_negative_prompt, aspect_ratio,
      era, negative_prompt, model_config_json, parent_project_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    project.id,
    project.name,
    project.path,
    project.style_name,
    project.style_prompt,
    project.style_negative_prompt,
    project.aspect_ratio,
    project.era ?? null,
    project.negative_prompt ?? null,
    project.model_config_json,
    project.parent_project_id ?? null,
    project.created_at,
    project.updated_at
  )

  // 续集：复制父项目的角色/场景/道具
  if (input.parentProjectId) {
    const parentId = input.parentProjectId

    // 复制 characters
    const chars = db.prepare(`SELECT * FROM characters WHERE project_id = ?`).all(parentId) as any[]
    const insertChar = db.prepare(`
      INSERT INTO characters (id, project_id, name, description, reference_image, skin_images)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const c of chars) {
      insertChar.run(randomUUID(), id, c.name, c.description ?? null, c.reference_image ?? null, c.skin_images ?? null)
    }

    // 复制 scenes
    const scenes = db.prepare(`SELECT * FROM scenes WHERE project_id = ?`).all(parentId) as any[]
    const insertScene = db.prepare(`
      INSERT INTO scenes (id, project_id, name, description, reference_image)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const s of scenes) {
      insertScene.run(randomUUID(), id, s.name, s.description ?? null, s.reference_image ?? null)
    }

    // 复制 props
    const props = db.prepare(`SELECT * FROM props WHERE project_id = ?`).all(parentId) as any[]
    const insertProp = db.prepare(`
      INSERT INTO props (id, project_id, name, description, reference_image)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const p of props) {
      insertProp.run(randomUUID(), id, p.name, p.description ?? null, p.reference_image ?? null)
    }
  }

  return project
}

export function getProjects(): Project[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC')
  return stmt.all() as Project[]
}

export function getProject(id: string): Project | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?')
  const row = stmt.get(id) as Project | undefined
  return row ?? null
}

export function updateProject(projectId: string, input: UpdateProjectInput): void {
  const db = getDb()
  const fields: string[] = []
  const values: any[] = []

  if (input.styleName !== undefined) {
    fields.push('style_name = ?')
    values.push(input.styleName)
  }
  if (input.stylePrompt !== undefined) {
    fields.push('style_prompt = ?')
    values.push(input.stylePrompt)
  }
  if (input.styleNegativePrompt !== undefined) {
    fields.push('style_negative_prompt = ?')
    values.push(input.styleNegativePrompt)
  }
  if (input.aspectRatio !== undefined) {
    fields.push('aspect_ratio = ?')
    values.push(input.aspectRatio)
  }
  if (input.era !== undefined) {
    fields.push('era = ?')
    values.push(input.era)
  }
  if (input.negativePrompt !== undefined) {
    fields.push('negative_prompt = ?')
    values.push(input.negativePrompt)
  }
  if (input.modelConfigJson !== undefined) {
    fields.push('model_config_json = ?')
    values.push(input.modelConfigJson)
  }

  if (fields.length === 0) return

  values.push(Date.now())
  values.push(projectId)

  db.prepare(`UPDATE projects SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...values)
}

export function updateProjectScript(projectId: string, script: string): void {
  const db = getDb()
  db.prepare('UPDATE projects SET script_text = ?, updated_at = ? WHERE id = ?').run(script, Date.now(), projectId)
}

export function getChaptersByProject(projectId: string) {
  const db = getDb()
  return db.prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_index').all(projectId) as any[]
}

export function getShotsByChapter(chapterId: string) {
  const db = getDb()
  return db.prepare('SELECT * FROM shots WHERE chapter_id = ? ORDER BY shot_index').all(chapterId) as any[]
}

export function getCharactersByProject(projectId: string) {
  const db = getDb()
  return db.prepare('SELECT * FROM characters WHERE project_id = ?').all(projectId) as any[]
}

export function getScenesByProject(projectId: string) {
  const db = getDb()
  return db.prepare('SELECT * FROM scenes WHERE project_id = ?').all(projectId) as any[]
}

export function getShotCharacters(shotId: string) {
  const db = getDb()
  return db
    .prepare(`
      SELECT c.* FROM characters c
      JOIN shot_characters sc ON c.id = sc.character_id
      WHERE sc.shot_id = ?
    `)
    .all(shotId) as any[]
}

export function getShotScenes(shotId: string) {
  const db = getDb()
  return db
    .prepare(`
      SELECT s.* FROM scenes s
      JOIN shot_scenes ss ON s.id = ss.scene_id
      WHERE ss.shot_id = ?
    `)
    .all(shotId) as any[]
}

export function getShotCharactersByProject(projectId: string) {
  const db = getDb()
  return db
    .prepare(`
      SELECT sc.shot_id, c.id as character_id, c.name, c.description
      FROM shot_characters sc
      JOIN characters c ON c.id = sc.character_id
      JOIN shots s ON sc.shot_id = s.id
      JOIN chapters ch ON s.chapter_id = ch.id
      WHERE ch.project_id = ?
    `)
    .all(projectId) as any[]
}

export function getShotScenesByProject(projectId: string) {
  const db = getDb()
  return db
    .prepare(`
      SELECT ss.shot_id, s.id as scene_id, s.name, s.description
      FROM shot_scenes ss
      JOIN scenes s ON s.id = ss.scene_id
      JOIN shots sh ON ss.shot_id = sh.id
      JOIN chapters ch ON sh.chapter_id = ch.id
      WHERE ch.project_id = ?
    `)
    .all(projectId) as any[]
}
