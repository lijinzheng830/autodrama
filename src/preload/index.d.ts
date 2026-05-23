import { ElectronAPI } from '@electron-toolkit/preload'

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
  model?: string | null
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

export interface AutoProcessOptions {
  mode?: 'full' | 'append'
  provider?: string
  model?: string
  promptTemplate?: string
  era?: string
  aspectRatio?: string
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
}

export interface Api {
  createProject: (input: ProjectInput) => Promise<unknown>
  getProjects: () => Promise<unknown[]>
  getProject: (id: string) => Promise<unknown | null>
  deleteProject: (id: string) => Promise<void>
  updateProject: (projectId: string, input: ProjectInput) => Promise<void>
  autoProcess: (projectId: string, script: string, options?: AutoProcessOptions) => Promise<unknown>
  onAIProgress: (callback: (data: unknown) => void) => () => void
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
  getChapters: (projectId: string) => Promise<unknown[]>
  getShots: (chapterId: string) => Promise<unknown[]>
  getCharacters: (projectId: string) => Promise<unknown[]>
  getScenes: (projectId: string) => Promise<unknown[]>
  getShotCharacters: (shotId: string) => Promise<unknown[]>
  getShotScenes: (shotId: string) => Promise<unknown[]>
  getShotCharactersByProject: (projectId: string) => Promise<unknown[]>
  getShotScenesByProject: (projectId: string) => Promise<unknown[]>
  selectDirectory: () => Promise<string | null>

  // Asset CRUD
  createCharacter: (projectId: string, input: CharacterInput) => Promise<unknown>
  updateCharacter: (characterId: string, input: CharacterInput) => Promise<void>
  deleteCharacter: (characterId: string) => Promise<void>

  createScene: (projectId: string, input: SceneInput) => Promise<unknown>
  updateScene: (sceneId: string, input: SceneInput) => Promise<void>
  deleteScene: (sceneId: string) => Promise<void>

  createProp: (projectId: string, input: PropInput) => Promise<unknown>
  updateProp: (propId: string, input: PropInput) => Promise<void>
  deleteProp: (propId: string) => Promise<void>
  getPropsByProject: (projectId: string) => Promise<unknown[]>

  // Template
  getPromptTemplates: (projectId: string, usage?: string) => Promise<unknown[]>
  savePromptTemplate: (projectId: string, input: PromptTemplateInput) => Promise<unknown>
  deletePromptTemplate: (templateId: string) => Promise<void>

  // Shot & project data
  getShotsWithAssociations: (chapterId: string) => Promise<unknown[]>
  getProjectData: (projectId: string) => Promise<unknown>
  getProjectStats: (projectId: string) => Promise<{ characters: number; scenes: number; props: number; chapters: number; shots: number }>
  moveShotUp: (shotId: string) => Promise<void>
  moveShotDown: (shotId: string) => Promise<void>
  deleteShot: (shotId: string) => Promise<void>
  updateShot: (shotId: string, input: ShotInput) => Promise<void>
  addShotAssociation: (shotId: string, type: string, assetId: string) => Promise<void>
  createGenerationTask: (input: GenerationTaskInput) => Promise<unknown>
  getGenerationTasks: (projectId: string, filters?: { status?: string; purpose?: string; since?: number }) => Promise<unknown[]>
  selectImage: (projectPath: string) => Promise<string | null>
  selectExportDirectory: (defaultPath?: string) => Promise<string | null>
  copyExportFile: (src: string, dest: string) => Promise<boolean>
  getProviders: () => Promise<Provider[]>
  addProvider: (provider: ProviderInput) => Promise<Provider>
  updateProvider: (id: string, data: ProviderInput) => Promise<Provider>
  deleteProvider: (id: string) => Promise<void>
  getSystemPrompt: () => Promise<string>
  setSystemPrompt: (prompt: string) => Promise<void>
  updatePromptTemplate: (templateId: string, input: PromptTemplateInput) => Promise<void>
  exportConfig: (data: unknown) => Promise<string>
  importConfig: (
    cipherText: string
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>
  getVersion: () => Promise<string>
  getVersions: () => Promise<{ electron: string; node: string; chrome: string }>
  configWriteFile: (filePath: string, content: string) => Promise<boolean>
  configReadFile: (filePath: string) => Promise<string | null>
  showSaveDialog: (options: unknown) => Promise<string | null>
  showOpenDialog: (options: unknown) => Promise<string | null>

  // Image Generation
  generateImage: (input: GenerateImageInput) => Promise<{ taskId: string; imagePaths: string[] }>
  getAssetImages: (assetType: 'character' | 'scene' | 'prop', assetId: string) => Promise<unknown[]>
  selectAssetImage: (assetType: 'character' | 'scene' | 'prop', assetId: string, imageId: string) => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
