/**
 * 配音服务 — Microsoft Edge TTS（免费、无需 API Key）
 * 为分镜对白生成 MP3 配音文件
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDb } from './db'
import { getProject } from './project'

export const VOICE_PRESETS: Record<string, string> = {
  'female-lead': 'zh-CN-XiaoxiaoNeural',
  'male-lead':   'zh-CN-YunxiNeural',
  'narrator':    'zh-CN-YunjianNeural',
  'female':      'zh-CN-XiaoyiNeural',
  'male':        'zh-CN-YunhaoNeural',
}

export function listVoicePresets(): { key: string; name: string; label: string }[] {
  return [
    { key: 'female-lead', name: VOICE_PRESETS['female-lead'], label: '女主（温暖女声）' },
    { key: 'male-lead',   name: VOICE_PRESETS['male-lead'],   label: '男主（沉稳男声）' },
    { key: 'narrator',    name: VOICE_PRESETS['narrator'],    label: '旁白（成熟男声）' },
    { key: 'female',      name: VOICE_PRESETS['female'],      label: '女配（年轻女声）' },
    { key: 'male',        name: VOICE_PRESETS['male'],        label: '男配（洪亮男声）' },
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

  const { tts: ttsFn } = await import('edge-tts/out/index.js')
  const buffer = await ttsFn(text, { voice: voiceName, rate: '+0%' })
  writeFileSync(outputPath, buffer)

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
