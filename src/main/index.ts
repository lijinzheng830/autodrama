import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { initDatabase } from './services/db'
import {
  createProject, getProjects, getProject,
  getChaptersByProject, getShotsByChapter,
  getCharactersByProject, getScenesByProject,
  getShotCharacters, getShotScenes
} from './services/project'
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

  ipcMain.handle('ai:auto-process', async (_, { projectId, script }: { projectId: string; script: string }) => {
    if (!mainWindow) throw new Error('主窗口未就绪')

    const sendProgress = (data: any) => {
      mainWindow?.webContents.send('ai:progress', data)
    }

    try {
      const result = await autoProcess(
        projectId,
        script,
        () => {},
        sendProgress
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
