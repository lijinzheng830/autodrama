import { getDb } from './db'
import { randomUUID } from 'crypto'
import { Character, Scene, Prop } from './project'

// ========== 辅助：改名时全局联动更新分镜提示词 ==========

function updateShotPrompts(projectId: string, oldName: string, newName: string): void {
  const db = getDb()
  db.prepare(
    `
    UPDATE shots
    SET
      first_frame_prompt = REPLACE(COALESCE(first_frame_prompt, ''), ?, ?),
      last_frame_prompt = REPLACE(COALESCE(last_frame_prompt, ''), ?, ?),
      video_prompt = REPLACE(COALESCE(video_prompt, ''), ?, ?)
    WHERE chapter_id IN (
      SELECT id FROM chapters WHERE project_id = ?
    )
  `
  ).run(oldName, newName, oldName, newName, oldName, newName, projectId)
}

// ========== Character ==========

export interface CreateCharacterInput {
  name: string
  description?: string
  referenceImage?: string
}

export interface UpdateCharacterInput {
  name?: string
  description?: string
  referenceImage?: string
  skinImages?: string
}

export function createCharacter(
  projectId: string,
  input: CreateCharacterInput
): Record<string, unknown> {
  const db = getDb()

  const existing = db
    .prepare('SELECT id FROM characters WHERE project_id = ? AND name = ?')
    .get(projectId, input.name)
  if (existing) throw new Error(`项目中已存在名为 "${input.name}" 的角色`)

  const id = randomUUID()
  db.prepare(
    `
    INSERT INTO characters (id, project_id, name, description, reference_image)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(id, projectId, input.name, input.description ?? null, input.referenceImage ?? null)

  return { id, project_id: projectId, ...input }
}

export function updateCharacter(characterId: string, input: UpdateCharacterInput): void {
  const db = getDb()

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId) as
    | Character
    | undefined
  if (!char) throw new Error('角色不存在')

  const fields: string[] = []
  const values: unknown[] = []

  if (input.name !== undefined) {
    const existing = db
      .prepare('SELECT id FROM characters WHERE project_id = ? AND name = ? AND id != ?')
      .get(char.project_id, input.name, characterId)
    if (existing) throw new Error(`项目中已存在名为 "${input.name}" 的角色`)

    fields.push('name = ?')
    values.push(input.name)
  }
  if (input.description !== undefined) {
    fields.push('description = ?')
    values.push(input.description)
  }
  if (input.referenceImage !== undefined) {
    fields.push('reference_image = ?')
    values.push(input.referenceImage)
  }
  if (input.skinImages !== undefined) {
    fields.push('skin_images = ?')
    values.push(input.skinImages)
  }

  if (fields.length === 0) return

  values.push(characterId)
  db.prepare(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  // 改名全局联动
  if (input.name !== undefined && input.name !== char.name) {
    updateShotPrompts(char.project_id!, char.name, input.name)
  }
}

export function deleteCharacter(characterId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM characters WHERE id = ?').run(characterId)
}

// ========== Scene ==========

export interface CreateSceneInput {
  name: string
  description?: string
  referenceImage?: string
}

export interface UpdateSceneInput {
  name?: string
  description?: string
  referenceImage?: string
}

export function createScene(projectId: string, input: CreateSceneInput): Record<string, unknown> {
  const db = getDb()

  const existing = db
    .prepare('SELECT id FROM scenes WHERE project_id = ? AND name = ?')
    .get(projectId, input.name)
  if (existing) throw new Error(`项目中已存在名为 "${input.name}" 的场景`)

  const id = randomUUID()
  db.prepare(
    `
    INSERT INTO scenes (id, project_id, name, description, reference_image)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(id, projectId, input.name, input.description ?? null, input.referenceImage ?? null)

  return { id, project_id: projectId, ...input }
}

export function updateScene(sceneId: string, input: UpdateSceneInput): void {
  const db = getDb()

  const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId) as Scene | undefined
  if (!scene) throw new Error('场景不存在')

  const fields: string[] = []
  const values: unknown[] = []

  if (input.name !== undefined) {
    const existing = db
      .prepare('SELECT id FROM scenes WHERE project_id = ? AND name = ? AND id != ?')
      .get(scene.project_id, input.name, sceneId)
    if (existing) throw new Error(`项目中已存在名为 "${input.name}" 的场景`)

    fields.push('name = ?')
    values.push(input.name)
  }
  if (input.description !== undefined) {
    fields.push('description = ?')
    values.push(input.description)
  }
  if (input.referenceImage !== undefined) {
    fields.push('reference_image = ?')
    values.push(input.referenceImage)
  }

  if (fields.length === 0) return

  values.push(sceneId)
  db.prepare(`UPDATE scenes SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  // 改名全局联动
  if (input.name !== undefined && input.name !== scene.name) {
    updateShotPrompts(scene.project_id!, scene.name, input.name)
  }
}

export function deleteScene(sceneId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM scenes WHERE id = ?').run(sceneId)
}

// ========== Prop ==========

export interface CreatePropInput {
  name: string
  description?: string
  referenceImage?: string
}

export interface UpdatePropInput {
  name?: string
  description?: string
  referenceImage?: string
}

export function createProp(projectId: string, input: CreatePropInput): Record<string, unknown> {
  const db = getDb()

  const existing = db
    .prepare('SELECT id FROM props WHERE project_id = ? AND name = ?')
    .get(projectId, input.name)
  if (existing) throw new Error(`项目中已存在名为 "${input.name}" 的道具`)

  const id = randomUUID()
  db.prepare(
    `
    INSERT INTO props (id, project_id, name, description, reference_image)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(id, projectId, input.name, input.description ?? null, input.referenceImage ?? null)

  return { id, project_id: projectId, ...input }
}

export function updateProp(propId: string, input: UpdatePropInput): void {
  const db = getDb()

  const prop = db.prepare('SELECT * FROM props WHERE id = ?').get(propId) as Prop | undefined
  if (!prop) throw new Error('道具不存在')

  const fields: string[] = []
  const values: unknown[] = []

  if (input.name !== undefined) {
    const existing = db
      .prepare('SELECT id FROM props WHERE project_id = ? AND name = ? AND id != ?')
      .get(prop.project_id, input.name, propId)
    if (existing) throw new Error(`项目中已存在名为 "${input.name}" 的道具`)

    fields.push('name = ?')
    values.push(input.name)
  }
  if (input.description !== undefined) {
    fields.push('description = ?')
    values.push(input.description)
  }
  if (input.referenceImage !== undefined) {
    fields.push('reference_image = ?')
    values.push(input.referenceImage)
  }

  if (fields.length === 0) return

  fields.push("updated_at = datetime('now', 'localtime')")

  values.push(propId)
  db.prepare(`UPDATE props SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  // 改名全局联动
  if (input.name !== undefined && input.name !== prop.name) {
    updateShotPrompts(prop.project_id!, prop.name, input.name)
  }
}

export function deleteProp(propId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM props WHERE id = ?').run(propId)
}

export function getPropsByProject(projectId: string): Prop[] {
  const db = getDb()
  return db.prepare('SELECT * FROM props WHERE project_id = ?').all(projectId) as Prop[]
}
