/**

 * 无边界AI API 客户端
 * 异步提交 → 轮询 → 下载 的媒体生成流程
 * POST /v1/media/generate → GET /v1/media/status → download result_url
 */

import axios from 'axios'
import { readFileSync } from 'fs'

const BASE_URL = 'https://api.lk888.ai/api/v1'
const POLL_INTERVAL = 5_000
const POLL_TIMEOUT = 600_000

// ===== 图片生成 =====

export interface WubianjieImageInput {
  apiKey: string
  prompt: string
  size: string
  model?: string
  refImages?: string[]
  signal?: AbortSignal
}

import { logger } from '../utils/logger'
export async function callWubianjieImageAPI(input: WubianjieImageInput): Promise<string[]> {
  const { apiKey, prompt, size, model = 'gpt-image-2', refImages, signal } = input

  const params: any = { prompt, size, quality: 'auto' }

  // 本地参考图 → base64 data URI
  if (refImages?.length) {
    params.images = refImages.map(p => {
      try {
        const buf = readFileSync(p)
        const ext = p.split('.').pop()?.toLowerCase() || 'png'
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
        return `data:${mime};base64,${buf.toString('base64')}`
      } catch { return '' }
    }).filter(Boolean)
    if (!params.images.length) delete params.images
  }

  const resp = await axios.post(`${BASE_URL}/media/generate`, { model, params }, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 300000,
    signal
  })

  logger.info('[Wubianjie] Response:', JSON.stringify(resp.data).slice(0, 300))
  const taskId = resp.data?.data?.task_id
  if (!taskId) throw new Error('无边界AI 生图：未返回 task_id')

  logger.info(`[Wubianjie] Image task created: ${taskId} | refs: ${refImages?.length || 0}`)

  const resultUrl = await pollTask(taskId, apiKey, signal)
  return [resultUrl]
}

// ===== 视频生成 =====

export interface WubianjieVideoInput {
  apiKey: string
  prompt: string
  aspectRatio: string
  duration: string
  model?: string
  refImages?: string[]
  signal?: AbortSignal
}

export async function callWubianjieVideoAPI(input: WubianjieVideoInput): Promise<string[]> {
  const { apiKey, prompt, aspectRatio, duration, model = 'pixverse-c1-cankaosheng', refImages, signal } = input

  const params: any = { prompt, aspect_ratio: aspectRatio, duration, resolution: '720P' }

  // 参考图：仅传公网 http/https URL，视频接口不支持 base64
  // grok-imagine 模型：images 必填，最多1张
  const isGrokVideo = (model || '').startsWith('grok-imagine')
  const maxImages = isGrokVideo ? 1 : 7
  if (refImages?.length) {
    const urls = refImages.filter(p => p.startsWith('http://') || p.startsWith('https://')).slice(0, maxImages)
    if (urls.length) {
      params.images = urls
    }
  }
  if (isGrokVideo && !params.images?.length) {
    throw new Error('grok-video-3.5 必须上传一张首帧参考图（公网URL）')
  }

  const resp = await axios.post(`${BASE_URL}/media/generate`, { model, params }, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 120000,
    signal
  })

  logger.info('[Wubianjie] Video Response:', JSON.stringify(resp.data).slice(0, 500))
  const taskId = resp.data?.data?.task_id
  if (!taskId) throw new Error('无边界AI 生视频：未返回 task_id')

  logger.info(`[Wubianjie] Video task created: ${taskId} | refs: ${refImages?.length || 0}`)

  const resultUrl = await pollTask(taskId, apiKey, signal)
  return [resultUrl]
}

// ===== 轮询 =====

async function pollTask(taskId: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const startedAt = Date.now()

  // 首次等 12 秒再开始轮询（大部分图片 30-90s 完成，视频 1-10min）
  await sleep(12000)

  let consecutiveErrors = 0
  const MAX_CONSECUTIVE_ERRORS = 3

  while (Date.now() - startedAt < POLL_TIMEOUT) {
    // 检查取消信号
    if (signal?.aborted) throw new Error('任务已取消')

    try {
      const resp = await axios.get(`${BASE_URL}/media/status`, {
        params: { task_id: taskId },
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000  // 单次查询 15s 超时（状态查询应秒回）
      })

      consecutiveErrors = 0  // 成功则重置

      const data = resp.data
      const state = data?.state || ''
      const isFinal = data?.is_final === true

      if (isFinal) {
        if (state === 'success' || data?.status_group === '已完成') {
          const url = data?.result_url || ''
          if (!url) throw new Error('无边界AI 任务完成但未返回 result_url')
          logger.info(`[Wubianjie] Task completed: ${taskId} cost:${data?.cost || '?'} 算力`)
          return url
        }
        if (state === 'failed' || data?.status_group === '失败') {
          throw new Error('无边界AI 任务失败: ' + (data?.error || '未知错误'))
        }
        throw new Error(`无边界AI 任务异常状态: ${state}`)
      }

      logger.info(`[Wubianjie] Polling ${taskId}: state=${state} progress=${data?.progress || '?'} elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`)
    } catch (e: any) {
      // 终态错误直接抛
      if (e?.message?.startsWith('无边界AI 任务')) throw e
      consecutiveErrors++
      logger.warn(`[Wubianjie] Poll error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, e?.code || e?.message?.slice(0, 80))
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(`无边界AI 轮询连续 ${consecutiveErrors} 次失败: ` + (e?.message || '').slice(0, 200))
      }
      // 错误后等久一点再重试
      await sleep(POLL_INTERVAL * 2)
      continue
    }

    await sleep(POLL_INTERVAL)
  }

  throw new Error('无边界AI 任务超时（10分钟）')
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
