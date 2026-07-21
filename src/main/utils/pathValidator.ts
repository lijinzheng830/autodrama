/**
 * 路径安全校验工具
 */
import { app } from 'electron'
import { resolve, normalize } from 'path'

/**
 * 校验路径是否在 userData 目录内（用于 config 读写等受控操作）
 */
export function isPathAllowed(filePath: string): boolean {
  const resolvedPath = normalize(resolve(filePath))
  const allowedBase = normalize(resolve(app.getPath('userData')))
  return resolvedPath.startsWith(allowedBase + '\\') || resolvedPath.startsWith(allowedBase + '/')
}

/**
 * 校验给定的目录路径是否属于指定项目（防止跨项目路径注入）
 * 匹配规则：路径以 "<project.path>/" 或 "<project.path>\" 开头
 */
export function isProjectPathAllowed(filePath: string, projectPath: string): boolean {
  const resolved = normalize(resolve(filePath))
  const projectRoot = normalize(resolve(projectPath))
  return resolved.startsWith(projectRoot + '\\') || resolved.startsWith(projectRoot + '/')
}
