/**
 * Prompt 级角色一致性校验器
 * 轻量关键词比对 — 不依赖 ML/CLIP，纯文本分析
 * 检测同一角色在分镜 prompt 中的外貌描述是否与角色定妆照描述一致
 */
import { CONSISTENCY_PROXIMITY_RANGE } from '../utils/constants'

// ===== 可检测的外貌属性 =====

interface AttributePattern {
  key: string
  label: string
  patterns: RegExp[] // 每个 pattern 的第一个捕获组为提取值
}

const APPEARANCE_ATTRS: AttributePattern[] = [
  {
    key: 'hairColor',
    label: '发色',
    patterns: [
      /\b(black|黑|dark|深|jet-black|乌黑|墨|玄)\b/i,
      /\b(white|白|银|silver|grey|gray|灰|platinum|花白)\b/i,
      /\b(blonde|金|golden|黄|gold)\b/i,
      /\b(brown|棕|褐|chestnut|栗)\b/i,
      /\b(red|红|auburn|赤|火红)\b/i,
      /\b(blue|蓝|azure|青)\b/i,
    ],
  },
  {
    key: 'hairLength',
    label: '发长',
    patterns: [
      /\b(long|长|及腰|waist-length|垂|披肩|及肩|shoulder-length)\b/i,
      /\b(short|短|及耳|ear-length|bob|齐耳)\b/i,
      /\b(medium|中长|mid-length)\b/i,
    ],
  },
  {
    key: 'eyeColor',
    label: '瞳色',
    patterns: [
      /\b(black|黑|dark|深|墨)\b/i,
      /\b(brown|棕|褐|hazel|琥珀)\b/i,
      /\b(blue|蓝|azure|碧蓝|湛蓝)\b/i,
      /\b(green|绿|emerald|翠|碧)\b/i,
      /\b(golden|金|gold|amber)\b/i,
    ],
  },
  // 服装主色不再检查——角色允许在不同场景更换服装
]

/** 在锚点词周围40字符内搜索颜色/长度关键词（取距离最近的匹配） */
function extractAttr(text: string, attr: AttributePattern): string | null {
  const anchorSource = ((): string => {
    switch (attr.key) {
      case 'hairColor': case 'hairLength': return 'hair|发|头发'
      case 'eyeColor': return 'eye|眼|瞳|眸'
      case 'clothing': return '' // 已禁用——角色允许换装
      default: return ''
    }
  })()
  if (!anchorSource) return null

  // 找所有锚点位置（每次新建 regex 避免 lastIndex 残留）
  const anchorPositions: number[] = []
  let am: RegExpExecArray | null
  const anchorRe = new RegExp(anchorSource, 'gi')
  while ((am = anchorRe.exec(text)) !== null) {
    anchorPositions.push(am.index)
  }
  if (anchorPositions.length === 0) return null

  // 找所有颜色/长度匹配，记录值和到最近锚点的距离
  let best: { value: string; dist: number } | null = null
  for (const pattern of attr.patterns) {
    // 确保 g 标志以遍历所有匹配
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
    const patRe = new RegExp(pattern.source, flags)
    let pm: RegExpExecArray | null
    while ((pm = patRe.exec(text)) !== null) {
      const value = pm[1].toLowerCase()
      const colorPos = pm.index
      const minDist = Math.min(...anchorPositions.map(a => Math.abs(colorPos - a)))
      if (minDist <= CONSISTENCY_PROXIMITY_RANGE && (!best || minDist < best.dist)) {
        best = { value, dist: minDist }
      }
    }
  }
  return best?.value || null
}

export interface ConsistencyWarning {
  characterName: string
  attribute: string     // '发色' / '发长' / '瞳色' / '服装主色'
  expected: string      // 角色定妆照描述中的值
  found: string         // 分镜 prompt 中的值
  rule: string          // 如 "发色不一致: 角色定义=黑, 分镜中出现=金"
}

/**
 * 检查分镜 prompt 中的角色外貌描述是否与角色定义一致
 * @returns 不一致的告警列表（空数组 = 一致）
 */
export function checkCharacterConsistency(
  shotPrompt: string,
  characterDescription: string,
  characterName: string
): ConsistencyWarning[] {
  if (!characterDescription || !shotPrompt) return []
  const warnings: ConsistencyWarning[] = []

  for (const attr of APPEARANCE_ATTRS) {
    const expected = extractAttr(characterDescription, attr)
    if (!expected) continue // 角色描述中未定义该属性，跳过

    const found = extractAttr(shotPrompt, attr)
    if (!found) continue // 分镜 prompt 中未提及该属性，跳过

    // 模糊匹配：比较颜色/长度类别
    if (expected !== found) {
      // 特殊处理：black≈dark≈jet-black, white≈silver≈grey
      const darkFamily = ['black', 'dark', '深', 'jet-black', '乌黑', '墨', '玄']
      const lightFamily = ['white', '白', '银', 'silver', 'grey', 'gray', '灰', 'platinum', '花白']
      const sameFamily = (a: string, b: string) => {
        if (darkFamily.some(k => a.includes(k) || k.includes(a)) && darkFamily.some(k => b.includes(k) || k.includes(b))) return true
        if (lightFamily.some(k => a.includes(k) || k.includes(a)) && lightFamily.some(k => b.includes(k) || k.includes(b))) return true
        return false
      }
      if (sameFamily(expected, found)) continue // 同色系视为一致

      warnings.push({
        characterName,
        attribute: attr.label,
        expected,
        found,
        rule: `${attr.label}不一致: 角色定义="${expected}", 分镜中出现="${found}"`
      })
    }
  }

  return warnings
}

/**
 * 批量检查：传入角色列表和分镜 prompt，返回所有不一致
 */
export function checkShotConsistency(
  shotPrompt: string,
  characters: Array<{ name: string; description: string | null }>
): ConsistencyWarning[] {
  const allWarnings: ConsistencyWarning[] = []
  for (const char of characters) {
    if (!char.description) continue
    const warnings = checkCharacterConsistency(shotPrompt, char.description, char.name)
    allWarnings.push(...warnings)
  }
  return allWarnings
}
