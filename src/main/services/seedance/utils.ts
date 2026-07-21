/**
 * Seedance 纯工具函数 —— 无业务状态，无外部依赖
 */
import { logger } from '../../utils/logger'

// ---- 字符统计 ----

/** 统计对白中的中文字数（自动剥离角色名前缀） */
export function charCount(text: string): number {
  return text.replace(/^[一-鿿]{1,6}[：:]\s*/, '').replace(/[^一-鿿]/g, '').length
}

/** 提取对话中的说话人前缀（含冒号），如 "林宇：" */
export function speechPrefix(text: string): string {
  const m = text.match(/^([^：:]+[：:])/)
  return m ? m[1] : ''
}

// ---- 文本切分 ----

/** 按中文字数切分：保留前 n 个中文字符，返回 [保留部分, 溢出部分] */
export function splitByChineseChars(text: string, n: number): [string, string] {
  let chineseCount = 0
  for (let i = 0; i < text.length; i++) {
    if (/[一-鿿]/.test(text[i])) {
      chineseCount++
      if (chineseCount > n) return [text.slice(0, i), text.slice(i)]
    }
  }
  return [text, '']
}

/** 语义切分：在目标字数附近找最近的标点断句，找不到才回退到字符切分 */
export function splitBySemanticBoundary(text: string, maxChars: number): [string, string] {
  const searchStart = Math.floor(maxChars * 0.7)
  const searchEnd = Math.min(text.length, Math.ceil(maxChars * 1.3))
  let bestSplit = -1
  for (let i = maxChars; i < searchEnd && i < text.length; i++) {
    if (/[，。！？；：、\n]/.test(text[i])) { bestSplit = i + 1; break }
  }
  if (bestSplit < 0) {
    for (let i = maxChars - 1; i >= searchStart && i >= 0; i--) {
      if (/[，。！？；：、\n]/.test(text[i])) { bestSplit = i + 1; break }
    }
  }
  if (bestSplit > 0) return [text.slice(0, bestSplit), text.slice(bestSplit)]
  return splitByChineseChars(text, maxChars)
}

// ---- 描述处理 ----

/** Qwen 补全：shot_description <30字时注入景别+场景+光影三要素 */
export function ensureShotDescription(desc: string, shotType: string, sceneName: string): string {
  if (!desc || desc.length >= 30) return desc || ''
  const tpls = [
    `${shotType}，${sceneName}内，${desc}，冷调光影勾勒轮廓，环境细节清晰。`,
    `${shotType}镜头，${sceneName}场景中，${desc}，柔和侧光打亮主体，画面富有层次。`,
  ]
  const pick = tpls[desc.length % tpls.length]
  return pick.length >= 30 ? pick : pick + '，画面质感细腻。'
}

/** 从长描述中截取第一句作为分镜卡片摘要（≤30字） */
export function truncateDesc(desc: string): string {
  if (!desc) return ''
  const m = desc.match(/^(.{10,30}?)[，。；：、！？,…\.;:!\?]/)
  if (m) return m[1].length > 30 ? m[1].slice(0, 30) : m[1]
  return desc.length > 30 ? desc.slice(0, 30) + '…' : desc
}

/** 确保中文描述不为空，fallback 到英文 */
export function ensureChinese(text: string, fallback: string, label: string): string {
  if (/[一-鿿]/.test(text)) return text
  logger.warn(`[saveToDatabase] ${label}: description_zh has no Chinese characters, using description as fallback`)
  return fallback || text
}

// ---- 角色过滤 ----

/** 检测可疑的非人物名称（UI 标签、系统词等） */
export function isSuspiciousName(name: string): boolean {
  const lower = (name || '').toLowerCase()
  const suspects = [
    'preference', 'setting', 'mode', 'status', 'progress', 'loading', 'ui', 'button',
    'tutorial', 'alert', 'notification', 'home', 'back', 'next', 'confirm', 'close',
    '偏好', '设置', '模式', '状态', '进度', '加载', '界面', '按钮',
    '教程', '提醒', '通知', '首页', '返回', '下一步', '确认', '关闭',
  ]
  return suspects.some(kw => lower.includes(kw))
}

/** 在文本中查找所有出现的人名 */
export function findNamesInText(text: string, names: string[]): string[] {
  if (!text || !names.length) return []
  const found: string[] = []
  for (const name of names) {
    if (text.includes(name)) found.push(name)
  }
  return found
}
