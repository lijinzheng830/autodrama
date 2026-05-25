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

export interface Provider {
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

export interface AutoProcessOptions {
  mode?: 'full' | 'append'
  provider?: string
  model?: string
  promptTemplate?: string
  era?: string
  aspectRatio?: string
}
