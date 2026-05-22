import { ElectronAPI } from '@electron-toolkit/preload'

export interface Api {
  createProject: (input: {
    name: string
    styleName: string
    stylePrompt: string
    styleNegativePrompt: string
    aspectRatio: string
    era?: string
    negativePrompt?: string
    parentProjectId?: string
    path?: string
  }) => Promise<unknown>
  getProjects: () => Promise<unknown[]>
  getProject: (id: string) => Promise<unknown | null>
  deleteProject: (id: string) => Promise<void>
  updateProject: (projectId: string, input: any) => Promise<void>
  autoProcess: (projectId: string, script: string, options?: any) => Promise<unknown>
  onAIProgress: (callback: (data: any) => void) => () => void
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
  getProviders: () => Promise<unknown[]>
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
  createCharacter: (projectId: string, input: any) => Promise<unknown>
  updateCharacter: (characterId: string, input: any) => Promise<void>
  deleteCharacter: (characterId: string) => Promise<void>

  createScene: (projectId: string, input: any) => Promise<unknown>
  updateScene: (sceneId: string, input: any) => Promise<void>
  deleteScene: (sceneId: string) => Promise<void>

  createProp: (projectId: string, input: any) => Promise<unknown>
  updateProp: (propId: string, input: any) => Promise<void>
  deleteProp: (propId: string) => Promise<void>
  getPropsByProject: (projectId: string) => Promise<unknown[]>

  // Template
  getPromptTemplates: (projectId: string, usage?: string) => Promise<unknown[]>
  savePromptTemplate: (projectId: string, input: any) => Promise<unknown>
  deletePromptTemplate: (templateId: string) => Promise<void>

  // Shot & project data
  getShotsWithAssociations: (chapterId: string) => Promise<unknown[]>
  getProjectData: (projectId: string) => Promise<unknown>
  moveShotUp: (shotId: string) => Promise<void>
  moveShotDown: (shotId: string) => Promise<void>
  deleteShot: (shotId: string) => Promise<void>
  updateShot: (shotId: string, input: any) => Promise<void>
  addShotAssociation: (shotId: string, type: string, assetId: string) => Promise<void>
  createGenerationTask: (input: any) => Promise<unknown>
  getGenerationTasks: (projectId: string) => Promise<unknown[]>
  selectImage: (projectPath: string) => Promise<string | null>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
