/**
 * 阿里云百炼 Wan2.7 图生视频 API
 * POST /api/v1/services/aigc/video-generation/video-synthesis → GET /api/v1/tasks/{task_id}
 * 支持首帧生视频、首尾帧生视频、视频续写
 */

import { logger } from '../utils/logger'
import axios from 'axios'
import { readFileSync, existsSync } from 'fs'

const BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'

// 本地路径 → base64 data URI
function toBase64Url(filePath: string): string | null {
  if (!filePath) return null
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath
  if (!existsSync(filePath)) return null
  try {
    const buf = readFileSync(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch { return null }
}
const POLL_INTERVAL = 10_000
const POLL_TIMEOUT = 600_000

export interface WanxVideoInput {
  apiKey: string
  prompt: string
  duration?: number
  resolution?: string
  seed?: number
  firstFrameUrl?: string   // 首帧图 URL
  lastFrameUrl?: string    // 尾帧图 URL（首尾帧模式）
  referenceAudioUrl?: string // 驱动音频 URL
  promptExtend?: boolean
}

export async function callWanxVideoAPI(input: WanxVideoInput): Promise<string[]> {
  const { apiKey, prompt, duration = 5, resolution = '720P', seed, firstFrameUrl, lastFrameUrl, referenceAudioUrl, promptExtend = false } = input

  const media: any[] = []
  if (firstFrameUrl) {
    const url = toBase64Url(firstFrameUrl) || firstFrameUrl
    media.push({ type: 'first_frame', url })
  }
  if (lastFrameUrl) media.push({ type: 'last_frame', url: lastFrameUrl })
  if (referenceAudioUrl) media.push({ type: 'driving_audio', url: referenceAudioUrl })
  if (!media.length) throw new Error('Wan2.7 需要至少一张首帧图')

  const body: any = {
    model: 'wan2.7-i2v-2026-04-25',
    input: { prompt, media },
    parameters: { resolution, duration, prompt_extend: promptExtend, watermark: false }
  }
  if (seed !== undefined) body.parameters.seed = seed

  logger.info(`[Wan2.7] Video request: duration=${duration}s resolution=${resolution} media=${media.length} seed=${seed ?? 'random'}`)

  const resp = await axios.post(`${BASE_URL}/services/aigc/video-generation/video-synthesis`, body, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable'
    },
    timeout: 120000
  })

  const taskId = resp.data?.output?.task_id
  if (!taskId) {
    const errMsg = resp.data?.message || JSON.stringify(resp.data).slice(0, 200)
    throw new Error(`Wan2.7 创建任务失败: ${errMsg}`)
  }
  logger.info('[Wan2.7] Task created:', taskId)

  // 轮询
  const startedAt = Date.now()
  await sleep(8000) // 首次等 8 秒

  while (Date.now() - startedAt < POLL_TIMEOUT) {
    const pollResp = await axios.get(`${BASE_URL}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 60000
    })

    const output = pollResp.data?.output
    const status = output?.task_status || ''

    if (status === 'SUCCEEDED') {
      const videoUrl = output?.video_url || ''
      if (!videoUrl) throw new Error('Wan2.7 任务完成但未返回 video_url')
      logger.info(`[Wan2.7] Task completed: ${taskId} duration:${output?.usage?.duration || '?'}`)
      const urls = [videoUrl]
      // 如果有尾帧图 URL
      if (output?.last_frame_url) urls.push(output.last_frame_url)
      return urls
    }
    if (status === 'FAILED') {
      throw new Error('Wan2.7 任务失败: ' + (output?.message || output?.code || '未知错误'))
    }

    logger.info(`[Wan2.7] Polling ${taskId}: status=${status}`)
    await sleep(POLL_INTERVAL)
  }

  throw new Error('Wan2.7 任务超时（10分钟）')
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
