/**
 * HCC (HermesRoute) API 客户端
 * 生图: POST /v1/images/generations (单图) / /v1/images/edits (多参考融合)
 * 生视频: POST /v1/videos → GET /v1/videos/{task_id} → GET /v1/videos/{task_id}/content
 * 视频结果保留 24 小时，需及时下载
 */

import { logger } from '../utils/logger'
import axios from 'axios'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'

const BASE_URL = 'https://hermesroute.vwuxiameng.cn/v1'
const POLL_INTERVAL = 8_000
const POLL_TIMEOUT = 600_000

// ===== 图片生成 =====

export interface HccImageInput {
  apiKey: string
  prompt: string
  size?: string
  refImages?: string[]
  model?: string
  signal?: AbortSignal
}

/**
 * HCC 生图：有参考图走 /images/edits（支持单张+多张），无参考图走 /images/generations
 */
export async function callHccImageAPI(input: HccImageInput): Promise<string[]> {
  const { apiKey, prompt, size = '1024x1024', refImages, model = 'gpt-image-2', signal } = input

  // 预处理参考图：本地文件→base64 data URI，公网URL保持原样
  const images: string[] = []
  if (refImages?.length) {
    for (const ref of refImages) {
      if (ref.startsWith('http://') || ref.startsWith('https://')) {
        images.push(ref)
      } else {
        try {
          const buf = readFileSync(ref)
          const ext = ref.split('.').pop()?.toLowerCase() || 'png'
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
          images.push(`data:${mime};base64,${buf.toString('base64')}`)
        } catch { /* skip */ }
      }
    }
  }

  // 有参考图 → 全部走 /images/edits（HCC /images/generations 不接受 image 字段）
  if (images.length > 0) {
    logger.info(`[HCC] Image edits: ${images.length} refs, prompt: ${prompt.slice(0, 100)}...`)
    const body: any = { model, prompt, images, size, n: 1, quality: 'high', response_format: 'url' }
    for (let retry = 0; retry < 2; retry++) {
      try {
        const resp = await axios.post(`${BASE_URL}/images/edits`, body, {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 600000, maxBodyLength: Infinity, maxContentLength: Infinity, signal,
        })
        return extractImageUrls(resp.data)
      } catch (e: any) {
        if (retry === 0 && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT')) {
          logger.warn(`[HCC] Image edits POST timed out, retrying (1/1)...`)
          await new Promise(r => setTimeout(r, 5000))
        } else { throw e }
      }
    }
    throw new Error('HCC 生图失败')
  }

  // 无参考图 → 纯文生图
  logger.info('[HCC] Image generations: (text-to-image) prompt:', prompt.slice(0, 100) + '...')
  const body2: any = { model, prompt, n: 1, size, quality: 'high', response_format: 'url' }
  for (let retry = 0; retry < 2; retry++) {
    try {
      const resp = await axios.post(`${BASE_URL}/images/generations`, body2, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 600000, maxBodyLength: Infinity, maxContentLength: Infinity, signal,
      })
      return extractImageUrls(resp.data)
    } catch (e: any) {
      if (retry === 0 && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT')) {
        logger.warn(`[HCC] Image generations POST timed out, retrying (1/1)...`)
        await new Promise(r => setTimeout(r, 5000))
      } else { throw e }
    }
  }
  throw new Error('HCC 生图失败')
}

function extractImageUrls(data: any): string[] {
  const items = data?.data || data?.images || []
  if (!Array.isArray(items)) {
    if (typeof data?.url === 'string') return [data.url]
    if (typeof data?.data === 'string') return [data.data]
    throw new Error('HCC 生图返回格式异常: ' + JSON.stringify(data).slice(0, 200))
  }
  const urls: string[] = []
  for (const item of items) {
    if (typeof item === 'string') {
      urls.push(item)
    } else if (item.url) {
      urls.push(item.url)
    } else if (item.b64_json) {
      urls.push(`data:image/png;base64,${item.b64_json}`)
    }
  }
  if (urls.length === 0) throw new Error('HCC 生图完成但未返回图片 URL')
  return urls
}

// ===== 视频生成 =====

export interface HccVideoInput {
  apiKey: string
  prompt: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  refImages?: string[]
  generateAudio?: boolean
  signal?: AbortSignal
}

/**
 * HCC 生视频：异步提交(JSON) → 轮询 → 下载
 * 接口: POST /v1/videos → GET /v1/videos/{task_id} → GET /v1/videos/{task_id}/content
 */
export async function callHccVideoAPI(input: HccVideoInput): Promise<string[]> {
  const {
    apiKey, prompt,
    duration = 5,
    aspectRatio = '16:9',
    resolution = '720p',
    refImages,
    generateAudio,
    signal,
  } = input

  const mode = refImages?.length ? 'reference_to_video' : 'text_to_video'

  // 处理参考图：公网 URL 直接传，本地文件转 base64 data URI
  const imageRefs: string[] = []
  if (refImages?.length) {
    for (const ref of refImages.slice(0, 8)) {
      if (ref.startsWith('http://') || ref.startsWith('https://')) {
        imageRefs.push(ref)
      } else {
        try {
          const buf = readFileSync(ref)
          // HCC 单图限制 10MB
          if (buf.length > 10 * 1024 * 1024) {
            logger.warn(`[HCC] Video ref image too large: ${ref} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`)
            continue
          }
          const ext = ref.split('.').pop()?.toLowerCase() || 'png'
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
          imageRefs.push(`data:${mime};base64,${buf.toString('base64')}`)
        } catch (e: any) {
          logger.warn(`[HCC] Video ref image unreadable: ${ref} ${e.message}`)
        }
      }
    }
  }

  const body: any = {
    model: 'seedance-2-fast',
    prompt,
    mode,
    aspect_ratio: aspectRatio,
    duration: String(Math.max(4, Math.min(15, duration))),
    resolution,
  }
  if (imageRefs.length > 0) body.reference_images = imageRefs
  if (generateAudio && mode === 'reference_to_video') body.generate_audio = '1'

  logger.info('[HCC] Video request:', { mode, duration, aspectRatio, resolution, refs: imageRefs.length })
  logger.info('[HCC] Video prompt:', prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''))

  // Step 1: 提交任务（优先尝试 JSON，失败回退 multipart）
  let taskId: string | undefined

  try {
    const submitResp = await axios.post(`${BASE_URL}/videos`, body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      signal,
    })
    taskId = submitResp.data?.id || submitResp.data?.task_id
  } catch (jsonErr: any) {
    // JSON 失败，尝试 multipart form
    if (imageRefs.length > 0) {
      logger.info('[HCC] JSON submit failed, trying multipart...')
      taskId = await submitVideoMultipart(apiKey, prompt, mode, aspectRatio, duration, resolution, imageRefs, generateAudio, signal)
    } else {
      throw jsonErr
    }
  }

  if (!taskId) {
    throw new Error('HCC 生视频：未返回 task_id')
  }
  logger.info('[HCC] Video task created:', taskId)

  // Step 2: 轮询状态
  await pollHccVideoTask(taskId, apiKey, signal)

  // Step 3: 下载视频到临时目录
  const downloadResp = await axios.get(`${BASE_URL}/videos/${taskId}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    responseType: 'arraybuffer',
    timeout: 600000,
    signal,
  })

  const tmpDir = join(app.getPath('temp'), 'hcc-videos')
  mkdirSync(tmpDir, { recursive: true })
  const videoPath = join(tmpDir, `${taskId}.mp4`)
  writeFileSync(videoPath, Buffer.from(downloadResp.data))
  logger.info(`[HCC] Video downloaded: ${videoPath} (${(downloadResp.data.byteLength / 1024).toFixed(0)} KB)`)

  return [videoPath]
}

/** 手动构造 multipart/form-data 提交视频任务（回退方案） */
async function submitVideoMultipart(
  apiKey: string,
  prompt: string,
  mode: string,
  aspectRatio: string,
  duration: number,
  resolution: string,
  imageRefs: string[],
  generateAudio: boolean | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const boundary = `----HCC${randomUUID().replace(/-/g, '')}`
  const CRLF = '\r\n'
  const parts: Buffer[] = []

  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`))
  }

  addField('model', 'seedance-2-fast')
  addField('prompt', prompt)
  addField('mode', mode)
  addField('aspect_ratio', aspectRatio)
  addField('duration', String(Math.max(4, Math.min(15, duration))))
  addField('resolution', resolution)
  if (generateAudio && mode === 'reference_to_video') {
    addField('generate_audio', '1')
  }

  // 参考图
  for (const ref of imageRefs) {
    if (ref.startsWith('data:')) {
      // base64 data URI → 作为文件上传
      const [header, data] = ref.split(',')
      const mimeMatch = header.match(/data:(.+);base64/)
      const mime = mimeMatch?.[1] || 'image/png'
      const ext = mime.split('/')[1] || 'png'
      const buf = Buffer.from(data, 'base64')
      parts.push(Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="reference_images"; filename="ref.${ext}"${CRLF}Content-Type: ${mime}${CRLF}${CRLF}`
      ))
      parts.push(buf)
      parts.push(Buffer.from(CRLF))
    } else {
      addField('reference_images', ref)
    }
  }

  parts.push(Buffer.from(`--${boundary}--${CRLF}`))

  const body = Buffer.concat(parts)

  const resp = await axios.post(`${BASE_URL}/videos`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    signal,
  })

  return resp.data?.id || resp.data?.task_id
}

// ===== 轮询 =====

async function pollHccVideoTask(taskId: string, apiKey: string, signal?: AbortSignal): Promise<void> {
  const startedAt = Date.now()

  // 首次等 10 秒再开始轮询
  await sleep(10000)

  while (Date.now() - startedAt < POLL_TIMEOUT) {
    if (signal?.aborted) throw new Error('HCC 视频任务已取消')

    let resp: any
    try {
      resp = await axios.get(`${BASE_URL}/videos/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 30000,
      })
    } catch (e: any) {
      const status = e?.response?.status
      if (status === 404) throw new Error('HCC 视频任务不存在: ' + taskId)
      if (status === 401) throw new Error('HCC API Key 无效')
      logger.warn('[HCC] Poll error:', e?.code || e?.message?.slice(0, 80))
      await sleep(POLL_INTERVAL * 2)
      continue
    }

    const data = resp.data
    const status = data?.status || ''
    const progress = data?.progress || 0

    if (status === 'completed') {
      logger.info(`[HCC] Video completed: ${taskId} progress:${progress}`)
      return
    }

    if (status === 'failed' || status === 'cancelled') {
      const errMsg = typeof data?.error === 'object' ? JSON.stringify(data.error) : (data?.error || '未知错误')
      throw new Error(`HCC 视频生成失败 (${status}): ${errMsg}`)
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    logger.info(`[HCC] Polling ${taskId}: status=${status} progress=${progress}% elapsed=${elapsed}s`)

    await sleep(POLL_INTERVAL)
  }

  throw new Error('HCC 视频任务超时（10分钟）')
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
