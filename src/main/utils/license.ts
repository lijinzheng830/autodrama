/**
 * 授权验证模块
 * MVP1：写死返回 true，所有功能不限制
 * MVP2：接入真实授权码验证逻辑
 */

export function checkLicense(): boolean {
  // MVP1：不限制
  return true
}

export function getLicenseInfo(): { valid: boolean; type: string; expiresAt: string | null } {
  // MVP1：免费版，无过期时间
  return {
    valid: true,
    type: 'free',
    expiresAt: null
  }
}
