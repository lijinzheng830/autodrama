/**
 * 结构化日志工具
 * 输出到 stdout/stderr + 用户数据目录下的 app.log
 * 零外部依赖，兼容 Electron main process
 */
import { app } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'

let logFile: string | null = null

function ensureLogFile(): string {
  if (logFile) return logFile
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'app.log')
  } catch {
    logFile = ''
  }
  return logFile
}

function format(level: string, msg: string, data?: unknown): string {
  const ts = new Date().toISOString()
  const payload = data !== undefined ? ' ' + JSON.stringify(data) : ''
  return `[${ts}] [${level}] ${msg}${payload}`
}

function write(level: string, msg: string, data?: unknown): void {
  const line = format(level, msg, data)
  if (level === 'ERROR') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
  const f = ensureLogFile()
  if (f) {
    try { appendFileSync(f, line + '\n', 'utf8') } catch { /* 日志写入失败不阻塞 */ }
  }
}

export const logger = {
  info(msg: string, data?: unknown): void {
    write('INFO', msg, data)
  },
  warn(msg: string, data?: unknown): void {
    write('WARN', msg, data)
  },
  error(msg: string, data?: unknown): void {
    write('ERROR', msg, data)
  },
}
