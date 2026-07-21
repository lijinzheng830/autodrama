import { getDb } from './db'
import { logger } from '../utils/logger'
import { app } from 'electron'
import { join, extname } from 'path'
import { mkdirSync, copyFileSync } from 'fs'
import { randomUUID } from 'crypto'

// In-flight task cancellation registry
const abortControllers = new Map<string, AbortController>()

export function registerTaskController(taskId: string, controller: AbortController): void {
  abortControllers.set(taskId, controller)
}

export function deregisterTaskController(taskId: string): void {
  abortControllers.delete(taskId)
}

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
  path?: string
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
  const projectPath = input.path || join(userDataPath, 'projects', id)
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
    const chars = db
      .prepare(`SELECT * FROM characters WHERE project_id = ?`)
      .all(parentId) as Character[]
    const insertChar = db.prepare(`
      INSERT INTO characters (id, project_id, name, description, reference_image, skin_images, aspect_ratio, character_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const c of chars) {
      insertChar.run(
        randomUUID(),
        id,
        c.name,
        c.description ?? null,
        c.reference_image ?? null,
        c.skin_images ?? null,
        c.aspect_ratio ?? '16:9',
        c.character_type ?? 'human'
      )
    }

    // 复制 scenes
    const scenes = db.prepare(`SELECT * FROM scenes WHERE project_id = ?`).all(parentId) as Scene[]
    const insertScene = db.prepare(`
      INSERT INTO scenes (id, project_id, name, description, reference_image, aspect_ratio)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const s of scenes) {
      insertScene.run(randomUUID(), id, s.name, s.description ?? null, s.reference_image ?? null, s.aspect_ratio ?? '16:9')
    }

    // 复制 props
    const props = db.prepare(`SELECT * FROM props WHERE project_id = ?`).all(parentId) as Prop[]
    const insertProp = db.prepare(`
      INSERT INTO props (id, project_id, name, description, reference_image, aspect_ratio)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const p of props) {
      insertProp.run(randomUUID(), id, p.name, p.description ?? null, p.reference_image ?? null, p.aspect_ratio ?? '16:9')
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
  const values: unknown[] = []

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
  db.prepare('UPDATE projects SET script_text = ?, updated_at = ? WHERE id = ?').run(
    script,
    Date.now(),
    projectId
  )
}

export function getChaptersByProject(projectId: string): Chapter[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_index')
    .all(projectId) as unknown as Chapter[]
}

export function getShotsByChapter(chapterId: string): Shot[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM shots WHERE chapter_id = ? ORDER BY shot_index')
    .all(chapterId) as unknown as Shot[]
}

export function getCharactersByProject(projectId: string): Character[] {
  const db = getDb()
  return db.prepare('SELECT * FROM characters WHERE project_id = ?').all(projectId) as Character[]
}

export function getScenesByProject(projectId: string): Scene[] {
  const db = getDb()
  return db.prepare('SELECT * FROM scenes WHERE project_id = ?').all(projectId) as Scene[]
}

export function getShotCharacters(shotId: string): Character[] {
  const db = getDb()
  return db
    .prepare(
      `
      SELECT c.* FROM characters c
      JOIN shot_characters sc ON c.id = sc.character_id
      WHERE sc.shot_id = ?
    `
    )
    .all(shotId) as unknown as Character[]
}

export function getShotScenes(shotId: string): Scene[] {
  const db = getDb()
  return db
    .prepare(
      `
      SELECT s.* FROM scenes s
      JOIN shot_scenes ss ON s.id = ss.scene_id
      WHERE ss.shot_id = ?
    `
    )
    .all(shotId) as unknown as Scene[]
}

export function getShotCharactersByProject(projectId: string): (Character & { shot_id: string })[] {
  const db = getDb()
  return db
    .prepare(
      `
      SELECT sc.shot_id, c.id as character_id, c.name, c.description
      FROM shot_characters sc
      JOIN characters c ON c.id = sc.character_id
      JOIN shots s ON sc.shot_id = s.id
      JOIN chapters ch ON s.chapter_id = ch.id
      WHERE ch.project_id = ?
    `
    )
    .all(projectId) as (Character & { shot_id: string })[]
}

export function getShotScenesByProject(projectId: string): (Scene & { shot_id: string })[] {
  const db = getDb()
  return db
    .prepare(
      `
      SELECT ss.shot_id, s.id as scene_id, s.name, s.description
      FROM shot_scenes ss
      JOIN scenes s ON s.id = ss.scene_id
      JOIN shots sh ON ss.shot_id = sh.id
      JOIN chapters ch ON sh.chapter_id = ch.id
      WHERE ch.project_id = ?
    `
    )
    .all(projectId) as (Scene & { shot_id: string })[]
}

export function deleteParseGroup(projectId: string, parseGroup: number): void {
  const db = getDb()
  logger.info(`[project] Deleting parse_group ${parseGroup} from project ${projectId}...`)
  db.transaction(() => {
    const shotIds = db
      .prepare(
        `SELECT s.id FROM shots s JOIN chapters c ON s.chapter_id = c.id
         WHERE c.project_id = ? AND c.parse_group = ?`
      )
      .all(projectId, parseGroup) as { id: string }[]
    for (const s of shotIds) {
      db.prepare('DELETE FROM shot_characters WHERE shot_id = ?').run(s.id)
      db.prepare('DELETE FROM shot_scenes WHERE shot_id = ?').run(s.id)
      db.prepare('DELETE FROM shot_props WHERE shot_id = ?').run(s.id)
      db.prepare('DELETE FROM shot_videos WHERE shot_id = ?').run(s.id)
    }
    db.prepare('DELETE FROM generation_tasks WHERE project_id = ?').run(projectId)
    db.prepare(
      'DELETE FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ? AND parse_group = ?)'
    ).run(projectId, parseGroup)
    db.prepare('DELETE FROM chapters WHERE project_id = ? AND parse_group = ?').run(projectId, parseGroup)
  })()
  logger.info(`[project] Deleted parse_group ${parseGroup} from project ${projectId}`)
}

export function deleteProject(projectId: string): void {
  const db = getDb()
  logger.info(`[project] Deleting project ${projectId} and all related data...`)
  db.transaction(() => {
    // 先删关联表（外键 CASCADE 不覆盖所有表）
    const shotIds = db.prepare('SELECT s.id FROM shots s JOIN chapters c ON s.chapter_id = c.id WHERE c.project_id = ?').all(projectId) as { id: string }[]
    for (const s of shotIds) {
      db.prepare('DELETE FROM shot_characters WHERE shot_id = ?').run(s.id)
      db.prepare('DELETE FROM shot_scenes WHERE shot_id = ?').run(s.id)
      db.prepare('DELETE FROM shot_props WHERE shot_id = ?').run(s.id)
      db.prepare('DELETE FROM shot_videos WHERE shot_id = ?').run(s.id)
    }
    db.prepare('DELETE FROM generation_tasks WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)').run(projectId)
    db.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId)
    // 资产及历史图片
    const charIds = db.prepare('SELECT id FROM characters WHERE project_id = ?').all(projectId) as { id: string }[]
    for (const c of charIds) { db.prepare('DELETE FROM character_images WHERE character_id = ?').run(c.id) }
    db.prepare('DELETE FROM characters WHERE project_id = ?').run(projectId)
    const sceneIds = db.prepare('SELECT id FROM scenes WHERE project_id = ?').all(projectId) as { id: string }[]
    for (const s of sceneIds) { db.prepare('DELETE FROM scene_images WHERE scene_id = ?').run(s.id) }
    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(projectId)
    const propIds = db.prepare('SELECT id FROM props WHERE project_id = ?').all(projectId) as { id: string }[]
    for (const p of propIds) { db.prepare('DELETE FROM prop_images WHERE prop_id = ?').run(p.id) }
    db.prepare('DELETE FROM props WHERE project_id = ?').run(projectId)
    // 最后删项目
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  })()
  logger.info(`[project] Project ${projectId} cascaded-deleted — all characters/scenes/shots/images wiped`)
}

export interface Character {
  id: string
  project_id?: string
  name: string
  description?: string
  reference_image?: string
  skin_images?: string
  voice_preset?: string
  aspect_ratio?: string
  character_type?: string
}

export interface Scene {
  id: string
  project_id?: string
  name: string
  description?: string
  reference_image?: string
  aspect_ratio?: string
}

export interface Prop {
  id: string
  project_id?: string
  name: string
  description?: string
  reference_image?: string
  aspect_ratio?: string
  created_at?: string
  updated_at?: string
}

export interface Chapter {
  id: string
  project_id: string
  chapter_index: number
  title: string
}

export interface Shot {
  id: string
  chapter_id: string
  shot_index: number
  storyboard_position?: number
  description?: string
  description_zh?: string
  dialogue?: string
  narration?: string
  inner_monologue?: string
  shot_type?: string
  camera_movement?: string
  lighting_mood?: string
  character_actions?: string
  video_prompt?: string
  video_prompt_zh?: string
  poster_image_path?: string
  video_path?: string
  duration_seconds?: number
}

export interface GenerationTask {
  id: string
  project_id: string
  shot_id?: string
  type: string
  purpose: string
  channel?: string
  model?: string
  status: string
  input_params?: string
  output_path?: string
  error_message?: string
  created_at?: string
  started_at?: string
  updated_at?: string
}

export interface UpdateShotInput {
  description?: string
  first_frame_prompt?: string
  first_frame_prompt_zh?: string
  last_frame_prompt?: string
  last_frame_prompt_zh?: string
  video_prompt?: string
  video_prompt_zh?: string
  dialogue?: string
  inner_monologue?: string
  narration?: string
}

export function updateShot(shotId: string, input: UpdateShotInput): void {
  const db = getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (input.description !== undefined) {
    fields.push('description = ?')
    values.push(input.description)
  }
  if (input.first_frame_prompt !== undefined) {
    fields.push('first_frame_prompt = ?')
    values.push(input.first_frame_prompt)
  }
  if (input.first_frame_prompt_zh !== undefined) {
    fields.push('first_frame_prompt_zh = ?')
    values.push(input.first_frame_prompt_zh)
  }
  if (input.last_frame_prompt !== undefined) {
    fields.push('last_frame_prompt = ?')
    values.push(input.last_frame_prompt)
  }
  if (input.last_frame_prompt_zh !== undefined) {
    fields.push('last_frame_prompt_zh = ?')
    values.push(input.last_frame_prompt_zh)
  }
  if (input.video_prompt !== undefined) {
    fields.push('video_prompt = ?')
    values.push(input.video_prompt)
  }
  if (input.video_prompt_zh !== undefined) {
    fields.push('video_prompt_zh = ?')
    values.push(input.video_prompt_zh)
  }
  if (input.dialogue !== undefined) {
    fields.push('dialogue = ?')
    values.push(input.dialogue)
  }
  if (input.narration !== undefined) {
    fields.push('narration = ?')
    values.push(input.narration)
  }
  if (input.inner_monologue !== undefined) {
    fields.push('inner_monologue = ?')
    values.push(input.inner_monologue)
  }

  if (fields.length === 0) return

  values.push(shotId)
  db.prepare(`UPDATE shots SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function addShotAssociation(
  shotId: string,
  type: 'character' | 'scene' | 'prop',
  assetId: string
): void {
  const db = getDb()

  if (type === 'character') {
    const existing = db
      .prepare('SELECT 1 FROM shot_characters WHERE shot_id = ? AND character_id = ?')
      .get(shotId, assetId)
    if (!existing) {
      db.prepare('INSERT INTO shot_characters (shot_id, character_id) VALUES (?, ?)').run(
        shotId,
        assetId
      )
    }
  } else if (type === 'scene') {
    const existing = db
      .prepare('SELECT 1 FROM shot_scenes WHERE shot_id = ? AND scene_id = ?')
      .get(shotId, assetId)
    if (!existing) {
      db.prepare('INSERT INTO shot_scenes (shot_id, scene_id) VALUES (?, ?)').run(shotId, assetId)
    }
  } else if (type === 'prop') {
    const existing = db
      .prepare('SELECT 1 FROM shot_props WHERE shot_id = ? AND prop_id = ?')
      .get(shotId, assetId)
    if (!existing) {
      db.prepare('INSERT INTO shot_props (id, shot_id, prop_id) VALUES (?, ?, ?)').run(
        randomUUID(),
        shotId,
        assetId
      )
    }
  }
}

export function removeShotAssociation(shotId: string, type: 'character' | 'scene' | 'prop', assetId: string): void {
  const db = getDb()
  if (type === 'character') db.prepare('DELETE FROM shot_characters WHERE shot_id = ? AND character_id = ?').run(shotId, assetId)
  else if (type === 'scene') db.prepare('DELETE FROM shot_scenes WHERE shot_id = ? AND scene_id = ?').run(shotId, assetId)
  else db.prepare('DELETE FROM shot_props WHERE shot_id = ? AND prop_id = ?').run(shotId, assetId)
}

export function createGenerationTask(input: {
  projectId: string
  shotId?: string
  type: string
  purpose: string
  channel?: string
  model?: string
  inputParams?: string
}): { id: string } {
  const db = getDb()
  const id = randomUUID()
  db.prepare(
    `
    INSERT INTO generation_tasks (
      id, project_id, shot_id, type, purpose, channel, model, status, input_params, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `
  ).run(
    id,
    input.projectId,
    input.shotId ?? null,
    input.type,
    input.purpose,
    input.channel ?? null,
    input.model ?? null,
    input.inputParams ?? '{}'
  )
  return { id }
}

export function batchCreateGenerationTasks(input: {
  projectId: string
  tasks: Array<{
    shotId?: string
    type: string
    purpose: string
    channel?: string
    model?: string
    inputParams?: string
  }>
}): { ids: string[] } {
  const db = getDb()
  const insert = db.prepare(
    `
    INSERT INTO generation_tasks (
      id, project_id, shot_id, type, purpose, channel, model, status, input_params, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `
  )

  const ids: string[] = []
  const transaction = db.transaction(() => {
    for (const task of input.tasks) {
      const id = randomUUID()
      insert.run(
        id,
        input.projectId,
        task.shotId ?? null,
        task.type,
        task.purpose,
        task.channel ?? null,
        task.model ?? null,
        task.inputParams ?? '{}'
      )
      ids.push(id)
    }
  })

  transaction()
  return { ids }
}

export function cancelGenerationTasks(projectId: string): { count: number } {
  const db = getDb()
  // Cancel pending DB records
  const result = db.prepare(
    `UPDATE generation_tasks SET status = 'cancelled', updated_at = datetime('now', 'localtime') WHERE project_id = ? AND status IN ('pending', 'running')`
  ).run(projectId)
  // Abort in-flight API calls
  const runningTasks = db.prepare(
    `SELECT id FROM generation_tasks WHERE project_id = ? AND status = 'running'`
  ).all(projectId) as { id: string }[]
  for (const t of runningTasks) {
    const ctrl = abortControllers.get(t.id)
    if (ctrl) {
      ctrl.abort()
      db.prepare(`UPDATE generation_tasks SET status = 'cancelled', updated_at = datetime('now', 'localtime') WHERE id = ?`).run(t.id)
    }
  }
  return { count: result.changes }
}

export function getGenerationTasks(
  projectId: string,
  filters?: { status?: string; purpose?: string; since?: number }
): GenerationTask[] {
  const db = getDb()

  let sql = `
    SELECT
      id, project_id, shot_id, type, purpose, channel, model, status,
      input_params, output_path, error_message, created_at, started_at, updated_at
    FROM generation_tasks
    WHERE project_id = ?
  `
  const params: unknown[] = [projectId]

  if (filters?.status) {
    sql += ' AND status = ?'
    params.push(filters.status)
  }
  if (filters?.purpose) {
    sql += ' AND purpose = ?'
    params.push(filters.purpose)
  }
  if (filters?.since) {
    sql += ' AND created_at >= ?'
    params.push(filters.since)
  }

  sql += ' ORDER BY created_at DESC LIMIT 100'

  return db.prepare(sql).all(...params) as GenerationTask[]
}

export function copyImageToProject(srcPath: string, projectPath: string): string {
  const assetsDir = join(projectPath, 'assets')
  mkdirSync(assetsDir, { recursive: true })
  const ext = extname(srcPath)
  const destName = `${randomUUID()}${ext}`
  const destPath = join(assetsDir, destName)
  copyFileSync(srcPath, destPath)
  return destPath
}

// ========== M1-06: 分镜查询服务层 ==========

function buildShotAssocMaps(
  db: ReturnType<typeof getDb>,
  shotIds: string[]
): {
  charMap: Map<string, Character[]>
  sceneMap: Map<string, Scene[]>
  propMap: Map<string, Prop[]>
} {
  if (shotIds.length === 0) {
    return {
      charMap: new Map<string, Character[]>(),
      sceneMap: new Map<string, Scene[]>(),
      propMap: new Map<string, Prop[]>()
    }
  }
  const placeholders = shotIds.map(() => '?').join(',')

  const shotChars = db
    .prepare(
      `
      SELECT sc.shot_id, c.id, c.name, c.description, c.description_zh, c.reference_image, c.skin_images, c.voice_preset
      FROM shot_characters sc
      JOIN characters c ON sc.character_id = c.id
      WHERE sc.shot_id IN (${placeholders})
    `
    )
    .all(...shotIds) as Record<string, unknown>[]

  const shotScenes = db
    .prepare(
      `
      SELECT ss.shot_id, s.id, s.name, s.description, s.description_zh, s.reference_image
      FROM shot_scenes ss
      JOIN scenes s ON ss.scene_id = s.id
      WHERE ss.shot_id IN (${placeholders})
    `
    )
    .all(...shotIds) as Record<string, unknown>[]

  const shotProps = db
    .prepare(
      `
      SELECT sp.shot_id, p.id, p.name, p.description, p.description_zh, p.reference_image
      FROM shot_props sp
      JOIN props p ON sp.prop_id = p.id
      WHERE sp.shot_id IN (${placeholders})
    `
    )
    .all(...shotIds) as Record<string, unknown>[]

  const charMap = new Map<string, Character[]>()
  for (const sc of shotChars) {
    const row = sc as Record<string, unknown>
    const shotId = row.shot_id as string
    if (!charMap.has(shotId)) charMap.set(shotId, [])
    charMap.get(shotId)!.push({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      reference_image: row.reference_image as string,
      skin_images: row.skin_images as string
    })
  }

  const sceneMap = new Map<string, Scene[]>()
  for (const ss of shotScenes) {
    const row = ss as Record<string, unknown>
    const shotId = row.shot_id as string
    if (!sceneMap.has(shotId)) sceneMap.set(shotId, [])
    sceneMap.get(shotId)!.push({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      reference_image: row.reference_image as string
    })
  }

  const propMap = new Map<string, Prop[]>()
  for (const sp of shotProps) {
    const row = sp as Record<string, unknown>
    const shotId = row.shot_id as string
    if (!propMap.has(shotId)) propMap.set(shotId, [])
    propMap.get(shotId)!.push({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      reference_image: row.reference_image as string
    })
  }

  return { charMap, sceneMap, propMap }
}

export interface ShotWithAssoc extends Shot {
  characters: Character[]
  scenes: Scene[]
  props: Prop[]
}

export interface ProjectData {
  chapters: Chapter[]
  characters: Character[]
  scenes: Scene[]
  props: Prop[]
  shots: ShotWithAssoc[]
}

export function getShotsWithAssociations(chapterId: string): ShotWithAssoc[] {
  const db = getDb()

  const shots = db
    .prepare('SELECT * FROM shots WHERE chapter_id = ? ORDER BY shot_index')
    .all(chapterId) as Shot[]

  const shotIds = shots.map((s) => s.id)
  const { charMap, sceneMap, propMap } = buildShotAssocMaps(db, shotIds)

  return shots.map((s) => ({
    ...s,
    characters: charMap.get(s.id) || [],
    scenes: sceneMap.get(s.id) || [],
    props: propMap.get(s.id) || []
  }))
}

export function getProjectData(projectId: string): ProjectData {
  const db = getDb()

  const chapters = db
    .prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_index')
    .all(projectId) as Chapter[]

  const characters = db
    .prepare('SELECT * FROM characters WHERE project_id = ?')
    .all(projectId) as Character[]
  const scenes = db.prepare('SELECT * FROM scenes WHERE project_id = ?').all(projectId) as Scene[]
  const props = db.prepare('SELECT * FROM props WHERE project_id = ?').all(projectId) as Prop[]

  const shots = db
    .prepare(
      `
      SELECT * FROM shots
      WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)
      ORDER BY chapter_id, shot_index
    `
    )
    .all(projectId) as Shot[]

  const shotIds = shots.map((s) => s.id)
  const { charMap, sceneMap, propMap } = buildShotAssocMaps(db, shotIds)

  const shotsWithAssoc = shots.map((s) => ({
    ...s,
    characters: charMap.get(s.id) || [],
    scenes: sceneMap.get(s.id) || [],
    props: propMap.get(s.id) || []
  }))

  return { chapters, characters, scenes, props, shots: shotsWithAssoc }
}

export function getProjectStats(projectId: string): { characters: number; scenes: number; props: number; chapters: number; shots: number } {
  const db = getDb()

  const charactersRow = db.prepare('SELECT COUNT(*) as count FROM characters WHERE project_id = ?').get(projectId) as { count: number }
  const scenesRow = db.prepare('SELECT COUNT(*) as count FROM scenes WHERE project_id = ?').get(projectId) as { count: number }
  const propsRow = db.prepare('SELECT COUNT(*) as count FROM props WHERE project_id = ?').get(projectId) as { count: number }
  const chaptersRow = db.prepare('SELECT COUNT(*) as count FROM chapters WHERE project_id = ?').get(projectId) as { count: number }
  const shotsRow = db
    .prepare(
      'SELECT COUNT(*) as count FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)'
    )
    .get(projectId) as { count: number }

  return {
    characters: charactersRow.count,
    scenes: scenesRow.count,
    props: propsRow.count,
    chapters: chaptersRow.count,
    shots: shotsRow.count
  }
}

export function moveShotUp(shotId: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId) as Shot
    if (!shot) return

    const prevShot = db
      .prepare(
        `
        SELECT * FROM shots
        WHERE chapter_id = ? AND shot_index < ?
        ORDER BY shot_index DESC LIMIT 1
      `
      )
      .get(shot.chapter_id, shot.shot_index) as Shot
    if (!prevShot) return

    db.prepare('UPDATE shots SET shot_index = ? WHERE id = ?').run(prevShot.shot_index, shotId)
    db.prepare('UPDATE shots SET shot_index = ? WHERE id = ?').run(shot.shot_index, prevShot.id)
  })
  tx()
}

export function moveShotDown(shotId: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId) as Shot
    if (!shot) return

    const nextShot = db
      .prepare(
        `
        SELECT * FROM shots
        WHERE chapter_id = ? AND shot_index > ?
        ORDER BY shot_index ASC LIMIT 1
      `
      )
      .get(shot.chapter_id, shot.shot_index) as Shot
    if (!nextShot) return

    db.prepare('UPDATE shots SET shot_index = ? WHERE id = ?').run(nextShot.shot_index, shotId)
    db.prepare('UPDATE shots SET shot_index = ? WHERE id = ?').run(shot.shot_index, nextShot.id)
  })
  tx()
}

export function deleteShot(shotId: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId) as Shot
    if (!shot) return

    db.prepare('DELETE FROM shots WHERE id = ?').run(shotId)
    db.prepare(
      `
      UPDATE shots SET shot_index = shot_index - 1
      WHERE chapter_id = ? AND shot_index > ?
    `
    ).run(shot.chapter_id, shot.shot_index)

    // 空章节自动清理
    const remaining = db.prepare('SELECT COUNT(*) as c FROM shots WHERE chapter_id = ?').get(shot.chapter_id) as { c: number }
    if (remaining.c === 0) {
      db.prepare('DELETE FROM chapters WHERE id = ?').run(shot.chapter_id)
    }
  })
  tx()
}
