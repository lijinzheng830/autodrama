import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { initDatabase } from './services/db'
import {
  createProject, getProjects, getProject, updateProject, deleteProject,
  getChaptersByProject, getShotsByChapter,
  getCharactersByProject, getScenesByProject,
  getShotCharacters, getShotScenes,
  getShotCharactersByProject, getShotScenesByProject,
  getShotsWithAssociations, getProjectData,
  moveShotUp, moveShotDown, deleteShot
} from './services/project'
import {
  createCharacter, updateCharacter, deleteCharacter,
  createScene, updateScene, deleteScene,
  createProp, updateProp, deleteProp, getPropsByProject
} from './services/asset'
import { getPromptTemplates, savePromptTemplate, deletePromptTemplate } from './services/template'
import { autoProcess } from './services/ai'
import { getSetting, setSetting } from './services/settings'
import { PROVIDERS } from './services/providers'

function watchWindowShortcuts(window: BrowserWindow): void {
  const { webContents } = window
  webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      const isDev = !app.isPackaged
      if (isDev) {
        if (input.code === 'F12') {
          if (webContents.isDevToolsOpened()) {
            webContents.closeDevTools()
          } else {
            webContents.openDevTools({ mode: 'undocked' })
          }
        }
      } else {
        if (input.code === 'KeyR' && (input.control || input.meta)) {
          event.preventDefault()
        }
        if (input.code === 'KeyI' && (input.alt && input.meta || input.control && input.shift)) {
          event.preventDefault()
        }
      }
    }
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  watchWindowShortcuts(mainWindow)

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? app.name : process.execPath)
  }

  initDatabase()

  ipcMain.handle('project:create', async (_, input) => {
    return createProject(input)
  })

  ipcMain.handle('project:list', async () => {
    return getProjects()
  })

  ipcMain.handle('project:get', async (_, id: string) => {
    return getProject(id)
  })

  ipcMain.handle('project:delete', async (_, id: string) => {
    deleteProject(id)
  })

  ipcMain.handle('project:update', async (_, { projectId, input }: { projectId: string; input: any }) => {
    updateProject(projectId, input)
  })

  ipcMain.handle('ai:auto-process', async (_, { projectId, script, options }: { projectId: string; script: string; options?: any }) => {
    if (!mainWindow) throw new Error('主窗口未就绪')

    const sendProgress = (data: any) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('ai:progress', data)
      }
    }

    try {
      const result = await autoProcess(
        projectId,
        script,
        () => {},
        sendProgress,
        options
      )
      return result
    } catch (err: any) {
      sendProgress({ step: 0, status: 'error', message: err.message || '生成失败' })
      throw err
    }
  })

  ipcMain.handle('settings:get', async (_, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', async (_, { key, value }: { key: string; value: string }) => {
    setSetting(key, value)
  })

  ipcMain.handle('providers:list', async () => {
    return PROVIDERS
  })

  ipcMain.handle('project:chapters', async (_, projectId: string) => {
    return getChaptersByProject(projectId)
  })

  ipcMain.handle('project:shots', async (_, chapterId: string) => {
    return getShotsByChapter(chapterId)
  })

  ipcMain.handle('project:characters', async (_, projectId: string) => {
    return getCharactersByProject(projectId)
  })

  ipcMain.handle('project:scenes', async (_, projectId: string) => {
    return getScenesByProject(projectId)
  })

  ipcMain.handle('project:shotCharacters', async (_, shotId: string) => {
    return getShotCharacters(shotId)
  })

  ipcMain.handle('project:shotScenes', async (_, shotId: string) => {
    return getShotScenes(shotId)
  })

  ipcMain.handle('project:shotCharactersByProject', async (_, projectId: string) => {
    return getShotCharactersByProject(projectId)
  })

  ipcMain.handle('project:shotScenesByProject', async (_, projectId: string) => {
    return getShotScenesByProject(projectId)
  })

  ipcMain.handle('project:shotsWithAssociations', async (_, chapterId: string) => {
    return getShotsWithAssociations(chapterId)
  })

  ipcMain.handle('project:data', async (_, projectId: string) => {
    return getProjectData(projectId)
  })

  ipcMain.handle('shot:moveUp', async (_, shotId: string) => {
    moveShotUp(shotId)
  })

  ipcMain.handle('shot:moveDown', async (_, shotId: string) => {
    moveShotDown(shotId)
  })

  ipcMain.handle('shot:delete', async (_, shotId: string) => {
    deleteShot(shotId)
  })

  // Asset CRUD handlers
  ipcMain.handle('asset:character:create', async (_, { projectId, input }: { projectId: string; input: any }) => {
    return createCharacter(projectId, input)
  })
  ipcMain.handle('asset:character:update', async (_, { characterId, input }: { characterId: string; input: any }) => {
    updateCharacter(characterId, input)
  })
  ipcMain.handle('asset:character:delete', async (_, characterId: string) => {
    deleteCharacter(characterId)
  })

  ipcMain.handle('asset:scene:create', async (_, { projectId, input }: { projectId: string; input: any }) => {
    return createScene(projectId, input)
  })
  ipcMain.handle('asset:scene:update', async (_, { sceneId, input }: { sceneId: string; input: any }) => {
    updateScene(sceneId, input)
  })
  ipcMain.handle('asset:scene:delete', async (_, sceneId: string) => {
    deleteScene(sceneId)
  })

  ipcMain.handle('asset:prop:create', async (_, { projectId, input }: { projectId: string; input: any }) => {
    return createProp(projectId, input)
  })
  ipcMain.handle('asset:prop:update', async (_, { propId, input }: { propId: string; input: any }) => {
    updateProp(propId, input)
  })
  ipcMain.handle('asset:prop:delete', async (_, propId: string) => {
    deleteProp(propId)
  })
  ipcMain.handle('asset:prop:list', async (_, projectId: string) => {
    return getPropsByProject(projectId)
  })

  // Template handlers
  ipcMain.handle('template:list', async (_, { projectId, usage }: { projectId: string; usage?: string }) => {
    return getPromptTemplates(projectId, usage)
  })

  ipcMain.handle('template:save', async (_, { projectId, input }: { projectId: string; input: any }) => {
    return savePromptTemplate(projectId, input)
  })

  ipcMain.handle('template:delete', async (_, templateId: string) => {
    deletePromptTemplate(templateId)
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择项目目录'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
