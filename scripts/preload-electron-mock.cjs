// Preload: mock electron module BEFORE any project imports
const Module = require('module')
const path = require('path')

const USER_DATA = 'C:/Users/Administrator/AppData/Roaming/wuxianchuangyi'
const APP_PATH = 'D:/wuxianchuangyi'

const originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
  if (id === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') return USER_DATA
          if (name === 'appData') return path.join(USER_DATA, '..')
          return USER_DATA
        },
        getAppPath: () => APP_PATH,
        getName: () => 'wuxianchuangyi',
        getVersion: () => '1.0.0',
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s) => Buffer.from(s, 'utf8'),
        decryptString: (b) => (typeof b === 'string' ? b : Buffer.from(b).toString('utf8')),
      },
      BrowserWindow: class {},
      ipcMain: { on: () => {}, handle: () => {} },
    }
  }
  if (id === 'electron/main') {
    return {}
  }
  return originalRequire.apply(this, arguments)
}

// Also mock logger if needed
console.log('[preload] electron mock installed')
