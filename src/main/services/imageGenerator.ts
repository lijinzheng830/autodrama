import { getDb } from './db'
import { getProject } from './project'
import { getProviders } from './settings'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import axios from 'axios'

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

  // 3. 解析模型配置（从项目配置或输入参数）
  let model = inputModel
  let channel = inputChannel
  let apiKey = inputApiKey

  if (!model || !apiKey) {
    const config = project.model_config_json ? JSON.parse(project.model_config_json) : {}
    const purposeMap: Record<string, string> = {
      character: 'character_image',
      scene: 'scene_image',
      prop: 'prop_image'
    }
    const purposeKey = purposeMap[type]
    const purposeConfig = config[purposeKey] || {}

    if (!model) model = purposeConfig.model
    if (!channel) channel = purposeConfig.channel
  }

  // 4. 如果没有直接传入 apiKey，从供应商配置读取
  if (!apiKey) {
    const providers = getProviders()
    const providerKey = channel || model?.split(':')[0]
    const provider = providers.find((p: any) => p.key === providerKey || p.id === providerKey)
    if ((provider as any)?.apiKey) {
      apiKey = (provider as any).apiKey
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
    const imageUrls = await callImageGenerationAPI(finalPrompt, model, count, apiKey, channel)

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
  n: number,
  apiKey: string,
  channel?: string | null
): Promise<string[]> {
  // 解析 provider 和 modelKey
  let baseURL = ''
  let actualModel = model

  if (model.includes(':')) {
    const [providerKey, modelKey] = model.split(':')
    actualModel = modelKey
    const providers = getProviders()
    const provider = providers.find((p: any) => p.key === providerKey || p.id === providerKey)
    if (provider?.baseURL) {
      baseURL = provider.baseURL
    }
  }

  // 如果 channel 有值也尝试解析
  if (!baseURL && channel) {
    const providers = getProviders()
    const provider = providers.find((p: any) => p.key === channel || p.id === channel)
    if (provider?.baseURL) {
      baseURL = provider.baseURL
    }
  }

  if (!baseURL) {
    throw new Error('无法确定 API 基础地址，请检查供应商配置')
  }

  const url = `${baseURL.replace(/\/$/, '')}/images/generations`

  const resp = await axios.post(
    url,
    {
      prompt,
      model: actualModel,
      n: Math.min(Math.max(n, 1), 4)
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }
  )

  const data = resp.data?.data || []
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
