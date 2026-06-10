/**
 * 视频生成服务
 * 提供分镜视频生成（Agnes + 通用 API）+ 异步轮询
 */

import { getDb } from './db'
import { getProject } from './project'
import { mapEra, getStylePromptZh, fillZhFallback, translateCnField, detectShotType } from './styleMapper'
import { resolveModelConfig, resolveProviderConfig } from './modelRouter'
import { translateToEnglish } from './ai'
import { join, isAbsolute } from 'path'
import { writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync, appendFileSync } from 'fs'
import { execFile, execFileSync } from 'child_process'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import axios from 'axios'

export interface GenerateVideoInput {
  projectId: string
  shotId: string
  model?: string
  channel?: string
  taskId?: string
}

export async function generateShotVideo(input: GenerateVideoInput): Promise<{ taskId: string; videoPaths: string[] }> {
  const db = getDb()
  const { projectId, shotId, model: inputModel, channel: inputChannel, taskId: inputTaskId } = input

  const shot = db.prepare('SELECT * FROM shots WHERE id = ?').get(shotId) as {
    video_prompt: string | null
    video_prompt_zh: string | null
    first_frame_image_path: string | null
    last_frame_image_path: string | null
    shot_type: string | null
    camera_movement: string | null
    lighting_mood: string | null
    character_actions: string | null
    dialogue: string | null
    narration: string | null
  } | undefined
  if (!shot) throw new Error('分镜不存在')

  const videoPrompt = shot.video_prompt || ''
  if (!videoPrompt.trim()) throw new Error('视频提示词为空，请先填写')

  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  // 收集分镜上下文（角色描述 + 场景描述 + 台词 + 景别 + 运镜 + 光线 + 动作）
  const ctxParts: string[] = []
  let charDescsForTpl: string[] = []
  let sceneDescForTpl = ''
  try {
    const chars = db.prepare(
      'SELECT c.name, c.description FROM characters c JOIN shot_characters sc ON c.id = sc.character_id WHERE sc.shot_id = ?'
    ).all(shotId) as { name: string; description: string | null }[]
    charDescsForTpl = chars.map(c => c.description ? `${c.name}: ${c.description}` : c.name).filter(Boolean)
    if (charDescsForTpl.length) {
      ctxParts.push(`Characters: ${charDescsForTpl.join('; ')}`)
      ctxParts.push('CRITICAL: Exactly ONE instance of each named character in the video. NO duplicates, NO clones, NO doppelgangers.')
    }

    const scenes = db.prepare(
      'SELECT s.name, s.description FROM scenes s JOIN shot_scenes ss ON s.id = ss.scene_id WHERE ss.shot_id = ?'
    ).all(shotId) as { name: string; description: string | null }[]
    sceneDescForTpl = scenes.map(s => s.description ? `${s.name}: ${s.description}` : s.name).filter(Boolean).join('; ')
    if (sceneDescForTpl) ctxParts.push(`Scene: ${sceneDescForTpl}`)
  } catch {}
  if (shot.dialogue) ctxParts.push(`Dialogue: ${shot.dialogue}`)
  if (shot.narration) ctxParts.push(`Narration (internal monologue/OFF-SCREEN — ALL characters keep mouths CLOSED): ${shot.narration}`)
  if (shot.shot_type) ctxParts.push(`Shot type: ${translateCnField(shot.shot_type)}`)
  if (shot.camera_movement) ctxParts.push(`Camera: ${translateCnField(shot.camera_movement)}`)
  if (shot.lighting_mood) ctxParts.push(`Lighting: ${translateCnField(shot.lighting_mood)}`)
  if (shot.character_actions) {
    try {
      const actions = JSON.parse(shot.character_actions) as Array<{ character_name: string; action: string }>
      if (actions.length) ctxParts.push(`Actions: ${actions.map(a => `${a.character_name} ${a.action}`).join(', ')}`)
    } catch {}
  }
  const shotContext = ctxParts.join('. ')
  const aspectRatio = project.aspect_ratio || '16:9'
  const isVertical = aspectRatio === '9:16'
  const arDirective = isVertical
    ? 'MUST output a vertical 9:16 portrait video (width:1024 height:1792).'
    : aspectRatio === '1:1'
      ? 'MUST output a square 1:1 video (width:1024 height:1024).'
      : 'MUST output a horizontal 16:9 landscape widescreen video (width:1792 height:1024).'

  // 有首帧图则提示视频从该构图开始
  let frameGuidance = ''
  if (shot.first_frame_image_path) {
    frameGuidance = shot.last_frame_image_path
      ? 'Start from the first frame composition and smoothly transition to the last frame composition.'
      : 'Start from the first frame composition and naturally expand the motion.'
  }

  const finalStylePrompt = project.style_prompt || ''

  // 参考图引导
  const refGuidance = shot.first_frame_image_path
    ? 'Use the reference image as the starting frame. Maintain character identity, scene environment, lighting, and visual style from the reference image. Apply natural motion and cinematic pacing.'
    : ''
  // 台词和旁白——解析多轮"角色名：台词"
  const rawDialogue = shot.dialogue || ''
  const rawNarration = shot.narration || ''
  const audioDirective = (() => {
    const parts: string[] = []
    if (rawDialogue) {
      // 拆分多轮对话: "A：xxx。B：yyy。" → [{speaker:"A", text:"xxx。"}, {speaker:"B", text:"yyy。"}]
      const turns: Array<{ speaker: string; text: string }> = []
      const regex = /([^：:]+)[：:]([^：:]*(?:[：:][^：:]*)*?)(?=[^：:]+[：:]|$)/g
      let m: RegExpExecArray | null
      while ((m = regex.exec(rawDialogue)) !== null) {
        turns.push({ speaker: m[1].trim(), text: m[2].trim() })
      }
      if (turns.length === 0) {
        // 无角色前缀，尝试匹配第一个
        const match = rawDialogue.match(/^([^：:]+)[：:]/)
        if (match) turns.push({ speaker: match[1].trim(), text: rawDialogue.replace(/^[^：:]+[：:]\s*/, '').trim() })
        else parts.push(`DIALOGUE: "${rawDialogue}".`)
      }
      if (turns.length > 0) {
        const speakers = new Set(turns.map(t => t.speaker))
        const allCharNames = charDescsForTpl.map(d => d.split(':')[0].trim())
        const silentChars = allCharNames.filter(n => !speakers.has(n))
        // 每轮对话标注谁说话
        const turnDescs = turns.map(t => `"${t.speaker}" says: "${t.text}"`)
        parts.push(`DIALOGUE: ${turnDescs.join(' Then ')}.`)
        if (silentChars.length > 0) {
          parts.push(`${silentChars.join(', ')} remain COMPLETELY SILENT throughout — mouths fully closed, no lip movement.`)
        }
      }
    }
    if (rawNarration) {
      const text = rawNarration.replace(/^[^：:]+[：:]\s*/, '').trim()
      parts.push(`NARRATION (OFF-SCREEN voice, internal monologue): "${text}". ALL characters keep mouths CLOSED — no one speaks during narration.`)
    }
    return parts.length > 0 ? `AUDIO INSTRUCTIONS: ${parts.join(' ')}` : ''
  })()
  // 禁止字幕——最高优先级约束
  const noSubtitlesDirective = 'CRITICAL CONSTRAINT: Absolutely NO subtitles, NO captions, NO text overlays, NO on-screen text of any kind. The dialogue is voice-only, do NOT display it as text on the video. NO character names, NO lyrics, NO words on screen.'
  // 稳定画面
  const stabilityDirective = 'TECHNICAL: Stable camera movement, smooth cinematic motion, no camera shake, no jitter, steady tripod or gimbal-like stabilization, professional cinematography quality, high definition sharp details, no motion blur artifacts.'
  // 视频提示词中文 → 英文翻译
  const hasChinese = (t: string) => /[一-鿿]/.test(t)
  const translatedVideoPrompt = hasChinese(videoPrompt) ? await translateToEnglish(videoPrompt).catch(() => videoPrompt) : videoPrompt

  // 景别 → 构图指令
  const st = detectShotType(videoPrompt) || shot.shot_type || ''
  const compositionGuide = ((): string => {
    if (st.includes('大特写')) return 'Extreme close-up: single detail fills entire frame — eyes, lips, hands. No face or environment. Macro style.'
    if (st.includes('特写')) return 'Close-up: face fills frame, background blurred. DO NOT show full room or distant objects.'
    if (st.includes('近景')) return 'Medium close-up: chest up, background secondary and close to character.'
    if (st.includes('中景')) return 'Medium shot: full body visible, environment clearly shown around the character.'
    if (st.includes('全景')) return 'Full shot: character in lower-middle third, expansive environment dominates upper portion.'
    if (st.includes('远景') || st.includes('大远景')) return 'Wide/long shot: character is a small figure in a vast environment.'
    return 'Balanced composition: character naturally placed within the scene.'
  })()

  // 用换行分隔比例指令和内容——音频指令提到最前面
  const finalPrompt = [audioDirective, `[COMPOSITION] ${compositionGuide}`, arDirective, stabilityDirective, noSubtitlesDirective, `Video description: ${translatedVideoPrompt}.`, shotContext, refGuidance, frameGuidance, `Style: ${finalStylePrompt}`].filter(Boolean).join('\n')

  // 收集参考图：首帧图 + 角色定妆照 + 场景图（相对路径用project.path拼接）
  const videoRefImages: string[] = []
  const addRefIfExists = function(p: string | null, label: string) {
    if (!p) return
    try {
      const abs = isAbsolute(p) ? p : join(project.path, p)
      const exists = existsSync(abs)
      console.log('[Agnes] addRef', label, 'path:', abs.slice(-60), 'exists:', exists, 'isAbs:', isAbsolute(p))
      if (exists) videoRefImages.push(abs)
    } catch (e: any) { console.log('[Agnes] addRef err:', label, e.message) }
  }
  addRefIfExists(shot.first_frame_image_path, 'frame')
  try {
    const chs = db.prepare("SELECT c.reference_image FROM characters c JOIN shot_characters sc ON c.id = sc.character_id WHERE sc.shot_id = ?").all(shotId) as { reference_image: string | null }[]
    chs.forEach(function(c: any) { addRefIfExists(c.reference_image, 'char') })
    if (videoRefImages.length < 2) {
      const scs = db.prepare("SELECT s.reference_image FROM scenes s JOIN shot_scenes ss ON s.id = ss.scene_id WHERE ss.shot_id = ?").all(shotId) as { reference_image: string | null }[]
      scs.forEach(function(s: any) { addRefIfExists(s.reference_image, 'scene') })
    }
  } catch {}
  console.log('[Agnes] === VIDEO GENERATION SUMMARY ===')
  console.log('[Agnes] Reference images:', videoRefImages.length, '| firstFrame:', shot.first_frame_image_path ? 'YES' : 'NO')
  console.log('[Agnes] Dialogue:', shot.dialogue ? `"${shot.dialogue.slice(0, 80)}"` : 'NONE')
  console.log('[Agnes] Shot type:', shot.shot_type || 'NONE', '| Camera:', shot.camera_movement || 'NONE')
  console.log('[Agnes] Lighting:', shot.lighting_mood || 'NONE', '| Actions:', shot.character_actions ? 'YES' : 'NONE')
  console.log('[Agnes] Video prompt (first 200 chars):', videoPrompt.slice(0, 200))
  // 传全部参考图（首帧 + 角色定妆照 + 场景图）
  const videoRefImage = videoRefImages.length > 0 ? videoRefImages : undefined

  // 模型配置降级
  const purposeKey = 'video'
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  const purposeConfig = projectConfig[purposeKey] || {}
  const videoOverrides = purposeConfig as any
  const videoParams = {
    num_frames: videoOverrides?.num_frames,
    frame_rate: videoOverrides?.frame_rate,
    num_inference_steps: videoOverrides?.num_inference_steps
  }

  let finalPromptWithTemplate = finalPrompt
  const videoTplId = (purposeConfig as any)?.templateId
  if (videoTplId) {
    try {
      const tpl = db.prepare('SELECT content, template_version FROM prompt_templates WHERE id = ?').get(videoTplId) as any
      if (tpl?.content) {
        let tp = tpl.template_version === 'v1' ? (() => { try { const p = JSON.parse(tpl.content); return p.chinese || p.english || '' } catch { return '' } })() : tpl.content
        // 构建完整的变量映射
        const videoStyleZh = getStylePromptZh(project.style_name, project.style_prompt || '')
        const vars: Record<string, string> = {
          duration_seconds: '10',
          style_prompt: project.style_prompt || '',
          style_prompt_zh: videoStyleZh,
          era: mapEra(project.era || ''),
          era_zh: project.era || '',
          video_prompt: videoPrompt,
          shot_description: videoPrompt,
          shot_description_zh: shot.video_prompt_zh || videoPrompt,
          dialogue: shot.dialogue || '',
          dialogue_en: shot.dialogue || '',
          shot_type: shot.shot_type || '',
          shot_type_en: shot.shot_type || '',
          lighting_mood: shot.lighting_mood || '',
          lighting_mood_en: shot.lighting_mood || '',
          camera_movement: shot.camera_movement || '',
          character_actions: shot.character_actions ? (() => { try { return JSON.parse(shot.character_actions!).map((a: any) => a.character_name + ' ' + a.action).join(', ') } catch { return '' } })() : '',
          character_actions_en: shot.character_actions ? (() => { try { return JSON.parse(shot.character_actions!).map((a: any) => a.character_name + ' ' + a.action).join(', ') } catch { return '' } })() : '',
          shot_type_zh: shot.shot_type || '',
          used_scene_description: sceneDescForTpl || '',
          used_scene_description_zh: sceneDescForTpl || '',
          used_character_descriptions: charDescsForTpl.join('; '),
          used_character_descriptions_zh: charDescsForTpl.join('; '),
          used_prop_descriptions: '',
          used_prop_descriptions_zh: ''
        }
        // 中文变量回退到英文
        fillZhFallback(vars)
        // 替换所有 {{var}}
        for (const [k, v] of Object.entries(vars)) {
          tp = tp.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), v)
        }
        // 清理未替换的变量
        tp = tp.replace(/\{\{[^}]+\}\}/g, '')
        if (tp.trim()) { finalPromptWithTemplate = tp.trim(); console.log('[template] video template OK:', videoTplId) }
      }
    } catch { /* keep default */ }
  }

  const { model, channel, apiKey } = resolveModelConfig(purposeKey, projectConfig, inputModel, inputChannel)
  if (!apiKey) throw new Error('未配置 API Key')
  if (!model) throw new Error('未配置视频模型')

  // 创建任务记录
  let taskId: string
  if (inputTaskId) {
    taskId = inputTaskId
    db.prepare(`UPDATE generation_tasks SET model=COALESCE(?,model), channel=COALESCE(?,channel), updated_at=datetime('now','localtime') WHERE id=?`)
      .run(model||null, channel||null, taskId)
  } else {
    taskId = randomUUID()
    db.prepare(`INSERT INTO generation_tasks (id,project_id,shot_id,type,purpose,channel,model,status,input_params,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?,datetime('now','localtime'),datetime('now','localtime'))`)
      .run(taskId, projectId, shotId, 'video', 'video', channel||null, model||null, JSON.stringify({ shotId, prompt: videoPrompt }))
  }

  db.prepare(`UPDATE generation_tasks SET status='running',started_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?`).run(taskId)

  try {
    console.log('═══════════════════════════════════════')
    console.log(`[VideoGen] === FINAL PROMPT TO API ===`)
    console.log(`[VideoGen] Full prompt (${(finalPromptWithTemplate || finalPrompt).length} chars):`)
    console.log(finalPromptWithTemplate || finalPrompt)
    console.log(`[VideoGen] ---`)
    console.log(`[VideoGen] Model: ${model} | Ref images: ${videoRefImages.length} | Aspect: ${aspectRatio}`)
    console.log(`[VideoGen] Composition: ${compositionGuide}`)
    console.log('═══════════════════════════════════════')

    const videoTraceStart = Date.now()
    const videoUrls = await callVideoGenerationAPI(finalPromptWithTemplate || finalPrompt, model, apiKey, channel, videoRefImage, aspectRatio, videoParams)
    try {
      const dir = join(project.path, 'exports')
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'generation_trace.jsonl'), JSON.stringify({
        ts: new Date().toISOString(),
        type: 'video',
        shotId,
        model,
        channel: channel || '',
        promptLength: (finalPromptWithTemplate || finalPrompt).length,
        promptFirst: (finalPromptWithTemplate || finalPrompt).slice(0, 200),
        refImageCount: videoRefImages.length,
        compositionGuide,
        imageCount: videoUrls.length,
        durationMs: Date.now() - videoTraceStart
      }) + '\n', 'utf8')
    } catch { /* ignore */ }

    const videoDir = join(project.path, 'assets', 'videos')
    mkdirSync(videoDir, { recursive: true })

    const videoPaths: string[] = []
    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i]
      const fileName = `${shotId}_video_${Date.now()}_${i}.mp4`
      const filePath = join(videoDir, fileName)
      console.log('[Video] Downloading:', url.slice(0, 100) + '...')
      // 视频下载：不传 Auth（CDN直链不需要，加了对 Google Storage 会 401）
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 300000 })
      console.log('[Video] Downloaded:', (resp.data.byteLength / 1024).toFixed(0), 'KB →', filePath)
      writeFileSync(filePath, Buffer.from(resp.data))
      console.log('[Video] Saved:', filePath)
      videoPaths.push(filePath)
    }

    db.prepare(`UPDATE shot_videos SET is_selected=0 WHERE shot_id=?`).run(shotId)
    for (const vp of videoPaths) {
      db.prepare(`INSERT INTO shot_videos (id,shot_id,video_path,is_selected,has_new_badge,created_at) VALUES (?,?,?,1,1,datetime('now','localtime'))`).run(randomUUID(), shotId, vp)
    }
    db.prepare(`UPDATE shots SET video_path=? WHERE id=?`).run(videoPaths[0], shotId)
    db.prepare(`UPDATE generation_tasks SET status='completed',output_path=?,updated_at=datetime('now','localtime') WHERE id=?`).run(videoPaths.join(','), taskId)

    return { taskId, videoPaths }
  } catch (err: any) {
    db.prepare(`UPDATE generation_tasks SET status='failed',error_message=?,updated_at=datetime('now','localtime') WHERE id=?`).run(err?.message||'视频生成失败', taskId)
    throw err
  }
}

async function callVideoGenerationAPI(
  prompt: string,
  model: string,
  apiKey: string,
  channel?: string | null,
  refImage?: string | string[],
  videoAspectRatio?: string,
  videoParams?: { num_frames?: number; frame_rate?: number; num_inference_steps?: number }
): Promise<string[]> {
  let baseURL = ''
  let actualModel = model
  const providerKey = channel || (model.includes(':') ? model.split(':')[0] : '')
  if (providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.baseURL) baseURL = resolved.baseURL
  }
  if (model.includes(':')) actualModel = model.split(':').slice(1).join(':')
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
        audio: true
      }
      // 图生视频：传首帧图base64，强制补齐padding到4的倍数
      const refs = Array.isArray(refImage) ? refImage : refImage ? [refImage] : []
      if (refs.length > 0) {
        try {
          let b64 = readFileSync(refs[0]).toString('base64')
          while (b64.length % 4 !== 0) b64 += '='
          body.image = b64
          console.log('[Agnes] video image ref:', (b64.length / 1024).toFixed(0) + 'KB', 'mod4:', b64.length % 4)
        } catch { /* skip */ }
      }
      const postURL = normalizedBaseURL + '/videos'
      const hasAudio = body.audio === true
      const hasDialogue = /Dialogue|对白|voiceover|audio|speak/i.test(prompt)
      console.log('[Agnes] POST', postURL, 'model:', actualModel, 'audio:', hasAudio, 'dialogue_in_prompt:', hasDialogue)
      console.log('[Agnes] Full prompt:', prompt.slice(0, 500), prompt.length > 500 ? '...' : '')
      console.log('[Agnes] Body size:', (JSON.stringify(body).length / 1024).toFixed(0) + 'KB')

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
          console.log("[Agnes] POST OK:", JSON.stringify(resp.data).slice(0, 400))
          break
        } catch (err: any) {
          lastPostErr = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err?.message
          console.error("[Agnes] POST try", postTry + 1, "ERR:", err?.response?.status || err?.code, lastPostErr.slice(0, 100))
          if (postTry < 2) { console.log("[Agnes] POST retry in 5s..."); await new Promise(r => setTimeout(r, 5000)) }
        }
      }
      if (!resp) throw new Error("Agnes视频请求失败(重试3次): " + lastPostErr)

      const videoId = resp.data?.video_id
      const fallbackTaskId = resp.data?.task_id || resp.data?.id
      console.log("[Agnes] video_id:", videoId ? videoId.slice(0, 40) + "..." : "MISSING")
      console.log("[Agnes] task_id:", fallbackTaskId || "MISSING")
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
        if (i === 0 || i % 6 === 0 || best.status === 'completed' || best.status === 'failed') console.log('[Agnes] poll', i, 'status:', best.status || 'no_status', 'progress:', best.progress)
        if (best.status === 'completed') {
          url = best.remixed_from_video_id || ''
          console.log('[Agnes] COMPLETED url:', url ? url.slice(0, 80) : 'MISSING!')
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

function resolveFfmpegPath(tool: 'ffmpeg' | 'ffprobe' = 'ffmpeg'): string {
  const exe = tool === 'ffprobe' ? 'ffprobe.exe' : 'ffmpeg.exe'
  const candidates = [
    join(process.resourcesPath || '', 'ffmpeg', exe),
    join(__dirname, '..', '..', '..', 'resources', 'ffmpeg', exe),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(`FFmpeg 未找到，请将 ${exe} 放到 resources/ffmpeg/ 目录`)
}

interface VideoFormat {
  codec: string
  width: number
  height: number
  fps: number
  container: string
  duration: number
}

function detectFormat(videoPath: string): VideoFormat | null {
  const ffprobe = resolveFfmpegPath('ffprobe')
  try {
    const stdout = execFileSync(ffprobe, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoPath
    ], { timeout: 30000, encoding: 'utf8' })
    const data = JSON.parse(stdout as string)
    const vs = data.streams?.find((s: any) => s.codec_type === 'video')
    if (!vs) return null
    const [num, den] = (vs.r_frame_rate || '30/1').split('/').map(Number)
    return {
      codec: vs.codec_name || 'unknown',
      width: vs.width || 1920,
      height: vs.height || 1080,
      fps: den > 0 ? num / den : 30,
      container: data.format?.format_name || 'mp4',
      duration: parseFloat(data.format?.duration) || 5
    }
  } catch { return null }
}

function formatsMatch(a: VideoFormat | null, b: VideoFormat | null): boolean {
  if (!a || !b) return false
  return a.codec === b.codec && a.width === b.width && a.height === b.height && Math.abs(a.fps - b.fps) < 0.1
}

export function concatVideos(
  videoPaths: string[],
  outputPath: string,
  onProgress?: (progress: ExportProgress) => void,
  voicePaths?: string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (videoPaths.length === 0) return reject(new Error('没有可拼接的视频'))

    const ffmpeg = resolveFfmpegPath()
    const outDir = join(outputPath, '..'); mkdirSync(outDir, { recursive: true })
    const tempDir = join(app.getPath('temp'), 'autodrama_concat')
    mkdirSync(tempDir, { recursive: true })
    const tempFiles: string[] = []

    const cleanup = () => {
      for (const f of tempFiles) { try { unlinkSync(f) } catch {} }
    }

    try {
      // 验证所有视频文件存在
      for (const p of videoPaths) {
        if (!existsSync(p)) return reject(new Error(`视频文件不存在: ${p}`))
      }

      // 单文件处理：注入音频（如有）或直接复制
      if (videoPaths.length === 1) {
        const voicePath = voicePaths?.[0]
        if (voicePath && existsSync(voicePath)) {
          // 单文件 + 有配音 → 注入音频
          execFileSync(ffmpeg, [
            '-i', videoPaths[0], '-i', voicePath,
            '-c:v', 'copy', '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0',
            '-shortest', '-y', outputPath
          ], { timeout: 600000, stdio: 'pipe' })
        } else {
          const { copyFileSync } = require('fs') as typeof import('fs')
          copyFileSync(videoPaths[0], outputPath)
        }
        onProgress?.({ status: 'completed', percent: 100, message: '导出完成' })
        return resolve(outputPath)
      }

      onProgress?.({ status: 'preparing', percent: 0, message: '正在检测视频格式...' })

      // ffprobe 检测所有视频格式
      const formats = videoPaths.map(p => ({ path: p, format: detectFormat(p) }))
      const baseFormat = formats[0].format
      const allMatch = formats.every(f => formatsMatch(f.format, baseFormat))

      // 格式不一致时先统一 re-encode
      let sources = videoPaths
      if (!allMatch) {
        onProgress?.({ status: 'encoding', percent: 5, message: '格式不一致，正在转码...' })
        const total = videoPaths.length
        for (let i = 0; i < total; i++) {
          const tempPath = join(tempDir, `reenc_${i}.mp4`)
          tempFiles.push(tempPath)
          execFileSync(ffmpeg, [
            '-i', videoPaths[i],
            '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p',
            '-y', tempPath
          ], { timeout: 600000, stdio: 'pipe' })
          onProgress?.({ status: 'encoding', percent: 5 + Math.floor((i + 1) / total * 15), message: `转码中 ${i + 1}/${total}` })
        }
        sources = videoPaths.map((_, i) => join(tempDir, `reenc_${i}.mp4`))
      }

      // 音频注入：为有配音的分镜注入音频轨
      if (voicePaths?.some(p => p && existsSync(p))) {
        onProgress?.({ status: 'encoding', percent: 20, message: '正在注入配音...' })
        for (let i = 0; i < sources.length; i++) {
          const vp = voicePaths[i]
          if (!vp || !existsSync(vp)) continue
          const tempPath = join(tempDir, `voice_${i}.mp4`)
          tempFiles.push(tempPath)
          execFileSync(ffmpeg, [
            '-i', sources[i], '-i', vp,
            '-c:v', 'copy', '-c:a', 'aac', '-map', '0:v:0', '-map', '1:a:0',
            '-shortest', '-y', tempPath
          ], { timeout: 600000, stdio: 'pipe' })
          sources[i] = tempPath
        }
      }

      onProgress?.({ status: 'encoding', percent: 25, message: '正在合成视频...' })

      // 构建 concat file list
      const listPath = join(tempDir, 'file_list.txt')
      tempFiles.push(listPath)
      const lines = sources.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      writeFileSync(listPath, lines.join('\n'), 'utf8')

      // execFile 拼接
      const totalDuration = formats.reduce((sum, f) => sum + (f.format?.duration || 5), 0)
      const child = execFile(ffmpeg, [
        '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', outputPath
      ], { timeout: 1800000 }) // 30 分钟超时

      let lastPct = 25
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/)
        if (timeMatch) {
          const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3])
          const pct = Math.min(99, 25 + Math.floor((secs / Math.max(1, totalDuration)) * 75))
          if (pct > lastPct) {
            lastPct = pct
            onProgress?.({ status: 'encoding', percent: pct, message: `合成中 ${pct}%` })
          }
        }
      })

      child.on('close', (code) => {
        cleanup()
        if (code === 0) {
          onProgress?.({ status: 'completed', percent: 100, message: '导出完成' })
          resolve(outputPath)
        } else {
          reject(new Error(`FFmpeg 退出码 ${code}`))
        }
      })

      child.on('error', (err) => {
        cleanup()
        reject(new Error(`视频拼接失败: ${err.message}`))
      })
    } catch (err: any) {
      cleanup()
      reject(err)
    }
  })
}

/**
 * 按分镜 ID 列表拼接视频（按传入顺序）
 */
export async function concatShots(
  projectId: string,
  shotIds: string[],
  outputFileName?: string,
  onProgress?: (progress: ExportProgress) => void
): Promise<{ outputPath: string; shotCount: number }> {
  const db = getDb()
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const videoPaths: string[] = []
  const voicePaths: string[] = []
  for (const sid of shotIds) {
    const shot = db.prepare('SELECT video_path, voice_path FROM shots WHERE id = ?').get(sid) as { video_path: string | null; voice_path: string | null } | undefined
    if (shot?.video_path && existsSync(shot.video_path)) {
      videoPaths.push(shot.video_path)
      voicePaths.push(shot.voice_path && existsSync(shot.voice_path) ? shot.voice_path : '')
    }
  }

  if (videoPaths.length === 0) throw new Error('所选分镜均未生成视频')

  const name = outputFileName || `export_${Date.now()}.mp4`
  const outputPath = join(project.path, 'exports', name)

  const result = await concatVideos(videoPaths, outputPath, onProgress, voicePaths)
  return { outputPath: result, shotCount: videoPaths.length }
}
