/**
 * 一键自动化管线
 * 负责剧本解析→资产提取→关联→入库的完整流程编排
 */

import { logger } from '../utils/logger'
import { getDb } from './db'
import { updateProjectScript, Character, Scene, Prop } from './project'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { loadPromptTemplate, callAI, extractJSON } from './ai'
import type { AutoProcessOptions, ProgressData, ShotData, ShotDataChapter, ExtractData, AssocItem, AssocData } from './ai'
import { normalizeShotData, findNamesInText, buildAutoVideoPrompt, ensureChinese, type ComplianceResult } from './scriptParse'
import { processSeedancePipeline } from './seedance'

// ========== 程序化关联（替代 AI 第三步，准确率远高于 AI 判断）==========

/** 程序化关联：扫描每个镜头的对白/旁白/描述/动作，精确匹配角色/场景/道具名 */
function buildAssociations(shotsData: ShotData, extractData: ExtractData): AssocData {
  const charNames = (extractData.characters || []).map(c => (c.name || '').trim()).filter(Boolean)
  const sceneNames = (extractData.scenes || []).map(s => (s.name || '').trim()).filter(Boolean)
  const propNames = (extractData.props || []).map(p => (p.name || '').trim()).filter(Boolean)

  const associations: AssocItem[] = []

  // 用于场景传播：同一章内未匹配的镜头继承最近的已知场景
  let lastKnownScene = ''

  const chapters = shotsData.chapters || []
  for (let ci = 0; ci < chapters.length; ci++) {
    const shots = chapters[ci].shots || []
    for (const shot of shots) {
      // 收集该镜头所有可搜索文本
      const chapterTitle = (chapters[ci] as any).title || ''
      const searchText = [
        chapterTitle,
        shot.dialogue || '',
        shot.narration || '',
        (shot as any).inner_monologue || '',
        shot.description || '',
        (shot as any).description_zh || '',
        (shot as any).first_frame_prompt_zh || '',
        (shot as any).last_frame_prompt_zh || '',
        // character_actions 里的角色名（可能是 JSON 字符串或数组）
        (() => {
          try {
            const ca = (shot as any).character_actions
            if (!ca) return ''
            if (typeof ca === 'string') {
              const arr = JSON.parse(ca)
              return Array.isArray(arr) ? arr.map((a: any) => a.character_name || '').join(' ') : ''
            }
            if (Array.isArray(ca)) return ca.map((a: any) => a.character_name || '').join(' ')
          } catch { /* ignore */ }
          return ''
        })(),
      ].join(' ')

      // 角色匹配：文本中出现角色名 → 关联
      const matchedChars = findNamesInText(searchText, charNames)
      // 额外：对白/旁白中解析"角色名："前缀
      const dialogueNarration = (shot.dialogue || '') + ' ' + (shot.narration || '') + ' ' + ((shot as any).inner_monologue || '')
      const prefixNames = (dialogueNarration.match(/(?<=^|[。！？])\s*([^。！？：:]+)[：:]/g) || [])
        .map(m => m.replace(/[。！？\s：:]/g, '').trim())
        .filter(n => charNames.includes(n))
      const allCharNames = [...new Set([...matchedChars, ...prefixNames])]

      // 角色名模糊匹配：对白/旁白中出现的名字若不在 charNames 中，尝试部分匹配
      const extraNames = (dialogueNarration.match(/(?<=^|[。！？])\s*([^。！？：:]+)[：:]/g) || [])
        .map(m => m.replace(/[。！？\s：:]/g, '').trim())
        .filter(n => n.length >= 2 && !allCharNames.includes(n))
      for (const extra of extraNames) {
        // 在已知角色中找共享至少 2 个字的，避免 1 字误匹配
        let bestMatch = ''
        let bestOverlap = 0
        for (const cn of charNames) {
          const overlap = [...new Set(cn)].filter(c => extra.includes(c)).length
          // 2字名需完全匹配，3-4字名≥2字重叠即匹配
          const minOverlap = cn.length <= 2 ? 2 : 2
          if (overlap >= minOverlap && overlap > bestOverlap) { bestMatch = cn; bestOverlap = overlap }
        }
        // 过滤非角色名：旁白/画外音/系统提示词不是角色
        const isNarratorMarker = (n: string) => ['旁白','画外音','旁白：','画外音：','系统','广播','通知'].includes(n) || n.startsWith('旁白') || n.startsWith('画外音')
        if (bestMatch && !allCharNames.includes(bestMatch) && !isNarratorMarker(bestMatch)) {
          allCharNames.push(bestMatch)
        } else if (!bestMatch && !allCharNames.includes(extra) && !isNarratorMarker(extra)) {
          // 无法匹配 → 将未识别名加入，后续 auto-create 新角色
          allCharNames.push(extra)
        }
      }

      // 场景匹配：优先用 AI 返回的 shot_scene（直接、准确）
      let matchedScene = (shot as any).shot_scene || ''
      if (matchedScene && !sceneNames.includes(matchedScene)) {
        // Step 2 可能润色了场景名 → 尝试模糊匹配
        const found = sceneNames.find(sn => sn.includes(matchedScene) || matchedScene.includes(sn))
        if (found) {
          matchedScene = found
        } else {
          // 模糊也匹配不上 → 保留 shot_scene 原值，后续 auto-create
          logger.info(`[assoc] shot c${ci}s${(shot as any).shot_index || shot.frame_index}: shot_scene="${matchedScene}" not in sceneNames=[${sceneNames.join(', ')}] — keeping as-is`)
        }
      }
      if (!matchedScene) {
        // 回退：精确匹配 → 模糊匹配 → 传播
        matchedScene = findNamesInText(searchText, sceneNames)[0] || ''
        if (!matchedScene) {
          for (const sn of sceneNames) {
            const keywords = sn.split(/[\s\-—，。、：:]+/).filter(k => k.length >= 2)
            if (keywords.some(kw => searchText.includes(kw))) { matchedScene = sn; break }
          }
        }
        // 字符重叠匹配：中文场景名拆字，≥60% 字符出现在描述中则匹配
        if (!matchedScene) {
          for (const sn of sceneNames) {
            const chars = [...new Set(sn.replace(/\s/g, ''))]  // unique chars
            const overlap = chars.filter(c => searchText.includes(c)).length
            if (chars.length >= 2 && overlap / chars.length >= 0.6) { matchedScene = sn; break }
          }
        }
        if (!matchedScene) { matchedScene = lastKnownScene }
      }
      // 更新传播链——无论 matchedScene 来自 shot_scene 还是文本匹配还是传播
      if (matchedScene) { lastKnownScene = matchedScene }
      if (!matchedScene) {
        logger.info(`[assoc] WARN: shot c${ci}s${(shot as any).shot_index || shot.frame_index} no scene matched. sceneNames=[${sceneNames.join(', ')}]`)
      }

      // 道具匹配（精确 + 模糊）
      let matchedProps = findNamesInText(searchText, propNames)
      if (matchedProps.length === 0) {
        // 模糊匹配
        for (const pn of propNames) {
          const keywords = pn.split(/[\s\-—，。、：:]+/).filter(k => k.length >= 2)
          if (keywords.some(kw => searchText.includes(kw))) {
            matchedProps.push(pn)
          }
        }
      }

      associations.push({
        chapter_index: ci,
        shot_index: (shot as any).shot_index || shot.frame_index || 0,
        character_names: allCharNames,
        scene_name: matchedScene,
        prop_names: matchedProps,
      })
    }
  }

  return { associations }
}

// ========== 自动挡主流程 ==========

export async function autoProcess(
  projectId: string,
  script: string,
  onProgress: (data: ProgressData) => void,
  sendProgress: (data: ProgressData) => void,
  options?: AutoProcessOptions
): Promise<{ shotsData: ShotData; extractData: ExtractData; assocData: AssocData }> {
  const db = getDb()
  const mode = options?.mode || 'full'

  // 保存剧本到项目
  try {
    if (mode === 'append') {
      const existing = db
        .prepare('SELECT script_text FROM projects WHERE id = ?')
        .get(projectId) as { script_text: string } | undefined
      const combined =
        (existing?.script_text || '') + (existing?.script_text ? '\n\n' : '') + script
      updateProjectScript(projectId, combined)
    } else {
      updateProjectScript(projectId, script)
    }
  } catch {
    // 忽略保存失败
  }

  // 更新 era / aspectRatio
  if (options?.era) {
    db.prepare('UPDATE projects SET era = ? WHERE id = ?').run(options.era, projectId)
  }
  if (options?.aspectRatio) {
    db.prepare('UPDATE projects SET aspect_ratio = ? WHERE id = ?').run(
      options.aspectRatio,
      projectId
    )
  }

  let storyboardPrompt = options?.promptTemplate || loadPromptTemplate('script_parse', `你是资深影视剧分镜师。将以下剧本文本拆分为分镜列表。返回JSON数组，每项包含shot_index/shot_description等字段。`)
  logger.info(`[autoProcess] prompt source: ${options?.promptTemplate ? 'CUSTOM' : 'TEMPLATE'}, length: ${storyboardPrompt.length}, starts: ${storyboardPrompt.slice(0, 100)}`)
  // 确保 prompt 包含 "json" 关键词，满足 response_format: json_object 的要求
  if (!/json/i.test(storyboardPrompt)) {
    storyboardPrompt += '\n请以 JSON 格式返回'
  }
  const modelOverride = options?.model

  // 步骤1：分镜
  onProgress({ step: 1, status: 'running', message: '正在分析剧本、拆分镜头...' })
  sendProgress({ step: 1, status: 'running', message: '正在分析剧本、拆分镜头...' })

  const shotsResult = await callAI(
    [
      { role: 'system', content: storyboardPrompt },
      { role: 'user', content: script }
    ],
    undefined,
    modelOverride
  )
  let shotsData: ShotData
  try {
    const extracted = extractJSON(shotsResult)
    // 始终保存 AI 原始响应用于调试
    const fs = await import('fs')
    const logPath = join(app.getPath('userData'), 'ai_shot_response.json')
    fs.writeFileSync(logPath, extracted, 'utf8')
    shotsData = JSON.parse(extracted)
    // Normalize: AI may return different structures depending on the template
    shotsData = normalizeShotData(shotsData)
  } catch (e) {
    const fs = await import('fs')
    const logPath = join(app.getPath('userData'), 'ai_response_debug.log')
    fs.writeFileSync(logPath, shotsResult, 'utf8')
    logger.error('[autoProcess] 分镜步骤 JSON 提取失败. 完整响应已写入:', logPath)
    logger.error('[autoProcess] Parse error:', (e as Error).message)
    throw e
  }

  onProgress({ step: 1, status: 'done', message: '分析剧本、拆分镜头 完成' })
  sendProgress({ step: 1, status: 'done', message: '分析剧本、拆分镜头 完成' })

  // 步骤2：提取角色、场景和道具
  onProgress({ step: 2, status: 'running', message: '正在提取角色、场景和道具...' })
  sendProgress({ step: 2, status: 'running', message: '正在提取角色、场景和道具...' })

  const extractResult = await callAI(
    [
      { role: 'system', content: loadPromptTemplate('asset_extract', '从以下分镜结果中提取所有角色、场景和道具。返回JSON，包含characters/scenes/props数组。') },
      { role: 'user', content: JSON.stringify(shotsData) }
    ],
    undefined,
    modelOverride
  )
  let extractData: ExtractData
  try {
    const fs = await import('fs')
    const logPath = join(app.getPath('userData'), 'ai_extract_response.json')
    fs.writeFileSync(logPath, extractJSON(extractResult), 'utf8')
    extractData = JSON.parse(extractJSON(extractResult))
  } catch (e) {
    logger.error('[autoProcess] 提取步骤 JSON 提取失败. AI返回前1000字符:', extractResult.substring(0, 1000))
    logger.error('[autoProcess] Parse error:', (e as Error).message)
    throw e
  }

  onProgress({ step: 2, status: 'done', message: '提取角色、场景和道具 完成' })
  sendProgress({ step: 2, status: 'done', message: '提取角色、场景和道具 完成' })

  // 步骤2.5：自动检测年代
  onProgress({ step: 3, status: 'running', message: '正在检测剧本年代...' })
  sendProgress({ step: 3, status: 'running', message: '正在检测剧本年代...' })

  try {
    const eraSystemPrompt = loadPromptTemplate('era_detect', '')
    const eraResult = await callAI(
      [
        { role: 'system', content: eraSystemPrompt },
        { role: 'user', content: script.slice(0, 2000) }
      ],
      undefined,
      modelOverride
    )
    const detectedEra = eraResult.trim()
    const validEras = ['古代','近代','现代','当代','未来','末世','民国','唐朝','宋朝','明朝','清朝','汉朝','上古','仙侠','洪荒','武侠','赛博朋克','蒸汽朋克']
    if (validEras.some(k => detectedEra.includes(k))) {
      const matched = validEras.find(k => detectedEra.includes(k)) || detectedEra
      db.prepare('UPDATE projects SET era = ? WHERE id = ?').run(matched, projectId)
      logger.info('[autoProcess] 检测到年代:', matched)
    }
  } catch { /* 年代检测失败不影响主流程 */ }

  onProgress({ step: 3, status: 'done', message: '检测剧本年代 完成' })
  sendProgress({ step: 3, status: 'done', message: '检测剧本年代 完成' })

  // 步骤3（原）：程序化关联（替代AI——精确匹配，不受AI幻觉影响）
  onProgress({ step: 4, status: 'running', message: '正在关联角色、场景和道具到分镜...' })
  sendProgress({ step: 4, status: 'running', message: '正在关联角色、场景和道具到分镜...' })

  const assocData: AssocData = buildAssociations(shotsData, extractData)

  onProgress({ step: 4, status: 'done', message: '关联角色、场景和道具到分镜 完成' })
  sendProgress({ step: 4, status: 'done', message: '关联角色、场景和道具到分镜 完成' })

  // 步骤5：保存到数据库
  onProgress({ step: 5, status: 'running', message: '正在保存项目...' })
  sendProgress({ step: 5, status: 'running', message: '正在保存项目...' })

  await saveToDatabase(projectId, shotsData, extractData, assocData, mode)

  onProgress({ step: 5, status: 'done', message: '完成！' })
  sendProgress({ step: 5, status: 'done', message: '完成！' })

  return { shotsData, extractData, assocData }
}

// ========== 数据库保存 ==========

async function saveToDatabase(
  projectId: string,
  shotsData: ShotData,
  extractData: ExtractData,
  assocData: AssocData,
  mode: 'full' | 'append' = 'full'
): Promise<void> {
  const db = getDb()

  // 预先查询已有资产（名称 → ID 映射），用于「只创建、不覆盖」
  const existingChars = db
    .prepare('SELECT * FROM characters WHERE project_id = ?')
    .all(projectId) as Character[]
  const existingScenes = db
    .prepare('SELECT * FROM scenes WHERE project_id = ?')
    .all(projectId) as Scene[]
  const existingProps = db
    .prepare('SELECT * FROM props WHERE project_id = ?')
    .all(projectId) as Prop[]

  const existingCharMap = new Map<string, string>()
  for (const c of existingChars) existingCharMap.set(c.name.trim(), c.id)

  const existingSceneMap = new Map<string, string>()
  const existingSceneNames = existingScenes.map(s => s.name.trim())
  for (const s of existingScenes) existingSceneMap.set(s.name.trim(), s.id)
  const fuzzyMatchScene = (newName: string): string | undefined => {
    const clean = newName.trim()
    if (!clean) return undefined
    if (existingSceneMap.has(clean)) return clean
    for (const old of existingSceneNames) {
      const intersect = [...new Set(old)].filter(c => clean.includes(c)).length
      const union = new Set([...old, ...clean]).size
      if (union > 0 && intersect / union >= 0.7) return old
    }
    return undefined
  }

  const existingPropMap = new Map<string, string>()
  for (const p of existingProps) existingPropMap.set(p.name.trim(), p.id)

  // append 模式：获取已有最大 chapter_index
  let existingMaxChapterIndex = -1
  if (mode === 'append') {
    const row = db
      .prepare('SELECT MAX(chapter_index) as max FROM chapters WHERE project_id = ?')
      .get(projectId) as { max: number } | undefined
    existingMaxChapterIndex = row?.max ?? -1
  }

  db.transaction(() => {
    // 1. full 模式：清空分镜+角色+场景+道具数据；append 模式：保留已有
    if (mode === 'full') {
      const oldShots = db
        .prepare(
          `SELECT s.id FROM shots s JOIN chapters c ON s.chapter_id = c.id WHERE c.project_id = ?`
        )
        .all(projectId) as { id: string }[]
      for (const s of oldShots) {
        db.prepare('DELETE FROM shot_characters WHERE shot_id = ?').run(s.id)
        db.prepare('DELETE FROM shot_scenes WHERE shot_id = ?').run(s.id)
        db.prepare('DELETE FROM shot_props WHERE shot_id = ?').run(s.id)
      }
      db.prepare(
        'DELETE FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)'
      ).run(projectId)
      db.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId)
      // 清理历史残留的假角色（AI 幻觉）
      const susChars = db.prepare("SELECT id, name FROM characters WHERE project_id = ?").all(projectId) as { id: string; name: string }[]
      for (const sc of susChars) {
        const cn = sc.name.trim()
        const bad = !cn || cn.length < 2 ||
          /(偏好|设置|进度|状态|级别|模式|日志|记录|报告|通知|提醒|任务|目标|系统|界面|按钮|菜单|窗口|对话框|提示)$/.test(cn) ||
          /^(您的?|我的?|他的?|她的?)(偏好|设置|进度)/.test(cn) ||
          /^(开始|结束|保存|删除|更新|加载|下载|导入|导出|搜索|筛选|切换|确认|取消|登录|注册)$/.test(cn) ||
          /[：:」「『』【】\(\)（）\[\]{}]/.test(cn)
        if (bad) {
          logger.info(`[save] Cleaning up suspicious character: "${cn}"`)
          db.prepare('DELETE FROM character_images WHERE character_id = ?').run(sc.id)
          db.prepare('DELETE FROM shot_characters WHERE character_id = ?').run(sc.id)
          db.prepare('DELETE FROM characters WHERE id = ?').run(sc.id)
        }
      }
      // 角色/场景/道具保留（按名称匹配复用），不删除已有资产
    }

    // 2. 角色：已存在则复用 ID，不存在则新建
    const charIdMap = new Map<string, string>()
    const insertChar = db.prepare(
      'INSERT INTO characters (id, project_id, name, description, description_zh) VALUES (?, ?, ?, ?, ?)'
    )
    for (const c of extractData.characters || []) {
      const trimmedName = (c.name || '').trim()
      if (!trimmedName) continue
      const existingId = existingCharMap.get(trimmedName)
      if (existingId) {
        charIdMap.set(trimmedName, existingId)
        // 更新已有角色的描述（含 description_zh）
        let descZh = ensureChinese((c as any).description_zh || '', c.description || '', `角色 ${trimmedName}`)
        if (!descZh) descZh = c.description || ''
        db.prepare('UPDATE characters SET description = ?, description_zh = ? WHERE id = ?').run(c.description || '', descZh, existingId)
      } else {
        const id = randomUUID()
        charIdMap.set(trimmedName, id)
        let descZh = ensureChinese((c as any).description_zh || '', c.description || '', `角色 ${trimmedName}`)
        if (!descZh) descZh = c.description || ''
        insertChar.run(id, projectId, trimmedName, c.description || '', descZh)
      }
    }

    // 3. 场景：同上
    const sceneIdMap = new Map<string, string>()
    const insertScene = db.prepare(
      'INSERT INTO scenes (id, project_id, name, description, description_zh, environment_effects, reference_objects, time_weather) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const s of extractData.scenes || []) {
      const trimmedName = (s.name || '').trim()
      if (!trimmedName) continue
      // 优先精确匹配，再模糊匹配（≥70% 字重叠）
      let matchedName = trimmedName
      let existingId = existingSceneMap.get(matchedName)
      if (!existingId) {
        const fuzzy = fuzzyMatchScene(matchedName)
        if (fuzzy) { logger.info(`[save] 场景名模糊匹配: "${matchedName}" → 复用已有 "${fuzzy}"`); matchedName = fuzzy; existingId = existingSceneMap.get(fuzzy) }
      }
      if (existingId) {
        sceneIdMap.set(matchedName, existingId)
        if (matchedName !== trimmedName) sceneIdMap.set(trimmedName, existingId)
        let descZh = ensureChinese((s as any).description_zh || '', s.description || '', `场景 ${matchedName}`)
        if (!descZh) descZh = s.description || ''
        db.prepare('UPDATE scenes SET description = ?, description_zh = ? WHERE id = ?').run(s.description || '', descZh, existingId)
      } else {
        const id = randomUUID()
        sceneIdMap.set(matchedName, id)
        let descZh = ensureChinese((s as any).description_zh || '', s.description || '', `场景 ${matchedName}`)
        if (!descZh) descZh = s.description || ''
        insertScene.run(id, projectId, matchedName, s.description || '', descZh, (s as any).environment_effects || '', (s as any).reference_objects || '', (s as any).time_weather || '')
      }
    }

    // 4. 道具：同上
    const propIdMap = new Map<string, string>()
    const insertProp = db.prepare(
      'INSERT INTO props (id, project_id, name, description, description_zh, initial_state, state_progression) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const p of extractData.props || []) {
      const trimmedName = (p.name || '').trim()
      if (!trimmedName) continue
      const existingId = existingPropMap.get(trimmedName)
      if (existingId) {
        propIdMap.set(trimmedName, existingId)
        const pDescZh = (p as any).description_zh || p.description || ''
        db.prepare('UPDATE props SET description = ?, description_zh = ?, initial_state = ?, state_progression = ? WHERE id = ?').run(
          p.description || '', pDescZh, (p as any).initial_state || '', (p as any).state_progression || '', existingId)
      } else {
        const id = randomUUID()
        propIdMap.set(trimmedName, id)
        const pDescZh = (p as any).description_zh || p.description || ''
        insertProp.run(id, projectId, trimmedName, p.description || '', pDescZh, (p as any).initial_state || '', (p as any).state_progression || '')
      }
    }

    // 4.6 计算 parse_group（每次解析递增）
    const maxGroupRow = db.prepare('SELECT COALESCE(MAX(parse_group), 0) as mx FROM chapters WHERE project_id = ?').get(projectId) as { mx: number } | undefined
    const parseGroup = (maxGroupRow?.mx || 0) + 1

    // 5. 插入章节和分镜
    const insertChapter = db.prepare(
      'INSERT INTO chapters (id, project_id, chapter_index, title, parse_group) VALUES (?, ?, ?, ?, ?)'
    )
    const insertShot = db.prepare(
      'INSERT INTO shots (id, chapter_id, shot_index, duration_seconds, storyboard_position, description, description_en, description_zh, dialogue, narration, inner_monologue, character_actions, shot_type, camera_movement, camera_angle, lighting_mood, video_prompt, video_prompt_zh, focal_length, focus_point, sound_hint, narrative_function) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const insertShotChar = db.prepare(
      'INSERT INTO shot_characters (shot_id, character_id) VALUES (?, ?)'
    )
    const insertShotScene = db.prepare('INSERT INTO shot_scenes (shot_id, scene_id) VALUES (?, ?)')
    const insertShotProp = db.prepare(
      'INSERT INTO shot_props (id, shot_id, prop_id) VALUES (?, ?, ?)'
    )

    const chapters: ShotDataChapter[] = shotsData.chapters || []
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapter = chapters[ci]
      const chapterId = randomUUID()
      const actualChapterIndex = mode === 'append' ? existingMaxChapterIndex + 1 + ci : ci
      insertChapter.run(
        chapterId,
        projectId,
        actualChapterIndex,
        chapter.title || `第${actualChapterIndex + 1}章`,
        parseGroup
      )

      const shots = chapter.shots || []
      for (const shot of shots) {
        const shotId = randomUUID()
        // 收集此分镜关联的角色和场景名（用于自动生成提示词）
        const shotAssoc = (assocData.associations || []).find(
          (a: AssocItem) => a.chapter_index === ci && a.shot_index === ((shot as any).shot_index || shot.frame_index)
        )
        const shotCharNames = (shotAssoc?.character_names || []).map((n: string) => n.trim()).filter(Boolean)
        const shotSceneName = (shotAssoc?.scene_name || '').trim()
        // 自动生成视频提示词
        const vPrompt = (shot.video_prompt && shot.video_prompt.trim()) ? shot.video_prompt : buildAutoVideoPrompt(shot.description || '', shotCharNames, shotSceneName, (shot as any).shot_type, (shot as any).camera_movement, (shot as any).lighting_mood, (shot as any).duration_seconds || 0, (shot as any).dialogue, (shot as any).narration)
        const vPromptZh = shot.video_prompt_zh || shot.description || ''
        // 写入防线：不管AI怎么塞，写入DB前强制补前缀+重新分配字段
        let dialogueText = (shot as any).dialogue || ''
        let narrationText = (shot as any).narration || ''
        let innerText = (shot as any).inner_monologue || ''

        // 把所有非空文本汇合，先拆 \n 再按前缀逐句重新分配
        // 关键：AI 可能把对白+旁白拼到一个字段里，必须拆行独立处理
        const rawChunks: Array<{ text: string; fromField: string }> = []
        if (dialogueText) rawChunks.push({ text: dialogueText, fromField: 'dialogue' })
        if (narrationText) rawChunks.push({ text: narrationText, fromField: 'narration' })
        if (innerText) rawChunks.push({ text: innerText, fromField: 'inner_monologue' })
        dialogueText = ''; narrationText = ''; innerText = ''

        // 拆 \n → 逐句匹配
        const sentences = rawChunks.flatMap(ch =>
          ch.text.split('\n').filter((s: string) => s.trim()).map((s: string) => ({ text: s.trim(), fromField: ch.fromField }))
        )

        const classify = (t: string, fromField: string): string => {
          if (t.startsWith('旁白：') || t.startsWith('旁白:')) return 'narration'
          if (t.includes('的内心独白：') || t.includes('的内心独白:')) return 'inner'
          // 冒号系统词
          if (/^[^：:]{1,8}[：:]/.test(t)) {
            const n = t.match(/^([^：:]{1,8})[：:]/)?.[1] || ''
            if (n.endsWith('警告') || n.endsWith('警报') || n.endsWith('提示')
              || n.endsWith('通知') || n.endsWith('广播') || n.endsWith('播報')
              || n.endsWith('等级') || n.endsWith('级别') || n.endsWith('状态')
              || n.endsWith('模式') || n.endsWith('编号') || n.endsWith('序号')
              || n === '系統' || n === '旁白' || n === '画外音') return 'narration-forceprefix'
            return 'dialogue'
          }
          // 感叹号系统词
          if (/^[^！：:]{1,8}[！]/.test(t)) {
            const n = t.match(/^([^！：:]{1,8})[！]/)?.[1] || ''
            if (n.endsWith('警告') || n.endsWith('警报') || n.endsWith('提示') || n.endsWith('注意')
              || n.endsWith('等级') || n.endsWith('级别') || n.endsWith('状态')
              || n.endsWith('模式') || n.endsWith('编号') || n.endsWith('序号')) return 'narration-forceprefix'
            return 'dialogue'
          }
          // 无前缀 → 根据来源字段决定
          if (fromField === 'narration') {
            if (/我|自己/.test(t) && t.length < 40 && /[……？！]/.test(t)) return 'inner'
            return 'narration-forceprefix'
          }
          if (fromField === 'inner_monologue') return 'inner'
          return 'dialogue'
        }

        for (const s of sentences) {
          const cls = classify(s.text, s.fromField)
          switch (cls) {
            case 'narration':
              narrationText = narrationText ? narrationText + '\n' + s.text : s.text
              break
            case 'narration-forceprefix':
              narrationText = narrationText ? narrationText + '\n旁白：' + s.text : '旁白：' + s.text
              break
            case 'inner':
              innerText = innerText ? innerText + '\n' + s.text : s.text
              break
            case 'dialogue':
              dialogueText = dialogueText ? dialogueText + '\n' + s.text : s.text
              break
          }
        }
        // 对白/旁白互斥：有对白清旁白
        if (dialogueText.trim() && narrationText.trim()) {
          logger.info(`[save] Shot c${ci}s${(shot as any).shot_index || shot.frame_index}: clearing narration (has dialogue)`)
          narrationText = ''
        }
        const gridPos = (ci * 100) + ((shot as any).shot_index || shot.frame_index || 0)
        insertShot.run(
          shotId,
          chapterId,
          (shot as any).shot_index || shot.frame_index || 0,
          (shot as any).duration_seconds ?? null,
          gridPos,
          shot.description || '',
          (shot as any).description_en || '',
          shot.description_zh || shot.description || '',
          dialogueText,
          narrationText,
          innerText,
          (shot as any).character_actions || '',
          shot.shot_type || '',
          shot.camera_movement || '',
          (shot as any).camera_angle || '',
          shot.lighting_mood || '',
          vPrompt,
          vPromptZh,
          (shot as any).focal_length || '',
          (shot as any).focus_point || '',
          (shot as any).sound_hint || '',
          (shot as any).narrative_function || ''
        )

        // 关联角色、场景、道具（复用上面已查找的 shotAssoc）
        if (shotAssoc) {
          const charNames = [...new Set(shotAssoc.character_names || [])]  // 去重
          for (const charName of charNames) {
            let charId = charIdMap.get((charName || '').trim())
            if (!charId && charName?.trim()) {
              // AI 漏提取的角色 → 自动创建
              const name = charName.trim()
              charId = randomUUID()
              db.prepare('INSERT INTO characters (id, project_id, name, description) VALUES (?, ?, ?, ?)').run(charId, projectId, name, '')
              charIdMap.set(name, charId)
            }
            if (charId) {
              insertShotChar.run(shotId, charId)
            }
          }
          const rawSceneName2 = (shotAssoc.scene_name || '').trim()
          let sceneId = sceneIdMap.get(rawSceneName2)
          if (!sceneId && rawSceneName2) {
            // 模糊匹配回退
            const fuzzy = fuzzyMatchScene(rawSceneName2)
            if (fuzzy) { sceneId = sceneIdMap.get(fuzzy) }
          }
          if (!sceneId && rawSceneName2) {
            // AI Step 2 可能润色了场景名 → 自动创建
            sceneId = randomUUID()
            db.prepare('INSERT INTO scenes (id, project_id, name, description) VALUES (?, ?, ?, ?)').run(sceneId, projectId, rawSceneName2, '')
            sceneIdMap.set(rawSceneName2, sceneId)
          }
          if (sceneId) {
            insertShotScene.run(shotId, sceneId)
          }
          for (const propName of shotAssoc.prop_names || []) {
            const propId = propIdMap.get((propName || '').trim())
            if (propId) {
              insertShotProp.run(randomUUID(), shotId, propId)
            }
          }
        }
      }
    }

    // 更新项目时间
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
  })()
}

// ===== 翻译服务 =====

/** 检测文本是否包含中文 */
function hasChinese(text: string): boolean {
  return /[一-鿿]/.test(text)
}

/**
 * 将中文提示词翻译为英文（调用 AI 文本模型）
 * 仅当文本包含中文时才翻译，否则直接返回原文
 */
export async function translateToEnglish(text: string): Promise<string> {
  if (!text || !hasChinese(text)) return text

  try {
    const result = await callAI([
      {
        role: 'system',
        content: loadPromptTemplate('translate_cn_to_en', 'You are a translator for AI image/video generation prompts. Translate the given Chinese prompt into English. Keep all technical terms in their standard English form. You MUST respond with a JSON object: {"translated": "the English translation here"}. Do NOT include any other text outside the JSON.')
      },
      { role: 'user', content: `Translate this Chinese text to English for AI image generation. Respond in JSON format.\n\n${text}` }
    ])
    // 解析 JSON 响应
    try {
      const parsed = JSON.parse(extractJSON(result))
      return (parsed.translated || result).trim()
    } catch {
      return result.trim()
    }
  } catch (e) {
    logger.error('[translateToEnglish] Translation failed, returning original:', e)
    return text // 翻译失败时返回原文，不阻塞保存
  }
}

// ========== Seedance 2.0 九宫格专属管线（合并 3→1 次 LLM 调用）==========

/** 增强关联匹配 — 九宫格章节内资产强继承 */
function buildSeedanceAssociations(
  shotsData: ShotData,
  characters: { name: string; description: string }[],
  scenes: { name: string; description: string }[],
  props: { name: string; description: string }[]
): AssocData {
  const charNames = characters.map(c => c.name.trim()).filter(Boolean)
  const sceneNames = scenes.map(s => s.name.trim()).filter(Boolean)
  const propNames = props.map(p => p.name.trim()).filter(Boolean)
  const associations: AssocItem[] = []

  // 九宫格强继承：第1镜场景为默认主场景
  let defaultMainScene = ''
  let lastKnownScene = ''
  let lastKnownChars: string[] = []

  const chapters = shotsData.chapters || []
  for (let ci = 0; ci < chapters.length; ci++) {
    const shots = chapters[ci].shots || []
    // 章节级别：第1镜场景设为主场景
    if (shots.length > 0) {
      defaultMainScene = (shots[0] as any).shot_scene || ''
    }

    for (const shot of shots) {
      const chapterTitle = chapters[ci].title || ''
      const searchText = [
        chapterTitle,
        shot.dialogue || '',
        shot.narration || '',
        (shot as any).inner_monologue || '',
        shot.description || '',
        (shot as any).description_zh || '',
      ].join(' ')

      // === 角色匹配（五级优先级）===
      const dialogueNarration = (shot.dialogue || '') + ' ' + (shot.narration || '') + ' ' + ((shot as any).inner_monologue || '')
      // L1: 精确匹配 — 对话前缀
      const prefixNames = (dialogueNarration.match(/(?<=^|[。！？])\s*([^。！？：:]+)[：:]/g) || [])
        .map(m => m.replace(/[。！？\s：:]/g, '').trim())
        .filter(n => charNames.includes(n))
      // L2: 全文精确匹配（含章节标题）
      const matchedChars = findNamesInText(searchText, charNames)
      let allCharNames = [...new Set([...prefixNames, ...matchedChars])]

      // L3: 年代适配模糊匹配（字符重叠 ≥70%）
      const extraNames = (dialogueNarration.match(/(?<=^|[。！？])\s*([^。！？：:]+)[：:]/g) || [])
        .map(m => m.replace(/[。！？\s：:]/g, '').trim())
        .filter(n => n.length >= 2 && !allCharNames.includes(n))
      for (const extra of extraNames) {
        let bestMatch = ''
        let bestOverlap = 0
        for (const cn of charNames) {
          const overlap = [...new Set(cn)].filter(c => extra.includes(c)).length
          const totalChars = new Set([...cn, ...extra]).size
          const ratio = overlap / totalChars
          const minOverlap = cn.length <= 2 ? cn.length : 2
          if (overlap >= minOverlap && ratio > bestOverlap && ratio >= 0.7) {
            bestMatch = cn; bestOverlap = ratio
          }
        }
        const isNarratorMarker = (n: string) => ['旁白','画外音','旁白：','画外音：','系统','广播','通知'].includes(n) || n.startsWith('旁白') || n.startsWith('画外音')
        if (bestMatch && !allCharNames.includes(bestMatch) && !isNarratorMarker(bestMatch)) {
          allCharNames.push(bestMatch)
        } else if (!bestMatch && !allCharNames.includes(extra) && !isNarratorMarker(extra)) {
          allCharNames.push(extra)
        }
      }

      // L4: 章节标题匹配 — 章节名中的角色名（如"北宸天帝登临云海"匹配"北宸天帝"）
      if (allCharNames.length === 0 && chapterTitle) {
        const titleMatched = findNamesInText(chapterTitle, charNames)
        for (const cn of titleMatched) {
          if (!allCharNames.includes(cn)) allCharNames.push(cn)
        }
      }

      // L5: 同章节继承 — 当前镜完全没匹配到角色时，才继承上一镜的角色
      if (allCharNames.length === 0) {
        for (const cn of lastKnownChars) {
          if (!allCharNames.includes(cn)) allCharNames.push(cn)
        }
      }
      lastKnownChars = allCharNames

      // === 场景匹配（三级优先级 + 九宫格强继承）===
      let matchedScene = (shot as any).shot_scene || ''
      // L1: 精确匹配
      if (matchedScene && !sceneNames.includes(matchedScene)) {
        const found = sceneNames.find(sn => sn.includes(matchedScene) || matchedScene.includes(sn))
        if (found) matchedScene = found
      }
      // L2: 模糊匹配（≥70% 字符重叠）
      if (!matchedScene || !sceneNames.includes(matchedScene)) {
        matchedScene = findNamesInText(searchText, sceneNames)[0] || ''
        if (!matchedScene) {
          for (const sn of sceneNames) {
            const intersect = [...new Set(sn)].filter(c => searchText.includes(c)).length
            const total = new Set([...sn, ...searchText.slice(0, 50)]).size
            if (sn.length >= 2 && intersect / total >= 0.7) { matchedScene = sn; break }
          }
        }
      }
      // L3: 九宫格强继承（核心优化）
      if (!matchedScene) { matchedScene = lastKnownScene || defaultMainScene }
      if (matchedScene) { lastKnownScene = matchedScene }

      // === 道具匹配 ===
      const matchedProps = findNamesInText(searchText, propNames)
      for (const pn of propNames) {
        if (!matchedProps.includes(pn)) {
          const keywords = pn.split(/[\s\-—，。、：:]+/).filter((k: string) => k.length >= 2)
          if (keywords.some((kw: string) => searchText.includes(kw))) matchedProps.push(pn)
        }
      }

      associations.push({
        chapter_index: ci,
        shot_index: (shot as any).shot_index || 0,
        character_names: allCharNames,
        scene_name: matchedScene,
        prop_names: matchedProps,
      })
    }
  }

  return { associations }
}

/** Seedance 2.0 九宫格专属一键管线 */
export async function autoProcessSeedance(
  projectId: string,
  script: string,
  onProgress: (data: ProgressData) => void,
  sendProgress: (data: ProgressData) => void,
  options?: AutoProcessOptions
): Promise<{
  shotsData: ShotData
  characters: { name: string; description: string }[]
  scenes: { name: string; description: string }[]
  props: { name: string; description: string }[]
  timePeriod: string
  compliance: ComplianceResult
}> {
  const db = getDb()
  const mode = options?.mode || 'full'

  // 保存剧本
  try {
    if (mode === 'append') {
      const existing = db.prepare('SELECT script_text FROM projects WHERE id = ?').get(projectId) as { script_text: string } | undefined
      updateProjectScript(projectId, (existing?.script_text || '') + (existing?.script_text ? '\n\n' : '') + script)
    } else {
      updateProjectScript(projectId, script)
    }
  } catch { /* ignore */ }

  if (options?.aspectRatio) {
    db.prepare('UPDATE projects SET aspect_ratio = ? WHERE id = ?').run(options.aspectRatio, projectId)
  }

  const modelOverride = options?.model

  // 构建结构化 user prompt：提取场景+对白清单，减少 AI 的 NLP 负担
  const buildStructuredUserPrompt = (rawScript: string): string => {
    const scenes = (rawScript.match(/【场景[：:](.+?)】/g) || []).map(s => s.replace(/【场景[：:]|】/g, '').trim())

    // 格式1：提取「角色名：台词」格式（仅匹配行首短中文名+冒号）
    const dialogues: string[] = []
    const dRegex = /^[\s]*([一-鿿]{1,6})[：:]([^\n]{1,100})/gm
    let dm: RegExpExecArray | null
    while ((dm = dRegex.exec(rawScript)) !== null) {
      const speaker = dm[1].trim()
      const text = dm[2].trim()
      // 过滤非人物标签 + 含叙述动词的误匹配
      if (!/^(场景|时间|地点|旁白|第.{0,3}[幕章回集])$/.test(speaker)
          && !/汇报|说道|问道|回答|告诉|喊道|叫道|吩咐|命令|下达/.test(speaker)
          && text.length > 0) {
        dialogues.push(`${speaker}：${text}`)
      }
    }

    // 格式2：提取中文引号「""」对白（小说体常用，≥4字排除名字引用如"苏晴"）
    const quotedDialogues: string[] = []
    const qRegex = /["“]([^"”]{4,})["”]/g
    let qm: RegExpExecArray | null
    while ((qm = qRegex.exec(rawScript)) !== null) {
      const text = qm[1].trim()
      // 去重：排除已被格式1捕获的（格式1也已存在的跳过）
      const alreadyInDialogues = dialogues.some(d => d.includes(text))
      // 排除明显非对白的引号内容（如技术术语、UI标签等）
      const isNonDialogue = /^(场景|时间|地点|第.{0,3}[幕章回集])$/.test(text)
      if (!alreadyInDialogues && !isNonDialogue && text.length >= 2) {
        quotedDialogues.push(text)
      }
    }

    const parts: string[] = []
    if (scenes.length > 0) {
      parts.push(`【场景】：${scenes.join('、')}`)
    }
    if (dialogues.length > 0) {
      parts.push(`【对白清单-角色标注格式】（${dialogues.length} 句，请分配到对应镜头的 dialogue 字段，写完整语义，不需手动截断）：\n${dialogues.map((d, i) => `${i + 1}. ${d}`).join('\n')}`)
    }
    if (quotedDialogues.length > 0) {
      const items = quotedDialogues.map((t, i) => `${i + 1}. "${t}"`).join('\n')
      parts.push(`【对白清单-引号格式】（${quotedDialogues.length} 句，你需要根据剧本上下文确定每句的说话人，按"角色名：台词"格式填入对应镜头的 dialogue 字段）：\n${items}`)
    }
    parts.push(`【完整剧本】：\n${rawScript}`)
    return parts.join('\n\n')
  }

  // ===== Step 1: 全量 AI 解析（单次 LLM 调用）=====
  onProgress({ step: 1, status: 'running', message: '正在解析剧本（九宫格模式）...' })
  sendProgress({ step: 1, status: 'running', message: '正在解析剧本（九宫格模式）...' })

  // 预估算章节数：优先检测「第X集」标记 → 逐集按内容量拆分 → 全局字数估算
  const colonDialogueCount = (script.match(/^[\s]*([一-鿿]{1,6})[：:]([^\n]{1,100})/gm) || [])
    .filter((l: string) => {
      const speaker = l.replace(/[：:].*/, '').trim()
      return !/^(场景|时间|地点|旁白|第.{0,3}[幕章回集])$/.test(speaker) && !/汇报|说道|问道|回答|告诉|喊道|叫道|吩咐|命令|下达/.test(speaker)
    }).length
  const dialogueLines = colonDialogueCount + (script.match(/["“]([^"”]{4,})["”]/g) || []).length
  // 对白统计（用于结构化 prompt 和 episodeHint 定量注入）
  const dialogueMatchesAll = script.match(/[：:].+/g) || []
  const dialogueChineseChars = dialogueMatchesAll
    .map((l: string) => l.replace(/^[^：:]+[：:]\s*/, '').replace(/[^一-鿿]/g, '').length)
    .reduce((a: number, b: number) => a + b, 0)
  const longestDialogueText = dialogueMatchesAll.reduce((max, l) => {
    const text = l.replace(/^[^：:]+[：:]\s*/, '')
    return text.length > max.length ? text : max
  }, '')
  const sceneMarkersAll = (script.match(/【场景[：:](.+?)】/g) || []).map(s => s.replace(/【场景[：:]|】/g, '').trim())
  const narrativeSegments = script.split(/[。！？\n]/).filter(s => s.trim().length > 5).length

  // 总对白汉字数（含引号对白），用于时长反推章数
  const quotedDialogueTexts: string[] = []
  const qRegex2 = /["“]([^"”]{4,})["”]/g
  let qm2: RegExpExecArray | null
  while ((qm2 = qRegex2.exec(script)) !== null) {
    quotedDialogueTexts.push(qm2[1])
  }
  const totalDialogueChineseChars = dialogueChineseChars +
    quotedDialogueTexts.reduce((sum, t) => sum + t.replace(/[^一-鿿]/g, '').length, 0)

  // 检测集标记并提取位置：第1集、第二集、第01集 等
  const epMarkerRegex = /第\s*(\d+|[一二三四五六七八九十百千]+)\s*集/gi
  const epMarkers: Array<{ label: string; pos: number }> = []
  let m: RegExpExecArray | null
  while ((m = epMarkerRegex.exec(script)) !== null) {
    epMarkers.push({ label: m[0].replace(/\s/g, ''), pos: m.index })
  }
  const episodeCount = epMarkers.length

  let estimatedChapters = 1
  let episodeRule = `剧本包含 ${dialogueLines} 句对白（共 ${dialogueChineseChars} 汉字，最长 ${longestDialogueText.length} 字）、${sceneMarkersAll.length || (script.match(/【.*?】/g) || []).length} 个场景标记、约 ${narrativeSegments} 个叙事单元。每个章节覆盖一个逻辑完整的叙事单元。`
  const dialogueAudioDuration = totalDialogueChineseChars / 3.0
  const estTotalDuration = dialogueAudioDuration + 3.3
  const recommendedChapters = Math.max(1, Math.ceil(estTotalDuration / 13.5))
  const chapterHint = recommendedChapters <= 1
    ? '内容紧凑，1 章即可完整呈现。'
    : `对白音频约 ${dialogueAudioDuration.toFixed(0)}s + 画面开销 ≈ ${estTotalDuration.toFixed(0)}s，建议 ${recommendedChapters} 章。`
  let episodeHint = `章节数量提示用于保证输出容量，不代表固定章节结构。导演必须根据剧情事件、时间变化和视觉节奏自主决定章节划分。对白 ${dialogueLines} 句（${totalDialogueChineseChars} 汉字）、场景 ${sceneMarkersAll.length || (script.match(/【.*?】/g) || []).length} 个。${chapterHint} 对白交替（问答/反应）须在相邻镜头呈现，间隔 ≤1 个反应镜（约 2s），禁止在对白交锋之间插入长段动作。对白必须填入dialogue字段，不需手动截断，超长由系统自动处理。`

  if (episodeCount > 0) {
    // 按集号拆分脚本内容
    const episodeChunks: Array<{ label: string; text: string }> = []
    for (let i = 0; i < epMarkers.length; i++) {
      const start = epMarkers[i].pos
      const end = i + 1 < epMarkers.length ? epMarkers[i + 1].pos : script.length
      episodeChunks.push({ label: epMarkers[i].label, text: script.slice(start, end).trim() })
    }

    // 逐集估算章节数（基于对白+旁白中文字数，与 clampChapterDuration 时长引擎一致）
    const estimateChaptersForContent = (text: string): number => {
      const dialogueChars = (text.match(/[：:].+/g) || [])
        .map((l: string) => l.replace(/^[^：:]+[：:]\s*/, '').replace(/[^一-鿿]/g, '').length)
        .reduce((a: number, b: number) => a + b, 0)
      const narrationChars = (text.match(/旁白[：:].+/g) || [])
        .map((l: string) => l.replace(/^旁白[：:]\s*/, '').replace(/[^一-鿿]/g, '').length)
        .reduce((a: number, b: number) => a + b, 0)
      const speechChars = dialogueChars + narrationChars
      // 每章对白容量：上限35字，留余量防溢出丢弃
      const CHARS_PER_CHAPTER = 25
      const densityBonus = speechChars / Math.max(1, Math.ceil(speechChars / CHARS_PER_CHAPTER)) > 50 ? 1 : 0
      return Math.max(1, Math.ceil(speechChars / CHARS_PER_CHAPTER) + densityBonus)
    }

    const epMappings: Array<{ label: string; chapters: number; speechChars: number }> = []
    let totalChapters = 0
    for (const chunk of episodeChunks) {
      const dChars = (chunk.text.match(/[：:].+/g) || [])
        .map((l: string) => l.replace(/^[^：:]+[：:]\s*/, '').replace(/[^一-鿿]/g, '').length)
        .reduce((a: number, b: number) => a + b, 0)
      const nChars = (chunk.text.match(/旁白[：:].+/g) || [])
        .map((l: string) => l.replace(/^旁白[：:]\s*/, '').replace(/[^一-鿿]/g, '').length)
        .reduce((a: number, b: number) => a + b, 0)
      const ch = estimateChaptersForContent(chunk.text)
      epMappings.push({ label: chunk.label, chapters: ch, speechChars: dChars + nChars })
      totalChapters += ch
    }

    estimatedChapters = totalChapters
    const mappingLines = epMappings.map((em) => {
      const density = em.chapters > 3 ? '对白密集' : em.chapters > 1 ? '对白适中' : '对白较少'
      return `${em.label}(${density}，对白+旁白 ${em.speechChars}字)`
    })
    episodeRule = `剧本包含 ${episodeCount} 集，每集为一个整体。每章 9 镜 ≤14.9s，对白容量=镜时长×3.0字/秒，不限硬上限。至少拆分为 ${totalChapters} 章。对白密集的集必须额外增加章节数，对白完整性优先——宁可多拆不可裁字。参考：${mappingLines.join('；')}。禁止跨集合并内容。`
    episodeHint = `章节数量提示用于保证输出容量，不代表固定章节结构。导演必须根据剧情事件、时间变化和视觉节奏自主决定章节划分。剧本明确标注为 ${episodeCount} 集。自行按每集内容拆分为若干章，每章=9镜。对白容量 = 镜时长×3.0字/秒，长对白占用多个镜时长，叙事区不够就增加章数，绝对不裁对白。建议：对白镜 ≤3 个承载核心台词，其余 6 镜用画面镜承载叙事细节。对白必须填入dialogue字段，不需手动截断，超长由系统自动处理。`

    logger.info(`[seedance] Episode detection: ${episodeCount} episodes, ${totalChapters} chapters total`)
    for (const em of epMappings) {
      logger.info(`[seedance]   ${em.label}: ${em.chapters} chapter(s)`)
    }
  } else {
    // 时长驱动章数估算：对白音频时长 + 镜1/9 开销 → 反推最少章数
    const dialogueAudioDuration = totalDialogueChineseChars / 3.0
    const overhead = 3.3  // 镜1(1.8s) + 镜9(1.5s) 基准
    const estimatedTotalDuration = dialogueAudioDuration + overhead
    const durationBasedChapters = Math.max(1, Math.ceil(estimatedTotalDuration / 13.5))  // 13.5s 留余量，非满打满算 14.9s
    estimatedChapters = Math.max(estimatedChapters, durationBasedChapters)
    logger.info(`[seedance] Duration estimate: ${totalDialogueChineseChars} dialogue chars → ${dialogueAudioDuration.toFixed(1)}s audio + ${overhead}s overhead = ${estimatedTotalDuration.toFixed(1)}s → ${durationBasedChapters} chapter(s)`)
  }

  let systemPrompt = options?.promptTemplate || loadPromptTemplate('seedance_9grid',
    loadPromptTemplate('script_parse', '将以下剧本文本拆分为9镜分镜列表，返回JSON格式。')
  )
  // 注入预期章节数 + 集拆分规则：短剧本硬约束章数，长剧本放宽
  const isShortScript = narrativeSegments <= 20 && dialogueLines <= 6 && totalDialogueChineseChars < 120
  // P0.10 容量估算：按每章实际可用对白时间(~9s)计算，而非总时长/15s
  const capacityBasedChapters = Math.max(1, Math.ceil(dialogueAudioDuration / 9))
  const chapterNumberForAI = Math.max(estimatedChapters, capacityBasedChapters)

  if (isShortScript && estimatedChapters <= 1) {
    // 短剧本：硬约束章数
    const chapterRule = `输出数组必须恰好包含 ${chapterNumberForAI} 个章节对象。`
    systemPrompt = systemPrompt.replace('{{CHAPTER_COUNT_RULE}}', chapterRule)
  } else {
    // P1-A: 模板变量替代脆弱的字符串 replace，Prompt 文案修改不会导致规则失效
    const chapterRule = `输出章节数不得低于 ${chapterNumberForAI}。该数字是系统容量估算值（对白 ${totalDialogueChineseChars} 字 ≈ ${dialogueAudioDuration.toFixed(0)}s 音频），导演必须根据对白完整性、情绪转折和视觉呼吸独立判断是否增加章节。禁止为满足章节数量压缩对白。`
    systemPrompt = systemPrompt.replace('{{CHAPTER_COUNT_RULE}}', chapterRule)
  }
  systemPrompt = systemPrompt.replace('{{CHAPTER_COUNT}}', String(chapterNumberForAI))
  systemPrompt = systemPrompt.replace('{{EPISODE_RULE}}', episodeRule)
  systemPrompt = systemPrompt.replace('{{EPISODE_HINT}}', episodeHint)

  const shotsResult = await callAI(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: buildStructuredUserPrompt(script) }],
    undefined, modelOverride
  )

  let parsed: any
  try {
    const extracted = extractJSON(shotsResult)
    const fs = await import('fs')
    fs.writeFileSync(join(app.getPath('userData'), 'ai_seedance_response.json'), extracted, 'utf8')
    parsed = JSON.parse(extracted)
  } catch (e) {
    const fs = await import('fs')
    fs.writeFileSync(join(app.getPath('userData'), 'ai_response_debug.log'), shotsResult, 'utf8')
    logger.error('[seedance] JSON解析失败: ' + (e as Error).message)
    throw e
  }

  const pipelineResult = processSeedancePipeline(parsed)

  // P0.9: 落盘 pipeline 分析结果（含 rhythmWarnings），供调试和数据分析
  try {
    const fs = await import('fs')
    const analysisPath = join(app.getPath('userData'), 'pipeline_analysis.json')
    const analysis = {
      timestamp: new Date().toISOString(),
      projectId,
      chapterCount: pipelineResult.chapters.length,
      compliance: pipelineResult.compliance,
      // P0.9.8: shot_purpose 来源统计（验证 AI 是否输出 purpose）
      purposeSource: (() => {
        const counts = { ai: 0, fallback_keyword: 0, fallback_index: 0 }
        for (const ch of pipelineResult.chapters) {
          for (const s of ch.shots) {
            const src = (s as any)._purposeSource || 'fallback_index'
            counts[src as keyof typeof counts]++
          }
        }
        const total = counts.ai + counts.fallback_keyword + counts.fallback_index
        return { ...counts, total, aiPercent: total > 0 ? Math.round(counts.ai / total * 100) : 0 }
      })(),
      rhythmSummary: {
        stats: (() => {
          let lipSync = 0, voiceOver = 0, visual = 0
          for (const ch of pipelineResult.chapters) {
            for (const s of ch.shots) {
              if (s.dialogue_mode === 'lip_sync') lipSync++
              else if (s.dialogue_mode === 'voice_over') voiceOver++
              else visual++
            }
          }
          const totalDur = pipelineResult.chapters.flatMap(ch => ch.shots).reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
          const dialogueDur = pipelineResult.chapters.flatMap(ch => ch.shots)
            .filter(s => s.dialogue_mode === 'lip_sync')
            .reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
          return { lipSyncShots: lipSync, voiceOverShots: voiceOver, visualShots: visual, totalShots: lipSync + voiceOver + visual, dialogueRatio: totalDur > 0 ? Math.round(dialogueDur / totalDur * 100) : 0 }
        })(),
        warnings: pipelineResult.compliance.rhythmWarnings.map(w => ({
          level: w.level, shotIndex: w.shotIndex, message: w.message
        }))
      },
      shotPurposes: pipelineResult.chapters.map(ch => ({
        chapter: ch.title,
        shots: ch.shots.map(s => ({ index: s.shot_index, purpose: s.shot_purpose, source: (s as any)._purposeSource || 'unknown', dialogueChars: (s.dialogue || '').replace(/[^一-鿿]/g, '').length, duration: s.duration_seconds, expectedDialogue: s.expected_dialogue_duration }))
      }))
    }
    fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2), 'utf8')
    logger.info(`[seedance] Pipeline analysis written to ${analysisPath}`)
  } catch { /* 分析文件写入失败不影响主流程 */ }

  const shotsData: ShotData = { chapters: pipelineResult.chapters }
  const characters = pipelineResult.characters
  const scenes = pipelineResult.scenes
  const propsList = pipelineResult.props
  const timePeriod = pipelineResult.timePeriod

  // 年代入库
  if (timePeriod) {
    try { db.prepare('UPDATE projects SET era = ? WHERE id = ?').run(timePeriod, projectId) } catch { /* ignore */ }
  }

  onProgress({ step: 1, status: 'done', message: '九宫格解析完成' })
  sendProgress({ step: 1, status: 'done', message: '九宫格解析完成' })

  // ===== Step 2: 程序化关联匹配 =====
  onProgress({ step: 2, status: 'running', message: '正在关联角色、场景和道具...' })
  sendProgress({ step: 2, status: 'running', message: '正在关联角色、场景和道具...' })

  const assocData = buildSeedanceAssociations(shotsData, characters, scenes, propsList)

  onProgress({ step: 2, status: 'done', message: '关联完成' })
  sendProgress({ step: 2, status: 'done', message: '关联完成' })

  // ===== Step 3: 时长精算（pipeline 已完成）=====
  onProgress({ step: 3, status: 'done', message: '时长精算完成' })
  sendProgress({ step: 3, status: 'done', message: '时长精算完成' })

  // ===== Step 4: 九宫格合规校验 =====
  onProgress({ step: 4, status: 'running', message: '正在校验九宫格合规性...' })
  sendProgress({ step: 4, status: 'running', message: '正在校验九宫格合规性...' })

  const compliance = pipelineResult.compliance
  if (!compliance.passed) {
    logger.warn('[seedance] Compliance check failed: ' + compliance.errors.join('; '))
  }
  if (compliance.warnings.length > 0) {
    logger.info('[seedance] Compliance warnings: ' + compliance.warnings.join('; '))
  }

  onProgress({ step: 4, status: compliance.passed ? 'done' : 'running', message: compliance.passed ? '校验通过' : `校验未通过: ${compliance.errors[0]}` })
  sendProgress({ step: 4, status: compliance.passed ? 'done' : 'running', message: compliance.passed ? '校验通过' : `校验未通过: ${compliance.errors[0]}` })

  // ===== Step 5: 结构化入库 =====
  onProgress({ step: 5, status: 'running', message: '正在保存项目...' })
  sendProgress({ step: 5, status: 'running', message: '正在保存项目...' })

  await saveSeedanceToDatabase(projectId, shotsData, characters, scenes, propsList, assocData, mode)

  onProgress({ step: 5, status: 'done', message: '完成！' })
  sendProgress({ step: 5, status: 'done', message: '完成！' })

  return { shotsData, characters, scenes, props: propsList, timePeriod, compliance }
}

/** Seedance 模式入库 */
async function saveSeedanceToDatabase(
  projectId: string,
  shotsData: ShotData,
  characters: { name: string; description: string }[],
  scenes: { name: string; description: string }[],
  propsList: { name: string; description: string }[],
  assocData: AssocData,
  mode: 'full' | 'append' = 'full'
): Promise<void> {
  const db = getDb()

  const existingChars = db.prepare('SELECT * FROM characters WHERE project_id = ?').all(projectId) as Character[]
  const existingScenes = db.prepare('SELECT * FROM scenes WHERE project_id = ?').all(projectId) as Scene[]
  const existingProps = db.prepare('SELECT * FROM props WHERE project_id = ?').all(projectId) as Prop[]

  // 角色名精确匹配 + 场景名模糊匹配（防止 AI 改场景名变体）
  const existingCharMap = new Map<string, string>()
  for (const c of existingChars) existingCharMap.set(c.name.trim(), c.id)
  const existingSceneMap = new Map<string, string>()
  const existingSceneNames = existingScenes.map(s => s.name.trim())
  for (const s of existingScenes) existingSceneMap.set(s.name.trim(), s.id)
  const fuzzyMatchScene = (newName: string): string | undefined => {
    const clean = newName.trim()
    if (!clean) return undefined
    if (existingSceneMap.has(clean)) return clean
    for (const old of existingSceneNames) {
      const intersect = [...new Set(old)].filter(c => clean.includes(c)).length
      const union = new Set([...old, ...clean]).size
      if (union > 0 && intersect / union >= 0.7) return old
    }
    return undefined
  }
  const existingPropMap = new Map<string, string>()
  for (const p of existingProps) existingPropMap.set(p.name.trim(), p.id)

  let existingMaxChapterIndex = -1
  if (mode === 'append') {
    const row = db.prepare('SELECT MAX(chapter_index) as max FROM chapters WHERE project_id = ?').get(projectId) as { max: number } | undefined
    existingMaxChapterIndex = row?.max ?? -1
  }

  db.transaction(() => {
    if (mode === 'full') {
      const oldShots = db.prepare('SELECT s.id FROM shots s JOIN chapters c ON s.chapter_id = c.id WHERE c.project_id = ?').all(projectId) as { id: string }[]
      for (const s of oldShots) {
        db.prepare('DELETE FROM shot_characters WHERE shot_id = ?').run(s.id)
        db.prepare('DELETE FROM shot_scenes WHERE shot_id = ?').run(s.id)
        db.prepare('DELETE FROM shot_props WHERE shot_id = ?').run(s.id)
      }
      db.prepare('DELETE FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)').run(projectId)
      db.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId)
      // 清理历史残留的假角色/假场景（AI 幻觉产生的非人物名）
      const suspiciousChars = db.prepare("SELECT id, name FROM characters WHERE project_id = ?").all(projectId) as { id: string; name: string }[]
      for (const sc of suspiciousChars) {
        const cn = sc.name.trim()
        const isSuspicious = !cn || cn.length < 2 ||
          /(偏好|设置|进度|状态|级别|模式|日志|记录|报告|通知|提醒|任务|目标|系统|界面|按钮|菜单|窗口|对话框|提示)$/.test(cn) ||
          /^(您的?|我的?|他的?|她的?)(偏好|设置|进度)/.test(cn) ||
          /^(开始|结束|保存|删除|更新|加载|下载|导入|导出|搜索|筛选|切换|确认|取消|登录|注册)$/.test(cn) ||
          /[：:」「『』【】\(\)（）\[\]{}]/.test(cn)
        if (isSuspicious) {
          logger.info(`[save] Cleaning up suspicious character: "${cn}"`)
          db.prepare('DELETE FROM character_images WHERE character_id = ?').run(sc.id)
          db.prepare('DELETE FROM shot_characters WHERE character_id = ?').run(sc.id)
          db.prepare('DELETE FROM characters WHERE id = ?').run(sc.id)
        }
      }
    }

    // 角色入库
    const charIdMap = new Map<string, string>()
    const insertChar = db.prepare('INSERT INTO characters (id, project_id, name, description, description_zh) VALUES (?, ?, ?, ?, ?)')
    for (const c of characters) {
      if (!c.name.trim()) continue
      const existingId = existingCharMap.get(c.name.trim())
      if (existingId) {
        charIdMap.set(c.name.trim(), existingId)
        db.prepare('UPDATE characters SET description = ?, description_zh = ? WHERE id = ?').run(c.description, ensureChinese(c.description, c.description, `角色 ${c.name}`), existingId)
      } else {
        const id = randomUUID()
        charIdMap.set(c.name.trim(), id)
        insertChar.run(id, projectId, c.name.trim(), c.description, ensureChinese(c.description, c.description, `角色 ${c.name}`))
      }
    }

    // 场景入库
    const sceneIdMap = new Map<string, string>()
    const insertScene = db.prepare('INSERT INTO scenes (id, project_id, name, description, description_zh, environment_effects, reference_objects, time_weather) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const s of scenes) {
      if (!s.name.trim()) continue
      // 优先精确匹配，再模糊匹配（≥70% 字重叠，防止 AI 场景名漂移）
      let matchedName = s.name.trim()
      let existingId = existingSceneMap.get(matchedName)
      if (!existingId) {
        const fuzzy = fuzzyMatchScene(matchedName)
        if (fuzzy) {
          logger.info(`[seedance] 场景名模糊匹配: "${matchedName}" → 复用已有 "${fuzzy}"`)
          matchedName = fuzzy
          existingId = existingSceneMap.get(fuzzy)
        }
      }
      if (existingId) {
        sceneIdMap.set(matchedName, existingId)
        // 别名：AI 生成的新名字也映射到同一个场景 ID
        if (matchedName !== s.name.trim()) sceneIdMap.set(s.name.trim(), existingId)
        db.prepare('UPDATE scenes SET description = ?, description_zh = ? WHERE id = ?').run(s.description, ensureChinese(s.description, s.description, `场景 ${matchedName}`), existingId)
      } else {
        const id = randomUUID()
        sceneIdMap.set(matchedName, id)
        insertScene.run(id, projectId, matchedName, s.description, ensureChinese(s.description, s.description, `场景 ${matchedName}`), '', '', '')
      }
    }

    // 道具入库
    const propIdMap = new Map<string, string>()
    const insertProp = db.prepare('INSERT INTO props (id, project_id, name, description, description_zh, initial_state, state_progression) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const p of propsList) {
      if (!p.name.trim()) continue
      const existingId = existingPropMap.get(p.name.trim())
      if (existingId) {
        propIdMap.set(p.name.trim(), existingId)
        db.prepare('UPDATE props SET description = ?, description_zh = ? WHERE id = ?').run(p.description, p.description || '', existingId)
      } else {
        const id = randomUUID()
        propIdMap.set(p.name.trim(), id)
        insertProp.run(id, projectId, p.name.trim(), p.description, p.description || '', '', '')
      }
    }

    // 章节+分镜入库
    const parseGroupRow = db.prepare('SELECT COALESCE(MAX(parse_group), 0) as mx FROM chapters WHERE project_id = ?').get(projectId) as { mx: number } | undefined
    const parseGroup = (parseGroupRow?.mx ?? 0) + 1
    const insertChapter = db.prepare('INSERT INTO chapters (id, project_id, chapter_index, title, parse_group) VALUES (?, ?, ?, ?, ?)')
    const insertShot = db.prepare(
      'INSERT INTO shots (id, chapter_id, shot_index, duration_seconds, storyboard_position, description, description_en, description_zh, dialogue, narration, inner_monologue, character_actions, shot_type, camera_movement, camera_angle, lighting_mood, video_prompt, video_prompt_zh, focal_length, focus_point, sound_hint, narrative_function, seedance_params) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const insertShotChar = db.prepare('INSERT INTO shot_characters (shot_id, character_id) VALUES (?, ?)')
    const insertShotScene = db.prepare('INSERT INTO shot_scenes (shot_id, scene_id) VALUES (?, ?)')
    const insertShotProp = db.prepare('INSERT INTO shot_props (id, shot_id, prop_id) VALUES (?, ?, ?)')

    const chapters = shotsData.chapters || []
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapter = chapters[ci]
      const chapterId = randomUUID()
      const actualChapterIndex = mode === 'append' ? existingMaxChapterIndex + 1 + ci : ci
      insertChapter.run(chapterId, projectId, actualChapterIndex, chapter.title || `第${actualChapterIndex + 1}章`, parseGroup)

      const shots = chapter.shots || []
      // 章级：任一镜有对白 → 全章清旁白
      const chapterHasDialogue = shots.some((s: any) => (s.dialogue || '').trim())
      if (chapterHasDialogue) {
        let cleared = 0
        for (const s of shots) { if ((s.narration || '').trim()) { s.narration = ''; cleared++ } }
        if (cleared > 0) logger.info(`[seedance-save] Chapter c${ci}: has dialogue, cleared narration from ${cleared} shots`)
      }

      for (const shot of shots) {
        const shotId = randomUUID()
        const shotAssoc = (assocData.associations || []).find(
          (a: AssocItem) => a.chapter_index === ci && a.shot_index === ((shot as any).shot_index || (shot as any).frame_index)
        )
        const shotCharNames = (shotAssoc?.character_names || []).filter(Boolean)
        const shotSceneName = (shotAssoc?.scene_name || '').trim()

        const vPrompt = (shot as any).video_prompt?.trim()
          ? (shot as any).video_prompt
          : buildAutoVideoPrompt(shot.description || '', shotCharNames, shotSceneName,
              (shot as any).shot_type, (shot as any).camera_movement,
              (shot as any).lighting_mood, (shot as any).duration_seconds || 0,
              (shot as any).dialogue, (shot as any).narration)
        const vPromptZh = (shot as any).video_prompt_zh || shot.description || ''
        const gridPos = (ci * 100) + ((shot as any).shot_index || 0)
        const seedanceParams = (shot as any).seedance_params || ''

        insertShot.run(
          shotId, chapterId,
          (shot as any).shot_index || 0,
          (shot as any).duration_seconds ?? null,
          gridPos,
          shot.description || '',
          (shot as any).description_en || '',
          shot.description_zh || shot.description || '',
          shot.dialogue || '',
          shot.narration || '',
          (shot as any).inner_monologue || '',
          (shot as any).character_actions || '',
          (shot as any).shot_type || '',
          (shot as any).camera_movement || '',
          (shot as any).camera_angle || '',
          (shot as any).lighting_mood || '',
          vPrompt, vPromptZh,
          (shot as any).focal_length || '',
          (shot as any).focus_point || '',
          (shot as any).sound_hint || '',
          (shot as any).narrative_function || '',
          seedanceParams
        )

        // 关联
        if (shotAssoc) {
          for (const charName of [...new Set(shotAssoc.character_names || [])]) {
            let charId = charIdMap.get(charName.trim())
            if (!charId && charName.trim()) {
              charId = randomUUID()
              db.prepare('INSERT INTO characters (id, project_id, name, description) VALUES (?, ?, ?, ?)').run(charId, projectId, charName.trim(), '')
              charIdMap.set(charName.trim(), charId)
            }
            if (charId) insertShotChar.run(shotId, charId)
          }
          const rawSceneName = (shotAssoc.scene_name || '').trim()
          let sceneName = rawSceneName
          let sceneId = sceneIdMap.get(sceneName)
          if (!sceneId && sceneName) {
            // 模糊匹配回退
            const fuzzy = fuzzyMatchScene(sceneName)
            if (fuzzy) { sceneName = fuzzy; sceneId = sceneIdMap.get(fuzzy) }
          }
          if (!sceneId && sceneName) {
            sceneId = randomUUID()
            db.prepare('INSERT INTO scenes (id, project_id, name, description) VALUES (?, ?, ?, ?)').run(sceneId, projectId, sceneName, '')
            sceneIdMap.set(sceneName, sceneId)
          }
          if (sceneId) insertShotScene.run(shotId, sceneId)
          for (const propName of shotAssoc.prop_names || []) {
            const propId = propIdMap.get(propName.trim())
            if (propId) insertShotProp.run(randomUUID(), shotId, propId)
          }
        }
      }
    }
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)
  })()
}
