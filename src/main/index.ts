// 强制控制台 UTF-8，修复 Windows 下中文日志乱码
process.stdout.setDefaultEncoding('utf8')

import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { logger } from './utils/logger'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { initDatabase, getDb } from './services/db'
import {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
  deleteParseGroup,
  getChaptersByProject,
  getShotsByChapter,
  getCharactersByProject,
  getScenesByProject,
  getShotCharacters,
  getShotScenes,
  getShotCharactersByProject,
  getShotScenesByProject,
  getShotsWithAssociations,
  getProjectData,
  getProjectStats,
  moveShotUp,
  moveShotDown,
  deleteShot,
  updateShot,
  addShotAssociation,
  removeShotAssociation,
  createGenerationTask,
  getGenerationTasks,
  batchCreateGenerationTasks,
  cancelGenerationTasks,
  copyImageToProject,
  UpdateProjectInput,
  UpdateShotInput
} from './services/project'
import {
  createCharacter,
  updateCharacter,
  deleteCharacter,
  createScene,
  updateScene,
  deleteScene,
  createProp,
  updateProp,
  deleteProp,
  getPropsByProject,
  CreateCharacterInput,
  UpdateCharacterInput,
  CreateSceneInput,
  UpdateSceneInput,
  CreatePropInput,
  UpdatePropInput
} from './services/asset'
import {
  getPromptTemplates,
  savePromptTemplate,
  deletePromptTemplate,
  updatePromptTemplate
} from './services/template'
import { autoProcess, autoProcessSeedance, translateToEnglish } from './services/autoProcess'
import type { AutoProcessOptions, ProgressData } from './services/ai'
import {
  getSetting,
  setSetting,
  getProviders,
  addProvider,
  updateProvider,
  deleteProvider,
  getSystemPrompt,
  setSystemPrompt,
  type ProviderRecord
} from './services/settings'
import { PROVIDERS } from './services/providers'
import { encrypt, decrypt } from './utils/crypto'
import { generateImage, generateAngle } from './services/imageGenerator'
import { generateGridStoryboard } from './services/gridStoryboard'
import { getAssetImages, selectAssetImage, deleteAssetImage, deleteShotImage, deleteShotVideo, getShotVideos, selectShotVideo, createMultiAngle, getMultiAngle } from './services/characterAnchorService'
import { generateShotVideo } from './services/videoGenerator'
import { exportStoryboardPDF } from './services/pdfExport'
import type { GenerateImageInput } from './types'
import { reviewScript, getReviewRules, getRuleStats, autoFixScript, generateFixSuggestion } from './services/scriptReviewer'
import { getStyleTemplates, getStyleByKey } from './services/styleTemplate'
import { isPathAllowed } from './utils/pathValidator'

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
        if (
          input.code === 'KeyI' &&
          ((input.alt && input.meta) || (input.control && input.shift))
        ) {
          event.preventDefault()
        }
      }
    }
  })
}

let mainWindow: BrowserWindow | null = null

// 确保 dev 模式下直接运行 electron 也能使用正确的 app name / userData 路径
if (!app.name || app.name === 'Electron') {
  app.name = 'wuxianchuangyi'
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: app.isPackaged
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

  ipcMain.handle('project:deleteParseGroup', async (_, projectId: string, parseGroup: number) => {
    deleteParseGroup(projectId, parseGroup)
  })

  ipcMain.handle(
    'project:update',
    async (_, { projectId, input }: { projectId: string; input: UpdateProjectInput }) => {
      updateProject(projectId, input)
    }
  )

  const autoProcessLocks = new Set<string>()
  ipcMain.handle(
    'ai:auto-process',
    async (
      _,
      {
        projectId,
        script,
        options
      }: { projectId: string; script: string; options?: AutoProcessOptions }
    ) => {
      if (!mainWindow) throw new Error('主窗口未就绪')
      if (autoProcessLocks.has(projectId)) throw new Error('剧本解析正在执行中，请等待完成')
      autoProcessLocks.add(projectId)

      const sendProgress = (data: ProgressData): void => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('ai:progress', data)
        }
      }

      try {
        const result = await autoProcess(projectId, script, () => {}, sendProgress, options)
        return result
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '生成失败'
        sendProgress({ step: 0, status: 'error', message })
        throw err
      } finally {
        autoProcessLocks.delete(projectId)
      }
    }
  )

  // Seedance 2.0 九宫格专属解析管线（合并3→1次LLM调用）
  ipcMain.handle(
    'ai:auto-process-seedance',
    async (
      _,
      { projectId, script, options }: { projectId: string; script: string; options?: AutoProcessOptions }
    ) => {
      if (!mainWindow) throw new Error('主窗口未就绪')
      if (autoProcessLocks.has(projectId)) throw new Error('剧本解析正在执行中，请等待完成')
      autoProcessLocks.add(projectId)

      const sendProgress = (data: ProgressData): void => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('ai:progress', data)
        }
      }

      try {
        const result = await autoProcessSeedance(projectId, script, () => {}, sendProgress, options)
        return result
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '生成失败'
        sendProgress({ step: 0, status: 'error', message })
        throw err
      } finally {
        autoProcessLocks.delete(projectId)
      }
    }
  )

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

  ipcMain.handle('project:stats', async (_, projectId: string) => {
    return getProjectStats(projectId)
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

  ipcMain.handle('shot:saveField', async (_, { shotId, field, value }: { shotId: string; field: string; value: unknown }) => {
    const db = getDb()
    db.prepare(`UPDATE shots SET ${field} = ? WHERE id = ?`).run(value, shotId)
  })

  ipcMain.handle('file:delete', async (_, filePath: string) => {
    const fs = await import('fs')
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  })

  ipcMain.handle(
    'shot:update',
    async (_, { shotId, input }: { shotId: string; input: UpdateShotInput }) => {
      updateShot(shotId, input)
    }
  )

  ipcMain.handle(
    'shot:associate',
    async (_, { shotId, type, assetId }: { shotId: string; type: string; assetId: string }) => {
      addShotAssociation(shotId, type as 'character' | 'scene' | 'prop', assetId)
    }
  )
  ipcMain.handle(
    'shot:removeAssociation',
    async (_, { shotId, type, assetId }: { shotId: string; type: string; assetId: string }) => {
      removeShotAssociation(shotId, type as 'character' | 'scene' | 'prop', assetId)
    }
  )

  ipcMain.handle(
    'generationTask:create',
    async (_, input: Parameters<typeof createGenerationTask>[0]) => {
      return createGenerationTask(input)
    }
  )

  ipcMain.handle('generationTask:list', async (_, projectId: string, filters?: { status?: string; purpose?: string; since?: number }) => {
    return getGenerationTasks(projectId, filters)
  })

  ipcMain.handle('generationTask:batchCreate', async (_, input) => {
    return batchCreateGenerationTasks(input)
  })

  ipcMain.handle('generationTask:cancel', async (_, projectId: string) => {
    return cancelGenerationTasks(projectId)
  })

  ipcMain.handle('generationTask:delete', async (_, taskId: string) => {
    getDb().prepare('DELETE FROM generation_tasks WHERE id = ?').run(taskId)
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
  ipcMain.handle(
    'asset:character:create',
    async (_, { projectId, input }: { projectId: string; input: CreateCharacterInput }) => {
      return createCharacter(projectId, input)
    }
  )
  ipcMain.handle(
    'asset:character:update',
    async (_, { characterId, input }: { characterId: string; input: UpdateCharacterInput }) => {
      updateCharacter(characterId, input)
    }
  )
  ipcMain.handle('asset:character:delete', async (_, characterId: string) => {
    deleteCharacter(characterId)
  })

  ipcMain.handle(
    'asset:scene:create',
    async (_, { projectId, input }: { projectId: string; input: CreateSceneInput }) => {
      return createScene(projectId, input)
    }
  )
  ipcMain.handle(
    'asset:scene:update',
    async (_, { sceneId, input }: { sceneId: string; input: UpdateSceneInput }) => {
      updateScene(sceneId, input)
    }
  )
  ipcMain.handle('asset:scene:delete', async (_, sceneId: string) => {
    deleteScene(sceneId)
  })

  ipcMain.handle(
    'asset:prop:create',
    async (_, { projectId, input }: { projectId: string; input: CreatePropInput }) => {
      return createProp(projectId, input)
    }
  )
  ipcMain.handle(
    'asset:prop:update',
    async (_, { propId, input }: { propId: string; input: UpdatePropInput }) => {
      updateProp(propId, input)
    }
  )
  ipcMain.handle('asset:prop:delete', async (_, propId: string) => {
    deleteProp(propId)
  })
  ipcMain.handle('asset:prop:list', async (_, projectId: string) => {
    return getPropsByProject(projectId)
  })

  // ===== Multi-Angle Character Anchors =====
  ipcMain.handle('anchor:createMultiAngle', async (_, { characterId, anchors }: { characterId: string; anchors: import('./services/characterAnchorService').MultiAngleAnchors }) => {
    return createMultiAngle(characterId, anchors)
  })
  ipcMain.handle('anchor:getMultiAngle', async (_, characterId: string) => {
    return getMultiAngle(characterId)
  })
  ipcMain.handle('anchor:generateAngle', async (_, { characterId, angle }: { characterId: string; angle: import('./services/styleMapper').AnchorAngle }) => {
    return generateAngle(characterId, angle)
  })

  // ===== AI 翻译 =====
  ipcMain.handle('ai:translate', async (_, text: string) => {
    return translateToEnglish(text)
  })

  // Template handlers
  ipcMain.handle(
    'template:list',
    async (_, { projectId, usage }: { projectId: string; usage?: string }) => {
      return getPromptTemplates(projectId, usage)
    }
  )

  ipcMain.handle(
    'template:save',
    async (
      _,
      { projectId, input }: { projectId: string; input: Parameters<typeof savePromptTemplate>[1] }
    ) => {
      return savePromptTemplate(projectId, input)
    }
  )

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
    try {
      const { copyFileSync, mkdirSync, existsSync } = await import('fs')
      const { dirname } = await import('path')
      const dir = dirname(dest)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      copyFileSync(src, dest)
      return true
    } catch (err) {
      logger.error(`Copy file failed: ${src} -> ${dest} ${err}`)
      return false
    }
  })

  // ===== Settings: Providers =====
  ipcMain.handle('settings:getProviders', async () => getProviders())
  ipcMain.handle('settings:addProvider', async (_, provider: ProviderRecord) =>
    addProvider(provider)
  )
  ipcMain.handle(
    'settings:updateProvider',
    async (_, { id, data }: { id: string; data: ProviderRecord }) => updateProvider(id, data)
  )
  ipcMain.handle('settings:deleteProvider', async (_, id: string) => deleteProvider(id))

  // ===== Settings: System Prompt =====
  ipcMain.handle('settings:getSystemPrompt', async () => getSystemPrompt())
  ipcMain.handle('settings:setSystemPrompt', async (_, prompt: string) => setSystemPrompt(prompt))

  // ===== Template: Update =====
  ipcMain.handle(
    'template:update',
    async (
      _,
      {
        templateId,
        input
      }: { templateId: string; input: Parameters<typeof updatePromptTemplate>[1] }
    ) => {
      updatePromptTemplate(templateId, input)
    }
  )

  // ===== Config Export / Import =====
  ipcMain.handle(
    'config:export',
    async (_, data: { systemPrompt: string; templates: unknown[]; modelRoutes: unknown }) => {
      const json = JSON.stringify(data, null, 2)
      const encrypted = encrypt(json)
      if (!encrypted) {
        throw new Error('加密失败，safeStorage 不可用')
      }
      return encrypted
    }
  )

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
  ipcMain.handle(
    'config:writeFile',
    async (_, { filePath, content }: { filePath: string; content: string }) => {
      if (!isPathAllowed(filePath)) {
        logger.error('[security] Write file rejected: path outside allowed directory', filePath)
        return false
      }
      try {
        const fs = await import('fs')
        fs.writeFileSync(filePath, content, 'utf8')
        return true
      } catch (err) {
        logger.error('Write file failed:', err)
        return false
      }
    }
  )

  ipcMain.handle('config:readFile', async (_, filePath: string) => {
    if (!isPathAllowed(filePath)) {
      logger.error('[security] Read file rejected: path outside allowed directory', filePath)
      return null
    }
    try {
      const fs = await import('fs')
      return fs.readFileSync(filePath, 'utf8')
    } catch (err) {
      logger.error('Read file failed:', err)
      return null
    }
  })

  ipcMain.handle('dialog:showSaveDialog', async (_, options: unknown) => {
    const result = await dialog.showSaveDialog(
      options as Parameters<typeof dialog.showSaveDialog>[0]
    )
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('dialog:showOpenDialog', async (_, options: unknown) => {
    const result = await dialog.showOpenDialog({
      ...(options as Record<string, unknown>),
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ===== Image Generation =====
  ipcMain.handle('image:generate', async (_, input: GenerateImageInput) => {
    const proj = getProject(input.projectId)
    if (!proj) throw new Error('项目不存在')
    return generateImage(input)
  })

  ipcMain.handle('image:getAssetImages', async (_, { assetType, assetId }: { assetType: 'character' | 'scene' | 'prop'; assetId: string }) => {
    return getAssetImages(assetType, assetId)
  })

  ipcMain.handle('image:selectAssetImage', async (_, { assetType, assetId, imageId }: { assetType: 'character' | 'scene' | 'prop'; assetId: string; imageId: string }) => {
    selectAssetImage(assetType, assetId, imageId)
  })

  ipcMain.handle('image:deleteAssetImage', async (_, { assetType, assetId, imageId }: { assetType: 'character' | 'scene' | 'prop'; assetId: string; imageId: string }) => {
    deleteAssetImage(assetType, assetId, imageId)
  })

  ipcMain.handle('image:deleteShotImage', async (_, { shotId, imageId }: { shotId: string; imageId: string }) => {
    deleteShotImage(shotId, imageId)
  })


  ipcMain.handle('video:generate', async (_, input) => {
    const proj = getProject(input.projectId)
    if (!proj) throw new Error('项目不存在')
    return generateShotVideo(input)
  })


  // ===== 宫格故事板生成 =====
  ipcMain.handle('storyboard:generate', async (_, input: import('./services/gridStoryboard').GenerateGridStoryboardInput) => {
    const proj = getProject(input.projectId)
    if (!proj) throw new Error('项目不存在')
    return generateGridStoryboard(input)
  })

  ipcMain.handle('video:getShotVideos', async (_, shotId: string) => {
    return getShotVideos(shotId)
  })

  ipcMain.handle('video:selectShotVideo', async (_, { shotId, videoId }: { shotId: string; videoId: string }) => {
    selectShotVideo(shotId, videoId)
  })

  ipcMain.handle('video:deleteShotVideo', async (_, { shotId, videoId }: { shotId: string; videoId: string }) => {
    deleteShotVideo(shotId, videoId)
  })


  // ===== Voice stubs (TTS已移除，保留空返回防止前端报错) =====
  ipcMain.handle('voice:listPresets', async () => [])
  ipcMain.handle('voice:generate', async () => '')
  ipcMain.handle('voice:batchGenerate', async () => ({}))

  // ===== PDF Export =====
  ipcMain.handle('export:pdfStoryboard', async (_, config: { projectId: string; shotIds?: string[]; includeImages?: boolean }) => {
    return exportStoryboardPDF(config)
  })

  // ===== Script Reviewer =====
  ipcMain.handle(
    'reviewer:review',
    async (_, { script, options }: { script: string; options?: { mode?: string } }) => {
      const mode = (options?.mode as 'quick' | 'deep') || 'quick'
      const startTime = Date.now()
      const logPath = join(app.getPath('userData'), 'reviewer.log')
      try {
        const fs = await import('fs')
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] 开始审查 模式=${mode} 剧本长度=${script.length}字\n`)
        const result = await reviewScript(script, { mode })
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] 审查完成 耗时=${Date.now() - startTime}ms 结论=${result.overallVerdict} 分数=${result.score}\n`)
        logger.info(`[reviewer] 审查完成，耗时: ${Date.now() - startTime}ms, 结论: ${result.overallVerdict}`)
        return result
      } catch (err) {
        logger.error(`[reviewer] 审查失败:`, err)
        throw err
      }
    }
  )
  ipcMain.handle('reviewer:rules', async () => {
    return getReviewRules()
  })
  ipcMain.handle('reviewer:ruleStats', async () => {
    return getRuleStats()
  })
  ipcMain.handle('style:list', async () => {
    return getStyleTemplates()
  })
  ipcMain.handle('style:getByKey', async (_, key: string) => {
    return getStyleByKey(key)
  })
  ipcMain.handle(
    'reviewer:autoFix',
    async (_, { script, findings }: { script: string; findings: any[] }) => {
      return autoFixScript(script, findings)
    }
  )
  ipcMain.handle(
    'reviewer:fixSuggestion',
    async (_, { script, finding }: { script: string; finding: any }) => {
      return generateFixSuggestion(script, finding)
    }
  )

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
