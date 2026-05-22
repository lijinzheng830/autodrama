import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// 硬编码密钥，用于配置文件的加密导出/导入
// 注意：这是对称加密，密钥在代码中可被反编译获取，仅用于防止配置被 casual 查看
const SECRET_KEY = 'AutoDramaConfig2026!@#SecureKey'
const SALT = Buffer.from('ad_salt_16bytes!', 'utf8')
const IV_LENGTH = 16

function getKey(): Buffer {
  return scryptSync(SECRET_KEY, SALT, 32)
}

export function encrypt(plainText: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-cbc', getKey(), iv)
  let encrypted = cipher.update(plainText, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

export function decrypt(cipherText: string): string | null {
  try {
    const parts = cipherText.split(':')
    if (parts.length !== 2) return null
    const iv = Buffer.from(parts[0], 'hex')
    const encrypted = parts[1]
    const decipher = createDecipheriv('aes-256-cbc', getKey(), iv)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    return null
  }
}
