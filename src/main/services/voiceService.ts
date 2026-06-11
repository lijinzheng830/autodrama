/**
 * 配音服务 — Microsoft Edge TTS（免费、无需 API Key）
 * 为分镜对白生成 MP3 配音文件
 * 支持多角色对白：按角色拆分，各用各的发音人，FFmpeg 拼接
 */
import { mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { getDb } from './db'
import { getProject } from './project'
import { randomUUID } from 'crypto'

interface VoiceConfig {
  name: string
  rate?: string     // e.g. '+10%' / '-20%' / 'default'
  pitch?: string    // e.g. '+5Hz' / '-3Hz' / 'default'
  volume?: string   // e.g. '+10%' / 'default'
}

export const VOICE_PRESETS: Record<string, VoiceConfig> = {
  // 女声
  'female-lead':      { name: 'zh-CN-XiaoxiaoNeural' },
  'female':           { name: 'zh-CN-XiaoyiNeural' },
  'female-child':     { name: 'zh-CN-XiaotongNeural' },
  'female-teen':      { name: 'zh-CN-XiaoruiNeural' },
  'female-gentle':    { name: 'zh-CN-XiaohanNeural' },
  'female-crisp':     { name: 'zh-CN-XiaoshuangNeural' },
  'female-narrative': { name: 'zh-CN-XiaoqiuNeural' },
  'female-cute':      { name: 'zh-CN-XiaomengNeural' },
  // 男声
  'male-lead':        { name: 'zh-CN-YunxiNeural' },
  'narrator':         { name: 'zh-CN-YunjianNeural' },
  'male':             { name: 'zh-CN-YunyangNeural' },
  'male-deep':        { name: 'zh-CN-YunxiaNeural' },
  'male-warm':        { name: 'zh-CN-YunchenNeural' },
  'male-bright':      { name: 'zh-CN-YunfanNeural' },
  'male-serious':     { name: 'zh-CN-YunfengNeural' },
  'male-teen':        { name: 'zh-CN-YunjieNeural' },
}

export function listVoicePresets(): { key: string; name: string; label: string }[] {
  return [
    // 女声
    { key: 'female-lead',      name: VOICE_PRESETS['female-lead'].name,      label: '女主·晓晓（温暖知性）' },
    { key: 'female',           name: VOICE_PRESETS['female'].name,           label: '女配·晓依（年轻活力）' },
    { key: 'female-child',     name: VOICE_PRESETS['female-child'].name,     label: '萝莉·晓彤（儿童声线）' },
    { key: 'female-teen',      name: VOICE_PRESETS['female-teen'].name,      label: '少女·晓睿（明亮元气）' },
    { key: 'female-gentle',    name: VOICE_PRESETS['female-gentle'].name,    label: '温柔·晓涵（软糯温柔）' },
    { key: 'female-crisp',     name: VOICE_PRESETS['female-crisp'].name,     label: '爽朗·晓双（干练利落）' },
    { key: 'female-narrative', name: VOICE_PRESETS['female-narrative'].name, label: '叙述·晓秋（沉稳叙事）' },
    { key: 'female-cute',      name: VOICE_PRESETS['female-cute'].name,      label: '萌系·晓梦（可爱甜腻）' },
    // 男声
    { key: 'male-lead',        name: VOICE_PRESETS['male-lead'].name,        label: '男主·云希（沉稳）' },
    { key: 'narrator',         name: VOICE_PRESETS['narrator'].name,         label: '旁白·云健（成熟男声）' },
    { key: 'male',             name: VOICE_PRESETS['male'].name,             label: '男配·云扬（洪亮）' },
    { key: 'male-deep',        name: VOICE_PRESETS['male-deep'].name,        label: '反派·云夏（低沉）' },
    { key: 'male-warm',        name: VOICE_PRESETS['male-warm'].name,        label: '暖男·云辰（温和亲切）' },
    { key: 'male-bright',      name: VOICE_PRESETS['male-bright'].name,      label: '阳光·云帆（充满活力）' },
    { key: 'male-serious',     name: VOICE_PRESETS['male-serious'].name,     label: '总裁·云枫（严肃专业）' },
    { key: 'male-teen',        name: VOICE_PRESETS['male-teen'].name,        label: '少年·云杰（青春少年）' },
  ]
}

/** 根据 preset key 获取 EdgeTTS 构造参数 */
function getVoiceConfig(key: string): { voice: string; rate: string; pitch: string; volume: string } {
  const cfg = VOICE_PRESETS[key] || VOICE_PRESETS['female']
  return {
    voice: cfg.name,
    rate: cfg.rate || 'default',
    pitch: cfg.pitch || 'default',
    volume: cfg.volume || 'default',
  }
}

export interface GenerateVoiceInput {
  projectId: string
  shotId: string
  text: string
  voicePreset: string
}

interface VoiceTurn {
  text: string
  voicePreset: string
}

/** 清洗括号内表演提示 */
function cleanBrackets(text: string): string {
  return text.replace(/[（(][^）)]*[）)]/g, '').trim()
}

/** 解析原始对白为角色分句——用位置切分替代正则捕获，避免多角色名被吞 */
function parseTurns(rawDialogue: string, charVoiceMap: Record<string, string>, fallbackVoice: string): VoiceTurn[] {
  const turns: VoiceTurn[] = []
  // Step 1: 找到所有 "角色名：" 的位置（仅句首或标点后，用 lookbehind 不吞标点）
  const namePattern = /(?<=^|[。！？])\s*([^。！？：:]+)[：:]/g
  const markers: Array<{ name: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = namePattern.exec(rawDialogue)) !== null) {
    markers.push({ name: m[1].trim(), start: m.index, end: m.index + m[0].length })
  }
  if (markers.length === 0) return turns

  // Step 2: 按标记切分文本
  for (let i = 0; i < markers.length; i++) {
    const textStart = markers[i].end
    const textEnd = i + 1 < markers.length ? markers[i + 1].start : rawDialogue.length
    const rawText = rawDialogue.slice(textStart, textEnd).trim()
    // 清洗括号内表演提示
    const cleaned = rawText.replace(/[（(][^）)]*[）)]/g, '').trim()
    if (!cleaned) continue
    const voicePreset = charVoiceMap[markers[i].name] || fallbackVoice
    turns.push({ text: cleaned, voicePreset })
  }
  return turns
}

/** 查找 FFmpeg 路径 */
function findFfmpeg(): string {
  const { existsSync } = require('fs') as typeof import('fs')
  const { join: pJoin } = require('path') as typeof import('path')
  const candidates = [
    pJoin(require('electron').app?.getPath('exe') || '', '..', 'resources', 'ffmpeg', 'ffmpeg.exe'),
    pJoin(__dirname, '..', '..', 'resources', 'ffmpeg', 'ffmpeg.exe'),
    'ffmpeg', 'ffmpeg.exe',
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  throw new Error('FFmpeg 未找到')
}

/**
 * 为单个分镜生成配音（支持多角色对白）
 * 返回: 音频文件路径
 */
export async function generateVoice(input: GenerateVoiceInput): Promise<string> {
  const { projectId, shotId, text, voicePreset } = input

  if (!text || !text.trim()) throw new Error(`分镜 ${shotId} 对白为空，跳过`)

  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const audioDir = join(project.path, 'assets', 'audio')
  mkdirSync(audioDir, { recursive: true })

  const { EdgeTTS } = await import('node-edge-tts')
  const db = getDb()
  const fallbackCfg = getVoiceConfig(voicePreset || 'female')

  console.log(`[voice] shot=${shotId.slice(0,8)} voicePreset=${voicePreset} voiceName=${fallbackCfg.voice} textLen=${text.length}`)

  // 检查是否多角色：文本中是否有 "角色名：" 模式
  const hasCharPrefix = /(?<=^|[。！？])\s*[^。！？：:]+[：:]/.test(text)
  console.log(`[voice] hasCharPrefix=${hasCharPrefix} textFirst=${text.slice(0, 60)}`)

  if (!hasCharPrefix) {
    // 单角色 / 已清洗文本 → 直接生成
    const outputPath = join(audioDir, `${shotId}.mp3`)
    const cleanText = cleanBrackets(text)
    console.log(`[voice] single-voice → ${fallbackCfg.voice} rate=${fallbackCfg.rate} text="${cleanText.slice(0, 50)}"`)
    const tts = new EdgeTTS({ voice: fallbackCfg.voice, lang: 'zh-CN', rate: fallbackCfg.rate, pitch: fallbackCfg.pitch, volume: fallbackCfg.volume })
    await tts.ttsPromise(cleanText, outputPath)
    db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
    return outputPath
  }

  // 多角色对白 → 按角色拆分生成 → FFmpeg 拼接
  // 查项目中所有角色（不限当前分镜关联），用名字匹配对白中的角色名
  const allChars = db.prepare('SELECT name, voice_preset FROM characters WHERE project_id = (SELECT project_id FROM shots WHERE id = ?)').all(shotId) as Array<{ name: string; voice_preset: string | null }>
  const charVoiceMap: Record<string, string> = {}
  for (const c of allChars) {
    if (c.voice_preset) charVoiceMap[c.name] = c.voice_preset
  }
  console.log(`[voice] charVoiceMap keys:`, Object.keys(charVoiceMap).join(', '))
  const turns = parseTurns(text, charVoiceMap, voicePreset || 'female')
  console.log(`[voice] turns=${turns.length}:`, turns.map(t => `${t.voicePreset}→"${t.text.slice(0, 30)}"`).join(' | '))
  if (turns.length === 0) {
    // 解析失败，回退到单语音（清洗后）
    const outputPath = join(audioDir, `${shotId}.mp3`)
    const cleanText = cleanBrackets(text)
    console.log(`[voice] parseTurns返回0 → fallback single-voice`)
    const tts = new EdgeTTS({ voice: fallbackCfg.voice, lang: 'zh-CN', rate: fallbackCfg.rate, pitch: fallbackCfg.pitch, volume: fallbackCfg.volume })
    await tts.ttsPromise(cleanText, outputPath)
    db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
    return outputPath
  }

  // 逐句生成
  const tempFiles: string[] = []
  for (const turn of turns) {
    const tmpPath = join(audioDir, `${shotId}_tmp_${randomUUID().slice(0, 8)}.mp3`)
    const cfg = getVoiceConfig(turn.voicePreset)
    const tts = new EdgeTTS({ voice: cfg.voice, lang: 'zh-CN', rate: cfg.rate, pitch: cfg.pitch, volume: cfg.volume })
    await tts.ttsPromise(turn.text, tmpPath)
    tempFiles.push(tmpPath)
  }

  // FFmpeg 拼接
  const outputPath = join(audioDir, `${shotId}.mp3`)
  if (tempFiles.length === 1) {
    const { renameSync } = require('fs') as typeof import('fs')
    renameSync(tempFiles[0], outputPath)
  } else {
    // 构建 concat file list
    const listPath = join(audioDir, `${shotId}_concat.txt`)
    const lines = tempFiles.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    writeFileSync(listPath, lines.join('\n'), 'utf8')
    try {
      execFileSync(findFfmpeg(), [
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy', '-y', outputPath
      ], { timeout: 60000, stdio: 'pipe' })
    } catch {
      // concat demuxer 失败时回退到 concat filter
      const inputs: string[] = []
      const filters: string[] = []
      for (let i = 0; i < tempFiles.length; i++) {
        inputs.push('-i', tempFiles[i])
        filters.push(`[${i}:a:0]`)
      }
      execFileSync(findFfmpeg(), [
        ...inputs,
        '-filter_complex', `${filters.join('')}concat=n=${tempFiles.length}:v=0:a=1[out]`,
        '-map', '[out]', '-y', outputPath
      ], { timeout: 60000, stdio: 'pipe' })
    }
    // 清理
    for (const f of tempFiles) { try { unlinkSync(f) } catch {} }
    try { unlinkSync(listPath) } catch {}
  }

  db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
  return outputPath
}

/**
 * 批量生成配音 — 并行，单条失败不影响其他
 */
export async function batchGenerateVoices(
  inputs: GenerateVoiceInput[]
): Promise<Record<string, string>> {
  const results: Record<string, string> = {}
  const settled = await Promise.allSettled(
    inputs.map(async (input) => {
      const path = await generateVoice(input)
      return { shotId: input.shotId, path }
    })
  )
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      results[r.value.shotId] = r.value.path
    } else {
      console.error('[voice] 失败:', r.reason?.message || r.reason)
    }
  }
  return results
}
