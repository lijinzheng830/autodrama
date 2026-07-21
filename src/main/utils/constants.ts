/**
 * 全局常量
 */

// ===== 一致性校验 =====
import { logger } from './logger'
/** 关键词提取时，颜色词到 "hair/eye" 的最大邻近字符距离 */
export const CONSISTENCY_PROXIMITY_RANGE = 40

// ===== 生图 API =====
/** Agnes 图生图最多传入的参考图数量 */
export const AGNES_MAX_REF_IMAGES = 2
/** API 重试最大次数（指数退避） */
export const IMAGE_API_MAX_RETRIES = 3

// ===== 统一重试工具 =====
/** 指数退避重试，第 n 次延迟 = min(baseDelay * 2^n + randomJitter, maxDelay) */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3
  const baseDelayMs = options?.baseDelayMs ?? 2000
  const maxDelayMs = options?.maxDelayMs ?? 30000

  let lastErr: unknown
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      lastErr = e
      if (attempt < maxRetries - 1) {
        const jitter = Math.random() * 1000
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs)
        logger.warn(`[withRetry] Attempt ${attempt + 1}/${maxRetries} failed, retry in ${Math.round(delay)}ms: ${(e as any)?.message?.slice(0, 80)}`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}
