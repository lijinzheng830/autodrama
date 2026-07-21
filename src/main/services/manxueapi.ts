/**
 * Manxueapi (满血API) 视频适配器
 * 接口: POST /v1/videos → GET /v1/videos/{task_id} → 下载
 * 网关: https://manxueapi.com/v1
 */
import axios from 'axios'
import { logger } from '../utils/logger'

const BASE_URL = 'https://manxueapi.com/v1'
const POLL_INTERVAL = 8_000
const POLL_TIMEOUT = 600_000

export interface ManxueapiVideoInput {
  apiKey: string
  prompt: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  refImages?: string[]
  generateAudio?: boolean
  model?: string
  signal?: AbortSignal
}

export async function callManxueapiVideoAPI(input: ManxueapiVideoInput): Promise<string[]> {
  const {
    apiKey, prompt,
    duration = 5,
    aspectRatio = '16:9',
    resolution = '720p',
    refImages,
    generateAudio = true,
    model: inputModel,
    signal,
  } = input

  // 上游模型名
  const upstreamModel = inputModel || 'doubao-seedance-2-0-fast-260128'

  // HTTP URL 过滤（满血API 只接受公网 URL）
  const httpImages = (refImages || []).filter(u => u.startsWith('http://') || u.startsWith('https://')).slice(0, 3)
  logger.info('[Manxueapi] Video request:', { model: upstreamModel, duration, aspectRatio, resolution, refsIn: (refImages || []).length, httpRefs: httpImages.length })
  logger.info('[Manxueapi] Video prompt:', prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''))

  const body: Record<string, unknown> = {
    model: upstreamModel,
    prompt,
    images: httpImages,
    metadata: {
      aspectRatio,
      resolution,
      duration: Math.max(4, Math.min(15, duration)),
      generateAudio,
    },
  }

  // Step 1: 提交任务
  const submitResp = await axios.post(`${BASE_URL}/videos`, body, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 120000,
    signal,
  })

  const taskId: string | undefined = submitResp.data?.id || submitResp.data?.task_id || submitResp.data?.data?.task_id
  if (!taskId) {
    throw new Error('Manxueapi 生视频：未返回 task_id — ' + JSON.stringify(submitResp.data).slice(0, 200))
  }
  logger.info('[Manxueapi] Video task created:', taskId)

  // Step 2: 轮询
  const result = await pollManxueapiTask(taskId, apiKey, signal)

  // Step 3: 提取视频 URL
  const videoUrl: string = (result as any)?.video_url || (result as any)?.result?.video_url || (result as any)?.result?.videos?.[0]?.url || ''
  if (!videoUrl) throw new Error('Manxueapi 生视频完成但未返回视频 URL')
  const urls = [videoUrl]

  // 检查音频 URL
  const audioUrl = (result as any)?.audio_url || (result as any)?.result?.audio_url || ''
  if (audioUrl) { urls.push(audioUrl); logger.info('[Manxueapi] Audio URL found') }

  return urls
}

async function pollManxueapiTask(taskId: string, apiKey: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const startedAt = Date.now()

  // 首次等 10 秒
  await new Promise(r => setTimeout(r, 10000))

  while (Date.now() - startedAt < POLL_TIMEOUT) {
    let pollData: any = null
    let status = ''
    let lastErr = ''

    // 每次 GET 最多重试 3 次（仅网络/超时错误重试，HTTP 响应错误不重试）
    for (let retry = 0; retry < 3; retry++) {
      try {
        const resp = await axios.get(`${BASE_URL}/videos/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 30000,
          signal,
        })
        pollData = resp.data?.data || resp.data
        status = pollData?.status || ''
        lastErr = ''
        break
      } catch (err: any) {
        lastErr = err?.message || ''
        // 有 HTTP 响应（4xx/5xx）→ 不重试，直接检查
        if (err?.response) {
          logger.warn(`[Manxueapi] Poll ${taskId} HTTP ${err.response.status}: ${lastErr.slice(0, 80)}`)
          break
        }
        // 网络/超时错误 → 重试
        if (retry < 2) {
          const waitMs = (retry + 1) * 5000
          logger.warn(`[Manxueapi] Poll ${taskId} GET retry ${retry + 1}/2 (${lastErr.slice(0, 60)}), waiting ${waitMs / 1000}s...`)
          await new Promise(r => setTimeout(r, waitMs))
        }
      }
    }

    if (!pollData) {
      logger.warn(`[Manxueapi] Poll ${taskId} all GET retries exhausted: ${lastErr.slice(0, 80)}`)
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      continue
    }

    if (status === 'completed') {
      logger.info('[Manxueapi] Task completed:', taskId)
      return pollData
    }
    if (status === 'failed') {
      throw new Error('Manxueapi 任务失败: ' + (pollData?.error?.message || '未知错误'))
    }

    logger.info(`[Manxueapi] Polling ${taskId}: status=${status}`)
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
  }

  throw new Error('Manxueapi 任务超时（10分钟）')
}
