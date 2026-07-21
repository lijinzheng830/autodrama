/**
 * 宫格故事板生成服务
 * 负责九宫格分镜预览图的 prompt 构建、API 调用、叠印标注
 */

import { logger } from '../utils/logger'
import { getDb } from './db'
import { getProject } from './project'
import { loadPromptTemplate } from './ai'
import { resolveModelConfig } from './modelRouter'
import { getAPISize, applyTemplate, parseDescField } from './styleMapper'
import { sanitizePromptContent, saveGeneratedImages, callImageGenerationAPI } from './imageGenerator'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { withRetry } from '../utils/constants'

// sharp 是原生模块，打包后可能加载失败。懒加载避免阻塞启动。
let _sharp: any = null
async function getSharp(): Promise<any> {
  if (_sharp) return _sharp
  try {
    _sharp = await import('sharp')
    return _sharp
  } catch (e: any) {
    throw new Error(`图像处理模块加载失败，请重新安装应用。${e.message || ''}`)
  }
}

// ===== 宫格故事板生成 =====

export interface GenerateGridStoryboardInput {
  projectId: string
  shotIds?: string[]
  model?: string
  channel?: string
  resolution?: string  // '16:9' | '16:9_2k' | '16:9_4k'
}

/** 从 shot 数据构建每格标注（动态，不再是静态模板） */
// 角色名 → SVG fill 颜色映射（hash 取模，同角色同色）
const CHAR_COLOR_PALETTE = ['#FF6B6B','#4ECDC4','#FFE66D','#95E1D3','#F38181','#A8D8EA','#FFD3B6','#D5ECC2']
const charColorMap = new Map<string, string>()
function getCharColor(name: string): string {
  if (charColorMap.has(name)) return charColorMap.get(name)!
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i)
  const c = CHAR_COLOR_PALETTE[Math.abs(hash) % CHAR_COLOR_PALETTE.length]
  charColorMap.set(name, c)
  return c
}

function buildCellFromShot(shot: any, cellNum: number, chars: any[]): {
  row: number; col: number; label: string; shotType: string; duration: string
  focal: string; camera: string; movement: string; sound: string; narrative: string
  characters: string; charColors: string[]
} {
  const idx = (cellNum - 1) // 0-based
  const row = Math.floor(idx / 3)
  const col = idx % 3
  const st = shot.shot_type || '中景'
  const cm = shot.camera_movement || '固定'
  // 提取景别缩写
  const stAbbr = st.includes('大远景') ? 'EWS' : st.includes('远景') ? 'WS' : st.includes('全景') ? 'WS'
    : st.includes('中景') ? 'MS' : st.includes('近景') ? 'CU' : st.includes('特写') || st.includes('大特写') ? 'ECU'
    : st.includes('过肩') ? 'OTS' : st.length > 3 ? st.slice(0,3) : st
  return {
    row, col,
    label: `${cellNum}  ${stAbbr}`,
    shotType: stAbbr,
    duration: shot.duration_seconds ? `${Number(shot.duration_seconds).toFixed(1)}s` : '1-2s',
    focal: shot.focal_length || '50mm',
    camera: shot.camera_angle || (cm.includes('低角度') || cm.includes('仰') ? '低角度' : cm.includes('俯') || cm.includes('高角度') ? '高角度' : '平视'),
    movement: (shot.camera_movement || '固定') + (cm.includes('推') ? ' dolly' : cm.includes('拉') ? ' pull' : cm.includes('摇') ? ' pan' : cm.includes('跟') ? ' track' : ' static'),
    sound: shot.sound_hint || '环境音',
    narrative: shot.narrative_function || '',
    characters: chars.map(c => c.name).join(', '),
    charColors: chars.map(c => getCharColor(c.name)),
  }
}

/** 在九宫格图片上叠印每格标注文字（从实际分镜数据驱动） */
async function overlayGridLabels(imagePath: string, outputPath: string, cells: ReturnType<typeof buildCellFromShot>[]): Promise<void> {
  const s = await getSharp()
  const meta = await s.default(imagePath).metadata()
  const w = meta.width || 1920
  const h = meta.height || 1088
  const cw = w / 3
  const ch = h / 3

  const svgTexts = cells.map(cell => {
    const x = cell.col * cw
    const y = cell.row * ch
    const barH = 66
    const barY = y + ch - barH
    const pad = cw * 0.03
    const line1Y = barY + 14
    const line2Y = barY + 30
    const line3Y = barY + 46
    const line4Y = barY + 60
    // 角色名：每个名字独立 tspan 带颜色
    let charTspans = ''
    if (cell.characters) {
      const names = cell.characters.split(', ')
      const colors = cell.charColors
      charTspans = names.map((n, i) => `<tspan fill="${colors[i] || '#fff'}">${n}</tspan>`).join('<tspan fill="#888">, </tspan>')
    }
    return [
      `<rect x="${x}" y="${barY}" width="${cw}" height="${barH}" fill="rgba(0,0,0,0.6)" />`,
      `<line x1="${x}" y1="${barY}" x2="${x + cw}" y2="${barY}" stroke="rgba(255,255,255,0.2)" stroke-width="1" />`,
      `<text x="${x + pad}" y="${line1Y}" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#ffffff">${cell.label}  |  ${cell.duration}  |  ${cell.focal}  |  ${cell.camera}</text>`,
      `<text x="${x + pad}" y="${line2Y}" font-family="Arial, sans-serif" font-size="10" fill="#bbbbbb">${cell.movement}  |  [Sound] ${cell.sound}</text>`,
      `<text x="${x + pad}" y="${line3Y}" font-family="Arial, sans-serif" font-size="10" fill="#66ccff">[Scene] ${cell.narrative}</text>`,
      `<text x="${x + pad}" y="${line4Y}" font-family="Arial, sans-serif" font-size="9">${charTspans ? `<tspan fill="#aaa">[Ch] </tspan>${charTspans}` : ''}</text>`,
    ].join('\n')
  }).join('\n')

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${svgTexts}</svg>`

  const s2 = await getSharp()
  await s2.default(imagePath)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toFile(outputPath)
}

/** 智能截断：在 maxLen 内的最后一个单词/标点边界截断，加 … */
function smartTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const slice = text.slice(0, maxLen)
  const lastBreak = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('.'), slice.lastIndexOf(','), slice.lastIndexOf('，'), slice.lastIndexOf('。'))
  if (lastBreak > maxLen * 0.6) return slice.slice(0, lastBreak) + '…'
  return slice + '…'
}

function buildShotsBody(gridShots: any[], cells: any[]): string {
  return gridShots.map((shot, i) => {
    const c = cells[i]
    const desc = smartTruncate(shot.description_en || shot.description || '', 65)
    const lighting = (shot.lighting_mood || '').slice(0, 20)
    const focus = shot.focus_point || (['WS','EWS'].includes(c.shotType) ? 'deep focus' : 'upper body')
    const sound = shot.sound_hint || ''
    const narrative = shot.narrative_function || ''
    return `${i + 1}｜${c.duration}｜${c.shotType}｜${c.camera}｜${c.movement}｜${c.focal}｜${lighting}｜${focus}｜${desc}｜${sound}｜${narrative}`
  }).join('\n')
}

export async function generateGridStoryboard(input: GenerateGridStoryboardInput): Promise<{ generated: number; errors: string[] }> {
  const db = getDb()
  const { projectId, shotIds, model: inputModel, channel: inputChannel, resolution: inputResolution } = input

  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  // 按章节分组取分镜（每章=一张故事板，每镜一格）
  logger.info(`[GridStoryboard] Input shotIds (${shotIds?.length || 0}): ${(shotIds?.slice(0, 3) || []).join(',')}${shotIds?.length ? '...' : ''}`)
  let chapterGroups: { chapterId: string; chapterTitle: string; shots: any[] }[]
  if (shotIds?.length) {
    // 指定分镜：按章节分组
    const map = new Map<string, any[]>()
    for (const sid of shotIds) {
      const row = db.prepare('SELECT s.*, c.id as cid, c.title as ctitle FROM shots s JOIN chapters c ON s.chapter_id = c.id WHERE s.id = ? AND c.project_id = ?').get(sid, projectId) as any
      if (row) {
        if (!map.has(row.cid)) map.set(row.cid, [])
        map.get(row.cid)!.push(row)
      }
    }
    chapterGroups = Array.from(map.entries()).map(([cid, shots]) => ({ chapterId: cid, chapterTitle: shots[0]?.ctitle || '', shots: shots.sort((a, b) => a.shot_index - b.shot_index) }))
  } else {
    // 不指定：取全部章节
    const chapters = db.prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_index').all(projectId) as any[]
    chapterGroups = chapters.map(ch => ({
      chapterId: ch.id,
      chapterTitle: ch.title || '',
      shots: db.prepare('SELECT s.* FROM shots s WHERE s.chapter_id = ? ORDER BY s.shot_index').all(ch.id) as any[]
    })).filter(g => g.shots.length > 0)
  }
  if (!chapterGroups.length) throw new Error('没有可生成的分镜')
  logger.info(`[GridStoryboard] Will generate ${chapterGroups.length} chapter(s):`, chapterGroups.map(g => g.chapterTitle).join(', '))
  const aspectRatio = inputResolution || project.aspect_ratio || '16:9'
  const size = getAPISize(aspectRatio)

  // 模型配置
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  const { model, channel, apiKey } = resolveModelConfig('grid_storyboard', projectConfig, inputModel, inputChannel)
  if (!apiKey) throw new Error('未配置 API Key')
  if (!model) throw new Error('未配置生图模型')

  const errors: string[] = []
  let totalGenerated = 0

  // 加载七段式故事板模板
  const tplContent = loadPromptTemplate('grid_storyboard', '{}')
  let tpl: Record<string, string> = {}
  if (tplContent) {
    try { tpl = JSON.parse(tplContent) } catch { /* keep empty, will use fallback */ }
  }

  // 每章生成一张故事板
  for (const chapter of chapterGroups) {
    const gridShots = chapter.shots.slice(0, 9)
    if (gridShots.length < 3) continue
    // 收集角色/场景数据（先于 cells，供角色颜色标注使用）
    const allCharScenes: Array<{ chars: any[]; scenes: any[] }> = []
    for (let i = 0; i < gridShots.length; i++) {
      const shot = gridShots[i]
      const shotChars = db.prepare('SELECT c.id, c.name, c.description, c.description_zh, c.reference_image FROM characters c JOIN shot_characters sc ON c.id = sc.character_id WHERE sc.shot_id = ?').all(shot.id) as any[]
      const shotScenes = db.prepare('SELECT s.id, s.name, s.description, s.description_zh, s.reference_image, s.environment_effects, s.reference_objects, s.time_weather FROM scenes s JOIN shot_scenes ss ON s.id = ss.scene_id WHERE ss.shot_id = ?').all(shot.id) as any[]
      allCharScenes.push({ chars: shotChars, scenes: shotScenes })
    }
    const cells = gridShots.map((s, i) => buildCellFromShot(s, i + 1, allCharScenes[i]?.chars || []))

    // 提取每个角色的参考图 source_url（不只第一个）
    let sceneRefUrl = ''
    let sceneDescText = ''
    const charRefMap = new Map<string, { name: string; sourceUrl: string; description: string }>()
    for (const { chars, scenes } of allCharScenes) {
      for (const ch of chars) {
        if (charRefMap.has(ch.id)) continue
        const cr = db.prepare("SELECT source_url FROM character_images WHERE character_id = ? AND source_url IS NOT NULL AND source_url != '' ORDER BY is_selected DESC, created_at DESC LIMIT 1").get(ch.id) as { source_url?: string } | undefined
        charRefMap.set(ch.id, { name: ch.name, sourceUrl: cr?.source_url || '', description: ch.description || '' })
      }
      if (!sceneRefUrl && scenes.length > 0) {
        const sr = db.prepare("SELECT source_url FROM scene_images WHERE scene_id = ? AND source_url IS NOT NULL AND source_url != '' ORDER BY is_selected DESC, created_at DESC LIMIT 1").get(scenes[0].id) as { source_url?: string } | undefined
        if (sr?.source_url) sceneRefUrl = sr.source_url
        if (!sceneDescText && scenes[0].description) sceneDescText = scenes[0].description
      }
    }

    // 构建多角色参考文本 + 字段级拆分
    let charRefsText = ''
    let charFacesText = ''
    let charHairsText = ''
    let charOutfitsText = ''
    let charBodiesText = ''
    let charMarksText = ''
    let charPropsText = ''
    let charRolesText = ''
    let charAgesText = ''
    if (charRefMap.size > 0) {
      const parts: string[] = []
      const roles: string[] = []
      const ages: string[] = []
      const faces: string[] = []
      const hairs: string[] = []
      const outfits: string[] = []
      const bodies: string[] = []
      const marks: string[] = []
      const props: string[] = []
      let idx = 0
      for (const [, info] of charRefMap) {
        const label = String.fromCharCode(65 + idx)
        const role = parseDescField(info.description, 'Role')
        const age = parseDescField(info.description, 'Age')
        const face = parseDescField(info.description, 'Facial features')
        const hair = parseDescField(info.description, 'Hair')
        let outfit = parseDescField(info.description, 'Outfit')
        const zhIdx = info.description.indexOf('正向提示词')
        const enIdx = info.description.indexOf('Positive prompt')
        const detailIdx = zhIdx > 0 ? zhIdx : enIdx > 0 ? enIdx : -1
        if (detailIdx > 0) {
          const detail = info.description.slice(detailIdx)
          const m = detail.match(/(?:Full-body|全身)(.+?)(?:Background|背景)/s)
          if (m && m[0]) outfit = (outfit ? outfit + ' | ' : '') + m[0].trim().replace(/\s+/g, ' ')
        }
        const keyProp = parseDescField(info.description, 'Key prop')
        const build = parseDescField(info.description, 'Build')
        const distinctiveMarks = parseDescField(info.description, 'Distinctive marks')

        if (role) roles.push(`[${label}] ${info.name}: ${role}`)
        if (age) ages.push(`[${label}] ${info.name}: ${age}`)
        if (face) faces.push(`[${label}] ${info.name}: ${face}`)
        if (hair) hairs.push(`[${label}] ${info.name}: ${hair}`)
        if (outfit) outfits.push(`[${label}] ${info.name}: ${outfit}`)
        if (build) bodies.push(`[${label}] ${info.name}: ${build}`)
        if (distinctiveMarks && distinctiveMarks !== 'none') marks.push(`[${label}] ${info.name}: ${distinctiveMarks}`)
        if (keyProp) props.push(`[${label}] ${info.name}: ${keyProp}`)

        if (info.sourceUrl) {
          parts.push(`[Reference Image #${idx + 1}] [${label}] ${info.name}: This reference image defines the EXACT appearance — facial features, face shape, hairstyle, outfit, and body type. Keep 100% consistent across all frames.`)
        } else {
          parts.push(`[${label}] ${info.name}: NO reference image available — use the following description strictly: ${info.description.slice(0, 120)}`)
        }
        idx++
      }
      charRefsText = parts.join(' ')
      charRolesText = roles.join('; ')
      charAgesText = ages.join('; ')
      charFacesText = faces.join('; ')
      charHairsText = hairs.join('; ')
      charOutfitsText = outfits.join('; ')
      charBodiesText = bodies.join('; ')
      charMarksText = marks.join('; ')
      charPropsText = props.join('; ')
    }

    // 角色名 → 字母标签 [A][B][C]...
    const charLabels: Record<string, string> = {}
    const labelChar = (name: string) => {
      if (!charLabels[name]) { charLabels[name] = `[${String.fromCharCode(65 + Object.keys(charLabels).length)}]` }
      return `${charLabels[name]} ${name}`
    }

    // 检测多人场景并精确计算每格角色分配
    const allCharIds = [...new Set(allCharScenes.flatMap(cs => cs.chars.map(c => c.id)))]
    let multiCharText = ''

    logger.info(`[GridStoryboard] === Chapter "${chapter.chapterTitle}" — Extracted Assets ===`)
    logger.info(`[GridStoryboard] Shots count: ${gridShots.length}`)
    for (let i = 0; i < gridShots.length; i++) {
      const shot = gridShots[i]
      const { chars, scenes } = allCharScenes[i]
      const charDetail = chars.length > 0
        ? chars.map((c: any) => `${labelChar(c.name)}(desc:${c.description ? c.description.slice(0,40)+'...' : 'N/A'}, ref_img:${c.reference_image ? 'YES' : 'N/A'}, id:${c.id.slice(0,8)})`).join(' | ')
        : '(no characters)'
      const sceneDetail = scenes.length > 0
        ? scenes.map((s: any) => `${s.name}(desc:${s.description ? s.description.slice(0,40)+'...' : 'N/A'}, ref_img:${s.reference_image ? 'YES' : 'N/A'}, fx:${s.environment_effects||'N/A'}, obj:${s.reference_objects||'N/A'}, weather:${s.time_weather||'N/A'})`).join(' | ')
        : '(no scenes)'
      logger.info(`[GridStoryboard]   Shot #${shot.shot_index}: chars=[${charDetail}] scenes=[${sceneDetail}]`)
    }
    logger.info(`[GridStoryboard] Character refs (${charRefMap.size}): ${[...charRefMap.entries()].map(([, info]) => `${charLabels[info.name] || ''} ${info.name} url=${info.sourceUrl ? 'YES' : 'N/A'} desc=${info.description.slice(0,40)}`).join(' | ') || 'N/A'}`)
    logger.info(`[GridStoryboard] Scene ref: url=${sceneRefUrl ? 'YES' : 'N/A'} desc=${sceneDescText.slice(0,60) || 'N/A'}`)
    logger.info(`[GridStoryboard] Unique character IDs: ${allCharIds.length} [${[...allCharIds].map((cid: string) => { const n = (allCharScenes.flatMap(cs => cs.chars).find(c => c.id === cid)?.name || cid.slice(0,8)); return charLabels[n] ? `${charLabels[n]} ${n}` : cid.slice(0,8); }).join(', ')}]`)
    if (allCharIds.length > 1) logger.info(`[GridStoryboard] Multi-char: ${multiCharText}`)
    if (allCharIds.length > 1) {
      const charFrames = new Map<string, number[]>()
      const charNames = new Map<string, string>()
      for (const cid of allCharIds) { charFrames.set(cid, []) }
      for (let i = 0; i < gridShots.length; i++) {
        const shotChars = allCharScenes[i]?.chars || []
        for (const ch of shotChars) {
          charFrames.get(ch.id)?.push(i + 1)
          if (!charNames.has(ch.id)) charNames.set(ch.id, ch.name || 'Unknown')
        }
      }
      const frameAssignments = allCharIds.map(cid => {
        const frames = charFrames.get(cid) || []
        const name = charNames.get(cid) || 'Unknown'
        return frames.length > 0 ? `Frames ${frames.join(',')} use ${name}` : `${name} not in any frame`
      }).join('; ')
      multiCharText = `CRITICAL: ${allCharIds.length} characters present. ${frameAssignments}. Each character MUST look identical in every frame they appear. No character mixing, no face swapping, no appearance drift. Never cross the 180-degree axis.`
    }

    // 构建表格格式分镜正文
    const shotsBodyPrefix = '[CHARACTER APPEARANCE LOCKED — Each character wears the EXACT same outfit in every shot. Ignore per-shot clothing descriptions. Reference images (section 1) define the definitive appearance.]'
    const shotsBody = buildShotsBody(gridShots, cells)
    const shotsBodyText = shotsBodyPrefix + '\n' + shotsBody

    // 准备模板变量
    const mainScene = allCharScenes[0]?.scenes[0]
    const moodCounts = new Map<string, number>()
    gridShots.forEach((s: any) => { const m = (s.lighting_mood || '').trim(); if (m) moodCounts.set(m, (moodCounts.get(m) || 0) + 1) })
    const dominantMood = [...moodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    const moodChanges = [...new Set(gridShots.map((s: any) => (s.lighting_mood || '').trim()).filter(Boolean))]
    const moodVariation = moodChanges.length > 1 ? `Lighting evolves across frames: ${moodChanges.join(' → ')}.` : 'Lighting remains consistent across all frames.'
    const tplVars: Record<string, string> = {
      char_refs: charRefsText,
      scene_ref_url: sceneRefUrl,
      style_prompt: '',
      scene_location: (sceneDescText || mainScene?.name || '').replace(/^Location:\s*/i, '').replace(/^\s*地点[：:]\s*/, ''),
      scene_time_weather: (mainScene as any)?.time_weather || project.era || '',
      scene_atmosphere: dominantMood,
      scene_lighting: dominantMood,
      scene_effects: (mainScene as any)?.environment_effects || 'none',
      scene_reference_objects: (mainScene as any)?.reference_objects || 'none',
      tone_transition: (() => {
        const s = (project.style_name || '').toLowerCase()
        const baseRule = s.includes('anime') || s.includes('二次元') || s.includes('gongbi') || s.includes('工笔')
          ? 'Warm bright tone throughout all frames, consistent color temperature and saturation, no sudden shifts in lighting mood.'
          : 'Primary color palette locked, only brightness and warm/cool shift gradually: Frames 1-3 warm and bright, Frames 4-6 gradually cooling, Frames 7-8 high contrast dramatic, Frame 9 soft dim resolution. No abrupt color jumps.'
        return baseRule + ' ' + moodVariation
      })(),
      char_roles: charRolesText,
      char_ages: charAgesText,
      char_faces: charFacesText,
      char_hairs: charHairsText,
      char_outfits: charOutfitsText,
      char_bodies: charBodiesText,
      char_marks: charMarksText,
      char_props: charPropsText,
      multi_character_positioning: multiCharText,
      prop_name: 'none',
      prop_initial: 'none',
      shots_body: shotsBodyText,
    }

    // 组装七段式 prompt
    const promptSections: string[] = []

    // 参考图对照表
    const charRefCount = charRefMap.size > 0 ? [...charRefMap.values()].filter(info => info.sourceUrl).length : 0
    if (charRefCount > 0 || sceneRefUrl) {
      const guideParts: string[] = ['REFERENCE IMAGE GUIDE — images attached to this request are in this exact order:']
      let refIdx = 0
      for (const [, info] of charRefMap) {
        if (info.sourceUrl) {
          refIdx++
          const label = String.fromCharCode(64 + refIdx)
          guideParts.push(`  #${refIdx} = Character [${label}] ${info.name}`)
        }
      }
      if (sceneRefUrl) {
        refIdx++
        guideParts.push(`  #${refIdx} = Scene reference (environment, architecture, lighting, color palette)`)
      }
      promptSections.push(guideParts.join('\n'))
    }

    if (charRefsText && tpl.section_1_ref_character) {
      promptSections.push(applyTemplate(tpl.section_1_ref_character, tplVars))
    }
    if (sceneRefUrl && tpl.section_2_ref_scene) {
      promptSections.push(applyTemplate(tpl.section_2_ref_scene, tplVars))
    }
    for (const key of ['section_3_format_style', 'section_4_scene_lock', 'section_5_character_lock', 'section_7_consistency']) {
      if (tpl[key]) {
        promptSections.push(applyTemplate(tpl[key], tplVars))
      }
    }
    if (tpl.section_6_shots_body) {
      promptSections.push(applyTemplate(tpl.section_6_shots_body, tplVars))
    } else {
      promptSections.push(shotsBodyText)
    }

    const negative = tpl.negative_prompt || 'blurry, low quality, deformed, text, watermark, cartoon, anime, 3d render'
    const quality = tpl.quality || 'masterpiece, ultra-detailed, 8K, HDR, photorealistic, sharp focus, cinematic color grading.'
    const qualityBlock = [
      'STRICT QUALITY REQUIREMENTS:',
      `Must avoid: ${negative}`,
      `Must achieve: ${quality}`,
      'All characters must have anatomically correct, well-formed limbs with natural proportions. Hands must have exactly 5 fingers, normally shaped. No extra limbs, no missing limbs, no fused body parts, no distorted faces. Every body part must be clearly defined and correctly positioned.',
      'Output the image only. Do NOT output text or explanation.'
    ].join(' ')

    const rawPrompt = [...promptSections, '', qualityBlock].join('\n')
    const { text: prompt, count: sanitizedCount } = sanitizePromptContent(rawPrompt, project.era)
    if (sanitizedCount > 0) logger.info(`[GridStoryboard] Content sanitized: ${sanitizedCount} word replacements`)

    const dumpPromptPath = join(project.path, 'storyboard_prompt_debug.txt')
    try { const fs = await import('fs'); fs.writeFileSync(dumpPromptPath, prompt, 'utf8') } catch {}

    logger.info(`[GridStoryboard] Chapter "${chapter.chapterTitle}": ${gridShots.length} shots → ${Math.min(gridShots.length, 9)} cells, prompt ${prompt.length} chars`)
    logger.info(`[GridStoryboard] Ref URLs: chars=${charRefMap.size} scene=${sceneRefUrl ? 'YES' : 'N/A'}`)

    // 生成前质量校验
    const stTypes = gridShots.map((s: any) => s.shot_type || '')
    const wsCount = stTypes.filter((t: string) => t.includes('远景') || t.includes('全景')).length
    const msCount = stTypes.filter((t: string) => t.includes('中景')).length
    const cuCount = stTypes.filter((t: string) => t.includes('近景') || t.includes('特写')).length
    const noNarrative = gridShots.filter((s: any) => !s.narrative_function).length
    const noFocus = gridShots.filter((s: any) => !s.focus_point).length
    const noSound = gridShots.filter((s: any) => !s.sound_hint).length
    const checkLines: string[] = ['[GridStoryboard] === Pre-gen Quality Check ===']
    if (wsCount < 2) checkLines.push(`  [WARN] WS/EWS count = ${wsCount} (expected >= 2)`)
    if (msCount < 2) checkLines.push(`  [WARN] MS count = ${msCount} (expected >= 2)`)
    if (cuCount < 1) checkLines.push(`  [WARN] CU/ECU count = ${cuCount} (expected >= 1)`)
    if (noNarrative > 0) checkLines.push(`  [WARN] ${noNarrative}/${gridShots.length} shots missing narrative_function`)
    if (noFocus > 0) checkLines.push(`  [WARN] ${noFocus}/${gridShots.length} shots missing focus_point`)
    if (noSound > 0) checkLines.push(`  [INFO] ${noSound}/${gridShots.length} shots missing sound_hint`)
    const movements = gridShots.map((s: any) => s.camera_movement || '固定')
    const angles = gridShots.map((s: any) => s.camera_angle || '平视')
    const uniqueMovements = new Set(movements)
    const uniqueAngles = new Set(angles)
    const movementSubs = ['缓推', '缓拉', '左摇', '右摇', '跟随', '环绕']

    if (uniqueMovements.size < 3) {
      checkLines.push(`  [FIX] Movement variety: ${uniqueMovements.size} types (need >= 3) → auto-diversifying`)
      let fixedInARow = 0
      for (let i = 0; i < gridShots.length; i++) {
        const mv = gridShots[i].camera_movement || ''
        if (mv === '固定' || !mv) {
          fixedInARow++
          if (fixedInARow >= 3) {
            const sub = movementSubs[i % movementSubs.length]
            gridShots[i].camera_movement = sub
            if (cells[i]) cells[i].movement = sub
            fixedInARow = 0
          }
        } else { fixedInARow = 0 }
      }
    }

    if (uniqueAngles.size < 2) {
      checkLines.push(`  [FIX] Camera angle variety: ${uniqueAngles.size} types (need >= 2) → auto-diversifying`)
      const altAngles = ['仰拍', '俯拍', '侧拍']
      for (let i = 1; i < gridShots.length; i += 2) {
        gridShots[i].camera_angle = altAngles[(i / 2 | 0) % altAngles.length]
        if (cells[i]) cells[i].camera = gridShots[i].camera_angle
      }
    }

    if (checkLines.length === 1) checkLines.push('  [OK] All checks passed')
    checkLines.forEach(l => logger.warn(l))

    let taskId = ''
    try {
      taskId = randomUUID()
      const firstShotId = gridShots[0]?.id || ''
      db.prepare(`INSERT INTO generation_tasks (id,project_id,shot_id,type,purpose,channel,model,status,input_params,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,datetime('now','localtime'),datetime('now','localtime'))`)
        .run(taskId, projectId, firstShotId, 'image', 'grid_storyboard', channel || null, model || null, JSON.stringify({ chapterId: chapter.chapterId, shotIds: gridShots.map(s => s.id) }))

      // 收集参考图
      const refImages: string[] = []
      for (const { chars, scenes } of allCharScenes) {
        for (const ch of chars) {
          try {
            const row = db.prepare('SELECT source_url, image_path FROM character_images WHERE character_id = ? ORDER BY is_selected DESC, created_at DESC LIMIT 1').get(ch.id) as { source_url?: string; image_path?: string } | undefined
            if (row?.source_url && (row.source_url.startsWith('http://') || row.source_url.startsWith('https://'))) {
              if (!refImages.includes(row.source_url)) refImages.push(row.source_url)
            } else if (row?.image_path) {
              if (!refImages.includes(row.image_path)) refImages.push(row.image_path)
            }
          } catch {}
        }
        for (const sc of scenes) {
          try {
            const row = db.prepare('SELECT source_url, image_path FROM scene_images WHERE scene_id = ? ORDER BY is_selected DESC, created_at DESC LIMIT 1').get(sc.id) as { source_url?: string; image_path?: string } | undefined
            if (row?.source_url && (row.source_url.startsWith('http://') || row.source_url.startsWith('https://'))) {
              if (!refImages.includes(row.source_url)) refImages.push(row.source_url)
            } else if (row?.image_path) {
              if (!refImages.includes(row.image_path)) refImages.push(row.image_path)
            }
          } catch {}
        }
      }
      logger.info(`[GridStoryboard] Ref images collected: ${refImages.length} (HTTP: ${refImages.filter(r => r.startsWith('http')).length}, local: ${refImages.filter(r => !r.startsWith('http')).length})`)
      const finalRefs = refImages.slice(0, 7)

      const fixSnippet = 'CRITICAL: Strict equal 3x3 grid with clear thin white dividers. Clear white number 1-9 at bottom-left of each cell. Absolute character consistency — identical face, identical hairstyle, identical clothes in all 9 frames. No extra objects, no extra people. Strictly follow the fixed scene setting. No random elements.'
      const imageUrls = await withRetry(async (attempt) => {
        const p = attempt > 0 ? prompt + '\n' + fixSnippet : prompt
        if (attempt > 0) logger.info(`[GridStoryboard] Retry ${attempt} with fix snippet...`)
        return callImageGenerationAPI(p, model, apiKey, channel, finalRefs, size)
      }, { maxRetries: 2 })

      // 保存并叠印
      const imageDir = join(project.path, 'assets', 'images', 'storyboard')
      const savedImages = await saveGeneratedImages(imageUrls.slice(0, 1), imageDir, `grid_ch${chapter.chapterId.slice(0,8)}_${Date.now()}`)
      let posterPath = savedImages[0]?.localPath || ''
      const posterSourceUrl = savedImages[0]?.sourceUrl || ''

      if (posterPath && !posterPath.startsWith('http')) {
        try {
          const annotatedPath = posterPath.replace(/\.(png|jpg|jpeg|webp)$/i, '_annotated.$1')
          await overlayGridLabels(posterPath, annotatedPath, cells)
          posterPath = annotatedPath
        } catch (e) { logger.error('[GridStoryboard] Overlay failed:', e) }
      }

      // 更新本章所有镜头的 poster_image_path + poster_source_url，旧图推入历史
      if (posterPath) {
        for (const shot of gridShots) {
          const old = db.prepare('SELECT poster_image_path, poster_history FROM shots WHERE id = ?').get(shot.id) as { poster_image_path?: string; poster_history?: string } | undefined
          let history: string[] = []
          try { if (old?.poster_history) history = JSON.parse(old.poster_history) } catch {}
          if (old?.poster_image_path && old.poster_image_path !== posterPath && !history.includes(old.poster_image_path)) {
            history.push(old.poster_image_path)
          }
          db.prepare('UPDATE shots SET poster_image_path = ?, poster_source_url = ?, poster_history = ? WHERE id = ?').run(posterPath, posterSourceUrl || null, JSON.stringify(history), shot.id)
        }
      }

      db.prepare('UPDATE generation_tasks SET status=?,output_path=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run('completed', posterPath, taskId)
      totalGenerated++
      logger.info(`[GridStoryboard] Chapter "${chapter.chapterTitle}" done: ${posterPath}`)
    } catch (err: any) {
      const msg = `章节"${chapter.chapterTitle}": ${err?.message || '生成失败'}`
      if (taskId) {
        db.prepare('UPDATE generation_tasks SET status=?,error_message=?,updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run('failed', msg, taskId)
      }
      logger.error(`[GridStoryboard] ${msg}`)
      errors.push(msg)
    }
  }

  return { generated: totalGenerated, errors }
}
