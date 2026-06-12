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

// Edge TTS express-as 风格映射: 中文情绪词 → Edge TTS style
const EMOTION_STYLE_MAP: Record<string, string> = {
  // gentle 系
  '温柔': 'gentle', '轻柔': 'gentle', '软糯': 'gentle', '空灵': 'gentle',
  '微笑': 'gentle', '浅笑': 'gentle', '轻笑': 'gentle', '含笑': 'gentle',
  '深情': 'gentle', '柔和': 'gentle', '温暖': 'gentle',
  // cheerful 系
  '快乐': 'cheerful', '欢快': 'cheerful', '高兴': 'cheerful', '开心': 'cheerful',
  '大笑': 'cheerful', '笑': 'cheerful',
  // sad 系
  '悲伤': 'sad', '忧郁': 'sad', '伤感': 'sad', '低落': 'sad',
  '叹息': 'sad', '叹气': 'sad', '苦笑': 'sad', '哭': 'sad', '流泪': 'sad', '抽泣': 'sad',
  '无奈': 'sad', '沉重': 'sad', '难过': 'sad',
  // angry 系
  '愤怒': 'angry', '生气': 'angry', '怒吼': 'angry', '厉声': 'angry',
  // excited 系
  '兴奋': 'excited', '激动': 'excited', '热烈': 'excited', '惊喜': 'excited',
  // fearful 系
  '恐惧': 'fearful', '害怕': 'fearful', '惊恐': 'terrified', '紧张': 'fearful', '不安': 'fearful',
  // disappointed
  '失望': 'disappointed', '失落': 'disappointed',
  // whispering
  '低语': 'whispering', '轻声': 'whispering', '耳语': 'whispering', '喃喃': 'whispering',
  // hopeful
  '希望': 'hopeful', '憧憬': 'hopeful',
  // friendly
  '友好': 'friendly', '亲切': 'friendly',
  // lyrical
  '抒情': 'lyrical', '诗意': 'lyrical',
  // calm / neutral
  '冷静': 'calm', '平静': 'calm', '淡淡': 'calm', '淡淡地': 'calm',
  '严肃': 'calm', '冷漠': 'calm', '冷淡': 'calm',
  '坚定': 'calm', '坚决': 'calm',
  '中立': 'neutral', '默认': 'neutral',
  '疲惫': 'calm', '疲倦': 'calm',
  '疑惑': 'calm', '困惑': 'calm',
}

/** 剥离前缀标签——TTS 只朗读内容，不读 "旁白：""林小薇的内心独白：" 等标签 */
function stripPrefix(text: string): string {
  return text
    .replace(/^旁白[：:]\s*/, '')
    .replace(/^[^：:]+\s*的内心独白[：:]\s*/, '')
    .replace(/^[^：:]+[：:]\s*/, '')
}

function extractEmotion(text: string): { cleanText: string; style?: string } {
  const m = text.match(/[（(]([^）)]+)[）)]/)
  if (!m) return { cleanText: text }
  const word = m[1]
  if (EMOTION_STYLE_MAP[word]) return { cleanText: text.slice(m.index! + m[0].length).trim(), style: EMOTION_STYLE_MAP[word] }
  for (const [cn, en] of Object.entries(EMOTION_STYLE_MAP)) {
    if (word.includes(cn) || cn.includes(word)) return { cleanText: text.slice(m.index! + m[0].length).trim(), style: en }
  }
  return { cleanText: text.slice(m.index! + m[0].length).trim() }
}

interface VoiceConfig {
  name: string
  rate?: string
  pitch?: string
  volume?: string
}

export const VOICE_PRESETS: Record<string, VoiceConfig> = {
  // 女声 — zh-CN-XiaoxiaoNeural（女主音）
  'female-lead':      { name: 'zh-CN-XiaoxiaoNeural' },
  'inner-voice':      { name: 'zh-CN-XiaoxiaoNeural' },
  'female-gentle':    { name: 'zh-CN-XiaoxiaoNeural', pitch: '+10Hz' },
  'female-narrative': { name: 'zh-CN-XiaoxiaoNeural', pitch: '-10Hz', rate: '+10%' },
  'female-teen':      { name: 'zh-CN-XiaoxiaoNeural', pitch: '+15Hz', rate: '+10%' },
  'female-cute':      { name: 'zh-CN-XiaoxiaoNeural', pitch: '+20Hz', rate: '+20%' },

  // 女声 — zh-CN-XiaoyiNeural（萝莉音）
  'female':           { name: 'zh-CN-XiaoyiNeural' },
  'female-child':     { name: 'zh-CN-XiaoyiNeural', pitch: '+10Hz' },
  'female-crisp':     { name: 'zh-CN-XiaoyiNeural', rate: '+10%' },

  // 男声 — zh-CN-YunxiNeural（少年音）
  'male-lead':        { name: 'zh-CN-YunxiNeural' },
  'male-warm':        { name: 'zh-CN-YunxiNeural', pitch: '-5Hz' },
  'male-bright':      { name: 'zh-CN-YunxiNeural', pitch: '+5Hz', rate: '+10%' },
  'male-teen':        { name: 'zh-CN-YunxiNeural', pitch: '+10Hz', rate: '+15%' },

  // 男声 — zh-CN-YunjianNeural（中年男音）
  'narrator':         { name: 'zh-CN-YunjianNeural' },
  'narrator-calm':    { name: 'zh-CN-YunjianNeural', pitch: '-10Hz' },

  // 男声 — zh-CN-YunyangNeural（正常男音）
  'male':             { name: 'zh-CN-YunyangNeural' },
  'male-serious':     { name: 'zh-CN-YunyangNeural', pitch: '-10Hz' },
  'male-sly':         { name: 'zh-CN-YunyangNeural', pitch: '+10Hz' },

  // 男声 — zh-CN-YunxiaNeural（正太音）
  'male-deep':        { name: 'zh-CN-YunxiaNeural' },
  'male-young':       { name: 'zh-CN-YunxiaNeural', pitch: '+10Hz', rate: '+10%' },
}

export function listVoicePresets(): { key: string; name: string; label: string }[] {
  return [
    // 女声 — zh-CN-XiaoxiaoNeural（女主音）
    { key: 'female-lead',      name: 'zh-CN-XiaoxiaoNeural', label: '女主·女性（温暖知性）' },
    { key: 'inner-voice',      name: 'zh-CN-XiaoxiaoNeural', label: '内心独白·女性（轻声）' },
    { key: 'female-gentle',    name: 'zh-CN-XiaoxiaoNeural', label: '温柔·女性（软糯温柔）' },
    { key: 'female-narrative', name: 'zh-CN-XiaoxiaoNeural', label: '叙述·女性（沉稳叙事）' },
    { key: 'female-teen',      name: 'zh-CN-XiaoxiaoNeural', label: '少女·女性（明亮元气）' },
    { key: 'female-cute',      name: 'zh-CN-XiaoxiaoNeural', label: '萌系·女性（活泼可爱）' },
    // 女声 — zh-CN-XiaoyiNeural（萝莉音）
    { key: 'female',           name: 'zh-CN-XiaoyiNeural',  label: '女配·女性（年轻活力）' },
    { key: 'female-child',     name: 'zh-CN-XiaoyiNeural',  label: '萝莉·女性（儿童声线）' },
    { key: 'female-crisp',     name: 'zh-CN-XiaoyiNeural',  label: '爽朗·女性（干练利落）' },
    // 男声 — zh-CN-YunxiNeural（少年音）
    { key: 'male-lead',        name: 'zh-CN-YunxiNeural',   label: '男主·男性（沉稳）' },
    { key: 'male-warm',        name: 'zh-CN-YunxiNeural',   label: '温暖·男性（温柔男声）' },
    { key: 'male-bright',      name: 'zh-CN-YunxiNeural',   label: '明亮·男性（阳光青年）' },
    { key: 'male-teen',        name: 'zh-CN-YunxiNeural',   label: '少年·男性（活泼）' },
    // 男声 — zh-CN-YunjianNeural（中年男音）
    { key: 'narrator',         name: 'zh-CN-YunjianNeural', label: '旁白·男性（成熟男声）' },
    { key: 'narrator-calm',    name: 'zh-CN-YunjianNeural', label: '沉稳旁白·男性（低沉）' },
    // 男声 — zh-CN-YunyangNeural（正常男音）
    { key: 'male',             name: 'zh-CN-YunyangNeural', label: '男配·男性（洪亮）' },
    { key: 'male-serious',     name: 'zh-CN-YunyangNeural', label: '严肃·男性（沉稳）' },
    { key: 'male-sly',         name: 'zh-CN-YunyangNeural', label: '奸诈·男性（阴险）' },
    // 男声 — zh-CN-YunxiaNeural（正太音）
    { key: 'male-deep',        name: 'zh-CN-YunxiaNeural',  label: '反派·男性（低沉）' },
    { key: 'male-young',       name: 'zh-CN-YunxiaNeural',  label: '正太·男性（活泼）' },
  ]
}

/** 根据 preset key 获取 EdgeTTS 构造参数 */
function getVoiceConfig(key: string): { voice: string; rate: string; pitch: string; volume: string; style: string } {
  const cfg = VOICE_PRESETS[key] || VOICE_PRESETS['female']
  return {
    voice: cfg.name,
    rate: cfg.rate || 'default',
    pitch: cfg.pitch || 'default',
    volume: cfg.volume || 'default',
    style: 'neutral',
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

/** 解析原始对白为角色分句——用位置切分替代正则捕获，避免多角色名被吞 */
function parseTurns(rawDialogue: string, charVoiceMap: Record<string, string>, fallbackVoice: string): VoiceTurn[] {
  // 非角色名冒号前缀——后缀通配替代精确枚举
  const isNonCharName = (n: string): boolean => {
    const exact = new Set(['系统', '画外音', '机械音', '背景音', '紧急', '危险'])
    if (exact.has(n)) return true
    return n.endsWith('警告') || n.endsWith('提示') || n.endsWith('通知')
      || n.endsWith('广播') || n.endsWith('播报') || n.endsWith('公告')
      || n.endsWith('信息') || n.endsWith('警报')
  }
  const turns: VoiceTurn[] = []
  const namePattern = /(?<=^|[。！？])\s*([^。！？：:]+)[：:]/g
  const markers: Array<{ name: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = namePattern.exec(rawDialogue)) !== null) {
    const name = m[1].trim()
    if (!isNonCharName(name)) markers.push({ name, start: m.index, end: m.index + m[0].length })
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
    const { cleanText: emoText } = extractEmotion(text)
    const cleanText = stripPrefix(emoText)
    console.log(`[voice] single-voice → ${fallbackCfg.voice} rate=${fallbackCfg.rate} pitch=${fallbackCfg.pitch} text="${cleanText.slice(0, 50)}"`)
    const tts = new EdgeTTS({ voice: fallbackCfg.voice, lang: 'zh-CN', rate: fallbackCfg.rate, pitch: fallbackCfg.pitch, volume: fallbackCfg.volume, timeout: 60000, style: 'neutral' })
    try {
      await tts.ttsPromise(cleanText, outputPath)
      db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
      return outputPath
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[voice] single-voice 失败 (${voicePreset}): ${errMsg}`)
      const e = errMsg === 'Timed out' ? new Error(`shot ${shotId} TTS 超时`) : (err instanceof Error ? err : new Error(String(err)))
      throw e
    }
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
    const { cleanText: emoText } = extractEmotion(text)
    const cleanText = stripPrefix(emoText)
    console.log(`[voice] parseTurns返回0 → fallback rate=${fallbackCfg.rate} pitch=${fallbackCfg.pitch}`)
    const tts = new EdgeTTS({ voice: fallbackCfg.voice, lang: 'zh-CN', rate: fallbackCfg.rate, pitch: fallbackCfg.pitch, volume: fallbackCfg.volume, timeout: 60000, style: 'neutral' })
    try {
      await tts.ttsPromise(cleanText, outputPath)
      db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
      return outputPath
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[voice] parseTurns-fallback 失败 (${voicePreset}): ${errMsg}`)
      throw err
    }
  }

  // 逐句生成——单句 15s 超时，失败不阻断后续 turn
  const tempFiles: string[] = []
  for (const [i, turn] of turns.entries()) {
    const tmpPath = join(audioDir, `${shotId}_tmp_${randomUUID().slice(0, 8)}.mp3`)
    const cfg = getVoiceConfig(turn.voicePreset)
    const cleanTurnText = stripPrefix(turn.text)
    const t0 = Date.now()
    try {
      const tts = new EdgeTTS({ voice: cfg.voice, lang: 'zh-CN', rate: cfg.rate, pitch: cfg.pitch, volume: cfg.volume, timeout: 60000, style: 'neutral' })
      await tts.ttsPromise(cleanTurnText, tmpPath)
      tempFiles.push(tmpPath)
      console.log(`[voice] turn ${i + 1}/${turns.length} done in ${Date.now() - t0}ms`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[voice] turn ${i + 1}/${turns.length} 失败 (${turn.voicePreset}): ${errMsg}`)
    }
  }

  if (tempFiles.length === 0) throw new Error(`shot ${shotId} 所有 turn 均生成失败`)

  // FFmpeg 拼接
  const outputPath = join(audioDir, `${shotId}.mp3`)
  const listPath = join(audioDir, `${shotId}_concat.txt`)
  try {
    if (tempFiles.length === 1) {
      const { renameSync } = require('fs') as typeof import('fs')
      renameSync(tempFiles[0], outputPath)
    } else {
      const lines = tempFiles.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      writeFileSync(listPath, lines.join('\n'), 'utf8')
      try {
        execFileSync(findFfmpeg(), [
          '-f', 'concat', '-safe', '0', '-i', listPath,
          '-c', 'copy', '-y', outputPath
        ], { timeout: 120000, stdio: 'pipe' })
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
        ], { timeout: 120000, stdio: 'pipe' })
      }
    }
    db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
    return outputPath
  } finally {
    for (const f of tempFiles) { try { unlinkSync(f) } catch {} }
    try { unlinkSync(listPath) } catch {}
  }
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
      const batchErr = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.error('[voice] 失败:', batchErr)
    }
  }
  return results
}
