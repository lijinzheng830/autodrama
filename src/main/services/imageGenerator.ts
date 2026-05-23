import { getDb } from './db'
import { getProject } from './project'
import { getProviders, getSetting } from './settings'
import { getProvider } from './providers'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import axios from 'axios'

/**
 * 统一解析供应商配置：从用户配置 → 硬编码 fallback
 */
function resolveProviderConfig(providerKey: string): { baseURL: string; apiKey: string } | null {
  if (!providerKey) return null

  // 1. 从用户配置的供应商中匹配（先按key/id）
  const userProviders = getProviders()
  let userProvider = userProviders.find((p: any) => p.key === providerKey || p.id === providerKey)

  // 兜底：旧数据可能存的是name，按name再匹配一次
  if (!userProvider) {
    userProvider = userProviders.find((p: any) => p.name === providerKey)
  }

  if (userProvider) {
    const apiKey = (userProvider as any)?.apiKey
    if (apiKey && userProvider.baseURL) {
      return { baseURL: userProvider.baseURL.trim(), apiKey }
    }
  }

  // 2. fallback 到硬编码配置
  const hardcoded = getProvider(providerKey)
  if (hardcoded?.baseURL) {
    return { baseURL: hardcoded.baseURL.trim(), apiKey: '' }
  }

  return null
}

export interface GenerateImageInput {
  projectId: string
  type: 'character' | 'scene' | 'prop'
  assetId: string
  description: string
  stylePrompt?: string
  eraPrompt?: string
  model?: string
  channel?: string
  apiKey?: string
  count?: number
}

export interface GenerateImageResult {
  taskId: string
  imagePaths: string[]
}

/**
 * 统一生图入口：创建任务 → 调用API → 保存图片 → 更新数据库
 */
export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const db = getDb()
  const {
    projectId,
    type,
    assetId,
    description,
    stylePrompt = '',
    eraPrompt = '',
    model: inputModel,
    channel: inputChannel,
    apiKey: inputApiKey,
    count = 1
  } = input

  // 1. 读取项目信息（风格/年代/模型配置）
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const finalStylePrompt = stylePrompt || project.style_prompt || ''
  const finalEraPrompt = eraPrompt || project.era || ''

  // 2. 拼接最终 prompt
  const finalPrompt = [description, finalStylePrompt, finalEraPrompt]
    .filter((s) => s.trim())
    .join(', ')

  // 3. 解析模型配置（四级降级）
  const purposeMap: Record<string, string> = {
    character: 'character_image',
    scene: 'scene_image',
    prop: 'prop_image'
  }
  const purposeKey = purposeMap[type]
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}

  let model = inputModel
  let channel = inputChannel
  let apiKey = inputApiKey

  // 第1级：input 参数（前端传入）
  // 第2级：项目配置
  if (!model || !channel) {
    const purposeConfig = projectConfig[purposeKey] || {}
    if (!model) model = purposeConfig.model
    if (!channel) channel = purposeConfig.channel
  }

  // 第3级：全局模型路由（settings 中的 model_routes）
  if (!model || !channel) {
    const modelRoutesRaw = getSetting('model_routes')
    if (modelRoutesRaw) {
      try {
        const modelRoutes = JSON.parse(modelRoutesRaw as string)
        const routeConfig = modelRoutes[purposeKey]
        if (routeConfig) {
          if (!model && routeConfig.model) model = routeConfig.model
          if (!channel && routeConfig.channel) channel = routeConfig.channel
        }
      } catch (e) {
        // ignore parse error
      }
    }
  }

  // 第4级：全局默认（settings 中的 provider/model）
  if (!model || !channel) {
    const globalProvider = getSetting('provider')
    const globalModel = getSetting('model')
    if (globalProvider && globalModel) {
      if (!model) model = `${globalProvider}:${globalModel}`
      if (!channel) channel = globalProvider
    }
  }

  // 第4级：自动从供应商列表匹配第一个有 apiKey 的供应商
  if (!model || !channel) {
    const providers = getProviders()
    for (const p of providers) {
      const pApiKey = (p as any).apiKey
      if (pApiKey && p.baseURL) {
        const firstModel = p.models?.[0]
        if (firstModel) {
          const modelKey = typeof firstModel === 'string' ? firstModel : firstModel.key
          const pKey = p.key || p.id
          if (!channel) channel = pKey
          if (!model) model = `${pKey}:${modelKey}`
          break
        }
      }
    }
  }

  // 4. 统一解析 providerKey，从供应商配置读取 apiKey 和 baseURL
  let providerKey = channel || (model?.includes(':') ? model.split(':')[0] : '')
  if (!apiKey && providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.apiKey) {
      apiKey = resolved.apiKey
    }
  }

  // 修复：如果四级降级后仍拿不到 apiKey，强制清空 model/channel 执行第4级自动匹配
  if (!apiKey) {
    model = undefined
    channel = undefined
    const providers = getProviders()
    for (const p of providers) {
      const pApiKey = (p as any).apiKey
      if (pApiKey && p.baseURL) {
        const firstModel = p.models?.[0]
        if (firstModel) {
          const modelKey = typeof firstModel === 'string' ? firstModel : firstModel.key
          const pKey = p.key || p.id
          channel = pKey
          model = `${pKey}:${modelKey}`
          break
        }
      }
    }
    providerKey = channel || (model?.includes(':') ? model.split(':')[0] : '')
    if (!apiKey && providerKey) {
      const resolved = resolveProviderConfig(providerKey)
      if (resolved?.apiKey) {
        apiKey = resolved.apiKey
      }
    }
  }

  // 5. 创建 generation_tasks 记录（pending）
  const taskId = randomUUID()
  db.prepare(
    `
    INSERT INTO generation_tasks (
      id, project_id, shot_id, type, purpose, channel, model, status,
      input_params, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))
  `
  ).run(
    taskId,
    projectId,
    null,
    'image',
    type === 'character' ? 'character_reference' : type === 'scene' ? 'scene_reference' : 'prop_reference',
    channel || null,
    model || null,
    JSON.stringify({ assetId, count, description })
  )

  // 6. 如果没有 API Key 或模型，标记失败并返回
  if (!apiKey) {
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run('未配置 API Key', taskId)
    throw new Error('未配置 API Key，请在设置页配置供应商')
  }
  if (!model) {
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run('未配置生图模型', taskId)
    throw new Error('未配置生图模型，请在模型配置中选择')
  }

  // 7. 更新状态为 running，设置 started_at
  db.prepare(
    `UPDATE generation_tasks SET status = 'running', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(taskId)

  try {
    // 8. 调用 OpenAI 兼容格式的生图 API
    const imageUrls = await callImageGenerationAPI(finalPrompt, model, apiKey, channel)

    // 9. 下载并保存图片
    const imageDir = join(project.path, 'assets', 'images', `${type}s`)
    mkdirSync(imageDir, { recursive: true })

    const imagePaths: string[] = []
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i]
      const ext = url.startsWith('data:') ? 'png' : 'png'
      const fileName = `${assetId}_${Date.now()}_${i}.${ext}`
      const filePath = join(imageDir, fileName)

      if (url.startsWith('data:')) {
        // base64 数据
        const base64Data = url.split(',')[1]
        writeFileSync(filePath, Buffer.from(base64Data, 'base64'))
      } else {
        // URL 下载
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 })
        writeFileSync(filePath, Buffer.from(resp.data))
      }
      imagePaths.push(filePath)
    }

    // 10. 写入历史表，新图自动选中（is_selected=1），旧图取消选中
    const tableMap: Record<string, string> = {
      character: 'character_images',
      scene: 'scene_images',
      prop: 'prop_images'
    }
    const historyTable = tableMap[type]
    const idColumn = type === 'character' ? 'character_id' : type === 'scene' ? 'scene_id' : 'prop_id'

    // 先取消该资产所有旧图的选中状态
    db.prepare(
      `UPDATE ${historyTable} SET is_selected = 0 WHERE ${idColumn} = ?`
    ).run(assetId)

    // 插入新图记录
    for (const imgPath of imagePaths) {
      db.prepare(
        `INSERT INTO ${historyTable} (id, ${idColumn}, image_path, is_selected, created_at) VALUES (?, ?, ?, 1, datetime('now'))`
      ).run(randomUUID(), assetId, imgPath)
    }

    // 11. 更新资产的 reference_image 为第一张新图
    const assetTableMap: Record<string, string> = {
      character: 'characters',
      scene: 'scenes',
      prop: 'props'
    }
    db.prepare(
      `UPDATE ${assetTableMap[type]} SET reference_image = ? WHERE id = ?`
    ).run(imagePaths[0], assetId)

    // 12. 更新任务状态为 completed
    db.prepare(
      `UPDATE generation_tasks SET status = 'completed', output_path = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(imagePaths.join(','), taskId)

    return { taskId, imagePaths }
  } catch (err: any) {
    const errorMsg = err?.message || '生图失败'
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(errorMsg, taskId)
    throw err
  }
}

/**
 * 调用 OpenAI 兼容格式的 /v1/images/generations
 */
async function callImageGenerationAPI(
  prompt: string,
  model: string,
  apiKey: string,
  channel?: string | null
): Promise<string[]> {
  // 解析 provider 和 modelKey
  let baseURL = ''
  let actualModel = model

  const providerKey = channel || (model.includes(':') ? model.split(':')[0] : '')
  if (providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.baseURL) {
      baseURL = resolved.baseURL
    }
  }

  if (model.includes(':')) {
    actualModel = model.split(':').slice(1).join(':')
  }

  if (!baseURL) {
    throw new Error('无法确定 API 基础地址，请检查供应商配置')
  }

  // 自动补 /v1：去掉末尾斜杠后，如果不以 /v1 结尾则补上
  let normalizedBaseURL = baseURL.replace(/\/$/, '')
  if (!normalizedBaseURL.endsWith('/v1')) {
    normalizedBaseURL += '/v1'
  }

  const url = `${normalizedBaseURL}/images/generations`

  const resp = await axios.post(
    url,
    {
      prompt,
      model: actualModel
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }
  )

  const data = resp.data?.data || resp.data?.images || []
  const urls: string[] = []
  for (const item of data) {
    if (item.url) urls.push(item.url)
    else if (item.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`)
  }

  if (urls.length === 0) {
    throw new Error('API 返回为空')
  }

  return urls
}

/**
 * 查询资产的历史图片记录
 */
export function getAssetImages(assetType: 'character' | 'scene' | 'prop', assetId: string): any[] {
  const db = getDb()
  const tableMap: Record<string, string> = {
    character: 'character_images',
    scene: 'scene_images',
    prop: 'prop_images'
  }
  const table = tableMap[assetType]
  const idColumn = assetType === 'character' ? 'character_id' : assetType === 'scene' ? 'scene_id' : 'prop_id'

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

// ===== 分镜首帧/尾帧生图 =====

import type { GenerateShotImageInput } from '../types'

/**
 * 生成分镜首帧/尾帧图片
 */
export async function generateShotImage(input: GenerateShotImageInput): Promise<GenerateImageResult> {
  const db = getDb()
  const {
    projectId,
    shotId,
    frameType,
    model: inputModel,
    channel: inputChannel,
    count = 1
  } = input

  // 1. 读取 shot 数据
  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId) as
    | {
        id: string
        first_frame_prompt: string | null
        last_frame_prompt: string | null
      }
    | undefined
  if (!shot) throw new Error('分镜不存在')

  const shotPrompt = frameType === 'first'
    ? (shot.first_frame_prompt || '')
    : (shot.last_frame_prompt || '')
  if (!shotPrompt.trim()) {
    throw new Error(`${frameType === 'first' ? '首帧' : '尾帧'}提示词为空，请先在表格中填写提示词`)
  }

  // 2. 读取项目信息
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const finalStylePrompt = project.style_prompt || ''
  const finalEraPrompt = project.era || ''

  // 3. 拼接最终 prompt
  const finalPrompt = [shotPrompt, finalStylePrompt, finalEraPrompt]
    .filter((s) => s.trim())
    .join(', ')

  // 4. 解析模型配置（四级降级）
  const purposeKey = frameType === 'first' ? 'first_frame' : 'last_frame'
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}

  let model = inputModel
  let channel = inputChannel
  let apiKey: string | undefined = undefined

  // L1: input 参数
  // L2: 项目配置
  if (!model || !channel) {
    const purposeConfig = projectConfig[purposeKey] || {}
    if (!model) model = purposeConfig.model
    if (!channel) channel = purposeConfig.channel
  }

  // L3: 全局模型路由
  if (!model || !channel) {
    const modelRoutesRaw = getSetting('model_routes')
    if (modelRoutesRaw) {
      try {
        const modelRoutes = JSON.parse(modelRoutesRaw as string)
        const routeConfig = modelRoutes[purposeKey]
        if (routeConfig) {
          if (!model && routeConfig.model) model = routeConfig.model
          if (!channel && routeConfig.channel) channel = routeConfig.channel
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // L4: 全局默认 settings
  if (!model || !channel) {
    const globalProvider = getSetting('provider')
    const globalModel = getSetting('model')
    if (globalProvider && globalModel) {
      if (!model) model = `${globalProvider}:${globalModel}`
      if (!channel) channel = globalProvider
    }
  }

  // L4b: 自动匹配第一个有 apiKey 的供应商
  if (!model || !channel) {
    const providers = getProviders()
    for (const p of providers) {
      const pApiKey = (p as any).apiKey
      if (pApiKey && p.baseURL) {
        const firstModel = p.models?.[0]
        if (firstModel) {
          const modelKey = typeof firstModel === 'string' ? firstModel : firstModel.key
          const pKey = p.key || p.id
          if (!channel) channel = pKey
          if (!model) model = `${pKey}:${modelKey}`
          break
        }
      }
    }
  }

  // 5. 统一解析 providerKey，读取 apiKey 和 baseURL
  let providerKey = channel || (model?.includes(':') ? model.split(':')[0] : '')
  if (!apiKey && providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.apiKey) {
      apiKey = resolved.apiKey
    }
  }

  // 修复：如果四级降级后仍拿不到 apiKey，强制清空 model/channel 执行第4级自动匹配
  if (!apiKey) {
    model = undefined
    channel = undefined
    const providers = getProviders()
    for (const p of providers) {
      const pApiKey = (p as any).apiKey
      if (pApiKey && p.baseURL) {
        const firstModel = p.models?.[0]
        if (firstModel) {
          const modelKey = typeof firstModel === 'string' ? firstModel : firstModel.key
          const pKey = p.key || p.id
          channel = pKey
          model = `${pKey}:${modelKey}`
          break
        }
      }
    }
    providerKey = channel || (model?.includes(':') ? model.split(':')[0] : '')
    if (!apiKey && providerKey) {
      const resolved = resolveProviderConfig(providerKey)
      if (resolved?.apiKey) {
        apiKey = resolved.apiKey
      }
    }
  }

  // 6. 创建 generation_tasks 记录
  const taskId = randomUUID()
  db.prepare(
    `
    INSERT INTO generation_tasks (
      id, project_id, shot_id, type, purpose, channel, model, status,
      input_params, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))
  `
  ).run(
    taskId,
    projectId,
    shotId,
    'image',
    purposeKey,
    channel || null,
    model || null,
    JSON.stringify({ shotId, frameType, count, prompt: shotPrompt })
  )

  if (!apiKey) {
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run('未配置 API Key', taskId)
    throw new Error('未配置 API Key，请在设置页配置供应商')
  }
  if (!model) {
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run('未配置生图模型', taskId)
    throw new Error('未配置生图模型，请在模型配置中选择')
  }

  // 7. 更新状态为 running
  db.prepare(
    `UPDATE generation_tasks SET status = 'running', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(taskId)

  try {
    // 8. 调用生图 API
    const imageUrls = await callImageGenerationAPI(finalPrompt, model, apiKey, channel)

    // 9. 下载并保存图片
    const imageDir = join(project.path, 'assets', 'images', 'frames')
    mkdirSync(imageDir, { recursive: true })

    const imagePaths: string[] = []
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i]
      const ext = url.startsWith('data:') ? 'png' : 'png'
      const fileName = `${shotId}_${frameType}_${Date.now()}_${i}.${ext}`
      const filePath = join(imageDir, fileName)

      if (url.startsWith('data:')) {
        const base64Data = url.split(',')[1]
        writeFileSync(filePath, Buffer.from(base64Data, 'base64'))
      } else {
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 })
        writeFileSync(filePath, Buffer.from(resp.data))
      }
      imagePaths.push(filePath)
    }

    // 10. 写入 shot_images 表：新图自动选中，旧图取消选中
    db.prepare(
      `UPDATE shot_images SET is_selected = 0 WHERE shot_id = ? AND type = ?`
    ).run(shotId, frameType)

    for (const imgPath of imagePaths) {
      db.prepare(
        `INSERT INTO shot_images (id, shot_id, image_path, type, is_selected, created_at) VALUES (?, ?, ?, ?, 1, datetime('now'))`
      ).run(randomUUID(), shotId, imgPath, frameType)
    }

    // 11. 更新 shots 表的 image_path
    const updateColumn = frameType === 'first' ? 'first_frame_image_path' : 'last_frame_image_path'
    db.prepare(
      `UPDATE shots SET ${updateColumn} = ? WHERE id = ?`
    ).run(imagePaths[0], shotId)

    // 12. 更新任务状态为 completed
    db.prepare(
      `UPDATE generation_tasks SET status = 'completed', output_path = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(imagePaths.join(','), taskId)

    return { taskId, imagePaths }
  } catch (err: any) {
    const errorMsg = err?.message || '生图失败'
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(errorMsg, taskId)
    throw err
  }
}

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
    db.prepare(`UPDATE shots SET ${updateColumn} = ? WHERE id = ?`).run(imgRow.image_path, shotId)
  }
}
