/**
 * 图片 API 调用层
 * 负责 OpenAI 兼容 API 的生图请求（/v1/images/generations + /v1/chat/completions）
 */

import { readFileSync } from 'fs'
import axios from 'axios'
import { AGNES_MAX_REF_IMAGES, IMAGE_API_MAX_RETRIES } from '../utils/constants'

// 模块级错误状态（供调用方读取最后错误）
let lastImageError = ''
let lastChatError = ''

export function getLastImageError(): string { return lastImageError }
export function getLastChatError(): string { return lastChatError }

export async function tryImageAPI(
  baseURL: string,
  model: string,
  prompt: string,
  apiKey: string,
  refImage?: string | string[] | null,
  size?: string | null,
  negativePrompt?: string,
  signal?: AbortSignal
): Promise<any> {
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
      if (negativePrompt) body.extra_body.negative_prompt = negativePrompt
    } else if (negativePrompt) {
      body.extra_body = { negative_prompt: negativePrompt, response_format: 'b64_json' }
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
        maxContentLength: Infinity,
        signal
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

export async function tryChatImageAPI(
  baseURL: string,
  model: string,
  prompt: string,
  apiKey: string,
  refImages?: string[],
  _size?: string | null,
  negativePrompt?: string,
  signal?: AbortSignal
): Promise<any> {
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
    const fullPrompt = negativePrompt
      ? `[NEGATIVE CONSTRAINTS — DO NOT GENERATE]: ${negativePrompt}\n\n[POSITIVE PROMPT]: Generate an image based on this description: ${prompt}. Return only the image.`
      : `Generate an image based on this description: ${prompt}. Return only the image.`
    userContent.push({ type: 'text', text: fullPrompt })
    return await axios.post(url, {
      model,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 4096
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 300000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      signal
    })
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.response?.data || e?.message || ''
    lastChatError = typeof msg === 'string' ? msg : JSON.stringify(msg)
    if (process.env.NODE_ENV === 'development') console.error('[tryChatImageAPI]', e?.response?.status, lastChatError)
    return null
  }
}
