/**
 * 风格模板服务
 * 提供13种预设风格的查询，以及生图时自动注入风格参考图
 */

import { getDb } from './db'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'

export interface StyleTemplate {
  id: string
  name: string
  key: string
  prompt: string | null
  negativePrompt: string | null
  characterRefImage: string | null
  sceneRefImage: string | null
  gridRefImage: string | null
  styleRefImage: string | null
  colorScheme: string | null
  sortOrder: number
}

/** 读取所有风格模板 */
export function getStyleTemplates(): StyleTemplate[] {
  const db = getDb()
  const rows = db.prepare(
    'SELECT id, name, key, prompt, negative_prompt, character_ref_image, scene_ref_image, grid_ref_image, style_ref_image, color_scheme, sort_order FROM style_templates ORDER BY sort_order'
  ).all() as any[]
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    key: r.key,
    prompt: r.prompt,
    negativePrompt: r.negative_prompt,
    characterRefImage: r.character_ref_image,
    sceneRefImage: r.scene_ref_image,
    gridRefImage: r.grid_ref_image,
    styleRefImage: r.style_ref_image,
    colorScheme: r.color_scheme,
    sortOrder: r.sort_order,
  }))
}

/** 根据 key 读取单个风格 */
export function getStyleByKey(key: string): StyleTemplate | null {
  const db = getDb()
  const r = db.prepare(
    'SELECT id, name, key, prompt, negative_prompt, character_ref_image, scene_ref_image, grid_ref_image, style_ref_image, color_scheme, sort_order FROM style_templates WHERE key = ?'
  ).get(key) as any
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    key: r.key,
    prompt: r.prompt,
    negativePrompt: r.negative_prompt,
    characterRefImage: r.character_ref_image,
    sceneRefImage: r.scene_ref_image,
    gridRefImage: r.grid_ref_image,
    styleRefImage: r.style_ref_image,
    colorScheme: r.color_scheme,
    sortOrder: r.sort_order,
  }
}

/** 根据项目风格名查找匹配的风格模板 */
export function findStyleByName(styleName: string): StyleTemplate | null {
  const all = getStyleTemplates()
  // 先精确匹配
  const exact = all.find(s => s.name === styleName || s.key === styleName)
  if (exact) return exact
  // 模糊匹配（包含关系）
  return all.find(s => styleName.includes(s.name) || s.name.includes(styleName)) || null
}

/** 将数据库相对路径解析为绝对路径 */
export function resolveStyleImagePath(relativePath: string | null): string | null {
  if (!relativePath) return null
  // 优先尝试 app.getAppPath()
  let basePath = app.getAppPath()
  if (basePath.endsWith('.asar')) {
    basePath = join(basePath, '..')
  }
  let fullPath = join(basePath, relativePath)
  // 检查文件是否存在
  try {
    if (existsSync(fullPath)) return fullPath
  } catch {}
  // fallback：尝试 process.cwd()
  try {
    const cwdPath = join(process.cwd(), relativePath)
    if (existsSync(cwdPath)) return cwdPath
  } catch {}
  // 都找不到返回 null
  return null
}
