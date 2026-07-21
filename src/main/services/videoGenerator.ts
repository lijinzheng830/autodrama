/**
 * 视频生成服务
 * 提供分镜视频生成（Agnes + 通用 API）+ 异步轮询
 */

import { getDb } from './db'
import { logger } from '../utils/logger'
import { getProject, registerTaskController, deregisterTaskController } from './project'
import { loadPromptTemplate } from './ai'
import { resolveModelConfig, resolveProviderConfig } from './modelRouter'
import { applyTemplate } from './styleMapper'
import { join, isAbsolute } from 'path'
import { writeFileSync, mkdirSync, readFileSync, existsSync, appendFileSync } from 'fs'
import { randomUUID } from 'crypto'
import axios from 'axios'
import { callWubianjieVideoAPI } from './wubianjie'
import { callApimartVideoAPI } from './apimart'
import { callWanxVideoAPI } from './wanx'
import { callHccVideoAPI } from './hcc'
import { callManxueapiVideoAPI } from './manxueapi'

export interface GenerateVideoInput {
  projectId: string
  shotId: string
  model?: string
  channel?: string
  taskId?: string
  duration?: number
}

export async function generateShotVideo(input: GenerateVideoInput): Promise<{ taskId: string; videoPaths: string[] }> {
  const db = getDb()
  const { projectId, shotId, model: inputModel, channel: inputChannel, taskId: inputTaskId } = input

  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId) as any
  if (!shot) throw new Error('分镜不存在')

  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  // 取该章节所有分镜
  const chapterRow = db.prepare('SELECT title FROM chapters WHERE id = ?').get(shot.chapter_id) as { title: string } | undefined
  logger.info(`[Video] === Chapter "${chapterRow?.title || '未知'}" ===`)
  const chapterShots = db.prepare('SELECT * FROM shots WHERE chapter_id = ? ORDER BY shot_index').all(shot.chapter_id) as any[]
  const gridShots = chapterShots.slice(0, 9)
  if (gridShots.length < 3) throw new Error('章节分镜不足，至少需要3镜')

  // 总时长：取各镜 duration_seconds 之和
  const totalDuration = gridShots.reduce((sum: number, s: any) => sum + (Number(s.duration_seconds) || 1.5), 0)

  // 加载视频模板（统一使用导演级模板）
  const tplContent = loadPromptTemplate('video_director', '{}')
  let tpl: Record<string, string> = {}
  try { tpl = JSON.parse(tplContent) } catch { /* keep empty */ }

  // 收集角色/场景数据用于模板变量
  const firstShot = gridShots[0]
  const chars = db.prepare('SELECT c.name, c.description FROM characters c JOIN shot_characters sc ON c.id = sc.character_id WHERE sc.shot_id = ?').all(firstShot.id) as { name: string; description: string | null }[]
  const scenes = db.prepare('SELECT s.* FROM scenes s JOIN shot_scenes ss ON s.id = ss.scene_id WHERE ss.shot_id = ?').all(firstShot.id) as any[]

  // 填充模板变量
  const tplVars: Record<string, string> = {
    total_duration: totalDuration.toFixed(2),
    shots_body: gridShots.map((s: any, i: number) => {
      const coreDesc = s.video_prompt_zh || s.description_zh || s.description || ''
      const dialogueTag = (s.dialogue && s.dialogue.trim()) ? `Dialogue: ${s.dialogue}` : ''
      const narrationTag = (s.narration && s.narration.trim()) ? `Narration: ${s.narration}` : ''
      const t0 = 0.15 + gridShots.slice(0, i).reduce((sum, s) => sum + (Number(s.duration_seconds) || 1.5), 0)
      const t1 = t0 + (Number(s.duration_seconds) || 1.5)
      const dof = s.focus_point || (['大远景','远景','全景'].includes(s.shot_type) ? 'deep focus' : 'shallow focus')
      const lens = (() => {
        switch (s.shot_type) {
          case '大远景': return '24mm f/8.0 wide'
          case '远景': case '全景': return '24mm f/8.0 wide'
          case '中景': return '50mm f/2.8 standard'
          case '近景': return '85mm f/2.0 medium telephoto'
          case '特写': case '大特写': return '100mm f/2.8 macro'
          default: return '50mm f/2.8 standard'
        }
      })()
      const moveSpeed = (() => {
        const cm = s.camera_movement || ''
        if (['缓慢推进','缓慢拉远'].includes(cm)) return '1.2cm/s dolly'
        if (['左摇','右摇','摇镜'].includes(cm)) return '0.7°/s pan'
        if (cm === '跟随') return 'tracking'
        if (cm === '升降') return '1.0cm/s crane'
        if (cm === '平移') return '1.0cm/s truck'
        return 'static'
      })()
      const seedanceCfg = s.seedance_params ? JSON.parse(s.seedance_params) : null
      const transition = seedanceCfg?.transition || 'cut'
      const seedanceStyle = seedanceCfg?.style || ''
      const isLastFrame = i === gridShots.length - 1

      const lines = [
        `Frame ${i + 1} [${t0.toFixed(2)}s → ${t1.toFixed(2)}s] ${isLastFrame ? '← LOCK FRAME' : ''}`,
        `Shot Scale: ${s.shot_type || 'medium shot'} | Camera Angle: ${s.camera_angle || 'eye level'} | Depth: ${dof}`,
        `Transition: ${transition} | FPS: ${seedanceCfg?.fps || 24}${seedanceStyle ? ' | Style: ' + seedanceStyle : ''}`,
        `Camera Movement: ${s.camera_movement || 'static'} — ${moveSpeed} — ${s.narrative_function || 'narrative'}`,
        `Lens: ${lens} | DOF: ${dof}`,
        `Visual Core: ${coreDesc}`,
        `Lighting: ${s.lighting_mood || 'natural light'} | Focus: ${s.focus_point || 'auto'}`,
        `Audio: ${s.sound_hint || 'ambient'}`,
      ]
      if (dialogueTag) lines.push(`[DIALOGUE @${t0.toFixed(2)}s-${t1.toFixed(2)}s] ${s.dialogue}`)
      if (narrationTag) lines.push(`[NARRATION @${t0.toFixed(2)}s-${t1.toFixed(2)}s] ${s.narration}`)
      if (isLastFrame) lines.push(`LOCK FRAME REQUIREMENT: Camera must come to complete stop at ${t1.toFixed(2)}s. Final composition must show: ${coreDesc}. This frame serves as the opening frame for the next video segment.`)
      return lines.join('\n')
    }).join('\n\n'),
    character_descriptions: chars.map(c => `${c.name}: ${c.description || ''}`).join('\n'),
    scene_location: scenes[0]?.description || scenes[0]?.name || '',
    scene_time_weather: scenes[0]?.time_weather || 'consistent time of day throughout the scene',
    scene_lighting: firstShot?.lighting_mood || 'professional studio lighting, soft key light with natural falloff',
    scene_effects: scenes[0]?.environment_effects || 'none',
    scene_reference_objects: scenes[0]?.reference_objects || 'none',
    era: project.era || '',
    style_prompt: project.style_prompt || '',
    style_name: project.style_name || '',
    last_frame_num: String(gridShots.length),
    last_frame_duration: (gridShots[gridShots.length - 1]?.duration_seconds || 1.5).toFixed(1) + 's',
    last_frame_desc: gridShots[gridShots.length - 1]?.video_prompt_zh || gridShots[gridShots.length - 1]?.description_zh || gridShots[gridShots.length - 1]?.description || '',
  }

  // 组装 prompt（兼容新旧模板段）
  const promptSections: string[] = []
  if (tpl.section_0_tech_spec) promptSections.push(applyTemplate(tpl.section_0_tech_spec, tplVars))
  for (const key of ['section_1_format']) {
    if (tpl[key]) promptSections.push(applyTemplate(tpl[key], tplVars))
  }
  if (tpl.camera_spec) promptSections.push(applyTemplate(tpl.camera_spec, tplVars))
  if (tpl.section_2_shots_body) promptSections.push(applyTemplate(tpl.section_2_shots_body, tplVars))
  if (chars.length > 0 && (tpl.section_3_character_lock)) promptSections.push(applyTemplate(tpl.section_3_character_lock, tplVars))
  if (tpl.section_4_scene_lock) promptSections.push(applyTemplate(tpl.section_4_scene_lock, tplVars))
  // 导演级模板使用 section_5_camera_direction，通用模板使用 section_5_composition
  if (tpl.section_5_camera_direction) promptSections.push(applyTemplate(tpl.section_5_camera_direction, tplVars))
  else if (tpl.section_5_composition) promptSections.push(applyTemplate(tpl.section_5_composition, tplVars))
  if (tpl.section_6_lighting_design) promptSections.push(applyTemplate(tpl.section_6_lighting_design, tplVars))
  else if (tpl.section_6_consistency) promptSections.push(applyTemplate(tpl.section_6_consistency, tplVars))
  if (tpl.section_7_lock_frame) promptSections.push(applyTemplate(tpl.section_7_lock_frame, tplVars))
  if (tpl.section_8_anti_clipping) promptSections.push(applyTemplate(tpl.section_8_anti_clipping, tplVars))
  const negImage = tpl.negative_prompt_image || ''
  const negVideo = tpl.negative_prompt_video || ''
  const negContent = tpl.negative_prompt_content || ''
  const negativeBlock = [
    'NEGATIVE:',
    `[图像缺陷] ${negImage}`,
    `[视频缺陷] ${negVideo}`,
    `[多余内容] ${negContent}`,
  ].join('\n')
  const quality = tpl.quality ? applyTemplate(tpl.quality, tplVars) : ''
  const finalPrompt = [...promptSections, '', negativeBlock, '', quality].join('\n')

  // 收集参考图：故事板 poster + 角色/场景定妆照
  const videoRefImages: string[] = []
  const addRefIfExists = function(p: string | null, label: string) {
    if (!p) return
    try {
      const abs = isAbsolute(p) ? p : join(project.path, p)
      const exists = existsSync(abs)
      logger.info(`[Video] addRef ${label} path:${abs.slice(-60)} exists:${exists} isAbs:${isAbsolute(p)}`)
      if (exists) videoRefImages.push(abs)
    } catch (e: any) { logger.warn(`[Video] addRef err ${label}: ${e.message}`) }
  }
  // 故事板 poster 作视频参考图（取第一镜的 poster）
  addRefIfExists(gridShots[0]?.poster_image_path || shot.poster_image_path, 'storyboard')
  try {
    // 遍历所有 9 镜收集角色+场景定妆照（非单个 shotId）
    const seenRefs = new Set<string>()
    for (const gs of gridShots) {
      try {
        const chs = db.prepare("SELECT c.reference_image FROM characters c JOIN shot_characters sc ON c.id = sc.character_id WHERE sc.shot_id = ?").all(gs.id) as { reference_image: string | null }[]
        for (const c of chs) { if (c.reference_image && !seenRefs.has(c.reference_image)) { seenRefs.add(c.reference_image); addRefIfExists(c.reference_image, 'char') } }
        const scs = db.prepare("SELECT s.reference_image FROM scenes s JOIN shot_scenes ss ON s.id = ss.scene_id WHERE ss.shot_id = ?").all(gs.id) as { reference_image: string | null }[]
        for (const s of scs) { if (s.reference_image && !seenRefs.has(s.reference_image)) { seenRefs.add(s.reference_image); addRefIfExists(s.reference_image, 'scene') } }
      } catch {}
    }
  } catch {}

  logger.info('[Video] === VIDEO GENERATION SUMMARY ===')
  logger.info(`[Video] Chapter shots: ${gridShots.length} total duration: ${totalDuration.toFixed(2)}s`)
  logger.info(`[Video] Reference images: ${videoRefImages.length} | poster: ${gridShots[0]?.poster_image_path ? 'YES' : 'NO'}`)

  // 模型配置
  const purposeKey = 'video'
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  const { model, channel, apiKey } = resolveModelConfig(purposeKey, projectConfig, inputModel, inputChannel)
  if (!apiKey) throw new Error('未配置 API Key')
  if (!model) throw new Error('未配置视频模型')

  // 创建任务记录
  let taskId: string
  if (inputTaskId) {
    taskId = inputTaskId
    db.prepare(`UPDATE generation_tasks SET model=COALESCE(?,model), channel=COALESCE(?,channel), updated_at=datetime('now','localtime') WHERE id=?`).run(model||null, channel||null, taskId)
  } else {
    taskId = randomUUID()
    db.prepare(`INSERT INTO generation_tasks (id,project_id,shot_id,type,purpose,channel,model,status,input_params,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,datetime('now','localtime'),datetime('now','localtime'))`).run(taskId, projectId, shotId, 'video', 'video', channel||null, model||null, JSON.stringify({ shotId }))
  }

  db.prepare(`UPDATE generation_tasks SET status='running',started_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?`).run(taskId)

  const abortCtrl = new AbortController()
  registerTaskController(taskId, abortCtrl)

  try {
    logger.info('[Video] Prompt chars:', finalPrompt.length)
    logger.info('═══════════════════════════════════════')
    logger.info(`[VideoGen] === FINAL PROMPT TO API ===`)
    logger.info(`[VideoGen] Full prompt (${finalPrompt.length} chars):`)
    logger.info(finalPrompt.slice(0, 500))
    // 保存完整提示词到项目文件夹
    try {
      const promptFile = join(project.path, 'video_prompt.txt')
      writeFileSync(promptFile, finalPrompt, 'utf8')
      logger.info(`[Video] Full prompt saved to: ${promptFile}`)
    } catch {}
    logger.info(`[VideoGen] Model: ${model} | Sub-frames: ${gridShots.length}`)
    logger.info('═══════════════════════════════════════')

    // 收集角色+场景参考图 URL（公网）— 直查 character_images/scene_images
    const allRefUrls: string[] = []
    // 从 9 镜收集所有角色 ID 和场景 ID
    const charIds: string[] = []
    const sceneIds: string[] = []
    for (const s of gridShots) {
      try {
        const chs = db.prepare("SELECT character_id FROM shot_characters WHERE shot_id = ?").all(s.id) as { character_id: string }[]
        for (const c of chs) { if (c.character_id && !charIds.includes(c.character_id)) charIds.push(c.character_id) }
        const scs = db.prepare("SELECT scene_id FROM shot_scenes WHERE shot_id = ?").all(s.id) as { scene_id: string }[]
        for (const sc of scs) { if (sc.scene_id && !sceneIds.includes(sc.scene_id)) sceneIds.push(sc.scene_id) }
      } catch {}
    }
    logger.info(`[Video] allRefUrls: charIds=${JSON.stringify(charIds)} sceneIds=${JSON.stringify(sceneIds)}`)
    // 故事板 poster 的公网 URL
    const posterUrl = gridShots[0]?.poster_source_url || shot.poster_source_url
    if (posterUrl && (posterUrl.startsWith('http://') || posterUrl.startsWith('https://')) && !allRefUrls.includes(posterUrl)) {
      allRefUrls.push(posterUrl)
      logger.info(`[Video] allRefUrls: poster_source_url added`)
    }
    // 按 ID 直查 source_url（与故事板生图相同路径）
    for (const cid of charIds) {
      try {
        const rows = db.prepare("SELECT source_url FROM character_images WHERE character_id = ? AND source_url IS NOT NULL AND source_url != '' ORDER BY created_at DESC LIMIT 2").all(cid) as { source_url: string }[]
        logger.info(`[Video] allRefUrls: char_id=${cid} → ${rows.length} rows, source_url[0]=${(rows[0]?.source_url || '').slice(0, 80)}`)
        for (const r of rows) { if ((r.source_url.startsWith('http://') || r.source_url.startsWith('https://')) && !allRefUrls.includes(r.source_url)) allRefUrls.push(r.source_url) }
      } catch {}
    }
    for (const sid of sceneIds) {
      try {
        const rows = db.prepare("SELECT source_url FROM scene_images WHERE scene_id = ? AND source_url IS NOT NULL AND source_url != '' ORDER BY created_at DESC LIMIT 2").all(sid) as { source_url: string }[]
        logger.info(`[Video] allRefUrls: scene_id=${sid} → ${rows.length} rows, source_url[0]=${(rows[0]?.source_url || '').slice(0, 80)}`)
        for (const r of rows) { if ((r.source_url.startsWith('http://') || r.source_url.startsWith('https://')) && !allRefUrls.includes(r.source_url)) allRefUrls.push(r.source_url) }
      } catch {}
    }
    if (sceneIds.length > 0) {
      for (const sid of sceneIds) {
        const total = db.prepare("SELECT COUNT(*) as cnt FROM scene_images WHERE scene_id = ?").get(sid) as { cnt: number }
        const withUrl = db.prepare("SELECT COUNT(*) as cnt FROM scene_images WHERE scene_id = ? AND source_url IS NOT NULL AND source_url != ''").get(sid) as { cnt: number }
        logger.info(`[Video] allRefUrls DIAG: scene_id=${sid} totalImages=${total.cnt} withSourceUrl=${withUrl.cnt}`)
      }
    }
    // 项目级 fallback

    logger.info(`[Video] allRefUrls (HTTP): ${allRefUrls.length} | videoRefImages (local): ${videoRefImages.length}`)

    // Wan2.7 / Apimart 路由
    const providerKey2 = channel || (model?.includes(':') ? model.split(':')[0] : '')
    const actualModel2 = model?.includes(':') ? model.split(':').slice(1).join(':') : model
    const refUrlsForApi = [...allRefUrls, ...videoRefImages].slice(0, 7)
    let videoUrls: string[]
    if (providerKey2 === 'dashscope' || (channel || '').includes('dashscope') || model?.includes('dashscope')) {
      const poster = gridShots[0]?.poster_image_path
      videoUrls = await callWanxVideoAPI({ apiKey, prompt: finalPrompt, duration: input.duration || 5, resolution: '720P', firstFrameUrl: poster, seed: 1024 })
    } else if (providerKey2 === 'apimart' || (channel || '').includes('apimart') || model?.includes('apimart')) {
      videoUrls = await callApimartVideoAPI({ apiKey, prompt: finalPrompt, size: '16:9', duration: input.duration || 5, resolution: '720p', refImages: refUrlsForApi, model: actualModel2, seed: 1024, generateAudio: true, returnLastFrame: true })
    } else if (providerKey2 === 'wubianjie' || (channel || '').includes('wubianjie') || (channel || '').includes('lk888') || model?.includes('wubianjie') || model?.includes('lk888') || model?.includes('grok-imagine')) {
      const wbRefs = allRefUrls.slice(0, 7)
      const wbDuration = String(Math.round(totalDuration))
      videoUrls = await callWubianjieVideoAPI({ apiKey, prompt: finalPrompt, aspectRatio: '16:9', duration: wbDuration, model: actualModel2, refImages: wbRefs, signal: abortCtrl.signal })
    } else if (providerKey2 === 'manxueapi' || (channel || '').includes('manxueapi') || model?.includes('vyro-seedance')) {
      videoUrls = await callManxueapiVideoAPI({ apiKey, prompt: finalPrompt, duration: input.duration || 5, aspectRatio: '16:9', resolution: '720p', refImages: refUrlsForApi.length > 0 ? refUrlsForApi : undefined, model: actualModel2, generateAudio: true, signal: abortCtrl.signal })
    } else if (providerKey2 === 'hcc' || (channel || '').includes('hcc') || model?.includes('hcc') || (channel || '').includes('hermesroute')) {
      const hccRefs = refUrlsForApi.length > 0 ? refUrlsForApi : videoRefImages
      const hccDuration = Math.round(totalDuration)
      videoUrls = await callHccVideoAPI({ apiKey, prompt: finalPrompt, duration: hccDuration, aspectRatio: '16:9', resolution: '720p', refImages: hccRefs, generateAudio: true, signal: abortCtrl.signal })
    } else {
      const refsForApi = refUrlsForApi.length > 0 ? refUrlsForApi : (videoRefImages.length > 0 ? videoRefImages : undefined)
      videoUrls = await callVideoGenerationAPI(finalPrompt, model, apiKey, channel, refsForApi, '16:9', undefined, input.duration || 5)
    }
    const videoTraceStart = Date.now()
    try {
      const dir = join(project.path, 'exports')
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'generation_trace.jsonl'), JSON.stringify({
        ts: new Date().toISOString(),
        type: 'video',
        shotId,
        model,
        channel: channel || '',
        promptLength: finalPrompt.length,
        promptFirst: finalPrompt.slice(0, 200),
        refImageCount: videoRefImages.length,
        imageCount: videoUrls.length,
        durationMs: Date.now() - videoTraceStart
      }) + '\n', 'utf8')
    } catch { /* ignore */ }

    const videoDir = join(project.path, 'assets', 'videos')
    mkdirSync(videoDir, { recursive: true })

    const videoPaths: string[] = []
    const isWubianjie = (channel || '').includes('lk888') || (model || '').includes('lk888')
    const isHcc = (channel || '').includes('hcc') || (channel || '').includes('hermesroute') || (model || '').includes('hcc')

    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i]
      const fileName = `${shotId}_video_${Date.now()}_${i}.mp4`
      const filePath = join(videoDir, fileName)

      // HCC 已下载到本地临时文件，直接拷贝
      if (isHcc && !url.startsWith('http')) {
        logger.info(`[Video] HCC local copy: ${url} → ${filePath}`)
        const { copyFileSync, unlinkSync } = await import('fs')
        copyFileSync(url, filePath)
        // 删除临时文件
        try { unlinkSync(url) } catch { /* ignore */ }
        videoPaths.push(filePath)
        continue
      }

      logger.info('[Video] Downloading:', url.slice(0, 100) + '...')
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 300000 })

      if (isWubianjie) {
        // 无边界AI直接返回标准mp4，无需转码
        writeFileSync(filePath, Buffer.from(resp.data))
        logger.info(`[Video] Downloaded: ${(resp.data.byteLength / 1024).toFixed(0)} KB`)
        videoPaths.push(filePath)
      } else {
        // 直接保存（API 已是标准 mp4，无需转码）
        writeFileSync(filePath, Buffer.from(resp.data))
        logger.info(`[Video] Saved: ${(resp.data.byteLength / 1024).toFixed(0)} KB`)
        videoPaths.push(filePath)
      }
    }

    db.prepare(`UPDATE shot_videos SET is_selected=0 WHERE shot_id=?`).run(shotId)
    for (const vp of videoPaths) {
      db.prepare(`INSERT INTO shot_videos (id,shot_id,video_path,is_selected,has_new_badge,created_at) VALUES (?,?,?,1,1,datetime('now','localtime'))`).run(randomUUID(), shotId, vp)
    }
    db.prepare(`UPDATE shots SET video_path=? WHERE id=?`).run(videoPaths[0], shotId)

    db.prepare(`UPDATE generation_tasks SET status='completed',output_path=?,updated_at=datetime('now','localtime') WHERE id=?`).run(videoPaths.join(','), taskId)
    deregisterTaskController(taskId)

    return { taskId, videoPaths }
  } catch (err: any) {
    deregisterTaskController(taskId)
    const errMsg = (err?.message || '视频生成失败') + ' | 重试建议: 每次只改一个变量（运镜/光影/参考图）。先用3-5s短视频验证方向，再投15s完整生成。避免同时调参。'
    db.prepare(`UPDATE generation_tasks SET status='failed',error_message=?,updated_at=datetime('now','localtime') WHERE id=?`).run(errMsg, taskId)
    throw err
  }
}

/** 手动/自动合成视频+配音：遮盖字幕区域(底部12%) + 合并Edge TTS音频 */
export function mergeVideoAudio(shotId: string): string {
  // Edge TTS + FFmpeg 合成已移除
  void shotId
  throw new Error('配音合成功能已移除，请使用模型自带的 generate_audio')
}

async function callVideoGenerationAPI(
  prompt: string,
  model: string,
  apiKey: string,
  channel?: string | null,
  refImage?: string | string[],
  videoAspectRatio?: string,
  videoParams?: { num_frames?: number; frame_rate?: number; num_inference_steps?: number },
  duration = 5
): Promise<string[]> {
  let baseURL = ''
  let actualModel = model
  const providerKey = channel || (model.includes(':') ? model.split(':')[0] : '')
  if (providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.baseURL) baseURL = resolved.baseURL
  }
  if (model.includes(':')) actualModel = model.split(':').slice(1).join(':')

  // Wan2.7 DashScope 图生视频
  const isDashScope = providerKey === 'dashscope' || baseURL.includes('dashscope.aliyuncs.com')
  if (isDashScope) {
    logger.info('[Wan2.7] Detected, delegating video generation...')
    const imgUrls = Array.isArray(refImage) ? refImage as string[] : refImage ? [refImage as string] : []
    return callWanxVideoAPI({ apiKey, prompt, duration, resolution: '720P', firstFrameUrl: imgUrls[0], seed: 1024 })
  }

  // Apimart 异步轮询专线
  const isApimart = providerKey === 'apimart' || baseURL.includes('apimart.ai')
  if (isApimart) {
    logger.info('[Apimart] Detected, delegating video generation...')
    const ar = videoAspectRatio || '16:9'
    const imgUrls = Array.isArray(refImage) ? refImage as string[] : refImage ? [refImage as string] : []
    return callApimartVideoAPI({ apiKey, prompt, size: ar, duration, resolution: '720p', refImages: imgUrls, model: actualModel, seed: 1024, generateAudio: true, returnLastFrame: true })
  }

  // 无边界AI 异步轮询专线
  const isWubianjie = providerKey === 'wubianjie' || baseURL.includes('lk888.ai') || actualModel.includes('grok-imagine')
  if (isWubianjie) {
    logger.info('[Wubianjie] Detected, delegating video generation...')
    const ar = videoAspectRatio || '16:9'
    const imgUrls = Array.isArray(refImage) ? refImage as string[] : refImage ? [refImage as string] : []
    return callWubianjieVideoAPI({ apiKey, prompt, aspectRatio: ar, duration: '15', model: actualModel, refImages: imgUrls })
  }

  const isManxueapi = providerKey === 'manxueapi' || baseURL.includes('manxueapi.com') || actualModel.includes('vyro-seedance')
  if (isManxueapi) {
    logger.info('[Manxueapi] Detected, delegating video generation...')
    const ar = videoAspectRatio || '16:9'
    const imgUrls = Array.isArray(refImage) ? refImage as string[] : refImage ? [refImage as string] : []
    return callManxueapiVideoAPI({ apiKey, prompt, duration, aspectRatio: ar, resolution: '720p', refImages: imgUrls, model: actualModel, generateAudio: true })
  }

  if (!baseURL) throw new Error('无法确定 API 基础地址')

  let normalizedBaseURL = baseURL.replace(/\/$/, '')
  const isAgnes = normalizedBaseURL.includes('agnes-ai.com')

    if (isAgnes) {
      // ===== Agnes API v2: POST /v1/videos -> poll /agnesapi?video_id= -> download =====
      if (!normalizedBaseURL.endsWith("/v1")) normalizedBaseURL += "/v1"

      const ar = videoAspectRatio || "16:9"
      let width = 1280, height = 768
      if (ar === "9:16") { width = 768; height = 1280 }
      else if (ar === "1:1") { width = 1024; height = 1024 }

      const body: any = {
        model: actualModel, prompt, width, height,
        num_frames: videoParams?.num_frames ?? 241,
        frame_rate: videoParams?.frame_rate ?? 24,
        num_inference_steps: videoParams?.num_inference_steps ?? 100,
        audio: false  // 禁用Agnes原生配音：中文TTS质量差，台词不准+最后2秒放飞自我。改用Edge TTS+FFmpeg合成
      }
      // 图生视频：传首帧图base64，强制补齐padding到4的倍数
      const refs = Array.isArray(refImage) ? refImage : refImage ? [refImage] : []
      if (refs.length > 0) {
        try {
          let b64 = readFileSync(refs[0]).toString('base64')
          while (b64.length % 4 !== 0) b64 += '='
          body.image = b64
          logger.info(`[Agnes] video image ref: ${(b64.length / 1024).toFixed(0)}KB mod4:${b64.length % 4}`)
        } catch { /* skip */ }
      }
      const postURL = normalizedBaseURL + '/videos'
      const hasAudio = body.audio === true
      const hasDialogue = /Dialogue|对白|voiceover|audio|speak/i.test(prompt)
      logger.info(`[Agnes] POST ${postURL} model:${actualModel} audio:${hasAudio} dialogue_in_prompt:${hasDialogue}`)
      logger.info(`[Agnes] Full prompt: ${prompt.slice(0, 500)}${prompt.length > 500 ? '...' : ''}`)
      logger.info('[Agnes] Body size:', (JSON.stringify(body).length / 1024).toFixed(0) + 'KB')

      let resp: any
      let lastPostErr = ''
      for (let postTry = 0; postTry < 3; postTry++) {
        try {
          resp = await axios.post(postURL, body, {
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            timeout: 600000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity
          })
          logger.info("[Agnes] POST OK:", JSON.stringify(resp.data).slice(0, 400))
          break
        } catch (err: any) {
          lastPostErr = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err?.message
          logger.error(`[Agnes] POST try ${postTry + 1} ERR:${err?.response?.status || err?.code} ${lastPostErr.slice(0, 100)}`)
          if (postTry < 2) { logger.info("[Agnes] POST retry in 5s..."); await new Promise(r => setTimeout(r, 5000)) }
        }
      }
      if (!resp) throw new Error("Agnes视频请求失败(重试3次): " + lastPostErr)

      const videoId = resp.data?.video_id
      const fallbackTaskId = resp.data?.task_id || resp.data?.id
      logger.info("[Agnes] video_id:", videoId ? videoId.slice(0, 40) + "..." : "MISSING")
      logger.info("[Agnes] task_id:", fallbackTaskId || "MISSING")
      if (!videoId && !fallbackTaskId) throw new Error("未返回 video_id")

      const queryBase = normalizedBaseURL.replace(/\/v1$/, '')
      let url = ''
      for (let i = 0; i < 60; i++) {
        // 指数退避: 3s → 20s max
        const delay = Math.min(3000 * Math.pow(1.3, i), 20000)
        await new Promise(r => setTimeout(r, delay))
        let best: any = {}
        // 同时查询两个端点，取进度更高的
        if (fallbackTaskId) {
          try {
            const sr = await axios.get(normalizedBaseURL + '/videos/' + fallbackTaskId, {
              headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000
            })
            best = sr.data || {}
          } catch {}
        }
        if (videoId) {
          try {
            const sr2 = await axios.get(queryBase + '/agnesapi?video_id=' + videoId + '&model_name=agnes-video-v2.0', {
              headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000
            })
            const s2 = sr2.data || {}
            if (!best.progress || (s2.progress > (best.progress || 0))) best = s2
          } catch {}
        }
        if (i === 0 || i % 6 === 0 || best.status === 'completed' || best.status === 'failed') logger.info(`[Agnes] poll ${i} status:${best.status || 'no_status'} progress:${best.progress}`)
        if (best.status === 'completed') {
          const rawUrl = best.remixed_from_video_id || best.url || best.video_url || ''
          // 补全相对路径：如果返回的是纯 ID/文件名，拼接完整下载地址
          url = rawUrl.startsWith('http') ? rawUrl : `${normalizedBaseURL}/videos/${rawUrl}/download`
          logger.info('[Agnes] COMPLETED url:', url ? url.slice(0, 80) : 'MISSING!')
          if (url) break
        }
        if (best.status === 'failed') { const errStr = typeof best.error === 'object' ? JSON.stringify(best.error) : (best.error || ''); throw new Error('视频生成失败: ' + errStr) }
      }
      if (!url) throw new Error("视频生成超时（5分钟）")
      return [url]
    }
  if (!normalizedBaseURL.endsWith('/v1')) normalizedBaseURL += '/v1'

  const videoBody: any = { model: actualModel, prompt }
  if (!actualModel.startsWith('grok-imagine')) videoBody.size = '720p'
  if (refImage) {
    try {
      const imgBuffer = readFileSync(refImage as string)
      videoBody.image = imgBuffer.toString('base64')
    } catch { /* 图片不可读，跳过 */ }
  }

  let createResp: any
  try {
    createResp = await axios.post(`${normalizedBaseURL}/video/generations`, videoBody, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 120000
    })
  } catch (err: any) {
    const detail = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err?.message
    throw new Error('视频API请求失败: ' + detail)
  }
  const taskId = createResp.data?.task_id || createResp.data?.id
  if (!taskId) throw new Error('视频任务创建失败：未返回 task_id')

  let videoUrl = ''
  for (let attempt = 0; attempt < 60; attempt++) {
    const delay = Math.min(3000 * Math.pow(1.3, attempt), 20000)
    await new Promise(r => setTimeout(r, delay))
    const statusResp = await axios.get(`${normalizedBaseURL}/video/generations/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30000
    })
    const s = statusResp.data?.data || statusResp.data
    const st = (s?.status || '').toUpperCase()
    if (st === 'COMPLETED' || st === 'SUCCESS') {
      videoUrl = s?.result_url || s?.video_url || s?.url || ''
      if (!videoUrl && s?.data) {
        const inner = s.data
        videoUrl = inner?.result_url || inner?.url || inner?.video_url || ''
      }
      if (!videoUrl) {
        const findURL = (obj: any): string => {
          if (typeof obj === 'string' && (obj.startsWith('http://') || obj.startsWith('https://'))) return obj
          if (typeof obj === 'object' && obj) { for (const v of Object.values(obj)) { const f = findURL(v); if (f) return f } }
          return ''
        }
        videoUrl = findURL(s)
      }
      if (videoUrl) break
    }
    if (st === 'FAILED' || st === 'ERROR') {
      throw new Error('视频生成失败: ' + (s?.fail_reason || s?.error?.message || st))
    }
  }
  if (!videoUrl) throw new Error('视频生成超时（5分钟），请重试')
  return [videoUrl]
}

// ===== FFmpeg 视频拼接导出 =====

export interface ExportProgress {
  status: 'preparing' | 'encoding' | 'completed' | 'failed'
  percent: number
  message: string
}

