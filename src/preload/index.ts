import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  createProject: (input: {
    name: string
    styleName: string
    stylePrompt: string
    styleNegativePrompt: string
    aspectRatio: string
    era?: string
    negativePrompt?: string
    parentProjectId?: string
  }) => ipcRenderer.invoke('project:create', input),
  getProjects: () => ipcRenderer.invoke('project:list'),
  getProject: (id: string) => ipcRenderer.invoke('project:get', id),
  updateProject: (projectId: string, input: any) => ipcRenderer.invoke('project:update', { projectId, input }),
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
  getShotScenes: (shotId: string) => ipcRenderer.invoke('project:shotScenes', shotId),
  getShotCharactersByProject: (projectId: string) => ipcRenderer.invoke('project:shotCharactersByProject', projectId),
  getShotScenesByProject: (projectId: string) => ipcRenderer.invoke('project:shotScenesByProject', projectId),

  // Asset CRUD
  createCharacter: (projectId: string, input: any) => ipcRenderer.invoke('asset:character:create', { projectId, input }),
  updateCharacter: (characterId: string, input: any) => ipcRenderer.invoke('asset:character:update', { characterId, input }),
  deleteCharacter: (characterId: string) => ipcRenderer.invoke('asset:character:delete', characterId),

  createScene: (projectId: string, input: any) => ipcRenderer.invoke('asset:scene:create', { projectId, input }),
  updateScene: (sceneId: string, input: any) => ipcRenderer.invoke('asset:scene:update', { sceneId, input }),
  deleteScene: (sceneId: string) => ipcRenderer.invoke('asset:scene:delete', sceneId),

  createProp: (projectId: string, input: any) => ipcRenderer.invoke('asset:prop:create', { projectId, input }),
  updateProp: (propId: string, input: any) => ipcRenderer.invoke('asset:prop:update', { propId, input }),
  deleteProp: (propId: string) => ipcRenderer.invoke('asset:prop:delete', propId),
  getPropsByProject: (projectId: string) => ipcRenderer.invoke('asset:prop:list', projectId),

  // Template
  getPromptTemplates: (projectId: string, usage?: string) => ipcRenderer.invoke('template:list', { projectId, usage }),
  savePromptTemplate: (projectId: string, input: any) => ipcRenderer.invoke('template:save', { projectId, input }),
  deletePromptTemplate: (templateId: string) => ipcRenderer.invoke('template:delete', templateId),

  // Shot & project data
  getShotsWithAssociations: (chapterId: string) => ipcRenderer.invoke('project:shotsWithAssociations', chapterId),
  getProjectData: (projectId: string) => ipcRenderer.invoke('project:data', projectId),
  moveShotUp: (shotId: string) => ipcRenderer.invoke('shot:moveUp', shotId),
  moveShotDown: (shotId: string) => ipcRenderer.invoke('shot:moveDown', shotId),
  deleteShot: (shotId: string) => ipcRenderer.invoke('shot:delete', shotId)
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
