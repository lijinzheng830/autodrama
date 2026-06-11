/**
 * 閰嶉煶鏈嶅姟 鈥?Microsoft Edge TTS锛堝厤璐广€佹棤闇€ API Key锛? * 涓哄垎闀滃鐧界敓鎴?MP3 閰嶉煶鏂囦欢
 * 鏀寔澶氳鑹插鐧斤細鎸夎鑹叉媶鍒嗭紝鍚勭敤鍚勭殑鍙戦煶浜猴紝FFmpeg 鎷兼帴
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
  // 濂冲０
  'female-lead':      { name: 'zh-CN-XiaoxiaoNeural' },
  'female':           { name: 'zh-CN-XiaoyiNeural' },
  'female-child':     { name: 'zh-CN-XiaotongNeural' },
  'female-teen':      { name: 'zh-CN-XiaoruiNeural' },
  'female-gentle':    { name: 'zh-CN-XiaohanNeural' },
  'female-crisp':     { name: 'zh-CN-XiaoshuangNeural' },
  'female-narrative': { name: 'zh-CN-XiaoqiuNeural' },
  'female-cute':      { name: 'zh-CN-XiaomengNeural' },
  // 鐢峰０
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
    // 濂冲０
    { key: 'female-lead',      name: VOICE_PRESETS['female-lead'].name,      label: '濂充富路鏅撴檽锛堟俯鏆栫煡鎬э級' },
    { key: 'female',           name: VOICE_PRESETS['female'].name,           label: '濂抽厤路鏅撲緷锛堝勾杞绘椿鍔涳級' },
    { key: 'female-child',     name: VOICE_PRESETS['female-child'].name,     label: '钀濊帀路鏅撳饯锛堝効绔ュ０绾匡級' },
    { key: 'female-teen',      name: VOICE_PRESETS['female-teen'].name,      label: '灏戝コ路鏅撶澘锛堟槑浜厓姘旓級' },
    { key: 'female-gentle',    name: VOICE_PRESETS['female-gentle'].name,    label: '娓╂煍路鏅撴兜锛堣蒋绯俯鏌旓級' },
    { key: 'female-crisp',     name: VOICE_PRESETS['female-crisp'].name,     label: '鐖芥湕路鏅撳弻锛堝共缁冨埄钀斤級' },
    { key: 'female-narrative', name: VOICE_PRESETS['female-narrative'].name, label: '鍙欒堪路鏅撶锛堟矇绋冲彊浜嬶級' },
    { key: 'female-cute',      name: VOICE_PRESETS['female-cute'].name,      label: '钀岀郴路鏅撴ⅵ锛堝彲鐖辩敎鑵伙級' },
    // 鐢峰０
    { key: 'male-lead',        name: VOICE_PRESETS['male-lead'].name,        label: '鐢蜂富路浜戝笇锛堟矇绋筹級' },
    { key: 'narrator',         name: VOICE_PRESETS['narrator'].name,         label: '鏃佺櫧路浜戝仴锛堟垚鐔熺敺澹帮級' },
    { key: 'male',             name: VOICE_PRESETS['male'].name,             label: '鐢烽厤路浜戞壃锛堟椽浜級' },
    { key: 'male-deep',        name: VOICE_PRESETS['male-deep'].name,        label: '鍙嶆淳路浜戝锛堜綆娌夛級' },
    { key: 'male-warm',        name: VOICE_PRESETS['male-warm'].name,        label: '鏆栫敺路浜戣景锛堟俯鍜屼翰鍒囷級' },
    { key: 'male-bright',      name: VOICE_PRESETS['male-bright'].name,      label: '闃冲厜路浜戝竼锛堝厖婊℃椿鍔涳級' },
    { key: 'male-serious',     name: VOICE_PRESETS['male-serious'].name,     label: '鎬昏路浜戞灚锛堜弗鑲冧笓涓氾級' },
    { key: 'male-teen',        name: VOICE_PRESETS['male-teen'].name,        label: '灏戝勾路浜戞澃锛堥潚鏄ュ皯骞达級' },
  ]
}

/** 鏍规嵁 preset key 鑾峰彇 EdgeTTS 鏋勯€犲弬鏁?*/
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

/** 娓呮礂鎷彿鍐呰〃婕旀彁绀?*/
function cleanBrackets(text: string): string {
  return text.replace(/[锛?][^锛?]*[锛?]/g, '').trim()
}

/** 瑙ｆ瀽鍘熷瀵圭櫧涓鸿鑹插垎鍙モ€斺€旂敤浣嶇疆鍒囧垎鏇夸唬姝ｅ垯鎹曡幏锛岄伩鍏嶅瑙掕壊鍚嶈鍚?*/
function parseTurns(rawDialogue: string, charVoiceMap: Record<string, string>, fallbackVoice: string): VoiceTurn[] {
  const turns: VoiceTurn[] = []
  // Step 1: 鎵惧埌鎵€鏈?"瑙掕壊鍚嶏細" 鐨勪綅缃紙浠呭彞棣栨垨鏍囩偣鍚庯紝鐢?lookbehind 涓嶅悶鏍囩偣锛?  const namePattern = /(?<=^|[銆傦紒锛焆)\s*([^銆傦紒锛燂細:]+)[锛?]/g
  const markers: Array<{ name: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = namePattern.exec(rawDialogue)) !== null) {
    markers.push({ name: m[1].trim(), start: m.index, end: m.index + m[0].length })
  }
  if (markers.length === 0) return turns

  // Step 2: 鎸夋爣璁板垏鍒嗘枃鏈?  for (let i = 0; i < markers.length; i++) {
    const textStart = markers[i].end
    const textEnd = i + 1 < markers.length ? markers[i + 1].start : rawDialogue.length
    const rawText = rawDialogue.slice(textStart, textEnd).trim()
    // 娓呮礂鎷彿鍐呰〃婕旀彁绀?    const cleaned = rawText.replace(/[锛?][^锛?]*[锛?]/g, '').trim()
    if (!cleaned) continue
    const voicePreset = charVoiceMap[markers[i].name] || fallbackVoice
    turns.push({ text: cleaned, voicePreset })
  }
  return turns
}

/** 鏌ユ壘 FFmpeg 璺緞 */
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
  throw new Error('FFmpeg 鏈壘鍒?)
}

/**
 * 涓哄崟涓垎闀滅敓鎴愰厤闊筹紙鏀寔澶氳鑹插鐧斤級
 * 杩斿洖: 闊抽鏂囦欢璺緞
 */
export async function generateVoice(input: GenerateVoiceInput): Promise<string> {
  const { projectId, shotId, text, voicePreset } = input

  if (!text || !text.trim()) throw new Error(`鍒嗛暅 ${shotId} 瀵圭櫧涓虹┖锛岃烦杩嘸)

  const project = getProject(projectId)
  if (!project) throw new Error('椤圭洰涓嶅瓨鍦?)

  const audioDir = join(project.path, 'assets', 'audio')
  mkdirSync(audioDir, { recursive: true })

  const { EdgeTTS } = await import('node-edge-tts')
  const db = getDb()
  const fallbackCfg = getVoiceConfig(voicePreset || 'female')

  console.log(`[voice] shot=${shotId.slice(0,8)} voicePreset=${voicePreset} voiceName=${fallbackCfg.voice} textLen=${text.length}`)

  // 妫€鏌ユ槸鍚﹀瑙掕壊锛氭枃鏈腑鏄惁鏈?"瑙掕壊鍚嶏細" 妯″紡
  const hasCharPrefix = /(?<=^|[銆傦紒锛焆)\s*[^銆傦紒锛燂細:]+[锛?]/.test(text)
  console.log(`[voice] hasCharPrefix=${hasCharPrefix} textFirst=${text.slice(0, 60)}`)

  if (!hasCharPrefix) {
    // 鍗曡鑹?/ 宸叉竻娲楁枃鏈?鈫?鐩存帴鐢熸垚
    const outputPath = join(audioDir, `${shotId}.mp3`)
    const cleanText = cleanBrackets(text)
    console.log(`[voice] single-voice 鈫?${fallbackCfg.voice} rate=${fallbackCfg.rate} text="${cleanText.slice(0, 50)}"`)
    const tts = new EdgeTTS({ voice: fallbackCfg.voice, lang: 'zh-CN', rate: fallbackCfg.rate, pitch: fallbackCfg.pitch, volume: fallbackCfg.volume, timeout: 60000 })
    await tts.ttsPromise(cleanText, outputPath)
    db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
    return outputPath
  }

  // 澶氳鑹插鐧?鈫?鎸夎鑹叉媶鍒嗙敓鎴?鈫?FFmpeg 鎷兼帴
  // 鏌ラ」鐩腑鎵€鏈夎鑹诧紙涓嶉檺褰撳墠鍒嗛暅鍏宠仈锛夛紝鐢ㄥ悕瀛楀尮閰嶅鐧戒腑鐨勮鑹插悕
  const allChars = db.prepare('SELECT name, voice_preset FROM characters WHERE project_id = (SELECT project_id FROM shots WHERE id = ?)').all(shotId) as Array<{ name: string; voice_preset: string | null }>
  const charVoiceMap: Record<string, string> = {}
  for (const c of allChars) {
    if (c.voice_preset) charVoiceMap[c.name] = c.voice_preset
  }
  console.log(`[voice] charVoiceMap keys:`, Object.keys(charVoiceMap).join(', '))
  const turns = parseTurns(text, charVoiceMap, voicePreset || 'female')
  console.log(`[voice] turns=${turns.length}:`, turns.map(t => `${t.voicePreset}鈫?${t.text.slice(0, 30)}"`).join(' | '))
  if (turns.length === 0) {
    // 瑙ｆ瀽澶辫触锛屽洖閫€鍒板崟璇煶锛堟竻娲楀悗锛?    const outputPath = join(audioDir, `${shotId}.mp3`)
    const cleanText = cleanBrackets(text)
    console.log(`[voice] parseTurns杩斿洖0 鈫?fallback single-voice`)
    const tts = new EdgeTTS({ voice: fallbackCfg.voice, lang: 'zh-CN', rate: fallbackCfg.rate, pitch: fallbackCfg.pitch, volume: fallbackCfg.volume, timeout: 60000 })
    await tts.ttsPromise(cleanText, outputPath)
    db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
    return outputPath
  }

  // 閫愬彞鐢熸垚
  const tempFiles: string[] = []
  for (const turn of turns) {
    const tmpPath = join(audioDir, `${shotId}_tmp_${randomUUID().slice(0, 8)}.mp3`)
    const cfg = getVoiceConfig(turn.voicePreset)
    const tts = new EdgeTTS({ voice: cfg.voice, lang: 'zh-CN', rate: cfg.rate, pitch: cfg.pitch, volume: cfg.volume, timeout: 60000 })
    await tts.ttsPromise(turn.text, tmpPath)
    tempFiles.push(tmpPath)
  }

  // FFmpeg 鎷兼帴
  const outputPath = join(audioDir, `${shotId}.mp3`)
  if (tempFiles.length === 1) {
    const { renameSync } = require('fs') as typeof import('fs')
    renameSync(tempFiles[0], outputPath)
  } else {
    // 鏋勫缓 concat file list
    const listPath = join(audioDir, `${shotId}_concat.txt`)
    const lines = tempFiles.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    writeFileSync(listPath, lines.join('\n'), 'utf8')
    try {
      execFileSync(findFfmpeg(), [
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy', '-y', outputPath
      ], { timeout: 60000, stdio: 'pipe' })
    } catch {
      // concat demuxer 澶辫触鏃跺洖閫€鍒?concat filter
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
    // 娓呯悊
    for (const f of tempFiles) { try { unlinkSync(f) } catch {} }
    try { unlinkSync(listPath) } catch {}
  }

  db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)
  return outputPath
}

/**
 * 鎵归噺鐢熸垚閰嶉煶 鈥?骞惰锛屽崟鏉″け璐ヤ笉褰卞搷鍏朵粬
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
      console.error('[voice] 澶辫触:', r.reason?.message || r.reason)
    }
  }
  return results
}

