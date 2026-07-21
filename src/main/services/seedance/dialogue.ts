/**
 * Seedance module — auto-extracted from scriptParse.ts
 */
import { type DialogueContext, type NormalizedChapter } from "./types"
import { charCount, speechPrefix, splitByChineseChars, splitBySemanticBoundary, ensureShotDescription } from "./utils"
// ---- P0.9.9 Voice-Over Slot Selection ----

/** 镜头 purpose 对 voice_over 的适合度。Infinity = 禁止 */
function purposeScoreForVO(shot: any): number {
  const p = (shot.shot_purpose || '').toLowerCase()
  if (p === 'information') return Infinity  // 信息镜有口型/关键动作，禁止覆盖
  if (p === 'transition') return 0           // 留白/空镜 — 最适合
  if (p === 'emotion') return 1               // 情绪镜 — 声音延续自然
  if (p === 'action') return 2               // 动作镜 — 可以叠声音
  return 5                                     // 无 purpose — 中性
}

/**
 * 为 voice_over 选择最优空位。
 * 1. 优先源镜之前的连续区间（J-cut：画面已切，声音延续）
 * 2. 禁止覆盖 information 镜
 * 3. distance × 2 + purposeScore 兜底
 */
function selectVoiceOverSlots(
  sourceIdx: number,
  emptySlots: number[],
  shots: any[],
  deficit: number
): number[] {
  if (deficit <= 0 || emptySlots.length === 0) return []

  // 过滤禁止项（information = Infinity）
  const allowed = emptySlots.filter(si => purposeScoreForVO(shots[si]) !== Infinity)
  if (allowed.length === 0) return []

  // 优先：源镜之前（preferBefore），找连续区间
  const beforeSource = allowed.filter(si => si < sourceIdx).sort((a, b) => b - a)  // 降序 = 离源镜最近在前
  if (beforeSource.length >= deficit) {
    // 检查是否形成连续块（相邻 slot 之间间隔 ≤1）
    const contiguous = beforeSource.slice(0, deficit)
    const gaps = contiguous.some((v, i) => i > 0 && Math.abs(v - contiguous[i - 1]) > 1)
    if (!gaps) return contiguous
    // 不连续 → 回退评分
  }

  // 兜底：评分排序
  const scored = allowed.map(si => {
    const dist = Math.abs(si - sourceIdx)
    const purpose = purposeScoreForVO(shots[si])
    return { idx: si, score: dist * 2 + (purpose === Infinity ? 100 : purpose) }
  })
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, deficit).map(s => s.idx)
}
import { getShotProfile, shotDialogueCapacity } from "./duration"
import { buildAutoVideoPrompt } from "./prompt"
import { buildSeedanceVideoPrompt, buildSeedanceVideoPromptZh } from "./prompt"
import { logger } from '../../utils/logger'

/** 检测占位符对白（跨镜组扩展成员、UI 标记等非真实对白文本） */
function isPlaceholderDialogue(text: string): boolean {
  const placeholders = ['(承上镜对白)', '同上', '继续', '无对白', '延续上一镜', '继续对白', '保持上一句', '无新增对白']
  return placeholders.some(p => text.includes(p))
}

/** 对白处理管线：分配 → 分段 → 溢出 → 收敛 → 拆章 → 裁剪 → 重编号 */
export function processDialoguePipeline(chapters: NormalizedChapter[]): NormalizedChapter[] {
  const ctx: DialogueContext = { overflowBin: [] }
  let result = redistributeDialogue(chapters)
  result = splitDialogueSegments(result)
  result = allocateDialogueSegments(result)
  result = overflowDialogue(result, ctx)
  result = enforceDialogueShotLimit(result)
  const overflows = buildOverflowChapters(ctx)
  if (overflows.length > 0) {
    result = result.concat(overflows)
    logger.info(`[parse] 对白溢出自动拆出 ${overflows.length} 个新章节`)
  }
  result = consolidateChapters(result)
  result = renumberShots(result)
  return result
}

/**
 * P1-C: 对白镜数量硬收敛 ≤3
 *
 * 合并策略：contiguous grouping（保持时间顺序，零对白丢失）。
 * merged-away shot 保留 audio_track_id / source_dialogue_id，仅 dialogue 置空，
 * 保证 audio timeline 连续、renderer 不误判空镜、trace 可追踪。
 */
export function enforceDialogueShotLimit(chapters: NormalizedChapter[]): NormalizedChapter[] {
  for (const ch of chapters) {
    const shots = ch.shots || []
    const shotCount = shots.length

    // 收集对白镜（不含镜1/镜9、占位符、voice_over）
    const dialogueShots: { idx: number; chars: number }[] = []
    for (let i = 1; i < shotCount - 1 && i < 9; i++) {
      const s = shots[i] as any
      const d = (s.dialogue || '').trim()
      if (!d) continue
      if (isPlaceholderDialogue(d)) continue
      if ((s.dialogue_mode || '').trim() === 'voice_over') continue
      dialogueShots.push({ idx: i, chars: charCount(d) })
    }

    if (dialogueShots.length <= 3) continue

    // P1-C.2: 按 audio_track 事件分组，同 track 的 segment 不被拆分到不同组。
    // 不同 audio_track_id 的对白镜不会互相合并。
    const n = dialogueShots.length
    const groupSize = Math.ceil(n / 3)
    const groups: { idx: number; chars: number }[][] = [[], [], []]
    let gi = 0
    for (let i = 0; i < n; i++) {
      if (groups[gi].length >= groupSize) {
        // 检查是否与当前组最后一个镜共享 audio_track_id —— 如果是，不拆分
        const lastInGroup = groups[gi][groups[gi].length - 1]
        const lastTid = (shots[lastInGroup.idx] as any).audio_track_id || ''
        const thisTid = (shots[dialogueShots[i].idx] as any).audio_track_id || ''
        if (!lastTid || !thisTid || lastTid !== thisTid) gi++
      }
      groups[gi].push(dialogueShots[i])
    }

    // Merge each group into its first shot — 但只在同 audio_track 内合并
    let totalMerged = 0
    for (const group of groups) {
      if (group.length <= 1) continue

      // 按 audio_track_id 分组：只有同 track 的镜才合并对话文本
      const subGroups = new Map<string, { idx: number; chars: number }[]>()
      for (const ds of group) {
        const tid = (shots[ds.idx] as any).audio_track_id || `_single_${ds.idx}`
        if (!subGroups.has(tid)) subGroups.set(tid, [])
        subGroups.get(tid)!.push(ds)
      }

      for (const [, sg] of subGroups) {
        if (sg.length <= 1) continue
        const target = shots[sg[0].idx] as any
        const sources = sg.slice(1)

        for (const src of sources) {
          const srcShot = shots[src.idx] as any
          const srcText = (srcShot.dialogue || '').trim()
          target.dialogue = (target.dialogue || '').trim() + srcText
          srcShot.dialogue = ''
          if (!srcShot.dialogue_mode || srcShot.dialogue_mode === 'lip_sync') {
            srcShot.dialogue_mode = 'none'
          }
          totalMerged++
        }
        target.segment_index = (target.segment_index || 0) + sources.length
      }
    }

    logger.info(`[parse] enforceDialogueShotLimit: "${ch.title || '?'}" ${n}→3 dialogue slots (merged ${totalMerged} shots)`)
  }

  return chapters
}

export function redistributeDialogue(chapters: any[]): any[] {
  for (const ch of chapters) {
    const shots = ch.shots || []
    // 镜1定场 + 镜9锁帧 强制留白
    if (shots.length >= 1) { shots[0].dialogue = ''; shots[0].narration = '' }
    if (shots.length >= 9) { shots[8].dialogue = ''; shots[8].narration = '' }
    // 章级检查：任一镜有对白 → 全章清旁白
    const hasAnyDialogue = shots.some((s: any) => (s.dialogue || '').trim())
    if (hasAnyDialogue) {
      let cleared = 0
      for (const s of shots) {
        if ((s.narration || '').trim()) { s.narration = ''; cleared++ }
      }
      if (cleared > 0) logger.info(`[parse] Chapter "${ch.title || '?'}": has dialogue, cleared narration from ${cleared} shots`)
    }
    for (let i = 0; i < shots.length; i++) {
      const d = (shots[i].dialogue || '') as string
      const dChars = d.replace(/^[^：:]+[：:]\s*/, '').replace(/[^一-鿿]/g, '').length
      if (dChars > 20) {
        logger.warn(`[parse] Long dialogue shot #${shots[i].shot_index}: ${dChars}字`)
      }
    }
  }
  return chapters
}

/**
 * P1-C.2: 对白分段 — 检测 AI 在 audio_track 组中复制了完整对白时，自动拆分为各镜承载片段。
 *
 * 不创建新镜头，不删除对白。只在 dialogue 字段已重复的情况下按容量分配 segment。
 * 这是从 "修 Pipeline 数据破坏" 到 "约束 AI 导演输出格式" 的架构转折点。
 */
export function splitDialogueSegments(chapters: NormalizedChapter[]): NormalizedChapter[] {
  for (const ch of chapters) {
    const shots = ch.shots || []
    const shotCount = shots.length

    // 收集中有 audio_track_id 的对白镜
    const trackGroups = new Map<string, number[]>()
    for (let i = 1; i < shotCount - 1 && i < 9; i++) {
      const s = shots[i] as any
      const tid = (s.audio_track_id || '').trim()
      const d = (s.dialogue || '').trim()
      if (!tid || !d) continue
      if (isPlaceholderDialogue(d)) continue
      if ((s.dialogue_mode || '').trim() === 'voice_over') continue
      if (!trackGroups.has(tid)) trackGroups.set(tid, [])
      trackGroups.get(tid)!.push(i)
    }

    for (const [tid, indices] of trackGroups) {
      if (indices.length <= 1) continue

      // 检测：所有成员是否写了完全相同的 dialogue 文本
      const firstD = (shots[indices[0]] as any).dialogue.trim()
      const allSame = indices.every(i => (shots[i] as any).dialogue.trim() === firstD)
      if (!allSame) continue

      // 提取完整对白文本
      const prefix = speechPrefix(firstD)
      const fullText = firstD.replace(/^[^：:]+[：:]\s*/, '')
      const totalChars = charCount(fullText)
      if (totalChars < 6) continue  // 短对白不需要分段

      // 按各镜容量比例拆分
      const capacities = indices.map(i => shotDialogueCapacity(shots[i]))
      let remaining = fullText
      let segIdx = 0
      for (let gi = 0; gi < indices.length && remaining; gi++) {
        const i = indices[gi]
        const s = shots[i] as any
        const isLast = gi === indices.length - 1
        const cap = capacities[gi]

        if (isLast) {
          s.dialogue = remaining ? `${prefix}${remaining}` : ''
        } else {
          const [keep, rest] = splitBySemanticBoundary(remaining, Math.max(1, cap))
          s.dialogue = keep ? `${prefix}${keep}` : ''
          remaining = rest
        }
        s.segment_index = segIdx++
        s.source_dialogue_id = tid
      }

      const charsAfter = indices.reduce((sum, i) => sum + charCount((shots[i] as any).dialogue || ''), 0)
      logger.info(`[parse] splitDialogueSegments: "${tid}" ${indices.length}镜重复对白(${totalChars}字)→分段(${charsAfter}字)`)
    }
  }
  return chapters
}

/**
 * P1-C.3: 对白承载分配 — 解决「孤岛对白」问题。
 *
 * 当 AI 在一个 audio_track 组中创建了多个视觉承接镜（dialogue=""），
 * 但只在一个镜上写了完整对白文本时，将对白按各镜 capacity 比例分配到所有组成员。
 *
 * 触发条件（全部满足）：
 *   1. 同 track 组有 ≥2 个成员
 *   2. 只有 1 个镜有对白文本（孤岛），其余 ≥1 个镜 dialogue 为空
 *   3. 总对白时长 > 5.0s（单镜上限）
 *
 * 不触发：AI 已正确分段（每个镜有不同 dialogue 文本）、全部有对白、全部无对白。
 */
export function allocateDialogueSegments(chapters: NormalizedChapter[]): NormalizedChapter[] {
  for (const ch of chapters) {
    const shots = ch.shots || []
    const shotCount = shots.length

    // 收集 audio_track 组（含空 dialogue 的成员）
    const trackAllMembers = new Map<string, number[]>()
    for (let i = 1; i < shotCount - 1 && i < 9; i++) {
      const s = shots[i] as any
      const tid = (s.audio_track_id || '').trim()
      if (!tid) continue
      if ((s.dialogue_mode || '').trim() === 'voice_over') continue
      if (!trackAllMembers.has(tid)) trackAllMembers.set(tid, [])
      trackAllMembers.get(tid)!.push(i)
    }

    for (const [tid, indices] of trackAllMembers) {
      if (indices.length <= 1) continue

      // 分离有对白和无对白的镜
      const withDialogue: number[] = []
      const withoutDialogue: number[] = []
      for (const i of indices) {
        const d = (shots[i] as any).dialogue || ''
        if (d.trim() && !isPlaceholderDialogue(d)) withDialogue.push(i)
        else withoutDialogue.push(i)
      }

      // 不触发：全部有对白或全部无对白
      if (withDialogue.length === 0 || withoutDialogue.length === 0) continue

      // 不触发：AI 已正确分段（多个镜各有不同 dialogue 文本）
      if (withDialogue.length > 1) {
        const texts = withDialogue.map(i => (shots[i] as any).dialogue.trim())
        if (new Set(texts).size > 1) continue  // 已分段，不破坏
      }

      // 计算总对白时长
      const totalChars = withDialogue.reduce(
        (sum, i) => sum + charCount((shots[i] as any).dialogue || ''), 0
      )

      // 仅当总时长超过非-track 单镜上限 (3.0s) 时才触发
      // 理由：孤岛对白已超过普通单镜容量，有空镜可分担就分散
      if (totalChars / 3.0 <= 3.0) continue

      // 收集完整文本（从有对白的镜拼接）
      const firstD = (shots[withDialogue[0]] as any).dialogue.trim()
      const prefix = speechPrefix(firstD)
      const fullText = withDialogue
        .map(i => (shots[i] as any).dialogue.replace(/^[^：:]+[：:]\s*/, ''))
        .join('')
      if (!fullText) continue

      // 按 capacity 比例分配到所有组成员（按 shot_index 时间顺序）
      const allMembers = [...withDialogue, ...withoutDialogue].sort((a, b) => a - b)
      const capacities = allMembers.map(i => shotDialogueCapacity(shots[i]))
      let remaining = fullText
      let segIdx = 0

      for (let gi = 0; gi < allMembers.length && remaining; gi++) {
        const i = allMembers[gi]
        const s = shots[i] as any
        const isLast = gi === allMembers.length - 1
        const cap = capacities[gi]

        if (isLast) {
          s.dialogue = remaining ? `${prefix}${remaining}` : ''
        } else {
          const [keep, rest] = splitBySemanticBoundary(remaining, Math.max(1, cap))
          s.dialogue = keep ? `${prefix}${keep}` : ''
          remaining = rest
        }
        s.segment_index = segIdx++
        s.source_dialogue_id = tid

        // 空镜 dialogue_mode 决策：有角色 → lip_sync；无角色/远镜 → voice_over
        if (withoutDialogue.includes(i) && s.dialogue) {
          const hasChar = (() => {
            try {
              const ca = JSON.parse(s.character_actions || '[]')
              return ca.length > 0 && ca.some((c: any) => c.character_name && !c.action?.includes('离场'))
            } catch { return false }
          })()
          const isLongShot = ['全景', '大远景'].includes(s.shot_type || '')
          s.dialogue_mode = (hasChar && !isLongShot) ? 'lip_sync' : 'voice_over'
        }
      }

      logger.info(`[parse] allocateDialogueSegments: "${tid}" 孤岛对白(${totalChars}字)→${allMembers.length}镜分散`)
    }
  }
  return chapters
}

export function buildOverflowChapters(ctx: DialogueContext): any[] {
  if (ctx.overflowBin.length === 0) return []
  // 按原始时间轴顺序排列，保留 A→B→A→B。每个 overflow item 对应一个续章。
  const sorted = [...ctx.overflowBin].sort((a, b) => a.sequenceOrder - b.sequenceOrder)

  const newChapters: any[] = []
  for (const item of sorted) {
    const speaker = item.prefix.replace(/[：:]$/, '')
    const sceneName = item.sceneName || '延续场景'
    const charNames = item.charNames
    const totalChars = charCount(item.text)
    if (totalChars < 6) {
      logger.info(`[parse] 溢出对白不足6字(${totalChars}字)，丢弃"${speaker}"碎片，不创建新章`)
      continue
    }
    const chaptersNeeded = Math.max(1, Math.ceil(totalChars / 36))
    const charsPerChapter = Math.ceil(totalChars / chaptersNeeded)

    let remaining = item.text
    for (let ci = 0; ci < chaptersNeeded && remaining; ci++) {
      const [chunk, rest] = splitByChineseChars(remaining, charsPerChapter)
      remaining = rest
      const shots: any[] = [
        { shot_index: 1, shot_purpose: 'transition', _purposeSource: 'overflow_skeleton',
          shot_type: '全景', dialogue: '', narration: '', dialogue_mode: 'none',
          source_dialogue_id: '', segment_index: 0,
          description: ensureShotDescription(`${sceneName}全景定场`, '全景', sceneName), description_zh: `${sceneName}全景`,
          shot_scene: sceneName, camera_movement: '固定', lighting_mood: '',
          character_actions: JSON.stringify(charNames.map((n: string) => ({ character_name: n, action: '' }))),
          focal_length: '35mm', focus_point: '全景深', sound_hint: '环境音',
          narrative_function: '建置时空', duration_seconds: 1.8, _rawAi: null },
      ]
      const RHYTHM_SKELETON: Array<{ purpose: string; shotType: string }> = [
        { purpose: 'information', shotType: '近景' },
        { purpose: 'emotion', shotType: '近景' },
        { purpose: 'transition', shotType: '中景' },
        { purpose: 'action', shotType: '中景' },
        { purpose: 'emotion', shotType: '中景' },
        { purpose: 'information', shotType: '特写' },
        { purpose: 'transition', shotType: '特写' },
      ]
      let remain = chunk
      for (let si = 0; si < 7 && remain; si++) {
        const skeleton = RHYTHM_SKELETON[si]
        const shotIdx = si + 2
        const profile = getShotProfile(skeleton.shotType)
        const maxC = Math.floor(profile.base * 3.0)
        const isDialogueSlot = skeleton.purpose === 'information' || skeleton.purpose === 'emotion'
        let dialogue = ''
        if (isDialogueSlot && remain) {
          const [keep, rest2] = splitBySemanticBoundary(remain, maxC)
          dialogue = keep.trim() ? `${item.prefix}${keep.trim()}` : ''
          remain = rest2
        }
        shots.push({
          shot_index: shotIdx, shot_purpose: skeleton.purpose, _purposeSource: 'overflow_skeleton',
          shot_type: skeleton.shotType, dialogue_mode: dialogue ? 'lip_sync' as const : 'none' as const,
          source_dialogue_id: dialogue ? speaker : '', segment_index: 0,
          dialogue, narration: '',
          description: ensureShotDescription(dialogue ? `${speaker}${skeleton.shotType}` : `${sceneName}${skeleton.purpose}`, skeleton.shotType, sceneName),
          description_zh: dialogue ? `${speaker}${skeleton.shotType}` : `${sceneName}${skeleton.purpose === 'emotion' ? '情绪' : skeleton.purpose === 'transition' ? '过渡' : '动作'}`,
          shot_scene: sceneName, camera_movement: '固定', lighting_mood: '',
          character_actions: JSON.stringify(charNames.map((n: string) => ({ character_name: n, action: '' }))),
          focal_length: skeleton.shotType === '近景' ? '85mm' : skeleton.shotType === '特写' ? '100mm' : '50mm',
          focus_point: skeleton.shotType === '近景' ? '人物上半身' : skeleton.shotType === '特写' ? '面部细节' : '人物全身',
          sound_hint: dialogue ? '对白' : '环境音',
          narrative_function: skeleton.purpose === 'emotion' ? '情绪放大' : skeleton.purpose === 'transition' ? '视觉过渡' : '人物状态',
          duration_seconds: profile.base, _rawAi: null,
        })
      }
      while (shots.length < 8) {
        const idx = shots.length
        shots.splice(idx - 1, 0, {
          shot_index: idx, shot_purpose: 'transition', _purposeSource: 'overflow_skeleton',
          shot_type: '中景', dialogue: '', narration: '', dialogue_mode: 'none',
          source_dialogue_id: '', segment_index: 0,
          description: ensureShotDescription('过渡镜头', '中景', sceneName), description_zh: '过渡',
          shot_scene: sceneName, camera_movement: '固定', lighting_mood: '',
          character_actions: JSON.stringify(charNames.map((n: string) => ({ character_name: n, action: '' }))),
          focal_length: '50mm', focus_point: '人物全身', sound_hint: '环境音',
          narrative_function: '视觉过渡', duration_seconds: 1.7, _rawAi: null,
        })
      }
      if (shots.length > 8) shots.length = 8
      shots.push({
        shot_index: 9, shot_purpose: 'transition', _purposeSource: 'overflow_skeleton',
        shot_type: '全景', dialogue: '', narration: '', dialogue_mode: 'none',
        source_dialogue_id: '', segment_index: 0,
        description: ensureShotDescription(`${sceneName}空镜收尾`, '全景', sceneName), description_zh: `${sceneName}空镜`,
        shot_scene: sceneName, camera_movement: '固定', lighting_mood: '',
        character_actions: '[]', focal_length: '35mm', focus_point: '全景深',
        sound_hint: '环境音', narrative_function: '情绪落幅', duration_seconds: 1.5, _rawAi: null,
      })
      shots.forEach((s: any, i: number) => { s.shot_index = i + 1 })
      const totalSc = shots.length
      for (let si = 0; si < totalSc; si++) {
        const s = shots[si] as any
        s.video_prompt = buildAutoVideoPrompt(
          s.description || '', charNames, sceneName, s.shot_type || '中景',
          s.camera_movement || '固定', s.lighting_mood || '', s.duration_seconds || 1.5,
          s.dialogue || '', s.narration || ''
        )
        s.video_prompt_zh = `${s.shot_type || '中景'}，${sceneName}。${s.description_zh || s.description || ''}${s.dialogue ? '。对白: ' + s.dialogue : ''}`
      }
      const keptChars = shots.reduce((s, sh) => s + charCount((sh as any).dialogue || ''), 0)
      newChapters.push({ title: `${speaker}·续${ci + 1}`, shots })
      logger.info(`[parse] 自动拆章: "${speaker}" 溢出对白 → 新章${ci + 1} (${keptChars}字)`)
    }
  }
  ctx.overflowBin = []
  return newChapters
}

/** 纯镜头重编号 + prompt 重建 */
export function renumberShots(chapters: NormalizedChapter[]): NormalizedChapter[] {
  for (const ch of chapters) {
    const shots = ch.shots || []
    const sc = shots.length
    for (let i = 0; i < sc; i++) {
      const s = shots[i] as any
      s.shot_index = i + 1
      if (s._rawAi) {
        const combined = { ...s._rawAi, dialogue: s.dialogue, narration: s.narration, shot_type: s.shot_type }
        s.video_prompt = buildSeedanceVideoPrompt(combined, i, sc)
        s.video_prompt_zh = buildSeedanceVideoPromptZh(combined, i, sc)
      }
    }
  }
  return chapters
}


export function consolidateChapters(chapters: any[]): any[] {
  if (chapters.length <= 1) return chapters

  // 按章+audio_track_id 去重计数（不同章的对白独立计算，不跨章去重）
  let totalDialogueChars = 0
  const seenTracks = new Set<string>()
  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci]
    for (const s of (ch.shots || [])) {
      const d = (s.dialogue || '').trim()
      if (!d) continue
      const tid = (s.audio_track_id || '').trim()
      const key = tid ? `ch${ci}_${tid}` : `ch${ci}_${s.shot_index}_${d.slice(0, 10)}`
      if (seenTracks.has(key)) continue
      seenTracks.add(key)
      totalDialogueChars += charCount(d)
    }
  }
  const dialogueAudioDuration = totalDialogueChars / 3.0
  const requiredDialogueChapters = Math.max(1, Math.ceil((dialogueAudioDuration + 3.3) / 13.5))

  // P0.9 架构修正：AI 负责章节规划，Pipeline 不再基于机械公式裁剪章节。
  // requiredDialogueChapters 是容量下限（对白至少需要多少章），不是上限。
  // Pipeline 只做极端保护：过滤明显无叙事价值的空章节。
  if (chapters.length < requiredDialogueChapters) {
    logger.info(`[parse] 章数不足: ${chapters.length}章，对白需要至少${requiredDialogueChapters}章（${totalDialogueChars}字→${dialogueAudioDuration.toFixed(1)}s），后续由 overflow 扩展`)
  }

  // 极端保护：当 AI 输出异常多章节时，仅过滤无叙事价值的空章
  const narrativeChapters: any[] = []
  const emptyChapters: any[] = []
  for (const ch of chapters) {
    if (isNarrativeChapter(ch)) {
      narrativeChapters.push(ch)
    } else {
      emptyChapters.push(ch)
    }
  }

  if (emptyChapters.length > 0 && narrativeChapters.length >= requiredDialogueChapters) {
    logger.info(`[parse] 过滤${emptyChapters.length}个无叙事章节，保留${narrativeChapters.length}章（对白${totalDialogueChars}字→${dialogueAudioDuration.toFixed(1)}s）`)
    return narrativeChapters
  }

  logger.info(`[parse] 章数合理: ${chapters.length}章（对白${totalDialogueChars}字→${dialogueAudioDuration.toFixed(1)}s，叙事章节${narrativeChapters.length}）`)
  return chapters
}

/** 判断章节是否有独立叙事价值——有对白/情绪/动作/多purpose结构的章节不可裁剪 */
function isNarrativeChapter(chapter: any): boolean {
  const shots = chapter.shots || []
  // 有对白的章节一定有叙事价值
  if (shots.some((s: any) => (s.dialogue || '').trim())) return true
  // 有情绪表达或动作推进的章节——AI 显式设计了叙事意图
  const purposes = shots.map((s: any) => s.shot_purpose).filter(Boolean)
  if (purposes.some((p: string) => p === 'emotion' || p === 'action')) return true
  // 至少 3 种不同 purpose 说明有完整的叙事结构（transition + information + emotion）
  if (new Set(purposes).size >= 3) return true
  // 全 transition/空镜视为无叙事价值——可被安全过滤
  return false
}

export function overflowDialogue(chapters: any[], ctx: DialogueContext): any[] {
  ctx.overflowBin = []
  // P1-C.1: 记录第一遍容量验证通过的 track，第二遍清理时保护不被缩组
  const validatedTracks = new Set<string>()
  for (const ch of chapters) {
    const shots = ch.shots || []
    const shotCount = shots.length

    // === 第一遍：收集 audio_track 组信息 ===
    const trackInfo = new Map<string, { firstIdx: number; chars: number; prefix: string; existingMembers: number }>()
    for (let i = 1; i < shotCount - 1 && i < 9; i++) {
      const s = shots[i] as any
      const tid = (s.audio_track_id || '').trim()
      const d = (s.dialogue || '').trim()
      if (!tid || !d) continue
      if (!trackInfo.has(tid)) {
        trackInfo.set(tid, { firstIdx: i, chars: charCount(d.replace(/^[^：:]+[：:]\s*/, '')), prefix: speechPrefix(d), existingMembers: 0 })
      }
      trackInfo.get(tid)!.existingMembers++
    }

    if (trackInfo.size > 0) {
      // 计算可用空位（镜2-8 中无对白且无 track 的镜）
      const emptySlots: number[] = []
      for (let i = 1; i < shotCount - 1 && i < 9; i++) {
        const s = shots[i] as any
        if (!(s.dialogue || '').trim() && !(s.audio_track_id || '').trim()) {
          emptySlots.push(i)
        }
      }

      // 按对白字数降序排列组（大字组优先分配空位）
      const sortedTracks = [...trackInfo.entries()]
        .sort((a, b) => b[1].chars - a[1].chars)

      for (const [tid, info] of sortedTracks) {
        const trackMaxChars = shotDialogueCapacity(shots[info.firstIdx])
        const neededSlots = Math.ceil(info.chars / trackMaxChars)
        const deficit = Math.max(0, neededSlots - info.existingMembers)

        if (deficit <= 0) {
          logger.info(`[parse] audio_track="${tid}": ${info.chars}字，${info.existingMembers}镜，容量充足`)
          validatedTracks.add(tid)
          continue
        }

        if (deficit <= emptySlots.length) {
          // 有空位 → 按连续区间 + purpose + 距离综合选择
          const allocated = selectVoiceOverSlots(info.firstIdx, emptySlots, shots, deficit)
          // 从 emptySlots 中移除已分配的
          for (const si of allocated) {
            const idx = emptySlots.indexOf(si)
            if (idx >= 0) emptySlots.splice(idx, 1)
          }
          for (const si of allocated) {
            const ns = shots[si] as any
            ns.audio_track_id = tid
            ns.dialogue = `${info.prefix}(承上镜对白)`
            ns.dialogue_mode = 'voice_over'
            ns.source_dialogue_id = tid
            ns.segment_index = (ns.segment_index || 0) + 1
          }
          logger.info(`[parse] audio_track="${tid}" 扩展: ${info.chars}字，${info.existingMembers}+${allocated.length}=${info.existingMembers + allocated.length}镜（${allocated.length}个空位）`)
        } else {
          // 空位不够 → 移入 overflow bin，交给 buildOverflowChapters 拆章
          const s = shots[info.firstIdx] as any
          try {
            const charList = JSON.parse(s.character_actions || '[]').map((c: any) => c.character_name)
            ctx.overflowBin.push({ prefix: info.prefix, text: (s.dialogue || '').replace(/^[^：:]+[：:]\s*/, ''), sceneName: s.shot_scene || '', charNames: charList, sequenceOrder: info.firstIdx })
          } catch {
            ctx.overflowBin.push({ prefix: info.prefix, text: (s.dialogue || '').replace(/^[^：:]+[：:]\s*/, ''), sceneName: s.shot_scene || '', charNames: [], sequenceOrder: info.firstIdx })
          }
          // 清除当前章的对白和 track
          for (let i = 1; i < shotCount - 1 && i < 9; i++) {
            const cs = shots[i] as any
            if ((cs.audio_track_id || '').trim() === tid) {
              cs.audio_track_id = ''
              cs.dialogue = ''
            }
          }
          logger.info(`[parse] audio_track="${tid}" 溢出拆章: ${info.chars}字，空位不足（需${deficit}个，剩${emptySlots.length}个）→ 移入 bin`)
        }
      }
    }

    // === 第二遍：旧格式兼容 + 处理剩余的 legacy 镜头 ===
    for (let i = 0; i < shotCount; i++) {
      if (i === 0 || (shotCount >= 9 && i === 8)) continue
      const s = shots[i] as any
      const d = (s.dialogue || '').trim()
      if (!d) continue

      // audio_track 镜头已在第一遍处理
      if ((s.audio_track_id || '').trim()) continue

      // 旧格式兼容：无 audio_track_id 的镜头，对白超长时拆分
      const maxChars = shotDialogueCapacity(s)
      const chars = charCount(d)
      if (chars <= maxChars) continue

      const prefix = speechPrefix(d)
      const afterPrefix = d.replace(/^[^：:]+[：:]\s*/, '')
      const [keep, overflowRaw] = splitBySemanticBoundary(afterPrefix, maxChars)
      s.dialogue = prefix + keep
      const srcId = s.source_dialogue_id || s.audio_track_id || ''
      let overflow = overflowRaw
      let moved = 0
      let segIdx = 1  // 原镜 segment=0，溢流从 1 开始

      for (let j = i + 1; j < shotCount && overflow; j++) {
        if (j === 0 || (shotCount >= 9 && j === 8)) continue
        const next = shots[j] as any
        if ((next.audio_track_id || '').trim()) continue // 不污染有 track 的镜头
        const nextMax = shotDialogueCapacity(next)
        const nextPrefix = speechPrefix(next.dialogue || '')
        const nextChars = charCount(next.dialogue || '')
        const free = nextMax - nextChars
        if (free <= 0) continue

        const isEmpty = nextChars === 0
        const sameSpeaker = nextPrefix === prefix
        if (!isEmpty && !sameSpeaker) continue

        const [move, rest] = splitBySemanticBoundary(overflow, free)
        const moveChars = charCount(move)
        if (moveChars === 0) continue

        if (isEmpty) { next.dialogue = prefix + move; next.source_dialogue_id = srcId; next.segment_index = segIdx++; }
        else { const na = (next.dialogue || '').replace(/^[^：:]+[：:]\s*/, ''); next.dialogue = nextPrefix + na + move; next.source_dialogue_id = srcId; next.segment_index = segIdx++; }
        overflow = rest
        moved += moveChars
      }

      if (moved > 0) logger.info(`[parse] Shot #${i + 1}: ${chars}字→保留${maxChars}字+溢出${moved}字到后续镜`)
      if (overflow) {
        const lost = charCount(overflow)
        try {
          const charList = JSON.parse(s.character_actions || '[]').map((c: any) => c.character_name)
          ctx.overflowBin.push({ prefix, text: overflow, sceneName: s.shot_scene || '', charNames: charList, sequenceOrder: i })
          logger.info(`[parse] Shot #${i + 1}: ${lost}字对白溢出收集，待拆章`)
        } catch {
          ctx.overflowBin.push({ prefix, text: overflow, sceneName: s.shot_scene || '', charNames: [], sequenceOrder: i })
        }
      }
    }
  }

  // audio_track 组清理：去重文本 + 解决 AI 同 ID 异文问题
  for (const ch of chapters) {
    const shots = (ch.shots || []) as any[]
    // 第一遍：检测同 track_id 是否属于同一对白身份
    // P0.9.8.2: source_dialogue_id 相同 = 同句拆分/延续，不冲突
    //           source_dialogue_id 不同 = AI 错误复用 track_id，需重命名
    const trackSources = new Map<string, string>()  // track_id → source_dialogue_id
    let renameCounter = 0
    for (let i = 0; i < shots.length; i++) {
      const tid = ((shots[i] as any).audio_track_id || '').trim()
      const d = ((shots[i] as any).dialogue || '').trim()
      if (!tid || !d) continue

      // 占位符/voice_over → 合法延续，不参与碰撞
      if (isPlaceholderDialogue(d)) continue
      if ((shots[i] as any).dialogue_mode === 'voice_over') continue

      const srcId = (shots[i] as any).source_dialogue_id || tid

      if (!trackSources.has(tid)) {
        trackSources.set(tid, srcId)
        continue
      }
      // 同一对白来源 → 正常拆分，不冲突
      if (trackSources.get(tid) === srcId) continue

      // 不同对白来源 → AI 错误复用 track_id，重命名
      renameCounter++
      ;(shots[i] as any).audio_track_id = `${tid}_r${renameCounter}`
      logger.info(`[parse] audio_track 重命名: "${tid}" source=${srcId} ≠ ${trackSources.get(tid)} → "${tid}_r${renameCounter}"（镜#${(shots[i] as any).shot_index}）`)
    }

    // 第二遍：去重对白文本 + 短对白收束
    const seenTracks = new Map<string, number>()
    for (let i = 0; i < shots.length; i++) {
      const tid = ((shots[i] as any).audio_track_id || '').trim()
      if (!tid) continue
      const d = ((shots[i] as any).dialogue || '').trim()
      if (!d) continue

      if (!seenTracks.has(tid)) {
        seenTracks.set(tid, i)
        continue
      }

      // 占位符文本 → 已知的扩展成员，跳过
      if (isPlaceholderDialogue(d)) continue

      const chars = charCount(d.replace(/^[^：:]+[：:]\s*/, ''))
      // 检查同 track 首镜是否长对白（>6字），若是则本镜为合法组成员，不清理
      const firstIdx = seenTracks.get(tid)!
      const firstChars = charCount(((shots[firstIdx] as any).dialogue || '').replace(/^[^：:]+[：:]\s*/, ''))
      if (firstChars > 6) {
        // 长对白组的后续镜 → 替换占位符，保留 track + source
        ;(shots[i] as any).dialogue = `${speechPrefix(d)}(承上镜对白)`
        ;(shots[i] as any).dialogue_mode = 'voice_over'
        ;(shots[i] as any).source_dialogue_id = tid
        continue
      }

      // P1-C.1: 第一遍容量验证通过的 track 不再被第二遍清理破坏
      if (validatedTracks.has(tid)) continue

      if (chars <= 6) {
        (shots[i] as any).audio_track_id = ''
        ;(shots[i] as any).dialogue = ''
        logger.info(`[parse] audio_track "${tid}" 短对白(${chars}字)收束：镜#${(shots[i] as any).shot_index}`)
      }
    }
  }
  return chapters


}