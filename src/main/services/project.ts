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
}

export interface CreateProjectInput {
  name: string
  styleName: string
  stylePrompt: string
  styleNegativePrompt: string
  aspectRatio: string
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
    created_at: now,
    updated_at: now
  }

  const stmt = db.prepare(`
    INSERT INTO projects (id, name, path, style_name, style_prompt, style_negative_prompt, aspect_ratio, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    project.id,
    project.name,
    project.path,
    project.style_name,
    project.style_prompt,
    project.style_negative_prompt,
    project.aspect_ratio,
    project.created_at,
    project.updated_at
  )

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
      SELECT sc.shot_id, c.id as character_id, c.name, c.description, c.prompt
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
      SELECT ss.shot_id, s.id as scene_id, s.name, s.description, s.prompt
      FROM shot_scenes ss
      JOIN scenes s ON s.id = ss.scene_id
      JOIN shots sh ON ss.shot_id = sh.id
      JOIN chapters ch ON sh.chapter_id = ch.id
      WHERE ch.project_id = ?
    `)
    .all(projectId) as any[]
}
