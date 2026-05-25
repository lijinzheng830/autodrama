import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ProjectInput,
  CharacterInput,
  SceneInput,
  PropInput,
  ShotInput,
  GenerationTaskInput,
  ProviderInput,
  PromptTemplateInput,
  AutoProcessOptions,
  GenerateImageInput,
  GenerateShotImageInput
} from '../main/types'

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
    path?: string
  }) => ipcRenderer.invoke('project:create', input),
  getProjects: () => ipcRenderer.invoke('project:list'),
  getProject: (id: string) => ipcRenderer.invoke('project:get', id),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  updateProject: (projectId: string, input: ProjectInput) =>
    ipcRenderer.invoke('project:update', { projectId, input }),
  autoProcess: (projectId: string, script: string, options?: AutoProcessOptions) =>
    ipcRenderer.invoke('ai:auto-process', { projectId, script, options }),
  onAIProgress: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('ai:progress', handler)
    return () => ipcRenderer.removeListener('ai:progress', handler)
  },
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', { key, value }),
  getChapters: (projectId: string) => ipcRenderer.invoke('project:chapters', projectId),
  getShots: (chapterId: string) => ipcRenderer.invoke('project:shots', chapterId),
  getCharacters: (projectId: string) => ipcRenderer.invoke('project:characters', projectId),
  getScenes: (projectId: string) => ipcRenderer.invoke('project:scenes', projectId),
  getShotCharacters: (shotId: string) => ipcRenderer.invoke('project:shotCharacters', shotId),
  getShotScenes: (shotId: string) => ipcRenderer.invoke('project:shotScenes', shotId),
  getShotCharactersByProject: (projectId: string) =>
    ipcRenderer.invoke('project:shotCharactersByProject', projectId),
  getShotScenesByProject: (projectId: string) =>
    ipcRenderer.invoke('project:shotScenesByProject', projectId),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  // Asset CRUD
  createCharacter: (projectId: string, input: CharacterInput) =>
    ipcRenderer.invoke('asset:character:create', { projectId, input }),
  updateCharacter: (characterId: string, input: CharacterInput) =>
    ipcRenderer.invoke('asset:character:update', { characterId, input }),
  deleteCharacter: (characterId: string) =>
    ipcRenderer.invoke('asset:character:delete', characterId),

  createScene: (projectId: string, input: SceneInput) =>
    ipcRenderer.invoke('asset:scene:create', { projectId, input }),
  updateScene: (sceneId: string, input: SceneInput) =>
    ipcRenderer.invoke('asset:scene:update', { sceneId, input }),
  deleteScene: (sceneId: string) => ipcRenderer.invoke('asset:scene:delete', sceneId),

  createProp: (projectId: string, input: PropInput) =>
    ipcRenderer.invoke('asset:prop:create', { projectId, input }),
  updateProp: (propId: string, input: PropInput) =>
    ipcRenderer.invoke('asset:prop:update', { propId, input }),
  deleteProp: (propId: string) => ipcRenderer.invoke('asset:prop:delete', propId),
  getPropsByProject: (projectId: string) => ipcRenderer.invoke('asset:prop:list', projectId),

  // Template
  getPromptTemplates: (projectId: string, usage?: string) =>
    ipcRenderer.invoke('template:list', { projectId, usage }),
  savePromptTemplate: (projectId: string, input: PromptTemplateInput) =>
    ipcRenderer.invoke('template:save', { projectId, input }),
  deletePromptTemplate: (templateId: string) => ipcRenderer.invoke('template:delete', templateId),

  // Shot & project data
  getShotsWithAssociations: (chapterId: string) =>
    ipcRenderer.invoke('project:shotsWithAssociations', chapterId),
  getProjectData: (projectId: string) => ipcRenderer.invoke('project:data', projectId),
  getProjectStats: (projectId: string) => ipcRenderer.invoke('project:stats', projectId),
  moveShotUp: (shotId: string) => ipcRenderer.invoke('shot:moveUp', shotId),
  moveShotDown: (shotId: string) => ipcRenderer.invoke('shot:moveDown', shotId),
  deleteShot: (shotId: string) => ipcRenderer.invoke('shot:delete', shotId),
  updateShot: (shotId: string, input: ShotInput) =>
    ipcRenderer.invoke('shot:update', { shotId, input }),
  addShotAssociation: (shotId: string, type: string, assetId: string) =>
    ipcRenderer.invoke('shot:associate', { shotId, type, assetId }),
  createGenerationTask: (input: GenerationTaskInput) =>
    ipcRenderer.invoke('generationTask:create', input),
  batchCreateGenerationTasks: (input: { projectId: string; tasks: Array<{ shotId?: string; type: string; purpose: string; channel?: string; model?: string; inputParams?: string }> }) =>
    ipcRenderer.invoke('generationTask:batchCreate', input),
  cancelGenerationTasks: (projectId: string) =>
    ipcRenderer.invoke('generationTask:cancel', projectId),
  getGenerationTasks: (projectId: string, filters?: { status?: string; purpose?: string; since?: number }) =>
    ipcRenderer.invoke('generationTask:list', projectId, filters),
  selectImage: (projectPath: string) => ipcRenderer.invoke('dialog:selectImage', projectPath),
  selectExportDirectory: (defaultPath?: string) =>
    ipcRenderer.invoke('export:selectDirectory', defaultPath),
  copyExportFile: (src: string, dest: string) =>
    ipcRenderer.invoke('export:copyFile', { src, dest }),
  getProviders: () => ipcRenderer.invoke('settings:getProviders'),
  addProvider: (provider: ProviderInput) => ipcRenderer.invoke('settings:addProvider', provider),
  updateProvider: (id: string, data: ProviderInput) =>
    ipcRenderer.invoke('settings:updateProvider', { id, data }),
  deleteProvider: (id: string) => ipcRenderer.invoke('settings:deleteProvider', id),
  getSystemPrompt: () => ipcRenderer.invoke('settings:getSystemPrompt'),
  setSystemPrompt: (prompt: string) => ipcRenderer.invoke('settings:setSystemPrompt', prompt),
  updatePromptTemplate: (templateId: string, input: PromptTemplateInput) =>
    ipcRenderer.invoke('template:update', { templateId, input }),
  exportConfig: (data: unknown) => ipcRenderer.invoke('config:export', data),
  importConfig: (cipherText: string) => ipcRenderer.invoke('config:import', cipherText),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getVersions: () => ipcRenderer.invoke('app:getVersions'),
  configWriteFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('config:writeFile', { filePath, content }),
  configReadFile: (filePath: string) => ipcRenderer.invoke('config:readFile', filePath),
  showSaveDialog: (options: unknown) => ipcRenderer.invoke('dialog:showSaveDialog', options),
  showOpenDialog: (options: unknown) => ipcRenderer.invoke('dialog:showOpenDialog', options),

  // Image Generation
  generateImage: (input: GenerateImageInput) => ipcRenderer.invoke('image:generate', input),
  getAssetImages: (assetType: 'character' | 'scene' | 'prop', assetId: string) =>
    ipcRenderer.invoke('image:getAssetImages', { assetType, assetId }),
  selectAssetImage: (assetType: 'character' | 'scene' | 'prop', assetId: string, imageId: string) =>
    ipcRenderer.invoke('image:selectAssetImage', { assetType, assetId, imageId }),
  deleteAssetImage: (assetType: 'character' | 'scene' | 'prop', assetId: string, imageId: string) =>
    ipcRenderer.invoke('image:deleteAssetImage', { assetType, assetId, imageId }),
  generateShotImage: (input: GenerateShotImageInput) => ipcRenderer.invoke('image:generateShot', input),
  getShotImages: (shotId: string, frameType: 'first' | 'last') =>
    ipcRenderer.invoke('image:getShotImages', { shotId, frameType }),
  selectShotImage: (shotId: string, frameType: 'first' | 'last', imageId: string) =>
    ipcRenderer.invoke('image:selectShotImage', { shotId, frameType, imageId }),

  generateVideo: (input: { projectId: string; shotId: string; model?: string; channel?: string; taskId?: string }) =>
    ipcRenderer.invoke('video:generate', input),
  getShotVideos: (shotId: string) => ipcRenderer.invoke('video:getShotVideos', shotId),
  selectShotVideo: (shotId: string, videoId: string) =>
    ipcRenderer.invoke('video:selectShotVideo', { shotId, videoId })
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
