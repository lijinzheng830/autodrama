/**
 * Seedance 时长引擎 — P0-2 类型化
 */
import { TARGET_TOTAL, DIALOGUE_RATE, SHOT_TYPE_PROFILE, SHOT_9_PROFILE } from "./types"
import type { NormalizedShot, TimelineChapter } from "./types"
import { charCount } from "./utils"
import { logger } from '../../utils/logger'

export function getShotProfile(shotType: string): { base: number; floor: number; compressPriority: number } {
  return SHOT_TYPE_PROFILE[shotType] || { base: 1.5, floor: 1.0, compressPriority: 2 }
}

export function shotDialogueCapacity(shot: NormalizedShot): number {
  const dur = shot.duration_seconds || getShotProfile(shot.shot_type).base
  return Math.round(dur * DIALOGUE_RATE)
}

export function assignShotDurations(chapters: TimelineChapter[]): TimelineChapter[] {
  for (const ch of chapters) {
    const shots = ch.shots
    const shotCount = shots.length
    if (shotCount < 9) continue

    for (let i = 0; i < shotCount; i++) {
      const s = shots[i]

      if (i === 8) {
        s.duration_seconds = SHOT_9_PROFILE.base
        continue
      }

      const profile = getShotProfile(s.shot_type || '中景')
      const baseDuration = profile.base

      if (i === 0) {
        s.duration_seconds = baseDuration
        continue
      }

      const dChars = charCount(s.dialogue)
      // P0.9.8: 只对 lip_sync（AI 原始对白）计算期望时长，voice_over 不参与
      if (dChars > 0 && s.dialogue_mode === 'lip_sync') {
        s.expected_dialogue_duration = Math.round((dChars / DIALOGUE_RATE) * 10) / 10
      }

      // P1-D: 统一时长计算 — 所有镜按 baseDuration 和对白需求取最大值。
      // audio_track 组的 segment 已由 splitDialogueSegments 拆开，单镜对白不会过长。
      // 仅 lip_sync 需要对白时长驱动；voice_over 是画外音叠加，不拉长镜头。
      const hasLipSync = dChars > 0 && s.dialogue_mode === 'lip_sync'
      const dialogueDuration = hasLipSync ? dChars / DIALOGUE_RATE : 0
      let duration = Math.max(baseDuration, dialogueDuration)
      // audio_track 组镜头允许更高上限（匹配 validator 的 5.0s 限制）
      const hasAudioTrack = s.audio_track_id !== ''
      const maxDur = hasAudioTrack ? 5.0 : 3.0
      duration = Math.min(duration, maxDur)
      s.duration_seconds = Math.round(duration * 10) / 10
    }

    // audio_track 组时长兜底
    // P0.9.9: i=1 开始收集（shot_id=2），而非 i=2（shot_id=3）
    // 对白组第一个镜头通常就在 shot_id=2，跳过它会导致单成员 group → 兜底不触发
    const trackGroups = new Map<string, number[]>()
    for (let i = 1; i < shotCount - 1; i++) {
      if (shots[i].audio_track_id && shots[i].dialogue) {
        if (!trackGroups.has(shots[i].audio_track_id)) trackGroups.set(shots[i].audio_track_id, [])
        trackGroups.get(shots[i].audio_track_id)!.push(i)
      }
    }
    for (const [tid, indices] of trackGroups) {
      if (indices.length <= 1) continue
      const fullDialogue = shots[indices[0]].dialogue.replace(/^[^：:]+[：:]\s*/, '')
      const dialogueChars = charCount(fullDialogue)
      const audioNeeded = dialogueChars / DIALOGUE_RATE
      let groupTotal = indices.reduce((sum, i) => sum + shots[i].duration_seconds, 0)
      if (groupTotal >= audioNeeded) continue

      const deficit = audioNeeded - groupTotal
      const perShotExtra = deficit / indices.length
      for (const i of indices) {
        let newDur = shots[i].duration_seconds + perShotExtra
        newDur = Math.min(newDur, 5.0)
        shots[i].duration_seconds = Math.round(newDur * 10) / 10
      }
      const newTotal = indices.reduce((sum, i) => sum + shots[i].duration_seconds, 0)
      logger.info(`[parse] audio_track "${tid}": 组时长${groupTotal.toFixed(1)}s→${newTotal.toFixed(1)}s（${dialogueChars}字需${audioNeeded.toFixed(1)}s）`)
    }

    fixChapterTotalDuration(shots, shotCount, ch.title || '?')
  }
  return chapters
}

export function fixChapterTotalDuration(shots: NormalizedShot[], shotCount: number, title: string): void {
  if (shotCount < 9) return

  let total = shots.reduce((s, sh) => s + sh.duration_seconds, 0)

  if (total <= TARGET_TOTAL) {
    const deficit = TARGET_TOTAL - total
    if (deficit > 0.05 && shots[8].duration_seconds < 1.5) {
      shots[8].duration_seconds = Math.round(Math.min(1.5, shots[8].duration_seconds + deficit) * 10) / 10
    }
    total = shots.reduce((s, sh) => s + sh.duration_seconds, 0)
    logger.info(`[parse] Chapter "${title}" duration: ${total.toFixed(1)}s`)
    return
  }

  // 第1轮：压缩镜9
  if (total > TARGET_TOTAL && shots[8].duration_seconds > SHOT_9_PROFILE.floor) {
    const reduce = Math.min(shots[8].duration_seconds - SHOT_9_PROFILE.floor, total - TARGET_TOTAL)
    shots[8].duration_seconds = Math.round((shots[8].duration_seconds - reduce) * 10) / 10
    total = shots.reduce((s, sh) => s + sh.duration_seconds, 0)
  }

  // 第2轮：按压缩优先级收无对白镜
  if (total > TARGET_TOTAL) {
    const ranked: { i: number; room: number; priority: number }[] = []
    for (let i = 0; i < 8; i++) {
      if (shots[i].dialogue) continue
      const profile = getShotProfile(shots[i].shot_type)
      const room = (shots[i].duration_seconds || profile.base) - profile.floor
      if (room > 0.005) ranked.push({ i, room, priority: profile.compressPriority })
    }
    ranked.sort((a, b) => b.priority - a.priority || b.room - a.room)

    let excess = total - TARGET_TOTAL
    let applied = 0
    for (const { i, room } of ranked) {
      if (excess <= 0.005) break
      const reduce = Math.min(room, excess)
      shots[i].duration_seconds = Math.round((shots[i].duration_seconds - reduce) * 10) / 10
      excess -= reduce
      applied += reduce
    }
    total = shots.reduce((s, sh) => s + sh.duration_seconds, 0)
    if (applied > 0.005) {
      logger.info(`[parse] Chapter "${title}": compressed ${applied.toFixed(1)}s by priority → total ${total.toFixed(1)}s`)
    }
  }

  // 第3轮：压无对白镜到 floor
  if (total > TARGET_TOTAL) {
    for (let i = 0; i < 8; i++) {
      if (shots[i].dialogue) continue
      const profile = getShotProfile(shots[i].shot_type)
      if (shots[i].duration_seconds > profile.floor) shots[i].duration_seconds = Math.round(profile.floor * 10) / 10
    }
    total = shots.reduce((s, sh) => s + sh.duration_seconds, 0)
  }

  // 二级压缩：压对白镜画面余量
  if (total > TARGET_TOTAL) {
    const total_before_2nd = total
    let excess = total - TARGET_TOTAL
    for (let i = 0; i < 8; i++) {
      if (excess <= 0.005) break
      const dChars = charCount(shots[i].dialogue)
      if (dChars === 0) continue
      const minSpeech = dChars / DIALOGUE_RATE
      const room = shots[i].duration_seconds - minSpeech
      if (room <= 0.005) continue
      const reduce = Math.min(room, excess)
      shots[i].duration_seconds = Math.round((shots[i].duration_seconds - reduce) * 10) / 10
      excess -= reduce
    }
    const applied2 = (total_before_2nd - TARGET_TOTAL) - excess
    total = shots.reduce((s, sh) => s + sh.duration_seconds, 0)
    if (applied2 > 0.005) {
      logger.info(`[parse] Chapter "${title}": 二级压缩对白镜余量 ${applied2.toFixed(1)}s → total ${total.toFixed(1)}s`)
    }
  }

  // 三级兜底：比例缩放（尊重每镜的 maxDur cap）
  if (total > TARGET_TOTAL) {
    const ratio = TARGET_TOTAL / total
    for (let i = 0; i < 8; i++) {
      const dChars = charCount(shots[i].dialogue)
      const speechFloor = dChars > 0 ? dChars / DIALOGUE_RATE : 0
      const hasAudioTrack = shots[i].audio_track_id !== ''
      const maxDur = hasAudioTrack ? 5.0 : 3.0
      shots[i].duration_seconds = Math.round(Math.max(
        getShotProfile(shots[i].shot_type).floor,
        Math.min(shots[i].duration_seconds * ratio, Math.max(speechFloor, maxDur))
      ) * 10) / 10
    }
    shots[8].duration_seconds = Math.max(1.2, Math.round((shots[8].duration_seconds * ratio) * 10) / 10)
    total = shots.reduce((s, sh) => s + sh.duration_seconds, 0)
    logger.warn(`[parse] Chapter "${title}": 三级比例缩放兜底 ${(ratio * 100).toFixed(0)}% → total ${total.toFixed(1)}s`)
  }

  logger.info(`[parse] Chapter "${title}" duration: ${total.toFixed(1)}s`)
}
