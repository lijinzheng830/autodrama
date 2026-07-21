/**
 * 统一生图服务（核心管线）
 * 负责资产生图、分镜首尾帧生图、图片 API 调用
 * 模型路由 → modelRouter.ts | 风格映射 → styleMapper.ts | 资产历史 CRUD → characterAnchorService.ts | 视频生成 → videoGenerator.ts
 */

import { logger } from '../utils/logger'
import { getDb } from './db'
import { getProject, registerTaskController, deregisterTaskController } from './project'

import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync, appendFileSync } from 'fs'
import { randomUUID } from 'crypto'
import axios from 'axios'

import { mapEra, getStylePrompt, getStylePromptZh, getAPISize, mapWubianjieSize, getAnglePrompt, getAngleSize, AnchorAngle, applyTemplate } from './styleMapper'
import { resolveModelConfig, resolveProviderConfig } from './modelRouter'
import { assertValidAssetType, assertValidTableName, assertValidColumnName, createMultiAngle } from './characterAnchorService'

import { withRetry } from '../utils/constants'
import { callWubianjieImageAPI } from './wubianjie'
import { callApimartImageAPI } from './apimart'
import { callQwenImageAPI } from './qwenImage'
import { callHccImageAPI } from './hcc'
import { tryImageAPI, tryChatImageAPI, getLastImageError, getLastChatError } from './imageApi'


// ===== 并发控制 =====
const MAX_CONCURRENT = 2
let activeCount = 0
const pendingQueue: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) { activeCount++; return Promise.resolve() }
  return new Promise(resolve => pendingQueue.push(resolve))
}
function releaseSlot(): void {
  activeCount--
  const next = pendingQueue.shift()
  if (next) { activeCount++; next() }
}

// ===== 生图 Trace 日志 =====

interface GenerationTrace {
  ts: string
  type: 'asset' | 'angle'
  assetId?: string
  shotId?: string
  model: string
  channel: string
  promptLength: number
  promptFirst: string
  refImageCount: number
  charMapping?: string[]
  compositionGuide?: string
  consistencyWarnings?: string[]
  imageCount: number
  durationMs: number
  error?: string
}

function writeTrace(projectPath: string, trace: GenerationTrace): void {
  try {
    const dir = join(projectPath, 'exports')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'generation_trace.jsonl'), JSON.stringify(trace) + '\n', 'utf8')
  } catch { /* 日志写入失败不影响生图 */ }
}

export interface GenerateImageInput {
  projectId: string
  type: 'character' | 'scene' | 'prop'
  assetId: string
  description: string
  stylePrompt?: string
  eraPrompt?: string
  aspectRatio?: string
  model?: string
  channel?: string
  apiKey?: string
  count?: number
  taskId?: string
  templateId?: string
  refImage?: string
}

export interface GenerateImageResult {
  taskId: string
  imagePaths: string[]
}

/** 内容安全过滤：替换 API 可能拒绝的敏感词（中英文） */
export function sanitizePromptContent(text: string, era?: string): { text: string; count: number } {
  // 古代/历史/仙侠题材豁免武器和战争词汇过滤（这些是历史准确的视觉要素）
  const isHistorical = era && /古代|近代|仙侠|架空|蒸汽朋克|赛博朋克|末世废土/.test(era)
  const rules: [RegExp, string][] = [
    // 英文
    [/\bblood-red\b/gi, 'crimson'],
    [/\bblood\b/gi, 'dark crimson'],
    [/\bslave\b/gi, 'captive'],
    [/\bslaves\b/gi, 'captives'],
    [/\bslavery\b/gi, 'captivity'],
    [/\bwarlord\b/gi, 'military governor'],
    [/\bslay(s|ed|ing)?\b/gi, 'defeat$1'],
    [/\bkilled\b/gi, 'defeated'],
    [/\bkill(s|ed|ing)?\b/gi, 'bring$1 down'],
    [/\bdecapitate(s|d)?\b/gi, 'strike$1 down'],
    [/\bbehead(s|ed|ing)?\b/gi, 'strike$1 down'],
    [/\bstab(s|bed|bing)?\b/gi, 'strike$1'],
    [/\bpierce(s|d|ing)?\b/gi, 'strike$1'],
    [/\bwound(s|ed|ing)?\b/gi, 'injur$1'],
    [/\bcorpse(s)?\b/gi, 'fallen form$1'],
    [/\bdead bod(y|ies)\b/gi, 'fallen form$1'],
    [/\bmassacre(s|d)?\b/gi, 'battle$1'],
    [/\btorture(s|d|ing)?\b/gi, 'interrogat$1'],
    [/\bslave trader\b/gi, 'merchant'],
    [/\bslave market\b/gi, 'labor market'],
    [/\brape(s|d|ing)?\b/gi, 'assault$1'],
    [/\bmurder(s|ed|ing)?\b/gi, 'defeat$1'],
    [/\bexecutioner(s)?\b/gi, 'official$1'],
    [/\bexecution(s)?\b/gi, 'judgment$1'],
    [/\bexecution ground\b/gi, 'judgment ground'],
    [/\bexecute(s|d|ing)?\b/gi, 'carries$1 out sentence on'],
    [/\bdismember\b/gi, 'separate'],
    [/\bdismemberment\b/gi, 'separation'],
    [/\bhang(s|ed|ing)?\b/gi, 'suspend$1'],
    [/\bstrangle(s|d|ing)?\b/gi, 'restrain$1'],
    [/\bweapon(s)?\b/gi, 'tool$1'],
    [/\bsword(s)?\b/gi, 'blade$1'],
    [/\bspear(s)?\b/gi, 'polearm$1'],
    [/\baxe(s)?\b/gi, 'hatchet$1'],
    [/\bbattlefield\b/gi, 'field'],
    [/\bwarfare\b/gi, 'conflict'],
    [/\bcruel(ly)?\b/gi, 'harsh$1'],
    [/\bbrutal(ly)?\b/gi, 'fierce$1'],
    [/\bsavage(ly|ry)?\b/gi, 'wild$1'],
    [/\bdry bones\b/gi, 'weathered stones'],
    [/\bbones\b/gi, 'remnants'],
    [/\bgrabs?\b/gi, 'reaches toward'],
    [/\bbinding?\b/gi, 'securing'],
    [/\bbound\b/gi, 'held'],
    [/\bmalnourished\b/gi, 'lean'],
    [/\btattered rags\b/gi, 'worn robe'],
    [/\brags\b/gi, 'robe'],
    [/\biron chains\b/gi, 'iron cords'],
    [/\bchains\b/gi, 'cords'],
    [/\bchain\b/gi, 'cord'],
    [/\btattered\b/gi, 'worn'],
    [/\bsallow\b/gi, 'pale'],
    [/\bragged\b/gi, 'weathered'],
    [/\brope\b/gi, 'cord'],
    [/\bhemp rope\b/gi, 'woven cord'],
    [/held with/gi, 'grasping'],
    [/铁链/g, '铁环'],
    [/锁链/g, '铁环'],
    [/镣铐/g, '脚环'],
    [/绳索/g, '绳带'],
    [/捆绑/g, '系着'],
    [/束缚/g, '约束'],
    [/血色/g, '深红'],
    [/血迹/g, '暗痕'],
    [/鲜血/g, '红液'],
    [/战场惨烈/g, '战场激烈'],
    [/杀戮/g, '交锋'],
    [/肃杀/g, '肃穆'],
    [/刑场/g, '广场'],
    [/刑架/g, '木架'],
    [/行刑/g, '执法'],
    // 中文
    [/奴隶/g, '奴仆'],
    [/血腥/g, '暗红'],
    [/尸体/g, '遗骸'],
    [/枯骨/g, '碎石'],
    [/屠杀/g, '战斗'],
    [/处决/g, '裁决'],
    [/斩首/g, '击败'],
    [/酷刑/g, '审问'],
    [/武器/g, '工具'],
    [/刀剑/g, '兵器'],
    [/长枪/g, '长杆'],
    [/利刃/g, '锋刃'],
    [/血色/g, '深红'],
    [/血迹/g, '暗痕'],
    [/战场惨烈/g, '战场激烈'],
    [/肃杀/g, '肃穆'],
    [/刑场/g, '广场'],
  ]
  // 历史/古代/仙侠题材：豁免武器和战争类词汇过滤
  const activeRules = isHistorical
    ? rules.filter(([re]) => {
        const s = re.source
        return !/weapon|sword|spear|axe|battlefield|warfare|execution|dismember|iron.chain|chain|cord|rope|massacre|torture|warlord|slay|killed|kill|decapitate|behead|stab|pierce|wound|corpse|dead.body/.test(s)
          && !/铁链|锁链|镣铐|绳索|捆绑|束缚|刑场|刑架|行刑|处决|斩首|酷刑|武器|刀剑|长枪|利刃|战场|肃杀/.test(s)
      })
    : rules
  let result = text
  let replacements = 0
  for (const [re, replacement] of activeRules) {
    const before = result
    result = result.replace(re, replacement)
    if (result !== before) replacements++
  }
  return { text: result, count: replacements }
}

/**
 * 统一生图入口：创建任务 → 调用API → 保存图片 → 更新数据库
 */
export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  assertValidAssetType(input.type)
  const db = getDb()
  const {
    projectId,
    type,
    assetId,
    description,
    stylePrompt = '',
    eraPrompt = '',
    model: inputModel,
    channel: inputChannel,
    apiKey: inputApiKey,
    count = 1,
    taskId: inputTaskId,
    templateId
  } = input

  // 1. 读取项目信息（风格/年代/模型配置）
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const finalStylePrompt = stylePrompt || project.style_prompt || ''
  const finalEraPrompt = mapEra(eraPrompt || project.era || '')

  // 比例优先级：入参 > 资产级设置 > 项目级设置 > 默认16:9
  let aspectRatio = input.aspectRatio
  if (!aspectRatio) {
    const table = type === 'character' ? 'characters' : type === 'scene' ? 'scenes' : 'props'
    const assetRow = db.prepare(`SELECT aspect_ratio FROM ${table} WHERE id = ?`).get(assetId) as { aspect_ratio?: string } | undefined
    aspectRatio = assetRow?.aspect_ratio
  }
  if (!aspectRatio) aspectRatio = project.aspect_ratio || '16:9'

  const aspectHint = aspectRatio || '16:9'
  const styleDesc = finalStylePrompt || 'Photorealistic, high detail, natural lighting, 8k uhd, cinematic grading'

  // 获取资产名称（用于模板变量）
  let assetName = ''
  if (type === 'character' || type === 'scene' || type === 'prop') {
    const table = type === 'character' ? 'characters' : type === 'scene' ? 'scenes' : 'props'
    const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(assetId) as { name: string } | undefined
    if (row) assetName = row.name
  }

  let finalPrompt = ''
  // 加载模板（如有配置），无模板回退硬编码
  const purposeKey = type === 'character' ? 'character_image' : type === 'scene' ? 'scene_image' : 'prop_image'
  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  let tplId = input.templateId || (projectConfig[purposeKey] as any)?.templateId
  // 未配置模板时，自动使用官方默认模板
  if (!tplId) {
    const defaultTplMap: Record<string, string> = {
      character_image: 'official-v1-character-image',
      scene_image: 'official-v1-scene-image',
      prop_image: 'official-v1-prop-image'
    }
    tplId = defaultTplMap[purposeKey]
  }
  let tplUsed = false
  if (tplId) {
    try {
      const tpl = db.prepare('SELECT content, template_version FROM prompt_templates WHERE id = ?').get(tplId) as any
      if (tpl?.content) {
        let tp = tpl.template_version === 'v1' ? (() => { try { const p = JSON.parse(tpl.content); return p.english || p.chinese || '' } catch { return '' } })() : tpl.content
        if (tp) {
          const stylePromptEn = getStylePrompt(project.style_name, finalStylePrompt)
          const stylePromptZh = getStylePromptZh(project.style_name, finalStylePrompt)
          logger.info(`[generateImage] Style: name="${project.style_name}" finalStylePrompt="${finalStylePrompt.slice(0,80)}" → en="${stylePromptEn.slice(0,60)}..."`)
          tp = applyTemplate(tp, {
            character_name: assetName || description,
            character_description: description,
            character_appearance_prompt: description,
            scene_name: assetName || description,
            scene_description: (() => { try { const j = JSON.parse(description); return j.environment || j.description || description } catch { return description } })(),
            scene_prompt: (() => { try { const j = JSON.parse(description); return j.environment || j.description || description } catch { return description } })(),
            prop_name: assetName || description,
            prop_description: description,
            prop_prompt: description,
            style_prompt: stylePromptEn,
            style_prompt_zh: stylePromptZh,
            style_name: project.style_name || '',
            era: finalEraPrompt,
            era_zh: project.era || '',
          })
          if (tp.trim()) { finalPrompt = tp.trim(); tplUsed = true }

          // 非人类角色：移除以人种约束为核心的整段（根据 character_type 字段判断）
          if (tplUsed && type === 'character') {
            const charRow = db.prepare('SELECT character_type FROM characters WHERE id = ?').get(assetId) as { character_type?: string } | undefined
            const isNonHuman = charRow?.character_type === 'non_human'
            if (isNonHuman) {
              finalPrompt = finalPrompt.replace(/\[ETHNICITY[\s\S]*?(?=\[Task\]|\[Composition\]|$)/gi, '')
              finalPrompt = finalPrompt.replace(/\[人种约束[^\]]*\][\s\S]*?(?=\[任务\]|\[构图\]|$)/gi, '')
              logger.info('[generateImage] Non-human character (character_type=non_human), ethnicity constraint removed')
            }
          }
        }
      }
    } catch { /* keep default */ }
  }
  if (!tplUsed) {
    if (type === 'character') {
      finalPrompt = [
        `CRITICAL: EXACTLY THREE panels — NOT two, NOT four, NOT six. The output must contain precisely 3 character views arranged in two columns.`,
        `[Image-to-Image] Preserve the reference image's three-panel layout (two-column, left column split top/bottom) and white background, but REPLACE the character. Do NOT copy the reference character.`,
        `[Subject] ${description}`,
        `[Background] Pure white seamless background, thin gray lines separating three panels, uniform spacing, NO overlap`,
        `[Style] ${styleDesc}${finalEraPrompt ? ', ' + finalEraPrompt : ''}`,
        `[Lighting] Professional studio lighting, soft key light, even illumination, no harsh shadows`,
        `[Composition] Two-column layout, equal width, thin gray vertical divider — Left column split top/bottom by thin gray horizontal divider: Top-Left (Upper Body Front, chest up): facing camera, facial features, expression, hair; Bottom-Left (45° Half-Body, waist up): body turned 45°, side face contour, upper body posture. Right column single tall panel (Full Body Front): standing upright, realistic adult proportions (7-8 head heights), natural shoulder width, defined waist, natural hip curve, feet grounded at bottom, complete outfit and silhouette. All three panels equal width, no overlap, uniform spacing`,
        `[Quality] ${aspectHint} aspect ratio, PHOTOREALISTIC STYLE — absolutely NOT anime, NOT cartoon, NOT illustration, NOT cel-shaded, NOT 2D. Must look like a real photograph taken with a professional camera. Realistic adult anatomy with natural body proportions (NOT compressed or stubby), defined waist-hip curve (NOT flat/straight silhouette), identical clothing design across all 3 panels, consistent character identity, uniform studio lighting, equal panel spacing`
      ].join('\n')
    } else if (type === 'scene') {
      finalPrompt = [
        `[Subject] ${description}`,
        `[Task] Generate a scene four-quadrant modular visual analysis board on pure white background with thin gray dividing lines.`,
        `[Composition — FOUR-QUADRANT 2×2 GRID] Top-left: panoramic establishing shot. Top-right: line art structural diagram with 4-5 hex color palette strip. Bottom-left: MATERIAL REFERENCE BOARD — ground surface, wall/object texture close-ups, decorative details displayed side by side. Bottom-right: LIGHTING DIRECTION DIAGRAM — simplified mini cross-section profile with directional arrows for light source and shadow cast, plus a warm-to-cool color temperature gradient bar.`,
        `[Style] ${styleDesc}${finalEraPrompt ? ', ' + finalEraPrompt : ''}`,
        `[Quality] Absolutely NO people. Pure white background, modular grid layout, professional visual reference board aesthetic, no narrative content, only style signal transmission. No text, no labels.`
      ].join('\n')
    } else {
    // props 道具：模板替换变量
    let basePrompt = description
    if (templateId) {
      try {
        const tpl = db.prepare('SELECT content, template_version FROM prompt_templates WHERE id = ?').get(templateId) as any
        if (tpl?.content) {
          let tp = tpl.template_version === 'v1' ? (() => { try { const p = JSON.parse(tpl.content); return p.english || p.chinese || '' } catch { return '' } })() : tpl.content
          if (tp) {
            tp = tp.replace(/\{\{prop_name\}\}/g, description)
              .replace(/\{\{prop_description\}\}/g, description)
              .replace(/\{\{prop_prompt\}\}/g, description)
              .replace(/\{\{style_prompt\}\}/g, finalStylePrompt)
              .replace(/\{\{style_name\}\}/g, project.style_name || '')
              .replace(/\{\{era\}\}/g, finalEraPrompt)
              .replace(/\{\{[^}]+\}\}/g, '')
            basePrompt = tp.trim() || basePrompt
          }
        }
      } catch { /* ignore */ }
    }
    finalPrompt = [basePrompt, finalStylePrompt, finalEraPrompt].filter((s) => s.trim()).join(', ')
    }
  }

  // 场景：强制禁止人物——放在 prompt 最前面以提升模型遵循度
  if (type === 'scene') {
    finalPrompt = 'CRITICAL: This is a PURE ENVIRONMENT image. ABSOLUTELY NO people, characters, humans, figures, silhouettes, animals, or any living creatures anywhere. Empty architecture/interior/landscape only.\n\n' + finalPrompt
  }

  // 日志：确认使用的提示词来源和内容
  logger.info(`[generateImage] type=${type} tplUsed=${tplUsed} tplId=${tplId || 'none'}`)
  // 内容安全过滤
  const { text: safeFinalPrompt, count: safeCount } = sanitizePromptContent(finalPrompt, project.era)
  if (safeCount > 0) { logger.info(`[generateImage] Content sanitized: ${safeCount} word replacements`); finalPrompt = safeFinalPrompt }

  logger.info(`[generateImage] FINAL PROMPT:\n${finalPrompt.slice(0, 600)}${finalPrompt.length > 600 ? '...' : ''}`)

  // 3. 解析模型配置（四级降级）— 复用上方 purposeKey 和 projectConfig
  const { model, channel, apiKey } = resolveModelConfig(purposeKey, projectConfig, inputModel, inputChannel, inputApiKey)

  // 5. 提前校验 API Key 和模型（避免无效任务记录）
  if (!apiKey) {
    throw new Error('未配置 API Key，请在设置页配置供应商')
  }
  if (!model) {
    throw new Error('未配置生图模型，请在模型配置中选择')
  }

  // 6. 创建或复用 generation_tasks 记录
  const purpose = type === 'character' ? 'character_reference' : type === 'scene' ? 'scene_reference' : 'prop_reference'
  let taskId: string
  if (inputTaskId) {
    taskId = inputTaskId
    db.prepare(
      `UPDATE generation_tasks SET model = COALESCE(?, model), channel = COALESCE(?, channel), updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(model || null, channel || null, taskId)
  } else {
    taskId = randomUUID()
    db.prepare(
      `
      INSERT INTO generation_tasks (
        id, project_id, shot_id, type, purpose, channel, model, status,
        input_params, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `
    ).run(
      taskId,
      projectId,
      null,
      'image',
      purpose,
      channel || null,
      model || null,
      JSON.stringify({ assetId, count, description })
    )
  }

  // 7. 更新状态为 running，设置 started_at
  db.prepare(
    `UPDATE generation_tasks SET status = 'running', started_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(taskId)

  try {
    // 8. 收集参考图：优先 source_url（公网URL），无边界AI不支持 base64
    const refImages: string[] = []
    if (input.refImage) {
      try { if (existsSync(input.refImage)) refImages.push(input.refImage) } catch {}
    }
    if (refImages.length === 0 && (type === 'character' || type === 'scene' || type === 'prop')) {
      const historyTable = type === 'character' ? 'character_images' : type === 'scene' ? 'scene_images' : 'prop_images'
      const idCol = type === 'character' ? 'character_id' : type === 'scene' ? 'scene_id' : 'prop_id'
      // 优先从历史表取 source_url
      const histRow = db.prepare(`SELECT source_url FROM ${historyTable} WHERE ${idCol} = ? AND source_url IS NOT NULL AND source_url != '' ORDER BY created_at DESC LIMIT 1`).get(assetId) as { source_url?: string } | undefined
      if (histRow?.source_url) {
        refImages.push(histRow.source_url)
      }
    }

    // 8.5 画面比例 → API size 参数
    const size = getAPISize(aspectRatio)

    // 9. 调用生图 API
    const negPrompt = type === 'scene'
      ? 'people, characters, humans, figures, silhouettes, animals, text, labels, split panels, wrong perspective, inconsistent vanishing point, distorted object scaling, merged furniture, floating objects, flat lighting, cartoon, illustration, anime'
      : type === 'character'
        ? 'wrong anatomy, wrong head-body ratio, flat body silhouette, distorted proportions, extra limbs, missing limbs, fused body parts, wrong hand size, wrong face size, cartoon, illustration, anime, cel-shaded, 2D, European face, Caucasian face, Western face, deep eye sockets, protruding nose bridge, blonde hair, light hair, pale pink skin tone, round eye shape without epicanthic fold'
        : 'cartoon, illustration, anime, wrong proportions, text, labels'
    const abortCtrl = new AbortController()
    registerTaskController(taskId, abortCtrl)
    const assetTraceStart = Date.now()
    let imageUrls: string[] = []
    try {
      imageUrls = await callImageGenerationAPI(finalPrompt, model, apiKey, channel, refImages, size, negPrompt, abortCtrl.signal)
    } finally {
      deregisterTaskController(taskId)
    }
    writeTrace(project.path, {
      ts: new Date().toISOString(),
      type: type === 'character' ? 'asset' : 'asset',
      assetId,
      model,
      channel: channel || '',
      promptLength: finalPrompt.length,
      promptFirst: finalPrompt.slice(0, 200),
      refImageCount: 0,
      imageCount: imageUrls.length,
      durationMs: Date.now() - assetTraceStart
    })

    // 9. 下载并保存图片
    const imageDir = join(project.path, 'assets', 'images', `${type}s`)
    const savedImages = await saveGeneratedImages(imageUrls, imageDir, assetId)
    const imagePaths = savedImages.map(s => s.localPath)

    // 10. 写入历史表，新图自动选中（is_selected=1），旧图取消选中
    const tableMap: Record<string, string> = {
      character: 'character_images',
      scene: 'scene_images',
      prop: 'prop_images'
    }
    const historyTable = tableMap[type]
    const idColumn = type === 'character' ? 'character_id' : type === 'scene' ? 'scene_id' : 'prop_id'
    assertValidTableName(historyTable)
    assertValidColumnName(idColumn)

    // 事务包裹：历史表写入 + 资产引用更新 + 锚点创建 + 任务状态，确保原子性
    const postTx = db.transaction(() => {
      // 先取消该资产所有旧图的选中状态
      db.prepare(
        `UPDATE ${historyTable} SET is_selected = 0 WHERE ${idColumn} = ?`
      ).run(assetId)

      // 插入新图记录
      for (let i = 0; i < savedImages.length; i++) {
        db.prepare(
          `INSERT INTO ${historyTable} (id, ${idColumn}, image_path, source_url, is_selected, created_at) VALUES (?, ?, ?, ?, 1, datetime('now', 'localtime'))`
        ).run(randomUUID(), assetId, savedImages[i].localPath, savedImages[i].sourceUrl || null)
      }

      // 11. 更新资产的 reference_image 为第一张新图
      const assetTableMap: Record<string, string> = {
        character: 'characters',
        scene: 'scenes',
        prop: 'props'
      }
      assertValidTableName(assetTableMap[type])
      db.prepare(
        `UPDATE ${assetTableMap[type]} SET reference_image = ? WHERE id = ?`
      ).run(savedImages[0]?.localPath, assetId)

      // 11.5 角色生图：自动存储多角度锚点（4宫格: Panel1正面特写/Panel2全身正面/Panel3半侧面/Panel4背面）
      if (type === 'character' && imagePaths.length > 0) {
        createMultiAngle(assetId, {
          front: savedImages[0]?.localPath,
          three_quarter: savedImages[0]?.localPath,
          side: savedImages[0]?.localPath,
          back: savedImages[0]?.localPath,
          generatedAt: new Date().toISOString()
        })
      }

      // 12. 更新任务状态为 completed
      db.prepare(
        `UPDATE generation_tasks SET status = 'completed', output_path = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(savedImages.map(s => s.localPath).join(','), taskId)
    })

    postTx()

    return { taskId, imagePaths }
  } catch (err: any) {
    const errorMsg = err?.message || '生图失败'
    db.prepare(
      `UPDATE generation_tasks SET status = 'failed', error_message = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(errorMsg, taskId)
    throw err
  }
}

// ===== 图片保存工具 =====

export async function saveGeneratedImages(
  imageUrls: string[],
  imageDir: string,
  filePrefix: string
): Promise<Array<{ localPath: string; sourceUrl: string }>> {
  mkdirSync(imageDir, { recursive: true })
  const results: Array<{ localPath: string; sourceUrl: string }> = []

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i]
    const fileName = `${filePrefix}_${i}_${Date.now()}.png`
    const filePath = join(imageDir, fileName)

    if (url.startsWith('data:')) {
      try {
        const base64Data = url.split(',')[1]
        if (!base64Data) { logger.error('[saveImages] Empty base64 data'); continue }
        writeFileSync(filePath, Buffer.from(base64Data, 'base64'))
        if (!existsSync(filePath)) { logger.error('[saveImages] Failed to write:', filePath); continue }
        results.push({ localPath: filePath, sourceUrl: url })
      } catch (e) { logger.error('[saveImages] Save error:', e); continue }
    } else if (url.startsWith('http')) {
      try {
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 })
        writeFileSync(filePath, Buffer.from(resp.data))
        results.push({ localPath: filePath, sourceUrl: url })
      } catch (e) {
        logger.error(`[saveImages] HTTP download failed: ${url.slice(0, 80)} ${(e as Error)?.message}`)
        continue
      }
    }
  }

  return results
}

// ===== 图片 API 调用层 =====

/**
 * 调用 OpenAI 兼容格式的 /v1/images/generations
 */
export async function callImageGenerationAPI(
  prompt: string,
  model: string,
  apiKey: string,
  channel?: string | null,
  refImages?: string[],
  size?: string | null,
  negativePrompt?: string,
  signal?: AbortSignal
): Promise<string[]> {
  await acquireSlot()
  try {
  // 千问图像编辑（DashScope，同步，有 seed）
  const providerKey = channel || (model.includes(':') ? model.split(':')[0] : '')
  const qwenModelName = model.includes(':') ? model.split(':').slice(1).join(':') : model
  const isQwenImage = providerKey === 'dashscope' && qwenModelName?.includes('qwen-image')
  if (isQwenImage) {
    logger.info('[QwenImage] Detected, delegating image generation...')
    // 把 16:9 映射为千问的 width*height 格式
    const qwenSizeMap: Record<string, string> = { '16:9':'1920*1088','9:16':'1088*1920','1:1':'1024*1024','4:3':'1536*1152','3:4':'1152*1536' }
    const qwenSize = qwenSizeMap[size || '16:9'] || '1920*1088'
    return callQwenImageAPI({ apiKey, prompt, model: qwenModelName || 'qwen-image-2.0', refImages, seed: 42, size: qwenSize })
  }

  // Apimart 异步轮询专线
  const isApimart = providerKey === 'apimart' || resolveProviderConfig(providerKey)?.baseURL?.includes('apimart.ai')
  if (isApimart) {
    logger.info('[Apimart] Detected, delegating image generation...')
    const apimartModelName = model.includes(':') ? model.split(':').slice(1).join(':') : model
    return callApimartImageAPI({ apiKey, prompt, size: size || '16:9', refImages, resolution: '1k', model: apimartModelName })
  }

  // 无边界AI 异步轮询专线
  const isWubianjie = providerKey === 'wubianjie' || resolveProviderConfig(providerKey)?.baseURL?.includes('lk888.ai')
  if (isWubianjie) {
    logger.info('[Wubianjie] Detected, delegating image generation...')
    const wbSize = size || mapWubianjieSize('16:9')
    const actualModel = model.includes(':') ? model.split(':').slice(1).join(':') : model
    const filteredRefs = (refImages || []).slice(0, 10)
    return callWubianjieImageAPI({ apiKey, prompt, size: wbSize, model: actualModel, refImages: filteredRefs, signal })
  }

  // HCC (HermesRoute) 图片专线
  const isHcc = providerKey === 'hcc' || resolveProviderConfig(providerKey)?.baseURL?.includes('hermesroute')
  if (isHcc) {
    logger.info('[HCC] Detected, delegating image generation...')
    const actualModel = model.includes(':') ? model.split(':').slice(1).join(':') : model
    return callHccImageAPI({ apiKey, prompt, size: size || '1024x1024', model: actualModel, refImages, signal })
  }

  // 解析 provider 和 modelKey
  let baseURL = ''
  let actualModel = model

  if (providerKey) {
    const resolved = resolveProviderConfig(providerKey)
    if (resolved?.baseURL) {
      baseURL = resolved.baseURL
    }
  }

  if (model.includes(':')) {
    actualModel = model.split(':').slice(1).join(':')
  }

  if (!baseURL) {
    throw new Error('无法确定 API 基础地址，请检查供应商配置')
  }

  // 自动补 /v1：去掉末尾斜杠后，如果不以 /v1 结尾则补上
  let normalizedBaseURL = baseURL.replace(/\/$/, '')
  if (!normalizedBaseURL.endsWith('/v1')) {
    normalizedBaseURL += '/v1'
  }

  let lastError = ''

  const hasMultipleRefs = (refImages?.length || 0) > 1
  const isAgnes = normalizedBaseURL.includes('agnes-ai.com')

  const resp = await withRetry(async () => {
    if (isAgnes) {
      logger.info('[Agnes] Trying images/generations (img2img)...')
      let r = await tryImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages, size, negativePrompt)
      if (!r) {
        lastError = getLastImageError()
        logger.info('[Agnes] images/generations failed, falling back to chat/completions...')
        r = await tryChatImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages, size, negativePrompt)
        if (r) { logger.info('[Agnes] chat/completions fallback OK'); return r }
        if (getLastChatError()) lastError = getLastChatError()
      } else { logger.info('[Agnes] images/generations OK'); return r }
      throw new Error(lastError || 'Agnes API 不可用')
    } else if (hasMultipleRefs) {
      const r = await tryChatImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages, size, negativePrompt)
      if (r) return r
      lastError = getLastChatError()
      throw new Error(lastError || 'chat/completions API 不可用')
    } else {
      let r = await tryImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages?.[0], size, negativePrompt)
      if (!r) {
        lastError = getLastImageError()
        r = await tryChatImageAPI(normalizedBaseURL, actualModel, prompt, apiKey, refImages, size, negativePrompt)
        if (!r) { if (getLastChatError()) lastError = getLastChatError(); throw new Error(lastError || '生图 API 不可用') }
      }
      return r
    }
  }, { maxRetries: 2 })

  const data = resp.data?.data || resp.data?.images || resp.data?.choices?.[0]?.message?.content || []
  const urls: string[] = []
  for (const item of Array.isArray(data) ? data : [data]) {
    if (typeof item === 'string') {
      // 尝试从 Markdown 格式提取 URL: ![alt](url)  支持 http 和 data: 两种
      const mdMatch = item.match(/!\[.*?\]\(((?:https?:\/\/|data:[^)]+)\S*)\)/)
      const actualUrl = mdMatch ? mdMatch[1] : item
      if (actualUrl.startsWith('data:')) urls.push(actualUrl)
      else if (actualUrl.startsWith('http')) urls.push(actualUrl)
    } else if (item.url) {
      const mdMatch2 = item.url.match(/!\[.*?\]\(((?:https?:\/\/|data:[^)]+)\S*)\)/)
      urls.push(mdMatch2 ? mdMatch2[1] : item.url)
    } else if (item.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`)
    else if (item.image_url) urls.push(item.image_url)
  }

  if (urls.length === 0) {
    throw new Error('API 返回为空或无法解析图片数据')
  }

  return urls
  } finally { releaseSlot() }
}

// tryImageAPI / tryChatImageAPI → extracted to ./imageApi.ts

// ===== 分镜首帧/尾帧生图 =====

/**
 * 生成分镜首帧/尾帧图片
 */
export async function generateAngle(
  characterId: string,
  angle: AnchorAngle
): Promise<{ imagePath: string; angle: AnchorAngle }> {
  const db = getDb()

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId) as
    | { id: string; project_id: string; name: string; description: string | null }
    | undefined
  if (!char) throw new Error(`角色不存在: ${characterId}`)

  const project = getProject(char.project_id)
  if (!project) throw new Error('项目不存在')

  const description = char.description || char.name
  const finalStylePrompt = project.style_prompt || ''
  const finalEraPrompt = mapEra(project.era || '')

  const anglePrompt = getAnglePrompt(angle, description, finalStylePrompt, finalEraPrompt)
  const size = getAngleSize(angle)

  logger.info(`[generateAngle] character=${char.name} angle=${angle} size=${size}`)

  const projectConfig = project.model_config_json ? JSON.parse(project.model_config_json) : {}
  const { model, channel, apiKey } = resolveModelConfig('character_image', projectConfig)

  if (!apiKey) throw new Error('未配置 API Key')
  if (!model) throw new Error('未配置生图模型')

  const imageUrls = await callImageGenerationAPI(anglePrompt, model, apiKey, channel, [], size)

  const imageDir = join(project.path, 'assets', 'images', 'characters')
  const savedAngles = await saveGeneratedImages(imageUrls.slice(0, 1), imageDir, `${characterId}_${angle}`)
  const filePath = savedAngles[0]?.localPath || ''

  createMultiAngle(characterId, { [angle]: filePath })

  return { imagePath: filePath, angle }
}

