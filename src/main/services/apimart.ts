/**
 * Apimart API 客户端
 * 异步提交 → 轮询 → 取图/取视频
 * 生图: POST /v1/images/generations → GET /v1/tasks/{task_id}
 * 生视频: POST /v1/videos/generations → GET /v1/tasks/{task_id}
 */
import { logger } from '../utils/logger'
import axios from 'axios'

// 国内直连域名（api.apimart.ai 被墙）
const APIMART_HOSTS = ['api.apib.ai', 'api.aiuxu.com', 'api.aishuch.com']
let BASE_URL = `https://${APIMART_HOSTS[0]}/v1`
const POLL_INTERVAL = 5_000
const POLL_TIMEOUT = 600_000

// ===== 生图 =====

export interface ApimartImageInput {
  apiKey: string
  prompt: string
  size?: string
  resolution?: string
  refImages?: string[]  // public URLs
  model?: string
}

export async function callApimartImageAPI(input: ApimartImageInput): Promise<string[]> {
  const { apiKey, prompt, size = '16:9', resolution = '2k', refImages, model: inputModel } = input

  const body: any = {
    model: inputModel || 'gpt-image-2',
    prompt,
    n: 1,
    size,
    resolution,
  }

  if (refImages?.length) {
    body.image_urls = refImages.filter(u => u.startsWith('http://') || u.startsWith('https://'))
  }

  // official 模型默认 quality: low（快），用户可后续切 high
  if (body.model === 'gpt-image-2-official') {
    body.quality = 'low'
  }

  logger.info('[Apimart] Image request:', JSON.stringify({ ...body, prompt: prompt.slice(0, 100) + '...' }))

  const resp = await axios.post(`${BASE_URL}/images/generations`, body, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 120000
  })

  const taskId = resp.data?.data?.[0]?.task_id
  if (!taskId) {
    const errMsg = resp.data?.error?.message || JSON.stringify(resp.data).slice(0, 200)
    throw new Error(`Apimart 生图失败: ${errMsg}`)
  }
  logger.info(`[Apimart] Image task created: ${taskId} | refs: ${refImages?.length || 0}`)

  const result = await pollApimartTask(taskId, apiKey)
  const urls = result?.result?.images?.[0]?.url || []
  if (!urls.length) throw new Error('Apimart 生图完成但未返回图片 URL')
  return urls
}

// ===== 生视频 =====

export interface ApimartVideoInput {
  apiKey: string
  prompt: string
  duration?: number
  size?: string
  resolution?: string
  seed?: number
  refImages?: string[]
  generateAudio?: boolean
  returnLastFrame?: boolean
  model?: string
}

export async function callApimartVideoAPI(input: ApimartVideoInput): Promise<string[]> {
  const { apiKey, prompt, duration = 5, size = '16:9', resolution = '720p', seed, refImages, generateAudio, returnLastFrame, model: inputModel } = input

  const isGrok = (inputModel || '').startsWith('grok-imagine')

  const body: any = {
    model: inputModel || 'doubao-seedance-2.0',
    prompt,
    duration,
    size,
  }
  // Grok 用 quality，Seedance 用 resolution
  if (isGrok) {
    body.quality = resolution
  } else {
    body.resolution = resolution
  }

  if (!isGrok && seed !== undefined) body.seed = seed
  if (!isGrok && generateAudio) body.generate_audio = true
  if (!isGrok && returnLastFrame) body.return_last_frame = true
  if (refImages?.length) body.image_urls = refImages.filter(u => u.startsWith('http://') || u.startsWith('https://'))

  logger.info('[Apimart] Video request:', JSON.stringify({ ...body, prompt: prompt.slice(0, 100) + '...' }))

  const resp = await axios.post(`${BASE_URL}/videos/generations`, body, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 120000
  })

  const taskId = resp.data?.data?.[0]?.task_id
  if (!taskId) {
    const errMsg = resp.data?.error?.message || JSON.stringify(resp.data).slice(0, 200)
    throw new Error(`Apimart 生视频失败: ${errMsg}`)
  }
  logger.info(`[Apimart] Video task created: ${taskId} | refs: ${refImages?.length || 0} | seed: ${seed}`)

  const result = await pollApimartTask(taskId, apiKey)
  logger.info('[Apimart] Video result keys:', JSON.stringify(Object.keys(result?.result || {})))
  logger.info('[Apimart] Full result (truncated):', JSON.stringify(result).slice(0, 500))
  const videoUrl = result?.result?.video_url || result?.result?.videos?.[0]?.url || ''
  if (!videoUrl) throw new Error('Apimart 生视频完成但未返回视频 URL')

  const urls = [videoUrl]
  // 检查音频 URL
  const audioUrl = result?.result?.audio_url || result?.result?.audio?.[0]?.url || ''
  if (audioUrl) {
    logger.info('[Apimart] Audio URL found:', audioUrl.slice(0, 100))
    urls.push(audioUrl)
  } else {
    logger.info('[Apimart] No audio URL in response')
  }
  // 返回尾帧图
  if (returnLastFrame && result?.result?.last_frame_url) urls.push(result.result.last_frame_url)
  return urls
}

// ===== 轮询 =====

async function pollApimartTask(taskId: string, apiKey: string): Promise<any> {
  const startedAt = Date.now()

  // 首次等 10 秒再开始轮询
  await sleep(10000)

  while (Date.now() - startedAt < POLL_TIMEOUT) {
    const resp = await axios.get(`${BASE_URL}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 60000
    })

    const data = resp.data?.data
    const status = data?.status || ''

    if (status === 'completed') {
      logger.info(`[Apimart] Task completed: ${taskId} cost:${data?.cost || '?'}`)
      return data
    }
    if (status === 'failed') {
      throw new Error('Apimart 任务失败: ' + (data?.error?.message || '未知错误'))
    }

    logger.info(`[Apimart] Polling ${taskId}: status=${status} progress=${data?.progress || '?'}`)
    await sleep(POLL_INTERVAL)
  }

  throw new Error('Apimart 任务超时（10分钟）')
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
