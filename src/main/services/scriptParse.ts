/**
 * 剧本规范化服务 — 兼容层
 * 实际实现已迁移至 seedance/ 模块，此文件保留为向后兼容导出
 */
export {
  normalizeShotData,
  normalizeSeedanceData,
  findNamesInText,
  buildAutoVideoPrompt,
  ensureChinese,
  validateGridCompliance,
} from './seedance'

export type { ComplianceResult } from './seedance'
