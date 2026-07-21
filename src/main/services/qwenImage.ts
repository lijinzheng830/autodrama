/**
 * 千问图像编辑 API（DashScope）
 * POST /api/v1/services/aigc/multimodal-generation/generation
 * 支持 seed、1-3 张参考图、同步返回
 */

import { logger } from '../utils/logger'
import axios from 'axios'

const BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'

export interface QwenImageInput {
  apiKey: string
  prompt: string
  model?: string
  refImages?: string[]  // 1-3 张参考图 URL
  size?: string
  seed?: number
  negativePrompt?: string
  n?: number
}

export async function callQwenImageAPI(input: QwenImageInput): Promise<string[]> {
  const { apiKey, prompt, model = 'qwen-image-2.0', refImages, size, seed, negativePrompt, n = 1 } = input

  const content: any[] = []
  if (refImages?.length) {
    for (const url of refImages.slice(0, 3)) {
      if (url.startsWith('http')) content.push({ image: url })
    }
  }
  content.push({ text: prompt })

  const body: any = {
    model,
    input: { messages: [{ role: 'user', content }] },
    parameters: { n, watermark: false, prompt_extend: false }
  }
  if (size) body.parameters.size = size
  if (seed !== undefined) body.parameters.seed = seed
  if (negativePrompt) body.parameters.negative_prompt = negativePrompt

  logger.info(`[QwenImage] Request: model=${model} prompt=${prompt.slice(0,80)}... refs=${refImages?.length||0} seed=${seed??'random'}`)

  const resp = await axios.post(`${BASE_URL}/services/aigc/multimodal-generation/generation`, body, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 300000
  })

  const images = resp.data?.output?.choices?.[0]?.message?.content || []
  const urls: string[] = []
  for (const item of images) {
    if (item.image?.startsWith('http')) urls.push(item.image)
  }
  if (!urls.length) {
    const errMsg = resp.data?.message || resp.data?.code || JSON.stringify(resp.data).slice(0, 200)
    throw new Error(`QwenImage 未返回图片: ${errMsg}`)
  }
  logger.info(`[QwenImage] Generated ${urls.length} image(s)`)
  return urls
}
