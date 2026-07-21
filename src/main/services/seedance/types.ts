/**
 * Seedance 模块共享类型定义
 */

// ---- 管线上下文 ----
export interface DialogueContext {
  overflowBin: OverflowItem[]
}

// ---- 对白溢出 ----
export interface OverflowItem {
  prefix: string
  text: string
  sceneName: string
  charNames: string[]
  sequenceOrder: number
}

// ---- 合规检测 ----
export interface ComplianceResult {
  passed: boolean
  score: number // 0-4: 0=fatal, 4=perfect
  warnings: string[]
  errors: string[]
  rhythmWarnings: RhythmWarning[]
}

// ---- 时长引擎 ----
export const TARGET_TOTAL = 14.9
export const DIALOGUE_RATE = 3.0

/** 景别→基准时长+压缩下限+压缩优先级（1=最低 3=最高） */
export const SHOT_TYPE_PROFILE: Record<string, { base: number; floor: number; compressPriority: number }> = {
  '大特写': { base: 1.0, floor: 0.8, compressPriority: 1 },
  '特写':   { base: 1.2, floor: 0.8, compressPriority: 1 },
  '近景':   { base: 2.0, floor: 1.2, compressPriority: 1 },
  '中景':   { base: 1.7, floor: 1.2, compressPriority: 2 },
  '全景':   { base: 1.8, floor: 1.2, compressPriority: 3 },
  '大远景': { base: 2.2, floor: 1.5, compressPriority: 3 },
}

export const SHOT_9_PROFILE = { base: 1.5, floor: 1.2, compressPriority: 3 }

// ---- 对白规划（P1 待实现） ----
export interface DialoguePlan {
  speaker: string
  text: string
  duration: number
  requiredShots: number
  preferredShot: string
}

// ---- 影视节奏（P0.9 Cinematic Rhythm） ----

export interface RhythmProfile {
  speechRate: number              // 对白语速 (字/秒)，默认 3.0
  maxContinuousDialogueSec: number // 连续对白上限 (秒)，默认 8
  preferredDialogueRatio: number   // 对白占比建议上限，默认 0.6
}

export const DEFAULT_RHYTHM_PROFILE: RhythmProfile = {
  speechRate: 3.0,
  maxContinuousDialogueSec: 8,
  preferredDialogueRatio: 0.6,
}

export type ShotPurpose = 'information' | 'emotion' | 'transition' | 'action'

export type DialogueMode = 'lip_sync' | 'voice_over' | 'none'

export interface RhythmWarning {
  type: 'rhythm'
  level: 'warning' | 'suggestion'
  message: string
  shotIndex?: number
  detail?: string
}

// ===== 数据生命周期类型（P0-2 Stage Types） =====

// ---- Stage 0: AI 原始输入（不可信，允许脏数据） ----
export interface RawSeedanceShot {
  shot_id?: number
  shot_type?: string
  dialogue?: string
  narration?: string
  duration?: number | string
  scene_name?: string
  shot_description?: string
  video_description?: string
  character_list?: string[]
  prop_list?: string[]
  camera_movement?: string
  audio_track_id?: string
  seedance_config?: { fps?: number; transition?: string; style?: string }
  [key: string]: unknown
}

// ---- Stage 1: parser 输出（标准化，字段可靠） ----
export interface NormalizedShot {
  shot_index: number
  shot_purpose: ShotPurpose | ''
  duration_seconds: number
  expected_dialogue_duration?: number
  description: string
  description_zh: string
  description_en: string
  shot_scene: string
  dialogue: string
  narration: string
  shot_type: string
  camera_movement: string
  camera_angle: string
  lighting_mood: string
  character_actions: string
  video_prompt: string
  video_prompt_zh: string
  focal_length: string
  focus_point: string
  sound_hint: string
  inner_monologue: string
  narrative_function: string
  seedance_params: string
  _rawAi: Record<string, unknown>
  audio_track_id: string
  source_dialogue_id: string      // 对白身份 — 同一句对白的拆分/延续共享此 ID，与 track_id 解耦
  segment_index: number           // 拆分序号 (0 = 首段, 1 = 第二段...)
  dialogue_mode: DialogueMode
  _purposeSource?: 'ai' | 'fallback_keyword' | 'fallback_index' | 'overflow_skeleton'
}

export interface NormalizedChapter {
  title: string
  shots: NormalizedShot[]
}

export interface NormalizedSeedanceData {
  chapters: NormalizedChapter[]
  characters: { name: string; description: string }[]
  scenes: { name: string; description: string }[]
  props: { name: string; description: string }[]
  timePeriod: string
}

// ---- Stage 2: dialogue 输出 ----
export interface DialogueChapter extends NormalizedChapter {}
export interface DialogueProcessedData {
  chapters: DialogueChapter[]
}

// ---- Stage 3: duration 输出 ----
export interface TimelineChapter extends NormalizedChapter {}
export interface TimelineData {
  chapters: TimelineChapter[]
}

// ---- Stage 4: 最终输出 ----
export interface ValidatedSeedanceData extends NormalizedSeedanceData {
  compliance: ComplianceResult
}
