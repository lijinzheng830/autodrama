/**
 * 配音服务 — Microsoft Edge TTS（免费、无需 API Key）
 * 为分镜对白生成 MP3 配音文件
 */
import { mkdirSync } from 'fs'
import { join } from 'path'
import { getDb } from './db'
import { getProject } from './project'

export const VOICE_PRESETS: Record<string, string> = {
  'female-lead': 'zh-CN-XiaoxiaoNeural',
  'male-lead':   'zh-CN-YunxiNeural',
  'narrator':    'zh-CN-YunjianNeural',
  'female':      'zh-CN-XiaoyiNeural',
  'male':        'zh-CN-YunyangNeural',
  'male-deep':   'zh-CN-YunxiaNeural',
  'male-elder':  'zh-CN-YunyangNeural',  // 与 male 相同语音，用 rate:'-20%' 降速显老成
}

export function listVoicePresets(): { key: string; name: string; label: string }[] {
  return [
    { key: 'female-lead', name: VOICE_PRESETS['female-lead'], label: '女主·晓晓（温暖女声）' },
    { key: 'male-lead',   name: VOICE_PRESETS['male-lead'],   label: '男主·云希（沉稳男声）' },
    { key: 'narrator',    name: VOICE_PRESETS['narrator'],    label: '旁白·云健（成熟男声）' },
    { key: 'female',      name: VOICE_PRESETS['female'],      label: '女配·晓依（年轻女声）' },
    { key: 'male',        name: VOICE_PRESETS['male'],        label: '男配·云扬（洪亮男声）' },
    { key: 'male-deep',   name: VOICE_PRESETS['male-deep'],   label: '反派·云夏（低沉男声）' },
    { key: 'male-elder',  name: VOICE_PRESETS['male-elder'],  label: '老者·云扬降速（老成男声）' },
  ]
}

export interface GenerateVoiceInput {
  projectId: string
  shotId: string
  text: string
  voicePreset: string  // VOICE_PRESETS 的 key
}

/**
 * 为单个分镜对白生成配音
 * 返回: 音频文件路径
 */
export async function generateVoice(input: GenerateVoiceInput): Promise<string> {
  const { projectId, shotId, text, voicePreset } = input

  if (!text || !text.trim()) throw new Error(`分镜 ${shotId} 对白为空，跳过`)

  const voiceName = VOICE_PRESETS[voicePreset] || VOICE_PRESETS['female']
  if (voiceName !== VOICE_PRESETS[voicePreset]) {
    console.warn(`[voice] 未知预设 ${voicePreset}，回退到 female`)
  }

  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const audioDir = join(project.path, 'assets', 'audio')
  mkdirSync(audioDir, { recursive: true })

  const outputPath = join(audioDir, `${shotId}.mp3`)

  const { EdgeTTS } = await import('node-edge-tts')
  const tts = new EdgeTTS({ voice: voiceName, lang: 'zh-CN' })
  await tts.ttsPromise(text, outputPath)

  // 更新 shots 表
  const db = getDb()
  db.prepare('UPDATE shots SET voice_path = ? WHERE id = ?').run(outputPath, shotId)

  return outputPath
}

/**
 * 批量生成配音 — 并行，单条失败不影响其他
 * 返回: { shotId: audioPath } 映射
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
