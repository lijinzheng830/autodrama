/**
 * Seedance module — auto-extracted from scriptParse.ts
 */
import { ensureShotDescription, truncateDesc, isSuspiciousName } from "./utils"
import { logger } from '../../utils/logger'
import type { NormalizedShot, NormalizedChapter, NormalizedSeedanceData } from "./types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeShot(s: Record<string, any>, i: number): NormalizedShot {
  const desc = s.shot_description || s.description || ''
  const descZh = s.description_zh || s.shot_description || ''
  const st = s.shot_type || ''
  const cm = s.camera_movement || ''
  const lm = s.lighting_mood || ''
  let charActions = s.character_actions
  if (charActions && typeof charActions === 'object' && !Array.isArray(charActions)) {
    charActions = Object.entries(charActions).map(([name, action]) => ({ character_name: name, action }))
  }
  const charActionsStr = Array.isArray(charActions) ? JSON.stringify(charActions) : ''
  const vPrompt = s.video_prompt || s.videoPrompt || `${cm || 'static'} camera, ${desc}. One primary action per shot, motivated lighting.`

  return {
    shot_index: s.frame_index ?? i + 1,
    shot_purpose: (s.shot_purpose as import('./types').ShotPurpose) || '',
    source_dialogue_id: (s.audio_track_id || '').trim(),
    segment_index: 0,
    dialogue_mode: (s.dialogue || '').trim() ? 'lip_sync' as const : 'none' as const,
    _purposeSource: (s.shot_purpose ? 'ai' : 'fallback_index') as 'ai' | 'fallback_index',
    duration_seconds: s.duration_seconds || null,
    description: desc,
    description_en: s.shot_description_en || s.description_en || '',
    description_zh: descZh,
    shot_scene: s.shot_scene || s.used_scene_name || '',
    dialogue: s.dialogue || '',
    narration: s.narration || '',
    inner_monologue: s.inner_monologue || '',
    shot_type: st,
    camera_movement: cm,
    camera_angle: s.camera_angle || '',
    lighting_mood: lm,
    character_actions: charActionsStr,
    video_prompt: vPrompt,
    video_prompt_zh: s.video_prompt_zh || descZh,
    focal_length: s.focal_length || '',
    focus_point: s.focus_point || '',
    sound_hint: s.sound_hint || '',
    narrative_function: s.narrative_function || '',
    seedance_params: s.seedance_params || '{}',
    _rawAi: s._rawAi || s,
    audio_track_id: (s.audio_track_id || '').trim(),
  }
}

// ===== 对白/旁白检查 =====

/** 对白/旁白互斥：章节内任一镜有对白→全章清旁白，镜9强制留白 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSeedanceShots(rawShots: Record<string, any>[]): NormalizedShot[] {
  // P0.9.8.2: 预扫描 — (track_id, text) → source_dialogue_id
  // 同 track 同文本 = AI 拆分（保留原 source）；同 track 不同文本 = AI 错误复用（新 source）
  const sourceIdMap = new Map<string, string>()  // key: "track_id::text前20字" → source_dialogue_id
  const trackFirstSeen = new Set<string>()
  let dupCounter = 0
  for (const s of rawShots) {
    const tid = (s.audio_track_id || '').trim()
    const txt = (s.dialogue || '').trim()
    if (!tid || !txt) continue
    const key = `${tid}::${txt.slice(0, 20)}`
    if (!sourceIdMap.has(key)) {
      if (!trackFirstSeen.has(tid)) {
        sourceIdMap.set(key, tid)              // 首次出现 — 原 track 即 source
        trackFirstSeen.add(tid)
      } else {
        sourceIdMap.set(key, `${tid}_r${++dupCounter}`)  // 同 track 不同文本 — 新 source
      }
    }
  }

  const shots = rawShots.map((s: any, i: number) => {
    const sc = s.seedance_config || {}

    // shot_purpose fallback: AI值 → 关键词推断 → 镜号默认
    let shotPurpose: string = s.shot_purpose || ''
    let purposeSource: 'ai' | 'fallback_keyword' | 'fallback_index' = 'ai'
    if (!shotPurpose) {
      const vd = (s.video_description || s.shot_description || '').toLowerCase()
      const dialogue = (s.dialogue || '').trim()
      const isLastShot = (s.shot_id ?? i + 1) === rawShots.length
      const isFirstShot = (s.shot_id ?? i + 1) === 1

      if (isLastShot) {
        shotPurpose = 'transition'; purposeSource = 'fallback_index'
      } else if (isFirstShot) {
        shotPurpose = 'transition'; purposeSource = 'fallback_index'
      } else if (dialogue && /皱眉|沉默|凝视|抿嘴|握拳|颤/.test(vd + dialogue)) {
        shotPurpose = 'emotion'; purposeSource = 'fallback_keyword'
      } else if (dialogue) {
        shotPurpose = 'information'; purposeSource = 'fallback_keyword'
      } else if (/挥|打|冲|跑|跳|推|拉|摔|踢/.test(vd)) {
        shotPurpose = 'action'; purposeSource = 'fallback_keyword'
      } else if (/空镜|留白|定场|环境|过渡/.test(vd)) {
        shotPurpose = 'transition'; purposeSource = 'fallback_keyword'
      } else {
        shotPurpose = 'information'; purposeSource = 'fallback_index'
      }
    }

    return {
      shot_index: s.shot_id ?? i + 1,
      shot_purpose: shotPurpose as import('./types').ShotPurpose || 'information',
      duration_seconds: s.duration ? Math.min(Number(s.duration), 3.0) : 0,  // AI 未给则留 0，由 assignShotDurations 按景别 fallback
      description: ensureShotDescription(s.shot_description || '', s.shot_type || '', s.scene_name || ''),
      description_zh: truncateDesc(s.shot_description || ''),
      description_en: `${s.shot_type || 'Medium shot'} of ${(s.character_list || []).join(', ') || 'scene'} in ${s.scene_name || 'location'}`,
      shot_scene: s.scene_name || '',
      dialogue: s.dialogue || '',
      narration: s.narration || '',
      shot_type: s.shot_type || '',
      camera_movement: (() => {
        // 标准化映射：LLM 常见同义变体 → 标准枚举值
        const CM_NORMALIZE: Record<string, string> = {
          '缓慢后退': '缓慢拉远', '往后拉': '缓慢拉远', '拉后': '缓慢拉远',
          '向前推进': '缓慢推进', '往前推': '缓慢推进', '缓慢前推': '缓慢推进', '缓慢右推': '缓慢推进', '推近': '缓慢推进',
          '向左摇': '左摇', '向右摇': '右摇', '缓慢左移': '左摇', '右移': '平移', '左移': '平移',
          '缓慢上移': '升降', '缓慢下移': '升降',
        }
        const rawCm0 = (s.camera_movement || '').trim()
        const rawCm = CM_NORMALIZE[rawCm0] || rawCm0
        if (rawCm) {
          if (/缓慢推|推近|推镜/.test(rawCm)) return '缓慢推进'
          if (/缓慢拉|拉远|拉出/.test(rawCm)) return '缓慢拉远'
          if (/左/.test(rawCm) && /摇/.test(rawCm)) return '左摇'
          if (/右/.test(rawCm) && /摇/.test(rawCm)) return '右摇'
          if (/摇/.test(rawCm)) return '摇镜'
          if (/跟/.test(rawCm)) return '跟随'
          if (/平移|移镜/.test(rawCm)) return '平移'
          if (/升|降|上抬|下移/.test(rawCm)) return '升降'
          if (/固定|静止/.test(rawCm)) return '固定'
          if (/环绕/.test(rawCm)) return '环绕'
          if (/手持/.test(rawCm)) return '手持抖动'
          if (/快速/.test(rawCm) && /跟/.test(rawCm)) return '快速跟拍'
          if (/甩/.test(rawCm)) return '甩镜'
          return rawCm  // 未知值保留原样，由合规校验告警
        }
        // fallback：从 video_description 正则推断
        const vd = s.video_description || s.shot_description || ''
        if (/推(?:进|镜|近|移|向|至)|推$/.test(vd)) return '缓慢推进'
        if (/拉(?:远|开|镜|出|至)|拉$/.test(vd)) return '缓慢拉远'
        if (/摇(?:镜|移|向|过|至)|摇$/.test(vd)) return s.shot_type?.includes('左') ? '左摇' : s.shot_type?.includes('右') ? '右摇' : '摇镜'
        if (/跟(?:镜|随|拍|踪|移|至)|跟$/.test(vd)) return '跟随'
        if (/移(?:镜|动|至|向)|平移/.test(vd)) return '平移'
        if (/升(?:镜|降|至|起)|降(?:至|下|落)|上抬|下移/.test(vd)) return '升降'
        return ''
      })(),
      camera_angle: (() => {
        const vd = s.video_description || s.shot_description || ''
        if (/仰拍|仰视|仰望|低角度|从下往上/.test(vd)) return '仰拍'
        if (/俯拍|俯视|俯瞰|高角度|从上往下/.test(vd)) return '俯拍'
        if (/侧拍|侧面|侧视/.test(vd)) return '侧拍'
        if (/平视|平拍|正视/.test(vd)) return '平视'
        return '平视'
      })(),
      lighting_mood: (() => {
        const vd = s.video_description || s.shot_description || ''
        const parts: string[] = []
        if (/暖黄|暖光|暖调|金色/.test(vd)) parts.push('暖调')
        else if (/冷蓝|冷光|冷调|蓝色/.test(vd)) parts.push('冷调')
        else parts.push('中性调')
        if (/侧光/.test(vd)) parts.push('侧光')
        else if (/逆光/.test(vd)) parts.push('逆光')
        else if (/顶光/.test(vd)) parts.push('顶光')
        else if (/柔光|漫射|散射/.test(vd)) parts.push('柔光')
        else if (/暗光|低光|昏暗/.test(vd)) parts.push('暗光')
        else parts.push('自然光')
        return parts.join('+')
      })(),
      character_actions: JSON.stringify(
        (s.character_list || []).map((name: string) => {
          const desc = s.shot_description || s.video_description || ''
          const idx = desc.indexOf(name)
          let action = ''
          if (idx >= 0) {
            const after = desc.slice(idx + name.length)
            const end = after.search(/[，。；、！？]/)
            action = end > 0 ? after.slice(0, end).trim() : after.slice(0, 30).trim()
          }
          return { character_name: name, action }
        })
      ),
      video_prompt: '',
      video_prompt_zh: '',
      focal_length: (() => {
        const st = s.shot_type || ''
        if (/大远景|远景/.test(st)) return '24mm'
        if (/全景/.test(st)) return '35mm'
        if (/中景/.test(st)) return '50mm'
        if (/近景/.test(st)) return '85mm'
        if (/特写|大特写/.test(st)) return '100mm'
        return '50mm'
      })(),
      focus_point: (() => {
        const st = s.shot_type || ''
        if (/大远景|远景|全景/.test(st)) return '全景深'
        if (/中景/.test(st)) return '人物全身+环境'
        if (/近景/.test(st)) return '人物上半身'
        if (/特写|大特写/.test(st)) return '面部/手部细节'
        return '主体区域'
      })(),
      sound_hint: s.shot_type?.includes('空镜') ? '低频环境共鸣 + 水银流动声' : (s.dialogue ? '对白' : '') + (s.narration ? '旁白' : '') || '环境音',
      inner_monologue: s.inner_monologue || '',
      narrative_function: (() => {
        const si = s.shot_id ?? i + 1
        if (si === 1) return '建置时空'
        if (si <= 3) return '人物状态'
        if (si <= 5) return '情绪放大'
        if (si <= 7) return '冲突触发'
        return '情绪落幅'
      })(),
      seedance_params: JSON.stringify({
        fps: sc.fps || 24,
        transition: sc.transition || '',
        style: sc.style || '',
        camera_fixed: i === rawShots.length - 1,  // 镜9锁定机位
        return_last_frame: i === rawShots.length - 1,  // 镜9返回末帧供下一章续接
      }),
      _rawAi: s,  // 保留原始 AI 数据，供 overflow 后重建 video_prompt
      audio_track_id: (s.audio_track_id || '').trim(),  // 跨镜共享音轨标识
      source_dialogue_id: sourceIdMap.get(`${(s.audio_track_id || '').trim()}::${(s.dialogue || '').trim().slice(0, 20)}`) || (s.audio_track_id || '').trim(),
      segment_index: 0,
      dialogue_mode: (s.dialogue || '').trim() ? 'lip_sync' as const : 'none' as const,
      _purposeSource: purposeSource,
    }
  })
  // 质量校验：原始 video_description 用于 Seedance 生成，必须≥100字
  for (const s of rawShots) {
    const vd = (s.video_description || '').trim()
    if (vd.length < 40) {
      logger.warn(`[seedance] WARN shot #${s.shot_id || '?'}: video_description ${vd.length}字 < 40字，生成细节可能不足`)
    }
    if ((s.shot_description || '').length < 15) {
      logger.warn(`[seedance] WARN shot #${s.shot_id || '?'}: 原始 shot_description 仅${(s.shot_description||'').length}字，AI输出过短`)
    }
    // Seedance API 建议中文 prompt < 2000 字，过长可能降低生成质量
    if (vd.length > 2000) {
      logger.warn(`[seedance] WARN shot #${s.shot_id || '?'}: video_description ${vd.length}字 > 2000字上限（API建议），建议精简`)
    }
  }
  return shots
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeSeedanceData(raw: any): NormalizedSeedanceData {
  if (!raw || typeof raw !== 'object') {
    logger.error('[seedance] AI 输出完全无效：非 JSON 对象。请重试或换模型。')
    throw new Error('AI 输出完全无效：非 JSON 对象。请重试解析或换用更稳定的语言模型。')
  }

  // 多章节数组格式（新）
  if (Array.isArray(raw)) {
    const allChapters: import('../ai').ShotDataChapter[] = []
    const allCharacters: { name: string; description: string }[] = []
    const allScenes: { name: string; description: string }[] = []
    const allProps: { name: string; description: string }[] = []
    let globalTimePeriod = ''

    for (const chapterRaw of raw) {
      const ci = chapterRaw.chapter_info || {}
      if (ci.time_period && !globalTimePeriod) globalTimePeriod = ci.time_period
      for (const c of (ci.characters || [])) {
        const cn = (c.name || '').trim()
        if (isSuspiciousName(cn)) { logger.warn(`[seedance-char] FILTERED: "${cn}"`); continue }
        if (!allCharacters.find(x => x.name === cn)) allCharacters.push({ name: cn, description: c.appearance || '' })
      }
      logger.info(`[seedance-char] Chapter ${ci.chapter_id || '?'}: ${(ci.characters||[]).length} AI chars → kept: ${[...new Set((ci.characters||[]).filter((c:any)=>!isSuspiciousName(c.name||'')).map((c:any)=>c.name||''))]}`)
      for (const s of (ci.scenes || [])) {
        if (!allScenes.find(x => x.name === s.name)) allScenes.push({ name: s.name || '', description: s.environment || '' })
      }
      for (const p of (ci.props || [])) {
        const pn = typeof p === 'string' ? p : p.name
        if (pn && !allProps.find(x => x.name === pn)) allProps.push({ name: pn, description: typeof p === 'object' ? p.description || '' : '' })
      }
      const shots = normalizeSeedanceShots(chapterRaw.shots || [])
      const rawTitle = ci.chapter_summary || ''
      const shortTitle = rawTitle.length > 8 ? rawTitle.slice(0, 8) + '…' : rawTitle
      allChapters.push({ title: shortTitle || `第${allChapters.length + 1}章`, shots })
    }

    return {
      chapters: allChapters as NormalizedChapter[],
      characters: allCharacters,
      scenes: allScenes,
      props: allProps,
      timePeriod: globalTimePeriod,
    }
  }

  // 不是数组 → AI 未按格式输出，报错
  logger.error('[seedance] AI 输出格式错误：期望 JSON 数组，实际为单对象。请重试或换模型。')
  throw new Error('AI 输出格式错误：期望 JSON 数组，实际为单对象。请重试解析或换用更稳定的语言模型。')
}

// ===== 九宫格合规校验 =====

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeShotData(raw: any): { chapters: NormalizedChapter[] } {
  if (!raw || typeof raw !== 'object') {
    logger.error('[parse] AI 输出完全无效：非 JSON 对象。请重试或换模型。')
    throw new Error('AI 输出完全无效：非 JSON 对象。请重试解析或换用更稳定的语言模型。')
  }

  // AI 直接返回数组 [{shot_description: ..., ...}] → 包装为章节
  if (Array.isArray(raw) && raw.length > 0 && !raw[0]?.shots) {
    const shots = raw.map(normalizeShot).map((s: any) => {
      if ((s.description_zh || '').length < 50) logger.warn(`[parse] WARN shot #${s.shot_index}: description_zh ${(s.description_zh||'').length}字 < 50字`)
      if ((s.description_en || '').split(/\s+/).length < 18) logger.warn(`[parse] WARN shot #${s.shot_index}: description_en ${(s.description_en||'').split(/\s+/).length}词 < 18词`)
      return s
    })
    return { chapters: [{ title: '第1章', shots }] }
  }

  // 数组元素自带 shots 属性 → 每个元素作为一个章节（模板 v0-01 标准输出格式）
  if (Array.isArray(raw) && raw.length > 0 && raw[0]?.shots) {
    return {
      chapters: raw.map((ch: any) => ({
        title: ch.chapter_title || ch.title || '',
        shots: (ch.shots || []).map(normalizeShot).map((s: any) => {
          if ((s.description_zh || '').length < 50) logger.warn(`[parse] WARN shot #${s.shot_index}: description_zh ${(s.description_zh||'').length}字 < 50字`)
          if ((s.description_en || '').split(/\s+/).length < 18) logger.warn(`[parse] WARN shot #${s.shot_index}: description_en ${(s.description_en||'').split(/\s+/).length}词 < 18词`)
          return s
        }),
      }))
    }
  }

  // Already has chapters array
  if (Array.isArray(raw.chapters)) {
    return { chapters: raw.chapters.map((ch: any) => ({
      title: ch.title || ch.scene_name || '',
      shots: (ch.shots || []).map(normalizeShot),
    })) }
  }

  // Has scenes array → convert to chapters
  if (Array.isArray(raw.scenes)) {
    const hasShots = raw.scenes.some((sc: any) => sc.shots && sc.shots.length > 0)
    if (hasShots) {
      return { chapters: raw.scenes.map((sc: any) => ({
        title: sc.scene_name || sc.title || sc.name || '',
        shots: (sc.shots || []).map(normalizeShot),
      })) }
    }
    return { chapters: [{
      title: '第1章',
      shots: raw.scenes.map(normalizeShot),
    }] }
  }

  // 单个章节对象（LLM 输出了对象而非数组）→ 包装为单章
  if (raw.shots && Array.isArray(raw.shots)) {
    return {
      chapters: [{
        title: raw.chapter_title || raw.title || '',
        shots: raw.shots.map(normalizeShot).map((s: any) => {
          if ((s.description_zh || '').length < 50) logger.warn(`[parse] WARN shot #${s.shot_index}: description_zh ${(s.description_zh||'').length}字 < 50字`)
          if ((s.description_en || '').split(/\s+/).length < 18) logger.warn(`[parse] WARN shot #${s.shot_index}: description_en ${(s.description_en||'').split(/\s+/).length}词 < 18词`)
          return s
        }),
      }]
    }
  }

  logger.error('[parse] AI 输出格式无法识别。请重试或换模型。')
  throw new Error('AI 输出格式无法识别。请重试解析或换用更稳定的语言模型。')
}

// ===== Seedance 2.0 九宫格数据规范化 =====
