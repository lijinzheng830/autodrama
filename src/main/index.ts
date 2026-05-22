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
  moveShotUp, moveShotDown, deleteShot,
  updateShot, addShotAssociation, createGenerationTask, getGenerationTasks, copyImageToProject
} from './services/project'
import {
  createCharacter, updateCharacter, deleteCharacter,
  createScene, updateScene, deleteScene,
  createProp, updateProp, deleteProp, getPropsByProject
} from './services/asset'
import { getPromptTemplates, savePromptTemplate, deletePromptTemplate, updatePromptTemplate } from './services/template'
import { autoProcess } from './services/ai'
import { getSetting, setSetting, getProviders, addProvider, updateProvider, deleteProvider, getSystemPrompt, setSystemPrompt } from './services/settings'
import { PROVIDERS } from './services/providers'
import { encrypt, decrypt } from './utils/crypto'
import { checkLicense } from './utils/license'

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

  ipcMain.handle('shot:update', async (_, { shotId, input }: { shotId: string; input: any }) => {
    updateShot(shotId, input)
  })

  ipcMain.handle('shot:associate', async (_, { shotId, type, assetId }: { shotId: string; type: string; assetId: string }) => {
    addShotAssociation(shotId, type as any, assetId)
  })

  ipcMain.handle('generationTask:create', async (_, input: any) => {
    return createGenerationTask(input)
  })

  ipcMain.handle('generationTask:list', async (_, projectId: string) => {
    return getGenerationTasks(projectId)
  })

  ipcMain.handle('dialog:selectImage', async (_, projectPath: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      title: '选择图片'
    })
    if (result.canceled) return null
    const srcPath = result.filePaths[0]
    return copyImageToProject(srcPath, projectPath)
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

  ipcMain.handle('export:selectDirectory', async (_, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择导出目录',
      defaultPath: defaultPath || undefined
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('export:copyFile', async (_, { src, dest }: { src: string; dest: string }) => {
    // LICENSE CHECK
    if (!checkLicense()) {
      console.warn('License check failed, but allowing export in MVP1')
    }
    try {
      const { copyFileSync, mkdirSync, existsSync } = await import('fs')
      const { dirname } = await import('path')
      const dir = dirname(dest)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      copyFileSync(src, dest)
      return true
    } catch (err) {
      console.error('Copy file failed:', src, '->', dest, err)
      return false
    }
  })

  // ===== Settings: Providers =====
  ipcMain.handle('settings:getProviders', async () => getProviders())
  ipcMain.handle('settings:addProvider', async (_, provider: any) => addProvider(provider))
  ipcMain.handle('settings:updateProvider', async (_, { id, data }: { id: string; data: any }) => updateProvider(id, data))
  ipcMain.handle('settings:deleteProvider', async (_, id: string) => deleteProvider(id))

  // ===== Settings: System Prompt =====
  ipcMain.handle('settings:getSystemPrompt', async () => getSystemPrompt())
  ipcMain.handle('settings:setSystemPrompt', async (_, prompt: string) => setSystemPrompt(prompt))

  // ===== Template: Update =====
  ipcMain.handle('template:update', async (_, { templateId, input }: { templateId: string; input: any }) => {
    updatePromptTemplate(templateId, input)
  })

  // ===== Config Export / Import =====
  ipcMain.handle('config:export', async (_, data: { systemPrompt: string; templates: any[]; modelRoutes: any }) => {
    const json = JSON.stringify(data, null, 2)
    return encrypt(json)
  })

  ipcMain.handle('config:import', async (_, cipherText: string) => {
    const json = decrypt(cipherText)
    if (!json) return { success: false, error: '配置文件无效' }
    try {
      const data = JSON.parse(json)
      return { success: true, data }
    } catch {
      return { success: false, error: '配置文件无效' }
    }
  })

  // ===== App Version =====
  ipcMain.handle('app:getVersion', async () => {
    return app.getVersion()
  })

  ipcMain.handle('app:getVersions', async () => {
    return {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    }
  })

  // Config file read/write helpers
  ipcMain.handle('config:writeFile', async (_, { filePath, content }: { filePath: string; content: string }) => {
    try {
      const fs = await import('fs')
      fs.writeFileSync(filePath, content, 'utf8')
      return true
    } catch (err) {
      console.error('Write file failed:', err)
      return false
    }
  })

  ipcMain.handle('config:readFile', async (_, filePath: string) => {
    try {
      const fs = await import('fs')
      return fs.readFileSync(filePath, 'utf8')
    } catch (err) {
      console.error('Read file failed:', err)
      return null
    }
  })

  ipcMain.handle('dialog:showSaveDialog', async (_, options: any) => {
    const result = await dialog.showSaveDialog(options)
    return result.canceled ? null : result.filePath
  })

  // LICENSE CHECK
  if (!checkLicense()) {
    console.warn('License check failed, but allowing startup in MVP1')
  }

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
