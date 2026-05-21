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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
