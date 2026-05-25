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
  taskId?: string
  templateId?: string
  refImage?: string
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
    count = 1,
    taskId: inputTaskId,
    templateId
  } = input

  // 1. 读取项目信息（风格/年代/模型配置）
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const finalStylePrompt = stylePrompt || project.style_prompt || ''
  const finalEraPrompt = eraPrompt || project.era || ''

  // 2. 加载模板内容（如有指定）
  let templateContent = ''
  if (templateId) {
    try {
      const template = db.prepare('SELECT content FROM prompt_templates WHERE id = ?').get(templateId) as { content: string } | undefined
      if (template) templateContent = template.content
    } catch { /* ignore */ }
  }

  // 3. 拼接最终 prompt：模板替换变量 + 描述 + 风格 + 年代
  let finalPrompt = templateContent
    ? templateContent.replace(/\{\{描述\}\}/g, description).replace(/\{\{角色描述\}\}/g, description)
    : description
  if (templateContent && finalPrompt === templateContent) {
    // 模板不含变量，追加描述
    finalPrompt = templateContent + '\n' + description
  }
  finalPrompt = [finalPrompt, finalStylePrompt, finalEraPrompt].filter((s) => s.trim()).join(', ')

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

  // 5. 创建或复用 generation_tasks 记录
  const purpose = type === 'character' ? 'character_reference' : type === 'scene' ? 'scene_reference' : 'prop_reference'
  let taskId: string
  if (inputTaskId) {
    taskId = inputTaskId
    // 更新 model/channel（执行时解析的可能比预创建时更精确）
    db.prepare(
      `UPDATE generation_tasks SET model = COALESCE(?, model), channel = COALESCE(?, channel), updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(model || null, channel || null, taskId)
  } else {
    taskId = randomUUID()
    db.prepare(
      `
      INSERT INTO generation_tasks (
        id, project_id, shot_id, type, purpose, channel, model, status,
        input_params, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `
    ).run(
      taskId,
      projectId,
      null,
      'image',
      purpose,
      channel || null,
      model || null,
      JSON.stringify({ assetId, count, description })
    )
  }

  // 6. 如果没有 API Key 或模型，标记失败并返回
  if (!apiKey) {
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run('未配置 API Key', taskId)
    throw new Error('未配置 API Key，请在设置页配置供应商')
  }
  if (!model) {
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run('未配置生图模型', taskId)
    throw new Error('未配置生图模型，请在模型配置中选择')
  }

  // 7. 更新状态为 running，设置 started_at
  db.prepare(
    `UPDATE generation_tasks SET status = 'running', started_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(taskId)

  try {
    // 8. 调用 OpenAI 兼容格式的生图 API
    const imageUrls = await callImageGenerationAPI(finalPrompt, model, apiKey, channel, input.refImage)

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
        `INSERT INTO ${historyTable} (id, ${idColumn}, image_path, is_selected, created_at) VALUES (?, ?, ?, 1, datetime('now', 'localtime'))`
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
      `UPDATE generation_tasks SET status = 'completed', output_path = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(imagePaths.join(','), taskId)

    return { taskId, imagePaths }
  } catch (err: any) {
    const errorMsg = err?.message || '生图失败'
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
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
  channel?: string | null,
  refImage?: string | null
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

  console.log('[imageGenerator] baseURL:', normalizedBaseURL, 'model:', actualModel, 'apiKey:', apiKey.substring(0, 15) + '...')
  let lastError = ''
  // 先尝试 /v1/images/generations（标准生图端点）
  let resp = await tryImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImage)

  // 如果 images 端点失败(404/500/网络错误)，回退到 chat completions 端点
  if (!resp) {
    console.log('[imageGenerator] /images/generations failed, falling back to /chat/completions')
    lastError = lastImageError
    resp = await tryChatImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImage)
    if (!resp && lastChatError) lastError = lastChatError
  }

  if (!resp) {
    throw new Error(lastError || '生图 API 不可用，请检查供应商配置和账户余额')
  }

  const data = resp.data?.data || resp.data?.images || resp.choices?.[0]?.message?.content || []
  const urls: string[] = []
  for (const item of Array.isArray(data) ? data : [data]) {
    if (typeof item === 'string') {
      // 可能是 base64 或 URL
      if (item.startsWith('data:')) urls.push(item)
      else if (item.startsWith('http')) urls.push(item)
      else if (item.length > 100) urls.push(`data:image/png;base64,${item}`)
    } else if (item.url) urls.push(item.url)
    else if (item.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`)
    else if (item.image_url) urls.push(item.image_url)
  }

  if (urls.length === 0) {
    throw new Error('API 返回为空或无法解析图片数据')
  }

  return urls
}

let lastImageError = ''
let lastChatError = ''

async function tryImageAPI(baseURL: string, model: string, prompt: string, apiKey: string, refImage?: string | null): Promise<any> {
  try {
    const url = `${baseURL}/images/generations`
    const body: any = { prompt, model, n: 1 }
    if (refImage) {
      try {
        const fs = require('fs')
        const imgBuffer = fs.readFileSync(refImage)
        body.image = imgBuffer.toString('base64')
      } catch { /* refImage file not readable, skip */ }
    }
    return await axios.post(url, body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000
    })
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.response?.data || e?.message || ''
    lastImageError = typeof msg === 'string' ? msg : JSON.stringify(msg)
    console.error('[tryImageAPI] Error:', e?.response?.status, lastImageError)
    return null
  }
}

async function tryChatImageAPI(baseURL: string, model: string, prompt: string, apiKey: string, refImage?: string | null): Promise<any> {
  try {
    const url = `${baseURL}/chat/completions`
    const userContent: any[] = [{ type: 'text', text: `Generate an image based on this description: ${prompt}. Return only the image.` }]
    if (refImage) {
      try {
        const fs = require('fs')
        const imgBuffer = fs.readFileSync(refImage)
        const ext = refImage.split('.').pop()?.toLowerCase() || 'png'
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
        userContent.unshift({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${imgBuffer.toString('base64')}` }
        })
      } catch { /* refImage file not readable, skip */ }
    }
    return await axios.post(url, {
      model,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 4096
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000
    })
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.response?.data || e?.message || ''
    lastChatError = typeof msg === 'string' ? msg : JSON.stringify(msg)
    console.error('[tryChatImageAPI] Error:', e?.response?.status, lastChatError)
    return null
  }
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
    count = 1,
    taskId: inputTaskId
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

  // 3. 读取模型配置（模板和参考图）
  const purposeKey = frameType === 'first' ? 'first_frame' : 'last_frame'
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  const purposeConfig = projectConfig[purposeKey] || {}
  const templateId = input.templateId || purposeConfig.templateId || ''
  const refImage = input.refImage || purposeConfig.refImage || ''

  // 4. 加载模板并拼接 prompt
  let templateContent = ''
  if (templateId) {
    try {
      const template = db.prepare('SELECT content FROM prompt_templates WHERE id = ?').get(templateId) as { content: string } | undefined
      if (template) templateContent = template.content
    } catch { /* ignore */ }
  }
  let finalPrompt = templateContent
    ? templateContent.replace(/\{\{描述\}\}/g, shotPrompt).replace(/\{\{分镜描述\}\}/g, shotPrompt)
    : shotPrompt
  if (templateContent && finalPrompt === templateContent) {
    finalPrompt = templateContent + '\n' + shotPrompt
  }
  finalPrompt = [finalPrompt, finalStylePrompt, finalEraPrompt]
    .filter((s) => s.trim())
    .join(', ')

  // 5. 解析模型配置（四级降级）

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

  // 6. 创建或复用 generation_tasks 记录
  let taskId: string
  if (inputTaskId) {
    taskId = inputTaskId
    db.prepare(
      `UPDATE generation_tasks SET model = COALESCE(?, model), channel = COALESCE(?, channel), updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(model || null, channel || null, taskId)
  } else {
    taskId = randomUUID()
    db.prepare(
      `
      INSERT INTO generation_tasks (
        id, project_id, shot_id, type, purpose, channel, model, status,
        input_params, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
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
  }

  if (!apiKey) {
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run('未配置 API Key', taskId)
    throw new Error('未配置 API Key，请在设置页配置供应商')
  }
  if (!model) {
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run('未配置生图模型', taskId)
    throw new Error('未配置生图模型，请在模型配置中选择')
  }

  // 7. 更新状态为 running
  db.prepare(
    `UPDATE generation_tasks SET status = 'running', started_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(taskId)

  try {
    // 8. 调用生图 API
    const imageUrls = await callImageGenerationAPI(finalPrompt, model, apiKey, channel, refImage)

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

    // 10. 写入 shot_images 表
    db.prepare(
      `UPDATE shot_images SET is_selected = 0 WHERE shot_id = ? AND type = ?`
    ).run(shotId, frameType)

    for (const imgPath of imagePaths) {
      db.prepare(
        `INSERT INTO shot_images (id, shot_id, image_path, type, is_selected, created_at) VALUES (?, ?, ?, ?, 1, datetime('now', 'localtime'))`
      ).run(randomUUID(), shotId, imgPath, frameType)
    }

    // 11. 更新 shots 表
    const updateColumn = frameType === 'first' ? 'first_frame_image_path' : 'last_frame_image_path'
    db.prepare(
      `UPDATE shots SET ${updateColumn} = ? WHERE id = ?`
    ).run(imagePaths[0], shotId)

    // 12. 更新任务状态为 completed
    db.prepare(
      `UPDATE generation_tasks SET status = 'completed', output_path = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(imagePaths.join(','), taskId)

    return { taskId, imagePaths }
  } catch (err: any) {
    const errorMsg = err?.message || '生图失败'
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
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
 * 删除资产历史图片
 */
export function deleteAssetImage(
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
  const table = tableMap[assetType]
  const idColumn = assetType === 'character' ? 'character_id' : assetType === 'scene' ? 'scene_id' : 'prop_id'

  // 获取要删除的图片信息
  const img = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(imageId) as { image_path: string; is_selected: number } | undefined
  if (!img) throw new Error('图片记录不存在')

  // 删除数据库记录
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(imageId)

  // 如果被删除的是当前选中的，将最新的一张设为选中
  if (img.is_selected) {
    const latest = db.prepare(`SELECT id FROM ${table} WHERE ${idColumn} = ? ORDER BY created_at DESC LIMIT 1`).get(assetId) as { id: string } | undefined
    if (latest) {
      db.prepare(`UPDATE ${table} SET is_selected = 1 WHERE id = ?`).run(latest.id)
      // 更新资产 reference_image
      const latestImg = db.prepare(`SELECT image_path FROM ${table} WHERE id = ?`).get(latest.id) as { image_path: string }
      const assetTable = assetType === 'character' ? 'characters' : assetType === 'scene' ? 'scenes' : 'props'
      db.prepare(`UPDATE ${assetTable} SET reference_image = ? WHERE id = ?`).run(latestImg.image_path, assetId)
    } else {
      // 没有其他图片了，清空 reference_image
      const assetTable = assetType === 'character' ? 'characters' : assetType === 'scene' ? 'scenes' : 'props'
      db.prepare(`UPDATE ${assetTable} SET reference_image = '' WHERE id = ?`).run(assetId)
    }
  }

  // 尝试删除文件
  try {
    const fs = require('fs')
    if (fs.existsSync(img.image_path)) fs.unlinkSync(img.image_path)
  } catch { /* file may not exist */ }
}

// ===== 视频生成 =====

export interface GenerateVideoInput {
  projectId: string
  shotId: string
  model?: string
  channel?: string
  taskId?: string
}

export async function generateShotVideo(input: GenerateVideoInput): Promise<{ taskId: string; videoPaths: string[] }> {
  const db = getDb()
  const { projectId, shotId, model: inputModel, channel: inputChannel, taskId: inputTaskId } = input

  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId) as { video_prompt: string | null } | undefined
  if (!shot) throw new Error('分镜不存在')

  const videoPrompt = shot.video_prompt || ''
  if (!videoPrompt.trim()) throw new Error('视频提示词为空，请先填写')

  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const finalStylePrompt = project.style_prompt || ''
  const finalPrompt = [videoPrompt, finalStylePrompt].filter(s => s.trim()).join(', ')

  // 模型配置降级
  const purposeKey = 'video'
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  const purposeConfig = projectConfig[purposeKey] || {}

  let model = inputModel
  let channel = inputChannel
  let apiKey: string | undefined

  if (!model || !channel) {
    if (!model) model = purposeConfig.model
    if (!channel) channel = purposeConfig.channel
  }
  if (!model || !channel) {
    const routesRaw = getSetting('model_routes')
    if (routesRaw) {
      try {
        const routes = JSON.parse(routesRaw as string)
        const rc = routes[purposeKey]
        if (!model && rc?.model) model = rc.model
        if (!channel && rc?.channel) channel = rc.channel
      } catch { /* ignore */ }
    }
  }

  let providerKey = channel || (model?.includes(':') ? model.split(':')[0] : '')
  if (providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.apiKey) apiKey = resolved.apiKey
  }

  if (!apiKey) throw new Error('未配置 API Key')
  if (!model) throw new Error('未配置视频模型')

  // 创建任务记录
  let taskId: string
  if (inputTaskId) {
    taskId = inputTaskId
    db.prepare(`UPDATE generation_tasks SET model=COALESCE(?,model), channel=COALESCE(?,channel), updated_at=datetime('now','localtime') WHERE id=?`)
      .run(model||null, channel||null, taskId)
  } else {
    taskId = randomUUID()
    db.prepare(`INSERT INTO generation_tasks (id,project_id,shot_id,type,purpose,channel,model,status,input_params,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,datetime('now','localtime'),datetime('now','localtime'))`)
      .run(taskId, projectId, shotId, 'video', 'video', channel||null, model||null, JSON.stringify({ shotId, prompt: videoPrompt }))
  }

  db.prepare(`UPDATE generation_tasks SET status='running',started_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?`).run(taskId)

  try {
    const videoUrls = await callVideoGenerationAPI(finalPrompt, model, apiKey, channel)
    const videoDir = join(project.path, 'assets', 'videos')
    mkdirSync(videoDir, { recursive: true })

    const videoPaths: string[] = []
    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i]
      const fileName = `${shotId}_video_${Date.now()}_${i}.mp4`
      const filePath = join(videoDir, fileName)
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 300000, headers: { Authorization: `Bearer ${apiKey}` } })
      writeFileSync(filePath, Buffer.from(resp.data))
      videoPaths.push(filePath)
    }

    db.prepare(`UPDATE shot_videos SET is_selected=0 WHERE shot_id=?`).run(shotId)
    for (const vp of videoPaths) {
      db.prepare(`INSERT INTO shot_videos (id,shot_id,video_path,is_selected,has_new_badge,created_at) VALUES (?,?,?,1,1,datetime('now','localtime'))`).run(randomUUID(), shotId, vp)
    }
    db.prepare(`UPDATE shots SET video_path=? WHERE id=?`).run(videoPaths[0], shotId)
    db.prepare(`UPDATE generation_tasks SET status='completed',output_path=?,updated_at=datetime('now','localtime') WHERE id=?`).run(videoPaths.join(','), taskId)

    return { taskId, videoPaths }
  } catch (err: any) {
    db.prepare(`UPDATE generation_tasks SET status='failed',error_message=?,updated_at=datetime('now','localtime') WHERE id=?`).run(err?.message||'视频生成失败', taskId)
    throw err
  }
}

async function callVideoGenerationAPI(prompt: string, model: string, apiKey: string, channel?: string | null): Promise<string[]> {
  let baseURL = ''
  let actualModel = model
  const providerKey = channel || (model.includes(':') ? model.split(':')[0] : '')
  if (providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.baseURL) baseURL = resolved.baseURL
  }
  if (model.includes(':')) actualModel = model.split(':').slice(1).join(':')
  if (!baseURL) throw new Error('无法确定 API 基础地址')

  let normalizedBaseURL = baseURL.replace(/\/$/, '')
  if (!normalizedBaseURL.endsWith('/v1')) normalizedBaseURL += '/v1'

  // 提交视频生成任务
  const createResp = await axios.post(`${normalizedBaseURL}/video/generations`, {
    model: actualModel, prompt, size: '720p'
  }, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 120000
  })
  const taskId = createResp.data?.task_id || createResp.data?.id
  if (!taskId) throw new Error('视频任务创建失败：未返回 task_id')

  // 轮询等待完成
  let videoUrl = ''
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 5000))
    const statusResp = await axios.get(`${normalizedBaseURL}/video/generations/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30000
    })
    const s = statusResp.data?.data || statusResp.data  // 兼容 data 嵌套
    const st = (s?.status || '').toUpperCase()
    console.log(`[video] poll ${attempt+1}: status=${st} progress=${s?.progress||'?'}`)
    if (st === 'COMPLETED' || st === 'SUCCESS') {
      // 尝试多个可能的 URL 字段（manxueapi 返回 result_url）
      videoUrl = s?.result_url || s?.video_url || s?.url || ''
      if (!videoUrl && s?.data) {
        const inner = s.data
        videoUrl = inner?.result_url || inner?.url || inner?.video_url || ''
        if (!videoUrl && inner?.output) {
          videoUrl = typeof inner.output === 'string' ? inner.output : inner.output?.url || ''
        }
        if (!videoUrl && inner?.result) {
          videoUrl = typeof inner.result === 'string' ? inner.result : inner.result?.url || ''
        }
        if (!videoUrl && inner?.video) {
          videoUrl = typeof inner.video === 'string' ? inner.video : inner.video?.url || ''
        }
      }
      if (!videoUrl) {
        // 深度搜索：遍历 data 对象查找 URL
        const findURL = (obj: any): string => {
          if (typeof obj === 'string' && (obj.startsWith('http://') || obj.startsWith('https://'))) return obj
          if (typeof obj === 'object' && obj) {
            for (const v of Object.values(obj)) {
              const found = findURL(v)
              if (found) return found
            }
          }
          return ''
        }
        videoUrl = findURL(s)
      }
      break
    }
    if (st === 'FAILED' || st === 'ERROR') {
      throw new Error(`视频生成失败: ${s?.fail_reason || s?.error?.message || '未知错误'}`)
    }
  }
  if (!videoUrl) throw new Error('视频生成超时（5分钟），请重试')

  return [videoUrl]
}

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
