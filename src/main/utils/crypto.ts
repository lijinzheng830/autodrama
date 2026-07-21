import { safeStorage } from 'electron'
import { logger } from './logger'

/**
 * 加密配置数据（用于导出）
 */
export function encrypt(plainText: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.error('safeStorage 不可用，无法加密配置')
    return null
  }
  try {
    return safeStorage.encryptString(plainText).toString('base64')
  } catch (err) {
    logger.error('加密失败:', err)
    return null
  }
}

/**
 * 解密配置数据（用于导入）
 */
export function decrypt(cipherText: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.error('safeStorage 不可用，无法解密配置')
    return null
  }
  try {
    return safeStorage.decryptString(Buffer.from(cipherText, 'base64'))
  } catch (err) {
    logger.error('解密失败:', err)
    return null
  }
}
