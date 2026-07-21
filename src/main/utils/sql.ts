/**
 * SQL 安全白名单 — 所有动态表名/列名必须在此白名单中
 */

// ===== 表名白名单 =====
export const SQL_TABLES = [
  'projects',
  'chapters',
  'shots',
  'characters',
  'scenes',
  'props',
  'character_images',
  'scene_images',
  'prop_images',
  'shot_images',
  'shot_videos',
  'shot_characters',
  'shot_scenes',
  'shot_props',
  'generation_tasks',
  'prompt_templates',
  'settings',
  'character_anchors'
] as const

export type SqlTable = typeof SQL_TABLES[number]

// ===== 列名白名单（按表分组） =====
export const SQL_COLUMNS: Record<string, readonly string[]> = {
  projects: ['id', 'name', 'path', 'style_name', 'style_prompt', 'style_negative_prompt',
    'aspect_ratio', 'script_text', 'era', 'model_config_json', 'created_at', 'updated_at'],
  chapters: ['id', 'project_id', 'title', 'chapter_index', 'created_at'],
  shots: ['id', 'chapter_id', 'shot_index', 'description', 'description_zh',
    'dialogue', 'narration', 'shot_type', 'camera_movement', 'lighting_mood',
    'character_actions', 'first_frame_prompt', 'first_frame_prompt_zh', 'first_frame_image_path',
    'last_frame_prompt', 'last_frame_prompt_zh', 'last_frame_image_path',
    'video_prompt', 'video_prompt_zh', 'video_path', 'created_at'],
  characters: ['id', 'project_id', 'name', 'description', 'description_zh',
    'reference_image', 'skin_images', 'created_at'],
  scenes: ['id', 'project_id', 'name', 'description', 'description_zh',
    'reference_image', 'created_at'],
  props: ['id', 'project_id', 'name', 'description', 'description_zh',
    'reference_image', 'created_at'],
  character_images: ['id', 'character_id', 'image_path', 'is_selected', 'created_at'],
  scene_images: ['id', 'scene_id', 'image_path', 'is_selected', 'created_at'],
  prop_images: ['id', 'prop_id', 'image_path', 'is_selected', 'created_at'],
  shot_images: ['id', 'shot_id', 'image_path', 'type', 'is_selected', 'created_at'],
  shot_videos: ['id', 'shot_id', 'video_path', 'is_selected', 'has_new_badge', 'created_at'],
  shot_characters: ['shot_id', 'character_id'],
  shot_scenes: ['shot_id', 'scene_id'],
  shot_props: ['id', 'shot_id', 'prop_id'],
  generation_tasks: ['id', 'project_id', 'shot_id', 'type', 'purpose', 'channel',
    'model', 'status', 'error_message', 'output_path', 'input_params',
    'started_at', 'created_at', 'updated_at'],
  prompt_templates: ['id', 'name', 'content', 'template_version', 'category', 'usage', 'created_at'],
  settings: ['key', 'value', 'created_at', 'updated_at'],
  character_anchors: ['character_id', 'front', 'three_quarter', 'side', 'back', 'generated_at']
}

// ===== 断言函数 =====

export function assertValidTableName(table: string): void {
  if (!(SQL_TABLES as readonly string[]).includes(table)) {
    throw new Error(`非法的表名: ${table}`)
  }
}

export function assertValidColumnName(column: string, table?: string): void {
  // 如果有表名上下文，做精确校验
  if (table) {
    assertValidTableName(table)
    const allowed = SQL_COLUMNS[table]
    if (allowed && !(allowed as readonly string[]).includes(column)) {
      throw new Error(`非法的列名: ${table}.${column}`)
    }
    return
  }
  // 无表名上下文时，在所有列中查找（兼容旧代码）
  for (const cols of Object.values(SQL_COLUMNS)) {
    if ((cols as readonly string[]).includes(column)) return
  }
  throw new Error(`非法的列名: ${column}`)
}

/**
 * 安全构建动态 SET 子句 — 校验每个字段名在白名单中
 */
export function buildSafeUpdateSet<T extends Record<string, any>>(
  table: string,
  input: T,
  fieldMap: Record<string, string>
): { fields: string[]; values: any[] } {
  assertValidTableName(table)
  const allowed = SQL_COLUMNS[table]
  if (!allowed) throw new Error(`未知表: ${table}`)

  const fields: string[] = []
  const values: any[] = []

  for (const [inputKey, dbColumn] of Object.entries(fieldMap)) {
    if (input[inputKey] !== undefined) {
      if (!(allowed as readonly string[]).includes(dbColumn)) {
        throw new Error(`非法的列名: ${table}.${dbColumn}`)
      }
      fields.push(`${dbColumn} = ?`)
      values.push(input[inputKey])
    }
  }

  return { fields, values }
}
