import { getDb } from './db'
import { app } from 'electron'
import { join, extname } from 'path'
import { mkdirSync, copyFileSync } from 'fs'
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
      INSERT INTO characters (id, project_id, name, description, reference_image, skin_images)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const c of chars) {
      insertChar.run(
        randomUUID(),
        id,
        c.name,
        c.description ?? null,
        c.reference_image ?? null,
        c.skin_images ?? null
      )
    }

    // 复制 scenes
    const scenes = db.prepare(`SELECT * FROM scenes WHERE project_id = ?`).all(parentId) as Scene[]
    const insertScene = db.prepare(`
      INSERT INTO scenes (id, project_id, name, description, reference_image)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const s of scenes) {
      insertScene.run(randomUUID(), id, s.name, s.description ?? null, s.reference_image ?? null)
    }

    // 复制 props
    const props = db.prepare(`SELECT * FROM props WHERE project_id = ?`).all(parentId) as Prop[]
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

export function getChaptersByProject(projectId: string): unknown[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_index')
    .all(projectId) as unknown[]
}

export function getShotsByChapter(chapterId: string): unknown[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM shots WHERE chapter_id = ? ORDER BY shot_index')
    .all(chapterId) as unknown[]
}

export function getCharactersByProject(projectId: string): Character[] {
  const db = getDb()
  return db.prepare('SELECT * FROM characters WHERE project_id = ?').all(projectId) as Character[]
}

export function getScenesByProject(projectId: string): Scene[] {
  const db = getDb()
  return db.prepare('SELECT * FROM scenes WHERE project_id = ?').all(projectId) as Scene[]
}

export function getShotCharacters(shotId: string): unknown[] {
  const db = getDb()
  return db
    .prepare(
      `
      SELECT c.* FROM characters c
      JOIN shot_characters sc ON c.id = sc.character_id
      WHERE sc.shot_id = ?
    `
    )
    .all(shotId) as unknown[]
}

export function getShotScenes(shotId: string): unknown[] {
  const db = getDb()
  return db
    .prepare(
      `
      SELECT s.* FROM scenes s
      JOIN shot_scenes ss ON s.id = ss.scene_id
      WHERE ss.shot_id = ?
    `
    )
    .all(shotId) as unknown[]
}

export function getShotCharactersByProject(projectId: string): unknown[] {
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
    .all(projectId) as unknown[]
}

export function getShotScenesByProject(projectId: string): unknown[] {
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
    .all(projectId) as unknown[]
}

export function deleteProject(projectId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
}

export interface Character {
  id: string
  project_id?: string
  name: string
  description?: string
  reference_image?: string
  skin_images?: string
}

export interface Scene {
  id: string
  project_id?: string
  name: string
  description?: string
  reference_image?: string
}

export interface Prop {
  id: string
  project_id?: string
  name: string
  description?: string
  reference_image?: string
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
  description?: string
  dialogue?: string
  first_frame_prompt?: string
  last_frame_prompt?: string
  video_prompt?: string
  first_frame_image_path?: string
  last_frame_image_path?: string
  video_path?: string
  voice_path?: string
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
  last_frame_prompt?: string
  video_prompt?: string
  dialogue?: string
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
  if (input.last_frame_prompt !== undefined) {
    fields.push('last_frame_prompt = ?')
    values.push(input.last_frame_prompt)
  }
  if (input.video_prompt !== undefined) {
    fields.push('video_prompt = ?')
    values.push(input.video_prompt)
  }
  if (input.dialogue !== undefined) {
    fields.push('dialogue = ?')
    values.push(input.dialogue)
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
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))
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

  sql += ' ORDER BY created_at DESC'

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
      SELECT sc.shot_id, c.id, c.name, c.description, c.reference_image, c.skin_images
      FROM shot_characters sc
      JOIN characters c ON sc.character_id = c.id
      WHERE sc.shot_id IN (${placeholders})
    `
    )
    .all(...shotIds) as Record<string, unknown>[]

  const shotScenes = db
    .prepare(
      `
      SELECT ss.shot_id, s.id, s.name, s.description, s.reference_image
      FROM shot_scenes ss
      JOIN scenes s ON ss.scene_id = s.id
      WHERE ss.shot_id IN (${placeholders})
    `
    )
    .all(...shotIds) as Record<string, unknown>[]

  const shotProps = db
    .prepare(
      `
      SELECT sp.shot_id, p.id, p.name, p.description, p.reference_image
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

export function getShotsWithAssociations(chapterId: string): unknown[] {
  const db = getDb()

  const shots = db
    .prepare('SELECT * FROM shots WHERE chapter_id = ? ORDER BY shot_index')
    .all(chapterId) as Record<string, unknown>[]

  const shotIds = shots.map((s) => (s as Record<string, unknown>).id as string)
  const { charMap, sceneMap, propMap } = buildShotAssocMaps(db, shotIds)

  return shots.map((s) => {
    const row = s as Record<string, unknown>
    return {
      ...row,
      characters: charMap.get(row.id as string) || [],
      scenes: sceneMap.get(row.id as string) || [],
      props: propMap.get(row.id as string) || []
    }
  })
}

export function getProjectData(projectId: string): Record<string, unknown> {
  const db = getDb()

  const chapters = db
    .prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_index')
    .all(projectId) as Record<string, unknown>[]

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

export function getProjectStats(projectId: string): { scenes: number; props: number; chapters: number; shots: number } {
  const db = getDb()

  const scenesRow = db.prepare('SELECT COUNT(*) as count FROM scenes WHERE project_id = ?').get(projectId) as { count: number }
  const propsRow = db.prepare('SELECT COUNT(*) as count FROM props WHERE project_id = ?').get(projectId) as { count: number }
  const chaptersRow = db.prepare('SELECT COUNT(*) as count FROM chapters WHERE project_id = ?').get(projectId) as { count: number }
  const shotsRow = db
    .prepare(
      'SELECT COUNT(*) as count FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)'
    )
    .get(projectId) as { count: number }

  return {
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
  })
  tx()
}
