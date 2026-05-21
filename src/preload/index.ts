import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  createProject: (input: {
    name: string
    styleName: string
    stylePrompt: string
    styleNegativePrompt: string
    aspectRatio: string
  }) => ipcRenderer.invoke('project:create', input),
  getProjects: () => ipcRenderer.invoke('project:list'),
  getProject: (id: string) => ipcRenderer.invoke('project:get', id),
  autoProcess: (projectId: string, script: string) => ipcRenderer.invoke('ai:auto-process', { projectId, script }),
  onAIProgress: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('ai:progress', handler)
    return () => ipcRenderer.removeListener('ai:progress', handler)
  },
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', { key, value }),
  getProviders: () => ipcRenderer.invoke('providers:list'),
  getChapters: (projectId: string) => ipcRenderer.invoke('project:chapters', projectId),
  getShots: (chapterId: string) => ipcRenderer.invoke('project:shots', chapterId),
  getCharacters: (projectId: string) => ipcRenderer.invoke('project:characters', projectId),
  getScenes: (projectId: string) => ipcRenderer.invoke('project:scenes', projectId),
  getShotCharacters: (shotId: string) => ipcRenderer.invoke('project:shotCharacters', shotId),
  getShotScenes: (shotId: string) => ipcRenderer.invoke('project:shotScenes', shotId)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
