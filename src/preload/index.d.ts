import { ElectronAPI } from '@electron-toolkit/preload'

export interface Api {
  createProject: (input: {
    name: string
    styleName: string
    stylePrompt: string
    styleNegativePrompt: string
    aspectRatio: string
  }) => Promise<unknown>
  getProjects: () => Promise<unknown[]>
  getProject: (id: string) => Promise<unknown | null>
  autoProcess: (projectId: string, script: string) => Promise<unknown>
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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
