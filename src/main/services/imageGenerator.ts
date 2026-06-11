/**
 * 统一生图服务（核心管线）
 * 负责资产生图、分镜首尾帧生图、图片 API 调用
 * 模型路由 → modelRouter.ts | 风格映射 → styleMapper.ts | 资产历史 CRUD → characterAnchorService.ts | 视频生成 → videoGenerator.ts
 */

import { getDb } from './db'
import { getProject } from './project'

import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs'
import { randomUUID } from 'crypto'
import axios from 'axios'

import { mapEra, getStylePromptZh, getAPISize, getAnglePrompt, getAngleSize, translateCnField, detectShotType, AnchorAngle } from './styleMapper'
import { resolveModelConfig, resolveProviderConfig } from './modelRouter'
import { assertValidAssetType, assertValidFrameType, assertValidTableName, assertValidColumnName, createMultiAngle } from './characterAnchorService'
import { checkShotConsistency } from './consistencyChecker'
import { IMAGE_API_RETRY_DELAY, AGNES_MAX_REF_IMAGES, IMAGE_API_MAX_RETRIES } from '../utils/constants'

import type { GenerateShotImageInput } from '../types'

// ===== 生图 Trace 日志 =====

interface GenerationTrace {
  ts: string
  type: 'asset' | 'first_frame' | 'last_frame' | 'angle'
  assetId?: string
  shotId?: string
  model: string
  channel: string
  promptLength: number
  promptFirst: string
  refImageCount: number
  charMapping?: string[]
  compositionGuide?: string
  consistencyWarnings?: string[]
  imageCount: number
  durationMs: number
  error?: string
}

function writeTrace(projectPath: string, trace: GenerationTrace): void {
  try {
    const dir = join(projectPath, 'exports')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'generation_trace.jsonl'), JSON.stringify(trace) + '\n', 'utf8')
  } catch { /* 日志写入失败不影响生图 */ }
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
  assertValidAssetType(input.type)
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
  const finalEraPrompt = mapEra(eraPrompt || project.era || '')
  const aspectRatio = project.aspect_ratio || '16:9'

  const aspectHint = aspectRatio || '16:9'
  const styleDesc = finalStylePrompt || 'high quality illustration'

  // 获取资产名称（用于模板变量）
  let assetName = ''
  if (type === 'character' || type === 'scene' || type === 'prop') {
    const table = type === 'character' ? 'characters' : type === 'scene' ? 'scenes' : 'props'
    const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(assetId) as { name: string } | undefined
    if (row) assetName = row.name
  }

  let finalPrompt = ''
  // 加载模板（如有配置），无模板回退硬编码
  const purposeKey = type === 'character' ? 'character_image' : type === 'scene' ? 'scene_image' : 'prop_image'
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  let tplId = input.templateId || (projectConfig[purposeKey] as any)?.templateId
  // 未配置模板时，自动使用官方默认模板
  if (!tplId) {
    const defaultTplMap: Record<string, string> = {
      character_image: 'official-v1-character-image',
      scene_image: 'official-v1-scene-image',
      prop_image: 'official-v1-prop-image'
    }
    tplId = defaultTplMap[purposeKey]
  }
  let tplUsed = false
  if (tplId) {
    try {
      const tpl = db.prepare('SELECT content, template_version FROM prompt_templates WHERE id = ?').get(tplId) as any
      if (tpl?.content) {
        let tp = tpl.template_version === 'v1' ? (() => { try { const p = JSON.parse(tpl.content); return p.chinese || p.english || '' } catch { return '' } })() : tpl.content
        if (tp) {
          const stylePromptZh = getStylePromptZh(project.style_name, finalStylePrompt)
          tp = tp.replace(/\{\{character_name\}\}/g, assetName || description)
            .replace(/\{\{character_description\}\}/g, description)
            .replace(/\{\{character_appearance_prompt\}\}/g, description)
            .replace(/\{\{scene_name\}\}/g, assetName || description)
            .replace(/\{\{scene_description\}\}/g, description)
            .replace(/\{\{scene_prompt\}\}/g, description)
            .replace(/\{\{prop_name\}\}/g, assetName || description)
            .replace(/\{\{prop_description\}\}/g, description)
            .replace(/\{\{prop_prompt\}\}/g, description)
            .replace(/\{\{style_prompt\}\}/g, finalStylePrompt)
            .replace(/\{\{style_prompt_zh\}\}/g, stylePromptZh)
            .replace(/\{\{style_name\}\}/g, project.style_name || '')
            .replace(/\{\{era\}\}/g, finalEraPrompt)
            .replace(/\{\{era_zh\}\}/g, project.era || '')
            .replace(/\{\{[^}]+\}\}/g, '')
          if (tp.trim()) { finalPrompt = tp.trim(); tplUsed = true }
        }
      }
    } catch { /* keep default */ }
  }
  if (!tplUsed) {
    if (type === 'character') {
      finalPrompt = [
        `[Image-to-Image] Preserve the reference image's four-panel layout and white background, but REPLACE the character. Do NOT copy the reference character.`,
        `[Subject] ${description}`,
        `[Background] Pure white seamless background, thin gray lines separating four panels, uniform white gaps, panels equal size, NO overlap`,
        `[Style] ${styleDesc}${finalEraPrompt ? ', ' + finalEraPrompt : ''}`,
        `[Lighting] Professional studio lighting, soft key light, even illumination, no harsh shadows`,
        `[Composition] Four panels arranged horizontally left to right in a single row, thin gray vertical dividers, equal width, no overlap — Panel 1 (Far Left, Close-up): head and shoulders, facial features, expression, hair, accessories; Panel 2 (Mid-Left, Full Body Front): standing straight with realistic adult body proportions (7-8 head heights), natural shoulder width, defined waist, natural hip curve, full outfit and silhouette, feet grounded at panel bottom; Panel 3 (Mid-Right, 45-Degree): side profile showing natural spinal curve, waist-hip ratio, garment draping and clothing depth; Panel 4 (Far Right, Full Body Back): back view showing hair from behind, shoulder blade definition, natural back curve, clothing back design with consistent hem line`,
        `[Quality] ${aspectHint} aspect ratio, realistic adult anatomy with natural body proportions (NOT compressed or stubby), defined waist-hip curve (NOT flat/straight silhouette), identical clothing design across all 4 panels (front/back hemlines match, slits/pleats consistent), consistent character identity, uniform studio lighting, equal panel spacing`
      ].join('\n')
    } else if (type === 'scene') {
      finalPrompt = [
        `[Subject] ${description}`,
        `[Composition] Single wide panoramic establishing shot — NOT a multi-panel layout. Complete spatial layout and lighting. Sharp foreground, softened background, spatial depth through atmospheric haze.`,
        `[Spatial Constraints — CRITICAL] 1) ALL objects share ONE unified perspective: all parallel lines (floor tiles, wall edges, table edges, furniture lines) converge to a SINGLE vanishing point at approximately 1.5m height (eye level). NO conflicting perspective angles. 2) Objects are proportionally scaled relative to each other: the largest furniture piece in the room is the vertical scale reference. NO object may appear larger than this dominant piece. Props and accessories must be realistically smaller than the furniture they sit on or stand next to. 3) The floor plane is a continuous flat surface: floor tile lines, wood plank seams, and carpet edges must follow consistent perspective toward the same vanishing point. 4) Ceiling height is approximately 2.5-3m standard room height — all wall-mounted objects (screens, lights, shelves) are positioned relative to this reference.`,
        `[Style] ${styleDesc}${finalEraPrompt ? ', ' + finalEraPrompt : ''}`,
        `[Quality] ${aspectHint} aspect ratio, absolutely NO people, NO text, NO labels, NO split panels, photorealistic, 8K, high detail, coherent perspective, realistic object scaling, no blur/cartoon/anime/illustration/flat lighting`
      ].join('\n')
    } else {
    // props 道具：模板替换变量
    let basePrompt = description
    if (templateId) {
      try {
        const tpl = db.prepare('SELECT content, template_version FROM prompt_templates WHERE id = ?').get(templateId) as any
        if (tpl?.content) {
          let tp = tpl.template_version === 'v1' ? (() => { try { const p = JSON.parse(tpl.content); return p.chinese || p.english || '' } catch { return '' } })() : tpl.content
          if (tp) {
            tp = tp.replace(/\{\{prop_name\}\}/g, description)
              .replace(/\{\{prop_description\}\}/g, description)
              .replace(/\{\{prop_prompt\}\}/g, description)
              .replace(/\{\{style_prompt\}\}/g, finalStylePrompt)
              .replace(/\{\{style_name\}\}/g, project.style_name || '')
              .replace(/\{\{era\}\}/g, finalEraPrompt)
              .replace(/\{\{[^}]+\}\}/g, '')
            basePrompt = tp.trim() || basePrompt
          }
        }
      } catch { /* ignore */ }
    }
    finalPrompt = [basePrompt, finalStylePrompt, finalEraPrompt].filter((s) => s.trim()).join(', ')
    }
  }

  // 场景：强制禁止人物——放在 prompt 最前面以提升模型遵循度
  if (type === 'scene') {
    finalPrompt = 'CRITICAL: This is a PURE ENVIRONMENT image. ABSOLUTELY NO people, characters, humans, figures, silhouettes, animals, or any living creatures anywhere. Empty architecture/interior/landscape only.\n\n' + finalPrompt
  }

  // 日志：确认使用的提示词来源和内容
  console.log(`[generateImage] type=${type} tplUsed=${tplUsed} tplId=${tplId || 'none'}`)
  console.log(`[generateImage] FINAL PROMPT:\n${finalPrompt.slice(0, 600)}${finalPrompt.length > 600 ? '...' : ''}`)

  // 3. 解析模型配置（四级降级）— 复用上方 purposeKey 和 projectConfig
  const { model, channel, apiKey } = resolveModelConfig(purposeKey, projectConfig, inputModel, inputChannel, inputApiKey)

  // 5. 提前校验 API Key 和模型（避免无效任务记录）
  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置页配置供应商')
  }
  if (!model) {
    throw new Error('未配置生图模型，请在模型配置中选择')
  }

  // 6. 创建或复用 generation_tasks 记录
  const purpose = type === 'character' ? 'character_reference' : type === 'scene' ? 'scene_reference' : 'prop_reference'
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
      null,
      'image',
      purpose,
      channel || null,
      model || null,
      JSON.stringify({ assetId, count, description })
    )
  }

  // 7. 更新状态为 running，设置 started_at
  db.prepare(
    `UPDATE generation_tasks SET status = 'running', started_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(taskId)

  try {
    // 8. 参考图：仅角色使用旧图保持一致性；场景/道具每次全新生成
    let finalRefImage: string | undefined = input.refImage
    if (!finalRefImage && type === 'character') {
      try {
        const row = db.prepare('SELECT reference_image FROM characters WHERE id = ?').get(assetId) as { reference_image: string | null } | undefined
        if (row?.reference_image) {
          if (existsSync(row.reference_image)) finalRefImage = row.reference_image
        }
      } catch { /* 无已有图片，跳过 */ }
    }

    // 8.5 画面比例 → API size 参数
    const size = getAPISize(aspectRatio)

    // 9. 调用 OpenAI 兼容格式的生图 API
    // 注意：不注入风格参考图（含具体人物，img2img 会锁定角色外观）
    // 风格信息通过 prompt 中的 style_prompt 传递
    const refs: string[] = finalRefImage ? [finalRefImage] : []
    const assetTraceStart = Date.now()
    const imageUrls = await callImageGenerationAPI(finalPrompt, model, apiKey, channel, refs, size)
    writeTrace(project.path, {
      ts: new Date().toISOString(),
      type: type === 'character' ? 'asset' : 'asset',
      assetId,
      model,
      channel: channel || '',
      promptLength: finalPrompt.length,
      promptFirst: finalPrompt.slice(0, 200),
      refImageCount: refs.length,
      imageCount: imageUrls.length,
      durationMs: Date.now() - assetTraceStart
    })

    // 9. 下载并保存图片
    const imageDir = join(project.path, 'assets', 'images', `${type}s`)
    const imagePaths = await saveGeneratedImages(imageUrls, imageDir, assetId)

    // 10. 写入历史表，新图自动选中（is_selected=1），旧图取消选中
    const tableMap: Record<string, string> = {
      character: 'character_images',
      scene: 'scene_images',
      prop: 'prop_images'
    }
    const historyTable = tableMap[type]
    const idColumn = type === 'character' ? 'character_id' : type === 'scene' ? 'scene_id' : 'prop_id'
    assertValidTableName(historyTable)
    assertValidColumnName(idColumn)

    // 事务包裹：历史表写入 + 资产引用更新 + 锚点创建 + 任务状态，确保原子性
    const postTx = db.transaction(() => {
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
      assertValidTableName(assetTableMap[type])
      db.prepare(
        `UPDATE ${assetTableMap[type]} SET reference_image = ? WHERE id = ?`
      ).run(imagePaths[0], assetId)

      // 11.5 角色生图：自动存储多角度锚点（4宫格: Panel1正面特写/Panel2全身正面/Panel3半侧面/Panel4背面）
      if (type === 'character' && imagePaths.length > 0) {
        createMultiAngle(assetId, {
          front: imagePaths[0],
          three_quarter: imagePaths[0],
          side: imagePaths[0],
          back: imagePaths[0],
          generatedAt: new Date().toISOString()
        })
      }

      // 12. 更新任务状态为 completed
      db.prepare(
        `UPDATE generation_tasks SET status = 'completed', output_path = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(imagePaths.join(','), taskId)
    })

    postTx()

    return { taskId, imagePaths }
  } catch (err: any) {
    const errorMsg = err?.message || '生图失败'
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(errorMsg, taskId)
    throw err
  }
}

// ===== 图片保存工具 =====

async function saveGeneratedImages(
  imageUrls: string[],
  imageDir: string,
  filePrefix: string
): Promise<string[]> {
  mkdirSync(imageDir, { recursive: true })
  const imagePaths: string[] = []

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i]
    const fileName = `${filePrefix}_${i}_${Date.now()}.png`
    const filePath = join(imageDir, fileName)

    if (url.startsWith('data:')) {
      try {
        const base64Data = url.split(',')[1]
        if (!base64Data) { console.error('[saveImages] Empty base64 data'); continue }
        writeFileSync(filePath, Buffer.from(base64Data, 'base64'))
        if (!existsSync(filePath)) { console.error('[saveImages] Failed to write:', filePath); continue }
      } catch (e) { console.error('[saveImages] Save error:', e); continue }
    } else if (url.startsWith('http')) {
      try {
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 })
        writeFileSync(filePath, Buffer.from(resp.data))
      } catch {
        imagePaths.push(url) // 下载失败，保留原 URL 作为记录
        continue
      }
    }
    imagePaths.push(filePath)
  }

  return imagePaths
}

// ===== 图片 API 调用层 =====

let lastImageError = ''
let lastChatError = ''

/**
 * 调用 OpenAI 兼容格式的 /v1/images/generations
 */
async function callImageGenerationAPI(
  prompt: string,
  model: string,
  apiKey: string,
  channel?: string | null,
  refImages?: string[],
  size?: string | null
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

  let lastError = ''
  let resp: any = null

  const hasMultipleRefs = (refImages?.length || 0) > 1
  const isAgnes = normalizedBaseURL.includes('agnes-ai.com')

  // 最多重试2次
  for (let attempt = 0; attempt < 2; attempt++) {
    if (isAgnes) {
      // Agnes: 先图生图（images/generations + extra_body.image）
      console.log('[Agnes] Trying images/generations (img2img)...')
      resp = await tryImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages, size)
      if (!resp) {
        lastError = lastImageError
        // 图生图挂了 → 回退到 chat/completions（不经过 ComfyUI）
        console.log('[Agnes] images/generations failed, falling back to chat/completions...')
        resp = await tryChatImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages, size)
        if (resp) console.log('[Agnes] chat/completions fallback OK')
        else if (lastChatError) lastError = lastChatError
      } else {
        console.log('[Agnes] images/generations OK')
      }
    } else if (hasMultipleRefs) {
      // 多参考图 → 直接走 chat/completions（images/generations 只支持单图）
      resp = await tryChatImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages, size)
      if (!resp) lastError = lastChatError
    } else {
      // 单参考图或无参考图 → 先尝试 images/generations
      resp = await tryImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages?.[0], size)
      if (!resp) {
        lastError = lastImageError
        resp = await tryChatImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages, size)
        if (!resp && lastChatError) lastError = lastChatError
      }
    }

    if (resp) break
    if (attempt < 1) {
      await new Promise(r => setTimeout(r, IMAGE_API_RETRY_DELAY))
    }
  }

  if (!resp) {
    throw new Error(lastError || '生图 API 不可用，请检查供应商配置和账户余额')
  }

  const data = resp.data?.data || resp.data?.images || resp.data?.choices?.[0]?.message?.content || []
  const urls: string[] = []
  for (const item of Array.isArray(data) ? data : [data]) {
    if (typeof item === 'string') {
      // 尝试从 Markdown 格式提取 URL: ![alt](url)  支持 http 和 data: 两种
      const mdMatch = item.match(/!\[.*?\]\(((?:https?:\/\/|data:[^)]+)\S*)\)/)
      const actualUrl = mdMatch ? mdMatch[1] : item
      if (actualUrl.startsWith('data:')) urls.push(actualUrl)
      else if (actualUrl.startsWith('http')) urls.push(actualUrl)
    } else if (item.url) {
      const mdMatch2 = item.url.match(/!\[.*?\]\(((?:https?:\/\/|data:[^)]+)\S*)\)/)
      urls.push(mdMatch2 ? mdMatch2[1] : item.url)
    } else if (item.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`)
    else if (item.image_url) urls.push(item.image_url)
  }

  if (urls.length === 0) {
    throw new Error('API 返回为空或无法解析图片数据')
  }

  return urls
}

async function tryImageAPI(baseURL: string, model: string, prompt: string, apiKey: string, refImage?: string | string[] | null, size?: string | null): Promise<any> {
  const url = `${baseURL}/images/generations`
  const isAgnes = baseURL.includes('agnes-ai.com')
  const body: any = { prompt, model, n: 1, seed: Math.floor(Math.random() * 2147483647) }

  if (isAgnes) {
    // Agnes 仅支持标准尺寸: 1024x1024 / 1024x768 / 768x1024
    if (size) {
      if (size === '1792x1024') body.size = '1024x768'
      else if (size === '1024x1792') body.size = '768x1024'
      else body.size = '1024x1024'
    }
    // 图生图：image 数组放 extra_body 内，不需要 tags
    const refs = Array.isArray(refImage) ? refImage : refImage ? [refImage] : []
    const imgUrls: string[] = []
    for (const r of refs.slice(0, AGNES_MAX_REF_IMAGES)) {
      try {
        const imgBuffer = readFileSync(r)
        imgUrls.push('data:image/png;base64,' + imgBuffer.toString('base64'))
      } catch { /* skip */ }
    }
    if (imgUrls.length > 0) {
      body.extra_body = { image: imgUrls, response_format: 'b64_json' }
    }
  } else {
    if (size) body.size = size
    const singleRef = Array.isArray(refImage) ? refImage[0] : refImage
    if (singleRef) {
      try {
        const imgBuffer = readFileSync(singleRef)
        body.image = imgBuffer.toString('base64')
      } catch { /* skip */ }
    }
  }
  // 重试3次，指数退避 1s → 2s → 4s
  let lastErr: any
  for (let attempt = 0; attempt < IMAGE_API_MAX_RETRIES; attempt++) {
    try {
      const resp = await axios.post(url, body, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 300000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      })
      return resp
    } catch (e: any) {
      lastErr = e
      const code = e?.code || e?.response?.status
      // ECONNRESET / 5xx → retry; 4xx (except 429) → don't retry
      if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code >= 500 || code === 429) {
        if (attempt < 2) {
          const delay = 1000 * Math.pow(2, attempt)
          console.warn(`[tryImageAPI] Retry ${attempt + 1}/3 after ${delay}ms (${code})`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
      }
      break
    }
  }
  const msg = lastErr?.response?.data?.message || lastErr?.response?.data || lastErr?.message || ''
  lastImageError = typeof msg === 'string' ? msg : JSON.stringify(msg)
  if (process.env.NODE_ENV === 'development') console.error('[tryImageAPI]', lastErr?.response?.status || lastErr?.code, lastImageError)
  return null
}

async function tryChatImageAPI(baseURL: string, model: string, prompt: string, apiKey: string, refImages?: string[], _size?: string | null): Promise<any> {
  try {
    const url = `${baseURL}/chat/completions`
    const userContent: any[] = []
    // 所有参考图作为 image_url 前置（chat/completions 支持多图）
    const imgs = refImages || []
    for (const imgPath of imgs) {
      try {
        const imgBuffer = readFileSync(imgPath)
        const ext = imgPath.split('.').pop()?.toLowerCase() || 'png'
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${imgBuffer.toString('base64')}` }
        })
      } catch { /* 文件不可读，跳过 */ }
    }
    userContent.push({ type: 'text', text: `Generate an image based on this description: ${prompt}. Return only the image.` })
    return await axios.post(url, {
      model,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 4096
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 300000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    })
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.response?.data || e?.message || ''
    lastChatError = typeof msg === 'string' ? msg : JSON.stringify(msg)
    if (process.env.NODE_ENV === 'development') console.error('[tryChatImageAPI]', e?.response?.status, lastChatError)
    return null
  }
}

// ===== 分镜首帧/尾帧生图 =====

/**
 * 生成分镜首帧/尾帧图片
 */
export async function generateShotImage(input: GenerateShotImageInput): Promise<GenerateImageResult> {
  assertValidFrameType(input.frameType)
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

  // 1. 读取 shot 数据（需要 chapter_id 和 shot_index 找上一个分镜）
  const shot = db.prepare('SELECT s.*, c.project_id FROM shots s JOIN chapters c ON s.chapter_id = c.id WHERE s.id = ?').get(shotId) as
    | {
        id: string
        chapter_id: string
        shot_index: number
        project_id: string
        first_frame_prompt: string | null
        first_frame_prompt_zh: string | null
        last_frame_prompt: string | null
        last_frame_prompt_zh: string | null
        first_frame_image_path: string | null
        last_frame_image_path: string | null
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
  const finalEraPrompt = mapEra(project.era || '')

  // 3. 参考图自动继承（跨分镜连贯性）
  const purposeKey = frameType === 'first' ? 'first_frame' : 'last_frame'
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  const purposeConfig = projectConfig[purposeKey] || {}
  let refImage = input.refImage || purposeConfig.refImage || ''

  // 3.5 收集参考图——角色在前做人脸锚点，场景在后做背景（模型优先看前面的图做人脸识别）
  // 同时记录每个角色图在 refImages 数组中的绝对索引（1-based，供 prompt 引用）
  const refImages: string[] = []
  const charImageAnchors: { name: string; refNum: number; description: string | null }[] = []
  const contextChars: string[] = []
  let contextScene = ''
  let contextPropsDesc = ''
  try {
    // ① 角色图排最前面——确保模型优先识别角色人脸
    const shotChars = db.prepare(
      'SELECT c.id, c.name, c.description, c.reference_image FROM characters c JOIN shot_characters sc ON c.id = sc.character_id WHERE sc.shot_id = ? ORDER BY sc.rowid'
    ).all(shotId) as { id: string; name: string; description: string | null; reference_image: string | null }[]
    for (const ch of shotChars) {
      if (ch.reference_image) {
        try {
          if (existsSync(ch.reference_image)) {
            refImages.push(ch.reference_image)
            charImageAnchors.push({ name: ch.name, refNum: refImages.length, description: ch.description })
          }
        } catch {}
      }
      if (ch.description) contextChars.push(`${ch.name}: ${ch.description}`)
      else if (ch.name) contextChars.push(ch.name)
    }
    // ② 道具图紧跟角色——确保模型优先看到道具外观
    try {
      const shotProps = db.prepare(
        'SELECT p.name, p.description, p.reference_image FROM props p JOIN shot_props sp ON p.id = sp.prop_id WHERE sp.shot_id = ?'
      ).all(shotId) as { name: string; description: string | null; reference_image: string | null }[]
      for (const pr of shotProps) {
        if (pr.reference_image) {
          try { if (existsSync(pr.reference_image)) refImages.push(pr.reference_image) } catch {}
        }
        if (pr.description) contextPropsDesc = contextPropsDesc ? `${contextPropsDesc}; ${pr.name}: ${pr.description}` : `${pr.name}: ${pr.description}`
      }
    } catch { /* ignore */ }
    // ③ 场景图排在道具后面——做背景底板
    const shotScenes = db.prepare(
      'SELECT s.name, s.description, s.reference_image FROM scenes s JOIN shot_scenes ss ON s.id = ss.scene_id WHERE ss.shot_id = ?'
    ).all(shotId) as { name: string; description: string | null; reference_image: string | null }[]
    for (const sc of shotScenes) {
      if (sc.reference_image) {
        try { if (existsSync(sc.reference_image)) refImages.push(sc.reference_image) } catch {}
      }
      if (sc.description) contextScene = `${sc.name}: ${sc.description}`
      else if (sc.name && !contextScene) contextScene = sc.name
    }
    // ④ 构图锚点（上一镜尾帧等）排最后——仅做构图参考，不影响人脸
    if (refImage) refImages.push(refImage)
  } catch { /* 关联查询失败则跳过 */ }

  // 4. 角色名列表（与 charImageAnchors 顺序一致）
  const charNames = charImageAnchors.map(c => c.name)

  // 4.1 构建参考图说明——用绝对编号，模型一目了然
  let refImagesNote = ''
  if (refImages.length > 1) {
    const labels: string[] = []
    for (let i = 0; i < refImages.length; i++) {
      const refNum = i + 1
      const img = refImages[i]
      // 精确匹配：用记录的 refNum 判断此位置是哪个角色
      const anchor = charImageAnchors.find(c => c.refNum === refNum)
      if (anchor) {
        const descSnippet = anchor.description ? ` (${anchor.description.slice(0, 80)})` : ''
        labels.push(`Image #${refNum}: = "${anchor.name}"${descSnippet} — THIS IS THE FACE ANCHOR for ${anchor.name}. Every instance of "${anchor.name}" in the generated image MUST have this exact face, hairstyle, hair color, eye color, and skin tone. Use this face. Do NOT swap it with another character.`)
      } else if (img.includes('scenes')) {
        labels.push(`Image #${refNum}: SCENE BACKGROUND — COPY this exact environment, architecture, lighting, colors. Characters are placed INTO this background.`)
      } else if (img.includes('props')) {
        labels.push(`Image #${refNum}: PROP REFERENCE — COPY this exact object appearance, shape, color, texture, and materials. The character should interact with THIS exact object.`)
      } else if (img === refImage || (refImage && i === refImages.length - 1)) {
        labels.push(`Image #${refNum}: COMPOSITION anchor — use ONLY for camera angle and framing. Do NOT copy character identity, position, or scale from this image.`)
      } else {
        labels.push(`Image #${refNum}: visual context — reference only, do NOT copy position or identity.`)
      }
    }
    if (labels.length > 0) {
      refImagesNote = labels.join('\n') + '\n\n'
    }
  }

  const shotContextParts: string[] = []
  // 角色外观描述
  if (contextChars.length > 0) {
    shotContextParts.push(`Characters: ${contextChars.join('; ')}`)
    shotContextParts.push('CRITICAL: Exactly ONE instance of each named character. NO duplicates, NO clones, NO mirror reflections showing the same character twice. Single unique individual per character name.')
  }
  // 场景描述
  if (contextScene) {
    // 特写/近景时裁剪场景描述（避免房间家具和特写构图冲突）
    const isCu = /特写|近景|close.?up|chest.?up/i.test(shotPrompt)
    const sceneText = isCu ? `${contextScene.split(':')[0]}: Soft blurred background, intimate atmosphere.` : contextScene
    shotContextParts.push(`Scene: ${sceneText}`)
  }
  // 景别 + 运镜（shots 表的中文字段）
  const extraFields = db.prepare(
    'SELECT shot_type, camera_movement, lighting_mood, character_actions, dialogue FROM shots WHERE id = ?'
  ).get(shotId) as { shot_type: string | null; camera_movement: string | null; lighting_mood: string | null; character_actions: string | null; dialogue: string | null } | undefined
  // shot_type 由 compositionGuide 统一控制，不重复注入
  if (extraFields?.camera_movement) shotContextParts.push(`Camera: ${translateCnField(extraFields.camera_movement)}`)
  if (extraFields?.lighting_mood) shotContextParts.push(`Lighting: ${translateCnField(extraFields.lighting_mood)}`)
  if (extraFields?.character_actions) {
    try {
      const actions = JSON.parse(extraFields.character_actions) as Array<{ character_name: string; action: string }>
      if (actions.length > 0) shotContextParts.push(`Actions: ${actions.map(a => `${a.character_name} ${a.action}`).join(', ')}`)
    } catch { /* JSON parse fail */ }
  }
  if (contextPropsDesc) shotContextParts.push(`Props in scene: ${contextPropsDesc}`)

  const shotContext = shotContextParts.join('. ')

  // 4.3 景别 → 构图位置指令（优先从 prompt 文本检测，其次取 DB 字段）
  const compositionGuide = ((): string => {
    const st = detectShotType(shotPrompt) || extraFields?.shot_type || ''
    const cm = extraFields?.camera_movement || ''
    if (st.includes('大特写')) return 'Extreme close-up composition: a SINGLE DETAIL fills the entire frame — one eye, lips, a hand, an object. No face, no body, no environment visible. Extreme shallow depth of field. Macro photography style. The subject detail occupies 90%+ of the image area'
    if (st.includes('特写')) return 'Close-up composition: single character FILLS the frame, face and upper body CENTERED, character occupies 70%+ of image area. Very shallow depth of field (f/1.8) — background is a soft blur of colors and light only. The character is sharply in focus while everything behind melts into bokeh. The environment is IMPLIED by the blurred light and color, not shown in detail.'
    if (st.includes('近景')) return 'Medium close-up composition: character from chest up, CENTER-FRONT, occupying 50-60% of frame height. Shallow depth of field (f/2.0) — character is in sharp focus, background elements are recognizable but softly blurred. The character stands IN FRONT OF the environment — distinct foreground (character) and background (scene) separation. Environment visible as out-of-focus shapes and light.'
    if (st.includes('中景')) return 'Medium shot composition: character from waist up, CENTERED in frame, occupying 40-50% of frame height. Lower body below waist is OUTSIDE the frame. NOT a full body shot. SPATIAL DEPTH (critical): The character stands ON the stage platform, IN FRONT OF the background elements. Three distinct depth layers required — FOREGROUND: the character, sharply focused; MIDGROUND: stage floor and nearby equipment (2-3 meters behind character), slightly softened; BACKGROUND: LED screen and distant stage elements (5+ meters behind), clearly out of focus. Shallow depth of field (f/2.8). The environment wraps AROUND and BEHIND the character — the character is INSIDE the scene, not pasted on top of it.'
    if (st.includes('全景')) return 'Full shot composition: character full body visible, positioned in the LOWER-MIDDLE third of the frame, occupying 25-35% of frame height. SPATIAL DEPTH: The character stands inside the environment — not in front of a flat backdrop. The scene surrounds the character: floor extends from foreground to background, walls/architecture recede into distance, lighting creates atmospheric perspective. Moderate depth of field (f/4.0) — foreground sharp, distant background slightly soft. Environment dominates upper portion, character integrated into the space.'
    if (st.includes('远景') || st.includes('大远景')) return 'Wide/long shot composition: character appears as a small figure within the vast environment, occupying 10-20% of frame height. Environment is the primary visual element. Character placed according to rule of thirds'
    if (cm.includes('跟')) return 'Tracking shot composition: character in motion, positioned with lead room in the direction of movement. Dynamic framing with space ahead of the character'
    return 'Balanced composition: character positioned naturally within the scene, proportionate to the environment. Rule of thirds applied'
  })()

  console.log(`[ShotImage] === ${frameType === 'first' ? 'FIRST' : 'LAST'} FRAME SUMMARY ===`)
  console.log(`[ShotImage] Shot prompt:`, shotPrompt.slice(0, 150))
  console.log(`[ShotImage] Ref images:`, refImages.length, '| context chars:', contextChars.length, '| scene:', contextScene ? 'YES' : 'NONE')
  console.log(`[ShotImage] Shot type:`, extraFields?.shot_type || 'NONE', '| Camera:', extraFields?.camera_movement || 'NONE', '| Lighting:', extraFields?.lighting_mood || 'NONE')

  let shotFinalPrompt = refImagesNote ? `${refImagesNote}${shotPrompt}` : shotPrompt
  if (shotContext) shotFinalPrompt = `${shotFinalPrompt}\n${shotContext}`
  shotFinalPrompt = [shotFinalPrompt, finalStylePrompt, finalEraPrompt].filter(s => s.trim()).join(', ')

  // 加载模板（如有配置），替换默认 prompt
  const shotTplId = (purposeConfig as any)?.templateId
  if (shotTplId) {
    try {
      const tpl = db.prepare('SELECT content, template_version FROM prompt_templates WHERE id = ?').get(shotTplId) as any
      if (tpl?.content) {
        let tp = tpl.template_version === 'v1' ? (() => { try { const p = JSON.parse(tpl.content); return p.chinese || p.english || '' } catch { return '' } })() : tpl.content
        if (tp) {
          const shotPromptZh = frameType === 'first'
            ? (shot.first_frame_prompt_zh || shotPrompt)
            : (shot.last_frame_prompt_zh || shotPrompt)
          const stylePromptZh = getStylePromptZh(project.style_name, finalStylePrompt)
          const sv: Record<string, string> = {
            style_prompt: finalStylePrompt, style_prompt_zh: stylePromptZh,
            era: finalEraPrompt, era_zh: project.era || '',
            shot_description: shotPrompt, shot_description_zh: shotPromptZh,
            dialogue: extraFields?.dialogue || '', dialogue_en: extraFields?.dialogue || '',
            shot_type: extraFields?.shot_type || '', shot_type_en: extraFields?.shot_type || '', shot_type_zh: extraFields?.shot_type || '',
            lighting_mood: extraFields?.lighting_mood || '', lighting_mood_en: extraFields?.lighting_mood || '',
            character_actions: extraFields?.character_actions || '', character_actions_en: extraFields?.character_actions || '',
            used_scene_description: contextScene || '', used_scene_description_zh: contextScene || '',
            used_character_descriptions: contextChars.join('; '), used_character_descriptions_zh: contextChars.join('; '),
            used_prop_descriptions: '', used_prop_descriptions_zh: ''
          }
          for (const [k, v] of Object.entries(sv)) { tp = tp.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), v) }
          tp = tp.replace(/\{\{[^}]+\}\}/g, '')
          if (tp.trim()) { shotFinalPrompt = tp.trim(); console.log(`[ShotImage] ⚠ TEMPLATE OVERRIDE: ${shotTplId} — user prompt replaced by template`) }
        }
      }
    } catch { /* keep default */ }
  }

  // 4.5 Prompt 级角色一致性校验（不阻塞生成，仅告警）
  try {
    const charsForCheck = (contextChars || []).map(s => {
      const [name, ...descParts] = s.split(': ')
      return { name, description: descParts.join(': ') || null }
    }).filter(c => c.description)
    if (charsForCheck.length > 0) {
      const warnings = checkShotConsistency(shotFinalPrompt, charsForCheck)
      if (warnings.length > 0) {
        for (const w of warnings) {
          console.warn(`[CONSISTENCY] ⚠ ${w.rule}`)
        }
      } else {
        console.log('[CONSISTENCY] ✓ 角色外貌描述一致')
      }
    }
  } catch (e) { /* 校验失败不影响生图 */ }

  // 4.6 角色-参考图映射 + 构图 + 唯一性
  const charMapNote = charImageAnchors.length > 0
    ? `[IDENTITY ANCHORS] This image contains ${charImageAnchors.length} character(s): ${charNames.join(', ')}. Each character has a numbered reference image that shows their EXACT face:\n${charImageAnchors.map(c => `  Image #${c.refNum} → "${c.name}" — every instance of "${c.name}" MUST use the face from Image #${c.refNum}.`).join('\n')}\nCRITICAL: Do NOT swap faces between characters. Each character's face comes ONLY from their own anchor image listed above. If ANY character uses the wrong face, the image is wrong.`
    : ''
  const spatialIntegration = 'SPATIAL INTEGRATION (critical): The character is PHYSICALLY INSIDE the scene — NOT a cutout pasted on a background. Scene lighting MUST illuminate the character — warm stage lights cast onto skin and clothing creating highlights and shadows consistent with the environment. The character casts a soft shadow on the floor/surface they stand on. Atmospheric perspective: light rays, haze, or volumetric effects visible between foreground and background. The reference images are visual GUIDES, not layers — the output must be a single unified photograph where character and environment exist in the same 3D space.'
  // 将用户指令提前，提高模型遵循度
  const hasHandheld = /hold|holding|手持|拿着|握着|touching|holding/i.test(shotPrompt)
  const propBoost = hasHandheld ? ' CRITICAL: The handheld object described above MUST match its reference image EXACTLY — same shape, color, material, and size. It is NOT a generic prop. The character MUST be physically holding or touching this specific object.' : ''
  const userDirective = shotPrompt.trim() ? `[USER INSTRUCTION] ${shotPrompt.trim()} — The above is the director's specific instruction. All objects, poses, and actions described above MUST be present in the final image.${propBoost}` : ''
  shotFinalPrompt = `${userDirective}\n${charMapNote}\n[COMPOSITION] ${compositionGuide}. ${spatialIntegration}. [CHARACTER COUNT] Exactly ONE instance of each named character — NO duplicates, NO clones, NO twin figures. Each character appears exactly ONCE. [VARIATION] Each generation should be UNIQUE in pose, expression, and camera angle.\n\n${shotFinalPrompt}`

  const { model, channel, apiKey } = resolveModelConfig(purposeKey, projectConfig, inputModel, inputChannel)

  // 6. 提前校验 API Key 和模型
  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置页配置供应商')
  }
  if (!model) {
    throw new Error('未配置生图模型，请在模型配置中选择')
  }

  // 7. 创建或复用 generation_tasks 记录
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

  // 8. 更新状态为 running
  db.prepare(
    `UPDATE generation_tasks SET status = 'running', started_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(taskId)

  try {
    // 9. 画面比例 → API size 参数
    const size2 = getAPISize(project.aspect_ratio || '16:9')

    // 9. 调用生图 API
    console.log('═══════════════════════════════════════')
    console.log(`[ShotImage] === FINAL PROMPT TO API (${frameType}) ===`)
    console.log(`[ShotImage] Full prompt (${shotFinalPrompt.length} chars):`)
    console.log(shotFinalPrompt)
    console.log(`[ShotImage] ---`)
    console.log(`[ShotImage] Model: ${model} | Channel: ${channel}`)
    console.log(`[ShotImage] Ref images: ${refImages.length} | Size: ${size2}`)
    console.log(`[ShotImage] Shot context injected: ${shotContextParts.length} parts`)
    console.log(`[ShotImage] Composition guide: ${compositionGuide.slice(0, 100)}...`)
    console.log('═══════════════════════════════════════')

    const traceStart = Date.now()
    const imageUrls = await callImageGenerationAPI(shotFinalPrompt, model, apiKey, channel, refImages, size2)
    const traceDuration = Date.now() - traceStart

    // 写 trace 日志（便于分析 Agnes 模型边界）
    writeTrace(project.path, {
      ts: new Date().toISOString(),
      type: frameType === 'first' ? 'first_frame' : 'last_frame',
      shotId,
      model,
      channel: channel || '',
      promptLength: shotFinalPrompt.length,
      promptFirst: shotFinalPrompt.slice(0, 200),
      refImageCount: refImages.length,
      charMapping: charImageAnchors.map(c => `Image#${c.refNum}=${c.name}`),
      compositionGuide: compositionGuide.slice(0, 150),
      consistencyWarnings: (() => {
        try {
          const charsForCheck = (contextChars || []).map(s => {
            const [name, ...dp] = s.split(': ')
            return { name, description: dp.join(': ') || null }
          }).filter(c => c.description)
          if (charsForCheck.length === 0) return []
          return checkShotConsistency(shotFinalPrompt, charsForCheck).map(w => w.rule)
        } catch { return [] }
      })(),
      imageCount: imageUrls.length,
      durationMs: traceDuration
    })

    // 9. 下载并保存图片
    const imageDir = join(project.path, 'assets', 'images', 'frames')
    const imagePaths = await saveGeneratedImages(imageUrls, imageDir, `${shotId}_${frameType}`)

    // 事务包裹：shot_images 写入 + shots 引用更新 + 任务状态，确保原子性
    const postTx = db.transaction(() => {
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
      assertValidColumnName(updateColumn)
      db.prepare(
        `UPDATE shots SET ${updateColumn} = ? WHERE id = ?`
      ).run(imagePaths[0], shotId)

      // 12. 更新任务状态为 completed
      db.prepare(
        `UPDATE generation_tasks SET status = 'completed', output_path = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(imagePaths.join(','), taskId)
    })

    postTx()

    return { taskId, imagePaths }
  } catch (err: any) {
    const errorMsg = err?.message || '生图失败'
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(errorMsg, taskId)
    throw err
  }
}

// ===== 角度锚点单体生成 =====

/**
 * 为指定角色生成单角度锚点图（增量更新，不覆盖已有角度）
 */
export async function generateAngle(
  characterId: string,
  angle: AnchorAngle
): Promise<{ imagePath: string; angle: AnchorAngle }> {
  const db = getDb()

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId) as
    | { id: string; project_id: string; name: string; description: string | null }
    | undefined
  if (!char) throw new Error(`角色不存在: ${characterId}`)

  const project = getProject(char.project_id)
  if (!project) throw new Error('项目不存在')

  const description = char.description || char.name
  const finalStylePrompt = project.style_prompt || ''
  const finalEraPrompt = mapEra(project.era || '')

  const anglePrompt = getAnglePrompt(angle, description, finalStylePrompt, finalEraPrompt)
  const size = getAngleSize(angle)

  console.log(`[generateAngle] character=${char.name} angle=${angle} size=${size}`)

  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  const { model, channel, apiKey } = resolveModelConfig('character_image', projectConfig)

  if (!apiKey) throw new Error('未配置 API Key')
  if (!model) throw new Error('未配置生图模型')

  const imageUrls = await callImageGenerationAPI(anglePrompt, model, apiKey, channel, [], size)

  const imageDir = join(project.path, 'assets', 'images', 'characters')
  const paths = await saveGeneratedImages(imageUrls.slice(0, 1), imageDir, `${characterId}_${angle}`)
  const filePath = paths[0]

  createMultiAngle(characterId, { [angle]: filePath })

  return { imagePath: filePath, angle }
}
