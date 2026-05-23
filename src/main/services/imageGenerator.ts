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
  console.log(`[imageGen] resolveProviderConfig called, providerKey="${providerKey}"`)
  if (!providerKey) {
    console.log(`[imageGen] resolveProviderConfig: providerKey empty, returning null`)
    return null
  }

  // 1. 从用户配置的供应商中匹配
  const userProviders = getProviders()
  console.log(`[imageGen] resolveProviderConfig: got ${userProviders.length} providers`)
  for (const p of userProviders) {
    console.log(`[imageGen]   provider key="${(p as any).key}" id="${(p as any).id}" name="${p.name}" baseURL="${p.baseURL}" hasApiKey=${!!(p as any).apiKey}`)
  }

  const userProvider = userProviders.find((p: any) => p.key === providerKey || p.id === providerKey)

  if (userProvider) {
    const apiKey = (userProvider as any)?.apiKey
    console.log(`[imageGen] resolveProviderConfig: matched userProvider name="${userProvider.name}" hasApiKey=${!!apiKey} hasBaseURL=${!!userProvider.baseURL}`)
    if (apiKey && userProvider.baseURL) {
      console.log(`[imageGen] resolveProviderConfig: returning user config`)
      return { baseURL: userProvider.baseURL, apiKey }
    }
    console.log(`[imageGen] resolveProviderConfig: userProvider matched but missing apiKey or baseURL`)
  } else {
    console.log(`[imageGen] resolveProviderConfig: no userProvider matched for key="${providerKey}"`)
  }

  // 2. fallback 到硬编码配置
  const hardcoded = getProvider(providerKey)
  if (hardcoded?.baseURL) {
    console.log(`[imageGen] resolveProviderConfig: fallback to hardcoded baseURL="${hardcoded.baseURL}"`)
    return { baseURL: hardcoded.baseURL, apiKey: '' }
  }

  console.log(`[imageGen] resolveProviderConfig: no config found for "${providerKey}"`)
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

  console.log(`[imageGen] generateImage start: inputModel="${inputModel}" inputChannel="${inputChannel}" inputApiKey="${inputApiKey ? '***' : ''}"`)

  // 第1级：input 参数（前端传入）
  // 第2级：项目配置
  if (!model || !channel) {
    const purposeConfig = projectConfig[purposeKey] || {}
    if (!model) model = purposeConfig.model
    if (!channel) channel = purposeConfig.channel
  }
  console.log(`[imageGen] after level2(projectConfig): model="${model}" channel="${channel}" purposeKey="${purposeKey}" projectConfig=${JSON.stringify(projectConfig[purposeKey] || {})}`)

  // 第3级：全局默认（settings 中的 provider/model）
  if (!model || !channel) {
    const globalProvider = getSetting('provider')
    const globalModel = getSetting('model')
    console.log(`[imageGen] level3(global): globalProvider="${globalProvider}" globalModel="${globalModel}"`)
    if (globalProvider && globalModel) {
      if (!model) model = `${globalProvider}:${globalModel}`
      if (!channel) channel = globalProvider
    }
  }
  console.log(`[imageGen] after level3(global): model="${model}" channel="${channel}"`)

  // 第4级：自动从供应商列表匹配第一个有 apiKey 的供应商
  if (!model || !channel) {
    const providers = getProviders()
    console.log(`[imageGen] level4(auto-match): scanning ${providers.length} providers`)
    for (const p of providers) {
      const pApiKey = (p as any).apiKey
      const pKey = p.key || p.id
      const hasModel = p.models && p.models.length > 0
      console.log(`[imageGen]   checking provider key="${pKey}" name="${p.name}" hasApiKey=${!!pApiKey} hasBaseURL=${!!p.baseURL} hasModels=${hasModel}`)
      if (pApiKey && p.baseURL) {
        const firstModel = p.models?.[0]
        if (firstModel) {
          const modelKey = typeof firstModel === 'string' ? firstModel : firstModel.key
          if (!channel) channel = pKey
          if (!model) model = `${pKey}:${modelKey}`
          console.log(`[imageGen]   -> auto-selected provider="${pKey}" model="${model}"`)
          break
        }
      }
    }
  }
  console.log(`[imageGen] after level4(auto-match): model="${model}" channel="${channel}"`)

  // 4. 统一解析 providerKey，从供应商配置读取 apiKey 和 baseURL
  const providerKey = channel || (model?.includes(':') ? model.split(':')[0] : '')
  console.log(`[imageGen] resolved providerKey="${providerKey}"`)
  if (!apiKey && providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    console.log(`[imageGen] resolveProviderConfig result: ${resolved ? `baseURL="${resolved.baseURL}" hasApiKey=${!!resolved.apiKey}` : 'null'}`)
    if (resolved?.apiKey) {
      apiKey = resolved.apiKey
    }
  }
  console.log(`[imageGen] final before check: model="${model}" channel="${channel}" providerKey="${providerKey}" apiKey="${apiKey ? '***' : ''}"`)

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
  const providers = getProviders()
  if (!apiKey) {
    const errDetail = `未配置 API Key [model=${model}, channel=${channel}, providerKey=${providerKey}, providers=${providers.length}]`
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(errDetail, taskId)
    throw new Error(`${errDetail}，请在设置页配置供应商`)
  }
  if (!model) {
    const errDetail = `未配置生图模型 [channel=${channel}, providerKey=${providerKey}, providers=${providers.length}]`
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(errDetail, taskId)
    throw new Error(`${errDetail}，请在模型配置中选择`)
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
    throw new Error(`无法确定 API 基础地址 [model=${model}, providerKey=${providerKey}]，请检查供应商配置`)
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
