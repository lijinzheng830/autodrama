/**
 * Seedance 合规检测 — P0-2 类型化
 */
import type { ComplianceResult, NormalizedShot, TimelineChapter, RhythmWarning } from "./types"
import { DEFAULT_RHYTHM_PROFILE } from "./types"
import { getShotProfile, shotDialogueCapacity } from "./duration"

// P0.9.8: 用 dialogue_mode 替代文本匹配，voice_over/none 不算真实对白
function hasLipSyncDialogue(s: NormalizedShot): boolean {
  return s.dialogue_mode === 'lip_sync'
}

// ---- P0.9 Cinematic Rhythm Validator ----

function validateRhythm(chapters: TimelineChapter[]): RhythmWarning[] {
  const warnings: RhythmWarning[] = []

  for (let ci = 0; ci < chapters.length; ci++) {
    const shots = chapters[ci].shots
    if (shots.length < 9) continue

    // Rule 1: 连续对白检测 — 连续有对白镜头的累计时长
    let continuousDialogueSec = 0
    let maxContinuousSec = 0
    let continuousStartIdx = -1
    for (let i = 1; i < shots.length - 1; i++) {
      const s = shots[i]
      if (hasLipSyncDialogue(s)) {
        if (continuousStartIdx < 0) continuousStartIdx = s.shot_index
        continuousDialogueSec += s.duration_seconds || getShotProfile(s.shot_type).base
      } else {
        if (continuousDialogueSec > maxContinuousSec) maxContinuousSec = continuousDialogueSec
        if (continuousDialogueSec > DEFAULT_RHYTHM_PROFILE.maxContinuousDialogueSec) {
          warnings.push({
            type: 'rhythm', level: 'warning',
            message: `Chapter ${ci + 1}: 连续对白 ${continuousDialogueSec.toFixed(1)}s > ${DEFAULT_RHYTHM_PROFILE.maxContinuousDialogueSec}s上限`,
            shotIndex: continuousStartIdx,
            detail: '建议在对白间插入反应镜或空镜作为视觉呼吸'
          })
        }
        continuousDialogueSec = 0
        continuousStartIdx = -1
      }
    }
    // 检查尾部
    if (continuousDialogueSec > maxContinuousSec) maxContinuousSec = continuousDialogueSec
    if (continuousDialogueSec > DEFAULT_RHYTHM_PROFILE.maxContinuousDialogueSec) {
      warnings.push({
        type: 'rhythm', level: 'warning',
        message: `Chapter ${ci + 1}: 连续对白 ${continuousDialogueSec.toFixed(1)}s > ${DEFAULT_RHYTHM_PROFILE.maxContinuousDialogueSec}s上限`,
        shotIndex: continuousStartIdx,
        detail: '建议在对白间插入反应镜或空镜作为视觉呼吸'
      })
    }

    // Rule 1b: 单镜对白密度 — expected_dialogue_duration vs actual duration
    for (const s of shots) {
      if (s.expected_dialogue_duration && s.expected_dialogue_duration > 0) {
        const actual = s.duration_seconds || getShotProfile(s.shot_type).base
        if (s.expected_dialogue_duration > actual * 2.5) {
          warnings.push({
            type: 'rhythm', level: 'warning',
            message: `Shot #${s.shot_index}: 对白期望 ${s.expected_dialogue_duration}s > 实际时长 ${actual}s × 2.5（对白密度过高）`,
            shotIndex: s.shot_index,
            detail: `建议：扩展此镜时长，或将对白拆分到多个镜头`
          })
        }
      }
    }

    // Rule 2: 对白占比
    const totalDur = shots.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
    const dialogueDur = shots.reduce((sum, s) => {
      if (!hasLipSyncDialogue(s)) return sum
      return sum + (s.duration_seconds || getShotProfile(s.shot_type).base)
    }, 0)
    if (totalDur > 0) {
      const ratio = dialogueDur / totalDur
      if (ratio > DEFAULT_RHYTHM_PROFILE.preferredDialogueRatio) {
        warnings.push({
          type: 'rhythm', level: 'suggestion',
          message: `Chapter ${ci + 1}: 对白占比 ${(ratio * 100).toFixed(0)}% > ${(DEFAULT_RHYTHM_PROFILE.preferredDialogueRatio * 100).toFixed(0)}%，确认是否为对白驱动场景`,
          detail: '审讯戏/对峙戏等对白驱动场景可忽略此建议'
        })
      }
    }

    // Rule 3: 视觉呼吸 — 检测非对白/非纯信息推进的"留白"镜
    const breathingShots = shots.filter(s => {
      const purpose = s.shot_purpose || ''
      return !hasLipSyncDialogue(s) && (purpose === 'transition' || purpose === 'emotion')
    })
    if (breathingShots.length === 0) {
      warnings.push({
        type: 'rhythm', level: 'suggestion',
        message: `Chapter ${ci + 1}: 当前章节缺少视觉缓冲镜头（无对白+transition/emotion），建议在叙事区间插入留白或情绪镜`,
        detail: '动作驱动场景可忽略此建议'
      })
    }
  }

  return warnings
}

export function validateGridCompliance(chapters: { chapters: TimelineChapter[] }): ComplianceResult {
  const warnings: string[] = []
  const errors: string[] = []

  for (const ch of chapters.chapters) {
    const shots = ch.shots

    // 镜数校验
    if (shots.length !== 9) {
      errors.push(`章节镜数=${shots.length}（需=9）`)
    }

    // 时长校验
    const totalDur = shots.reduce((s, sh) => s + (sh.duration_seconds || 0), 0)
    if (totalDur > 14.9) errors.push(`总时长${totalDur.toFixed(1)}s > 14.9s上限`)
    if (totalDur < 14.0) warnings.push(`总时长${totalDur.toFixed(1)}s < 14s（偏短）`)

    // 镜1定场
    const s1 = shots[0]
    if (s1.dialogue) errors.push('镜1定场出现对白')
    if (s1.narration) errors.push('镜1定场出现旁白')
    if (s1.shot_type && s1.shot_type !== '全景') warnings.push(`镜1建议全景定场，当前为"${s1.shot_type}"`)

    // 第9镜空镜
    const s9 = shots[8]
    if (s9.dialogue) errors.push('第9镜出现对白')
    if (s9.narration) errors.push('第9镜出现旁白')
    if (s9.duration_seconds > 1.5 || s9.duration_seconds < 1.2) {
      warnings.push(`镜9时长${s9.duration_seconds.toFixed(1)}s 不在 1.2~1.5s 范围`)
    }

    // 景别配比
    const types = shots.map(s => s.shot_type)
    const wsCount = types.filter(t => t.includes('定场') || t.includes('全景')).length
    if (wsCount < 1) warnings.push('缺少定场镜')

    // 单镜时长校验
    for (const s of shots) {
      const hasTrack = s.audio_track_id !== ''
      const maxDur = hasTrack ? 5.0 : 3.0
      if (s.duration_seconds > maxDur) {
        errors.push(`镜#${s.shot_index} 时长${s.duration_seconds.toFixed(1)}s > ${maxDur}s上限`)
      }
      const profile = getShotProfile(s.shot_type)
      if (s.duration_seconds < profile.floor) {
        warnings.push(`镜#${s.shot_index} 时长${s.duration_seconds.toFixed(1)}s < ${s.shot_type || '?'}下限${profile.floor.toFixed(1)}s`)
      }
    }

    // 对白字数校验：按 audio_track 组
    const trackGroupShots = new Map<string, NormalizedShot[]>()
    const singleShots: NormalizedShot[] = []
    for (const s of shots) {
      if (!s.dialogue) continue
      if (s.audio_track_id) {
        if (!trackGroupShots.has(s.audio_track_id)) trackGroupShots.set(s.audio_track_id, [])
        trackGroupShots.get(s.audio_track_id)!.push(s)
      } else {
        singleShots.push(s)
      }
    }
    for (const [tid, groupShots] of trackGroupShots) {
      const chars = groupShots[0].dialogue.replace(/^[^：:]+[：:]\s*/, '').replace(/[^一-鿿]/g, '').length
      const groupCapacity = groupShots.reduce((sum, s) => sum + shotDialogueCapacity(s), 0)
      if (chars > groupCapacity) {
        warnings.push(`audio_track "${tid}" 对白${chars}字 > 组容量${groupCapacity}字（${groupShots.length}镜合计）`)
      }
    }
    for (const s of singleShots) {
      const chars = s.dialogue.replace(/^[^：:]+[：:]\s*/, '').replace(/[^一-鿿]/g, '').length
      const capacity = shotDialogueCapacity(s)
      if (chars > capacity) {
        warnings.push(`镜#${s.shot_index} 对白${chars}字 > 镜容量${capacity}字（${s.shot_type} ${s.duration_seconds}s）`)
      }
    }

    // 第9镜角色校验
    let charList: { character_name: string; action: string }[] = []
    try { charList = JSON.parse(s9.character_actions || '[]') } catch { /* ignore */ }
    if (charList.length > 0) errors.push('第9镜 character_list 非空（空镜禁止出现人物）')

    // 运镜合规
    const VALID_CAMERA = ['缓慢推进', '缓慢拉远', '左摇', '右摇', '摇镜', '跟随', '平移', '升降', '固定', '环绕', '手持抖动', '快速跟拍', '甩镜', '']
    for (const s of shots) {
      if (s.camera_movement && !VALID_CAMERA.includes(s.camera_movement)) {
        warnings.push(`镜#${s.shot_index} 运镜"${s.camera_movement}"不在标准枚举值内`)
      }
    }

    // 角色一致性
    const allChapterChars = new Set<string>()
    for (const s of shots) {
      try {
        const chars = JSON.parse(s.character_actions || '[]') as { character_name: string }[]
        chars.forEach(c => allChapterChars.add(c.character_name))
      } catch { /* ignore */ }
    }
    for (const s of shots) {
      try {
        const shotChars = JSON.parse(s.character_actions || '[]') as { character_name: string }[]
        const unknowns = shotChars.filter(c => !allChapterChars.has(c.character_name))
        if (unknowns.length > 0 && allChapterChars.size > 0) {
          errors.push(`角色异常: 镜#${s.shot_index} 包含未声明的角色 [${unknowns.map(c => c.character_name).join(',')}]`)
        }
      } catch { /* ignore */ }
    }

    // 场景一致性
    const firstScene = shots[0].shot_scene
    for (let i = 1; i < shots.length; i++) {
      const curScene = shots[i].shot_scene
      if (curScene && firstScene && curScene !== firstScene) {
        warnings.push(`场景切换未声明: 镜${i + 1} scene="${curScene}" ≠ 镜1 "${firstScene}"`)
      }
    }

    // 运镜连贯性
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1].camera_movement
      const cur = shots[i].camera_movement
      const gentle = ['固定', '缓慢推进', '缓慢拉远', '左摇', '右摇', '摇镜', '平移', '']
      const intense = ['快速跟拍', '甩镜', '手持抖动']
      if (gentle.includes(prev) && intense.includes(cur)) {
        warnings.push(`运镜跳变: 镜${i}→${i + 1} 从"${prev}"跳至"${cur}"`)
      }
      if (intense.includes(prev) && gentle.includes(cur) && cur !== '固定') {
        warnings.push(`运镜骤停: 镜${i}→${i + 1} 从"${prev}"骤停至"${cur}"`)
      }
    }

    // 轴线风险
    const directions = shots.map(s => {
      if (/左/.test(s.camera_movement)) return 'left'
      if (/右/.test(s.camera_movement)) return 'right'
      return null
    })
    for (let i = 2; i < directions.length; i++) {
      if (directions[i] && directions[i] === directions[i - 1] && directions[i] === directions[i - 2]) {
        warnings.push(`轴线风险: 镜${i - 1}→${i + 1} 连续3镜同向运镜`)
      }
    }

    // 景别跳变
    const typeJumps: Record<string, string[]> = { '大特写': ['全景', '大远景'], '特写': ['大远景'] }
    for (let i = 1; i < shots.length; i++) {
      for (const [from, toList] of Object.entries(typeJumps)) {
        if (shots[i - 1].shot_type === from && toList.includes(shots[i].shot_type)) {
          warnings.push(`景别跳变: 镜${i}→${i + 1} 从"${from}"直接跳至"${shots[i].shot_type}"`)
        }
      }
    }
  }

  // 评分
  let score = 4
  if (warnings.length > 0) score = 3
  if (errors.length > 0) score = Math.min(score, errors.length <= 2 ? 2 : 1)
  const fatalErrors = errors.filter(e => e.includes('第9镜') || e.includes('镜数='))
  if (fatalErrors.length > 0) score = 0

  // P0.9: 节奏检测（全部 advisory，不影响 passed）
  const rhythmWarnings = validateRhythm(chapters.chapters)

  return { passed: errors.length === 0, score, warnings, errors, rhythmWarnings }
}
