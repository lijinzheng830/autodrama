/**
 * 角色锚点服务（资产图片/分镜帧/视频历史 CRUD + 多角度锚点）
 * 提供资产图片历史管理、分镜图片管理、视频历史管理、多角度锚点生成，以及数据库操作安全断言
 */

import { getDb } from './db'
import { existsSync, unlinkSync } from 'fs'
import { assertValidTableName, assertValidColumnName } from '../utils/sql'

// ===== 多角度锚点类型 =====

export type AnchorAngle = 'front' | 'three_quarter' | 'side' | 'back'

export interface MultiAngleAnchors {
  front?: string       // 正面 (0°) 图片路径
  three_quarter?: string // 45° 侧面图片路径
  side?: string         // 90° 侧面图片路径
  back?: string         // 背面 (180°) 图片路径
  generatedAt?: string  // ISO 生成时间
}

/**
 * 创建/更新角色的多角度锚点记录
 * 将 angle→image_path 映射存入 characters.skin_images (JSON)
 * 同时写入 character_images 历史表（带 angle 元数据标记）
 */
export function createMultiAngle(
  characterId: string,
  anchors: MultiAngleAnchors
): MultiAngleAnchors {
  const db = getDb()

  // 1. 读取现有 skin_images，合并新锚点
  const char = db.prepare('SELECT skin_images FROM characters WHERE id = ?').get(characterId) as
    | { skin_images: string | null }
    | undefined
  if (!char) throw new Error(`角色不存在: ${characterId}`)

  let existing: MultiAngleAnchors = {}
  try {
    if (char.skin_images) existing = JSON.parse(char.skin_images)
  } catch { /* 旧数据非JSON则覆盖 */ }

  const merged: MultiAngleAnchors = {
    ...existing,
    ...anchors,
    generatedAt: anchors.generatedAt || new Date().toISOString()
  }

  // 2. 仅更新 characters.skin_images JSON（不写 character_images，由 generateImage 负责历史记录）
  db.prepare('UPDATE characters SET skin_images = ? WHERE id = ?').run(
    JSON.stringify(merged),
    characterId
  )

  return merged
}

/**
 * 获取角色的多角度锚点数据
 */
export function getMultiAngle(characterId: string): MultiAngleAnchors | null {
  const db = getDb()
  const char = db.prepare('SELECT skin_images FROM characters WHERE id = ?').get(characterId) as
    | { skin_images: string | null }
    | undefined
  if (!char?.skin_images) return null
  try {
    return JSON.parse(char.skin_images)
  } catch {
    return null
  }
}

// ===== 安全断言 =====
// 表名/列名白名单委托给 sql.ts；资产类型/帧类型白名单保留在此文件

/** 允许的资产类型白名单 */
const VALID_ASSET_TYPES = ['character', 'scene', 'prop'] as const
type ValidAssetType = typeof VALID_ASSET_TYPES[number]

/** 允许的帧类型白名单 */
const VALID_FRAME_TYPES = ['first', 'last'] as const
type ValidFrameType = typeof VALID_FRAME_TYPES[number]

export function assertValidAssetType(type: string): asserts type is ValidAssetType {
  if (!VALID_ASSET_TYPES.includes(type as any)) {
    throw new Error(`非法的资产类型: ${type}`)
  }
}

export function assertValidFrameType(frameType: string): asserts frameType is ValidFrameType {
  if (!VALID_FRAME_TYPES.includes(frameType as any)) {
    throw new Error(`非法的帧类型: ${frameType}`)
  }
}

// 表名/列名校验重新导出（白名单在 sql.ts）
export { assertValidTableName, assertValidColumnName } from '../utils/sql'

// ===== 资产图片 CRUD =====

/**
 * 查询资产的历史图片记录
 */
export function getAssetImages(assetType: 'character' | 'scene' | 'prop', assetId: string): any[] {
  assertValidAssetType(assetType)
  const db = getDb()
  const tableMap: Record<string, string> = {
    character: 'character_images',
    scene: 'scene_images',
    prop: 'prop_images'
  }
  const table = tableMap[assetType]
  const idColumn = assetType === 'character' ? 'character_id' : assetType === 'scene' ? 'scene_id' : 'prop_id'
  assertValidTableName(table)
  assertValidColumnName(idColumn)

  return db
    .prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ? ORDER BY created_at DESC`)
    .all(assetId)
}

/**
 * 切换选中历史图片
 */
export function selectAssetImage(
  assetType: 'character' | 'scene' | 'prop',
  assetId: string,
  imageId: string
): void {
  assertValidAssetType(assetType)
  const db = getDb()
  const tableMap: Record<string, string> = {
    character: 'character_images',
    scene: 'scene_images',
    prop: 'prop_images'
  }
  const assetTableMap: Record<string, string> = {
    character: 'characters',
    scene: 'scenes',
    prop: 'props'
  }
  const table = tableMap[assetType]
  const idColumn = assetType === 'character' ? 'character_id' : assetType === 'scene' ? 'scene_id' : 'prop_id'
  assertValidTableName(table)
  assertValidColumnName(idColumn)
  assertValidTableName(assetTableMap[assetType])

  // 取消该资产所有选中
  db.prepare(`UPDATE ${table} SET is_selected = 0 WHERE ${idColumn} = ?`).run(assetId)
  // 选中指定图片
  db.prepare(`UPDATE ${table} SET is_selected = 1 WHERE id = ?`).run(imageId)

  // 更新资产 reference_image
  const imgRow = db.prepare(`SELECT image_path FROM ${table} WHERE id = ?`).get(imageId) as
    | { image_path: string }
    | undefined
  if (imgRow) {
    db.prepare(`UPDATE ${assetTableMap[assetType]} SET reference_image = ? WHERE id = ?`).run(
      imgRow.image_path,
      assetId
    )
  }
}

/**
 * 删除资产历史图片
 */
export function deleteAssetImage(
  assetType: 'character' | 'scene' | 'prop',
  assetId: string,
  imageId: string
): void {
  assertValidAssetType(assetType)
  const db = getDb()
  const tableMap: Record<string, string> = {
    character: 'character_images',
    scene: 'scene_images',
    prop: 'prop_images'
  }
  const table = tableMap[assetType]
  const idColumn = assetType === 'character' ? 'character_id' : assetType === 'scene' ? 'scene_id' : 'prop_id'
  assertValidTableName(table)
  assertValidColumnName(idColumn)

  // 获取要删除的图片信息
  const img = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(imageId) as { image_path: string; is_selected: number } | undefined
  if (!img) throw new Error('图片记录不存在')

  // 删除数据库记录
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(imageId)

  // 如果被删除的是当前选中的，将最新的一张设为选中
  if (img.is_selected) {
    const assetTable = assetType === 'character' ? 'characters' : assetType === 'scene' ? 'scenes' : 'props'
    assertValidTableName(assetTable)
    const latest = db.prepare(`SELECT id FROM ${table} WHERE ${idColumn} = ? ORDER BY created_at DESC LIMIT 1`).get(assetId) as { id: string } | undefined
    if (latest) {
      db.prepare(`UPDATE ${table} SET is_selected = 1 WHERE id = ?`).run(latest.id)
      const latestImg = db.prepare(`SELECT image_path FROM ${table} WHERE id = ?`).get(latest.id) as { image_path: string }
      db.prepare(`UPDATE ${assetTable} SET reference_image = ? WHERE id = ?`).run(latestImg.image_path, assetId)
    } else {
      db.prepare(`UPDATE ${assetTable} SET reference_image = '' WHERE id = ?`).run(assetId)
    }
  }

  // 尝试删除文件
  try {
    if (existsSync(img.image_path)) unlinkSync(img.image_path)
  } catch { /* file may not exist */ }
}

// ===== 分镜图片 CRUD =====

/**
 * 查询分镜的历史图片记录
 */
export function getShotImages(shotId: string, frameType: 'first' | 'last'): any[] {
  const db = getDb()
  return db
    .prepare(`SELECT * FROM shot_images WHERE shot_id = ? AND type = ? ORDER BY created_at DESC`)
    .all(shotId, frameType)
}

/**
 * 切换分镜历史图片选中状态
 */
export function selectShotImage(
  shotId: string,
  frameType: 'first' | 'last',
  imageId: string
): void {
  assertValidFrameType(frameType)
  const db = getDb()

  // 取消该 shot 该 frameType 的所有选中
  db.prepare(`UPDATE shot_images SET is_selected = 0 WHERE shot_id = ? AND type = ?`).run(shotId, frameType)
  // 选中指定图片
  db.prepare(`UPDATE shot_images SET is_selected = 1 WHERE id = ?`).run(imageId)

  // 更新 shots 的 image_path
  const imgRow = db.prepare(`SELECT image_path FROM shot_images WHERE id = ?`).get(imageId) as
    | { image_path: string }
    | undefined
  if (imgRow) {
    const updateColumn = frameType === 'first' ? 'first_frame_image_path' : 'last_frame_image_path'
    assertValidColumnName(updateColumn)
    db.prepare(`UPDATE shots SET ${updateColumn} = ? WHERE id = ?`).run(imgRow.image_path, shotId)
  }
}

/** 删除分镜首帧/尾帧历史图片 */
export function deleteShotImage(shotId: string, imageId: string): void {
  const db = getDb()
  const img = db.prepare('SELECT * FROM shot_images WHERE id = ? AND shot_id = ?').get(imageId, shotId) as { image_path: string; type: string; is_selected: number } | undefined
  if (!img) throw new Error('图片记录不存在')

  db.prepare('DELETE FROM shot_images WHERE id = ?').run(imageId)

  // 如果删除的是当前选中图，自动选最新的一张
  if (img.is_selected) {
    const latest = db.prepare('SELECT id, image_path FROM shot_images WHERE shot_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1').get(shotId, img.type) as { id: string; image_path: string } | undefined
    const col = img.type === 'first' ? 'first_frame_image_path' : 'last_frame_image_path'
    assertValidColumnName(col)
    if (latest) {
      db.prepare('UPDATE shot_images SET is_selected = 1 WHERE id = ?').run(latest.id)
      db.prepare(`UPDATE shots SET ${col} = ? WHERE id = ?`).run(latest.image_path, shotId)
    } else {
      db.prepare(`UPDATE shots SET ${col} = '' WHERE id = ?`).run(shotId)
    }
  }

  try { if (existsSync(img.image_path)) unlinkSync(img.image_path) } catch {}
}

// ===== 视频历史 CRUD =====

export function getShotVideos(shotId: string): any[] {
  const db = getDb()
  return db.prepare('SELECT * FROM shot_videos WHERE shot_id = ? ORDER BY created_at DESC').all(shotId)
}

export function selectShotVideo(shotId: string, videoId: string): void {
  const db = getDb()
  db.prepare('UPDATE shot_videos SET is_selected = 0 WHERE shot_id = ?').run(shotId)
  db.prepare('UPDATE shot_videos SET is_selected = 1 WHERE id = ?').run(videoId)
  const v = db.prepare('SELECT video_path FROM shot_videos WHERE id = ?').get(videoId) as { video_path: string } | undefined
  if (v) db.prepare('UPDATE shots SET video_path = ? WHERE id = ?').run(v.video_path, shotId)
}

/** 删除分镜视频历史记录 */
export function deleteShotVideo(shotId: string, videoId: string): void {
  const db = getDb()
  const v = db.prepare('SELECT * FROM shot_videos WHERE id = ? AND shot_id = ?').get(videoId, shotId) as { video_path: string; is_selected: number } | undefined
  if (!v) throw new Error('视频记录不存在')

  db.prepare('DELETE FROM shot_videos WHERE id = ?').run(videoId)

  if (v.is_selected) {
    const latest = db.prepare('SELECT id, video_path FROM shot_videos WHERE shot_id = ? ORDER BY created_at DESC LIMIT 1').get(shotId) as { id: string; video_path: string } | undefined
    if (latest) {
      db.prepare('UPDATE shot_videos SET is_selected = 1 WHERE id = ?').run(latest.id)
      db.prepare('UPDATE shots SET video_path = ? WHERE id = ?').run(latest.video_path, shotId)
    } else {
      db.prepare("UPDATE shots SET video_path = '' WHERE id = ?").run(shotId)
    }
  }

  try { if (existsSync(v.video_path)) unlinkSync(v.video_path) } catch {}
}
