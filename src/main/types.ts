export interface ProjectInput {
  name?: string
  path?: string
  styleName?: string
  stylePrompt?: string
  styleNegativePrompt?: string
  aspectRatio?: string
  era?: string
  negativePrompt?: string
  modelConfigJson?: string
  parentProjectId?: string
}

export interface CharacterInput {
  name?: string
  description?: string
  referenceImage?: string
  skinImages?: string
  voicePreset?: string  // VOICE_PRESETS key, e.g. 'female-lead' → 'zh-CN-XiaoxiaoNeural'
}

export interface SceneInput {
  name?: string
  description?: string
  referenceImage?: string
}

export interface PropInput {
  name?: string
  description?: string
  referenceImage?: string
}

export interface ShotInput {
  description?: string
  firstFramePrompt?: string
  lastFramePrompt?: string
  videoPrompt?: string
  firstFramePath?: string
  lastFramePath?: string
  duration?: number
  status?: string
  notes?: string
}

export interface GenerationTaskInput {
  projectId?: string
  shotId?: string | null
  type?: string
  purpose?: string
  channel?: string
  model?: string
  inputParams?: string
}

export interface ProviderInput {
  name?: string
  key?: string
  baseURL?: string
  apiKey?: string
  models?: string[]
}

export interface PromptTemplateInput {
  name?: string
  usage?: string
  content?: string
  isOfficial?: boolean
}

export interface UserProvider {
  id: string
  name: string
  key: string
  baseURL: string
  apiKey: string
  models: string[]
  createdAt: number
  updatedAt: number
}

export interface GenerateImageInput {
  projectId: string
  type: 'character' | 'scene' | 'prop'
  assetId: string
  description: string
  stylePrompt?: string
  eraPrompt?: string
  model?: string
  channel?: string
  apiKey?: string
  count?: number
  taskId?: string
  templateId?: string
  refImage?: string
}

export interface GenerateShotImageInput {
  projectId: string
  shotId: string
  frameType: 'first' | 'last'
  model?: string
  channel?: string
  count?: number
  taskId?: string
  templateId?: string
  refImage?: string
}

// ===== 数据库行类型（对应各表列） =====

export interface ProjectRow {
  id: string; name: string; path: string
  style_name: string; style_prompt: string; style_negative_prompt: string
  aspect_ratio: string; era?: string; negative_prompt?: string
  model_config_json?: string; parent_project_id?: string
  script_text?: string; created_at: number; updated_at: number
}

export interface CharacterRow {
  id: string; project_id: string; name: string
  description?: string; description_zh?: string
  reference_image?: string; skin_images?: string
  created_at?: string
}

export interface SceneRow {
  id: string; project_id: string; name: string
  description?: string; description_zh?: string
  reference_image?: string; created_at?: string
}

export interface PropRow {
  id: string; project_id: string; name: string
  description?: string; description_zh?: string
  reference_image?: string; created_at?: string
}

export interface ChapterRow {
  id: string; project_id: string; chapter_index: number; title: string
}

export interface ShotRow {
  id: string; chapter_id: string; shot_index: number
  description?: string; description_zh?: string
  dialogue?: string; narration?: string
  shot_type?: string; camera_movement?: string; lighting_mood?: string
  character_actions?: string
  first_frame_prompt?: string; first_frame_prompt_zh?: string; first_frame_image_path?: string
  last_frame_prompt?: string; last_frame_prompt_zh?: string; last_frame_image_path?: string
  video_prompt?: string; video_prompt_zh?: string; video_path?: string
  voice_path?: string; duration_seconds?: number
}

export interface GenerationTaskRow {
  id: string; project_id: string; shot_id?: string
  type: string; purpose: string; channel?: string; model?: string
  status: string; input_params?: string; output_path?: string
  error_message?: string
  created_at: string; updated_at?: string; started_at?: string
}

/** 带关联的分镜（getProjectData 或 getShotsWithAssociations 返回） */
export interface ShotWithAssoc extends ShotRow {
  characters?: CharacterRow[]; scenes?: SceneRow[]; props?: PropRow[]
}

export interface AutoProcessOptions {
  mode?: 'full' | 'append'
  provider?: string
  model?: string
  promptTemplate?: string
  era?: string
  aspectRatio?: string
}
