/**
 * P0.9.8 稳定性验证脚本
 *
 * 不改生产代码，只跑剧本，收数据，验证 Prompt 职责契约是否稳定。
 *
 * 用法:
 *   npx tsx --require ./scripts/preload-electron-mock.cjs ./scripts/run-stability-check.ts
 *
 * 产出:
 *   scripts/results/YYYYMMDD-HHmmss/
 *   +-- summary.json          总览报告
 *   +-- case-a1-argument/
 *   |   +-- ai_response.json
 *   |   +-- pipeline_analysis.json
 *   +-- case-a2-conversation/
 *   ...
 */

import { randomUUID } from 'crypto'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs'

// Must be imported AFTER electron mock is installed (via --require)
import { initDatabase } from '../src/main/services/db'
import { autoProcessSeedance } from '../src/main/services/autoProcess'

const TEST_SCRIPTS_PATH = join(__dirname, 'test-scripts.json')
const USER_DATA = 'C:/Users/Administrator/AppData/Roaming/wuxianchuangyi'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const RESULTS_DIR = join(__dirname, 'results', TIMESTAMP)

interface TestScript {
  id: string
  type: string
  name: string
  description: string
  script: string
}

interface ScriptResult {
  id: string
  type: string
  name: string
  success: boolean
  error?: string
  timingMs: number
  metrics: Metrics | null
}

interface Metrics {
  // AI Design Recovery Rate
  chapterCount: number
  totalShots: number
  purposeAI: number
  purposeFallback: number
  aiPurposePercent: number

  // Pipeline intervention
  overflowCount: number
  r1RenameCount: number
  voiceOverSources: { aiGenerated: number; pipelineGenerated: number }
  voiceOverAIRate: number           // P1: AI自主VO比例

  // Rhythm
  rhythmWarnings: number
  complianceWarnings: string[]

  // Shot composition
  lipSyncShots: number
  voiceOverShots: number
  visualShots: number
  dialogueRatio: number

  // Chapter autonomy (P1: renamed from aiChapterAutonomyRate)
  aiChapterCount: number
  overflowChapterCount: number
  chapterPlanningDivergenceRate: number  // P1: AI规划 vs 最终章数差异

  // P1: 区分预期/非预期溢出
  expectedOverflowCount: number
  unexpectedOverflowCount: number
  unexpectedOverflowRate: number
}

function noop() {}

async function runScript(testScript: TestScript): Promise<ScriptResult> {
  // eslint-disable-next-line no-console
  console.log(`\n========================================`)
  // eslint-disable-next-line no-console
  console.log(`Running: ${testScript.name} (${testScript.id})`)
  // eslint-disable-next-line no-console
  console.log(`Type: ${testScript.type}`)
  // eslint-disable-next-line no-console
  console.log(`Script length: ${testScript.script.length} chars`)
  // eslint-disable-next-line no-console
  console.log(`========================================`)

  const startTime = Date.now()

  try {
    const projectId = randomUUID()
    const progress = { step: 0, status: 'running' as const, message: '' }

    await autoProcessSeedance(
      projectId,
      testScript.script,
      noop,
      noop,
      { mode: 'full' }
    )

    const elapsed = Date.now() - startTime
    return collectResult(testScript, elapsed, null)
  } catch (err) {
    const elapsed = Date.now() - startTime
    const errMsg = err instanceof Error ? err.message : String(err)

    // FOREIGN KEY constraint is expected (random project UUID not in DB).
    // The pipeline completed successfully — ai_response.json and pipeline_analysis.json
    // were already written to disk before the DB save step.
    if (errMsg.includes('FOREIGN KEY')) {
      // eslint-disable-next-line no-console
      console.log(`Pipeline completed, DB save skipped (expected): ${errMsg}`)
      return collectResult(testScript, elapsed, null)
    }

    // eslint-disable-next-line no-console
    console.error(`FAILED after ${(elapsed / 1000).toFixed(1)}s: ${errMsg}`)
    return {
      id: testScript.id,
      type: testScript.type,
      name: testScript.name,
      success: false,
      error: errMsg,
      timingMs: elapsed,
      metrics: null,
    }
  }
}

function collectResult(
  testScript: TestScript,
  elapsed: number,
  _err: string | null
): ScriptResult {
  // Copy output files
  const caseDir = join(RESULTS_DIR, testScript.id)
  mkdirSync(caseDir, { recursive: true })

  const aiResponsePath = join(USER_DATA, 'ai_seedance_response.json')
  const analysisPath = join(USER_DATA, 'pipeline_analysis.json')

  if (existsSync(aiResponsePath)) {
    copyFileSync(aiResponsePath, join(caseDir, 'ai_response.json'))
  }
  if (existsSync(analysisPath)) {
    copyFileSync(analysisPath, join(caseDir, 'pipeline_analysis.json'))
  }

  // Extract metrics
  const metrics = extractMetrics(analysisPath, aiResponsePath)

  // eslint-disable-next-line no-console
  console.log(`Completed in ${(elapsed / 1000).toFixed(1)}s`)
  if (metrics) {
    // eslint-disable-next-line no-console
    console.log(`Metrics: ${JSON.stringify(metrics, null, 2)}`)
  }

  return {
    id: testScript.id,
    type: testScript.type,
    name: testScript.name,
    success: true,
    timingMs: elapsed,
    metrics,
  }
}

function extractMetrics(analysisPath: string, aiResponsePath: string): Metrics | null {
  try {
    const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'))
    const aiResponse = JSON.parse(readFileSync(aiResponsePath, 'utf8'))

    // Count AI chapters vs overflow chapters
    const aiChapterCount = Array.isArray(aiResponse) ? aiResponse.length : 0
    const overflowChapterCount = analysis.chapterCount - aiChapterCount

    // Count voice_over sources
    // AI-generated voice_over = voice_over shots in AI's original plan
    // Pipeline-generated = voice_over shots added by pipeline
    const voiceOverSources = { aiGenerated: 0, pipelineGenerated: 0 }
    if (Array.isArray(aiResponse)) {
      for (const ch of aiResponse) {
        if (ch.shots) {
          for (const s of ch.shots) {
            if (s.dialogue_mode === 'voice_over' || (!s.dialogue_mode && s.narration)) {
              voiceOverSources.aiGenerated++
            }
          }
        }
      }
    }
    // Pipeline-generated = total voice_over - AI-generated
    voiceOverSources.pipelineGenerated =
      analysis.rhythmSummary.stats.voiceOverShots - voiceOverSources.aiGenerated
    if (voiceOverSources.pipelineGenerated < 0) voiceOverSources.pipelineGenerated = 0

    // Count _r1 renames from compliance warnings
    const r1RenameCount = analysis.compliance.warnings.filter(
      (w: string) => w.includes('_r1')
    ).length

    // P1: total VO shots for autonomy rate
    const totalVO = voiceOverSources.aiGenerated + voiceOverSources.pipelineGenerated

    return {
      chapterCount: analysis.chapterCount,
      totalShots: analysis.purposeSource.total,
      purposeAI: analysis.purposeSource.ai,
      purposeFallback: analysis.purposeSource.fallback_keyword + analysis.purposeSource.fallback_index,
      aiPurposePercent: analysis.purposeSource.aiPercent,

      overflowCount: overflowChapterCount > 0 ? overflowChapterCount : 0,
      r1RenameCount,
      voiceOverSources,
      voiceOverAIRate: totalVO > 0 ? Math.round(voiceOverSources.aiGenerated / totalVO * 100) : 0,

      rhythmWarnings: analysis.compliance.rhythmWarnings.length,
      complianceWarnings: analysis.compliance.warnings,

      lipSyncShots: analysis.rhythmSummary.stats.lipSyncShots,
      voiceOverShots: analysis.rhythmSummary.stats.voiceOverShots,
      visualShots: analysis.rhythmSummary.stats.visualShots,
      dialogueRatio: analysis.rhythmSummary.stats.dialogueRatio,

      aiChapterCount,
      overflowChapterCount: Math.max(0, overflowChapterCount),
      chapterPlanningDivergenceRate: analysis.chapterCount > 0
        ? Math.round((1 - Math.abs(analysis.chapterCount - aiChapterCount) / analysis.chapterCount) * 100)
        : 100,
      expectedOverflowCount: Math.min(Math.max(0, overflowChapterCount), Math.max(0, Math.ceil(aiChapterCount * 0.3))),
      unexpectedOverflowCount: Math.max(0, Math.max(0, overflowChapterCount) - Math.max(0, Math.ceil(aiChapterCount * 0.3))),
      unexpectedOverflowRate: analysis.chapterCount > 0
        ? Math.round(Math.max(0, Math.max(0, overflowChapterCount) - Math.max(0, Math.ceil(aiChapterCount * 0.3))) / analysis.chapterCount * 100)
        : 0,
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to extract metrics:', e)
    return null
  }
}

function generateReport(results: ScriptResult[]): string {
  const lines: string[] = []

  lines.push('# P1 稳定性验证报告')
  lines.push('')
  lines.push(`生成时间: ${new Date().toISOString()}`)
  lines.push(`测试剧本数: ${results.length}`)
  lines.push(`成功: ${results.filter(r => r.success).length} / 失败: ${results.filter(r => !r.success).length}`)
  lines.push('')

  // Summary table
  lines.push('## 概览')
  lines.push('')
  lines.push('| 剧本 | 类型 | 章数 | AI Purpose% | 溢出(预期/非预期) | VO(AI/管线) | VO自主率 | 章规划差异 | 耗时 |')
  lines.push('|------|------|------|-----------|-------------------|------------|---------|-----------|------|')
  for (const r of results) {
    if (r.success && r.metrics) {
      const m = r.metrics
      lines.push(`| ${r.name} | ${r.type} | ${m.chapterCount} (AI:${m.aiChapterCount}) | ${m.aiPurposePercent}% | ${m.expectedOverflowCount}/${m.unexpectedOverflowCount} | ${m.voiceOverSources.aiGenerated}/${m.voiceOverSources.pipelineGenerated} | ${m.voiceOverAIRate}% | ${m.chapterPlanningDivergenceRate}% | ${(r.timingMs / 1000).toFixed(0)}s |`)
    } else {
      lines.push(`| ${r.name} | ${r.type} | FAILED | - | - | - | - | - | ${(r.timingMs / 1000).toFixed(0)}s |`)
      if (r.error) lines.push(`| | | ${r.error} | | | | | | |`)
    }
  }
  lines.push('')

  // Target comparison
  lines.push('## 目标达成情况')
  lines.push('')

  const successful = results.filter(r => r.success && r.metrics)
  if (successful.length > 0) {
    const avgAiPurpose = successful.reduce((s, r) => s + (r.metrics?.aiPurposePercent || 0), 0) / successful.length
    const avgOverflow = successful.reduce((s, r) => s + (r.metrics?.overflowChapterCount || 0), 0) / successful.length
    const avgUnexpectedOverflow = successful.reduce((s, r) => s + (r.metrics?.unexpectedOverflowRate || 0), 0) / successful.length
    const avgR1 = successful.reduce((s, r) => s + (r.metrics?.r1RenameCount || 0), 0) / successful.length
    const totalVoPipeline = successful.reduce((s, r) => s + (r.metrics?.voiceOverSources.pipelineGenerated || 0), 0)
    const totalVoAi = successful.reduce((s, r) => s + (r.metrics?.voiceOverSources.aiGenerated || 0), 0)
    const avgVoAiRate = successful.reduce((s, r) => s + (r.metrics?.voiceOverAIRate || 0), 0) / successful.length
    const avgChapterDivergence = successful.reduce((s, r) => s + (r.metrics?.chapterPlanningDivergenceRate || 0), 0) / successful.length
    const avgRhythmWarnings = successful.reduce((s, r) => s + (r.metrics?.rhythmWarnings || 0), 0) / successful.length
    const avgTime = successful.reduce((s, r) => s + r.timingMs, 0) / successful.length

    lines.push('| 指标 | 实际值 | 目标 | 状态 |')
    lines.push('|------|--------|------|------|')
    lines.push(`| AI shot_purpose 比例 | ${avgAiPurpose.toFixed(0)}% | > 80% | ${avgAiPurpose >= 80 ? '[OK]' : '[WARN]'} |`)
    lines.push(`| 章规划差异率 | ${avgChapterDivergence.toFixed(0)}% | > 80% | ${avgChapterDivergence >= 80 ? '[OK]' : '[WARN]'} |`)
    lines.push(`| 非预期溢出率 | ${avgUnexpectedOverflow.toFixed(1)}% | < 5% | ${avgUnexpectedOverflow < 5 ? '[OK]' : '[WARN]'} |`)
    lines.push(`| _r1 重命名数 | ${avgR1.toFixed(1)} | 0 | ${avgR1 === 0 ? '[OK]' : '[WARN]'} |`)
    lines.push(`| VO AI自主率 | ${avgVoAiRate.toFixed(0)}% | > 50% | ${avgVoAiRate >= 50 ? '[OK]' : '[WARN]'} |`)
    lines.push(`| VO 管线生成 / AI生成 | ${totalVoPipeline} / ${totalVoAi} | 管线 < AI | ${totalVoPipeline <= totalVoAi ? '[OK]' : '[WARN]'} |`)
    lines.push(`| 平均 Rhythm Warnings | ${avgRhythmWarnings.toFixed(1)} | < 2 | ${avgRhythmWarnings < 2 ? '[OK]' : '[WARN]'} |`)
    lines.push(`| 平均耗时 | ${(avgTime / 1000).toFixed(0)}s | - | - |`)
  }

  // AI Design Recovery Rate (renamed to Chapter Planning)
  lines.push('')
  lines.push('## Chapter Planning Divergence（章节规划差异率）')
  lines.push('')
  lines.push('| 剧本 | AI自主章 | 最终章数 | 溢出(预期/非预期) | 差异率 | VO AI自主率 |')
  lines.push('|------|---------|---------|-------------------|--------|------------|')
  for (const r of successful) {
    const m = r.metrics!
    lines.push(`| ${r.name} | ${m.aiChapterCount} | ${m.chapterCount} | ${m.expectedOverflowCount}/${m.unexpectedOverflowCount} | ${m.chapterPlanningDivergenceRate}% | ${m.voiceOverAIRate}% |`)
  }

  lines.push('')
  lines.push('## 各剧本详细')
  lines.push('')
  for (const r of successful) {
    const m = r.metrics!
    lines.push(`### ${r.name}`)
    lines.push(`- 类型: ${r.type}`)
    lines.push(`- 总章数: ${m.chapterCount} (AI自主: ${m.aiChapterCount}, Pipeline溢出: ${m.overflowChapterCount})`)
    lines.push(`- 溢出拆解: 预期 ${m.expectedOverflowCount} / 非预期 ${m.unexpectedOverflowCount} (${m.unexpectedOverflowRate}%)`)
    lines.push(`- 章节规划差异率: ${m.chapterPlanningDivergenceRate}%`)
    lines.push(`- 总镜数: ${m.totalShots}`)
    lines.push(`- AI shot_purpose 覆盖: ${m.aiPurposePercent}% (${m.purposeAI}/${m.totalShots})`)
    lines.push(`- 对白/画外音/视觉: ${m.lipSyncShots}/${m.voiceOverShots}/${m.visualShots}`)
    lines.push(`- 对白时长占比: ${m.dialogueRatio}%`)
    lines.push(`- VO来源: AI ${m.voiceOverSources.aiGenerated} + Pipeline ${m.voiceOverSources.pipelineGenerated} (AI自主率: ${m.voiceOverAIRate}%)`)
    lines.push(`- _r1 重命名: ${m.r1RenameCount}`)
    lines.push(`- Rhythm Warnings: ${m.rhythmWarnings}`)
    if (m.complianceWarnings.length > 0) {
      lines.push(`- Compliance Warnings:`)
      for (const w of m.complianceWarnings) {
        lines.push(`  - ${w}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('=== P1 Stability Validation ===')
  // eslint-disable-next-line no-console
  console.log(`Results: ${RESULTS_DIR}`)

  // Init
  mkdirSync(RESULTS_DIR, { recursive: true })

  // Initialize DB
  // eslint-disable-next-line no-console
  console.log('\nInitializing database...')
  initDatabase()

  // Check AI config — providers store the actual API key
  try {
    const db = (await import('../src/main/services/db')).getDb()
    const providerRow = db.prepare("SELECT value FROM settings WHERE key = 'provider'").get() as { value: string } | undefined
    const modelRow = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined
    const providersRow = db.prepare("SELECT value FROM settings WHERE key = 'providers'").get() as { value: string } | undefined

    const provider = providerRow?.value || 'unknown'
    const model = modelRow?.value || 'unknown'
    // eslint-disable-next-line no-console
    console.log(`Provider: ${provider}, Model: ${model}`)

    let hasKey = false
    if (providersRow) {
      try {
        const providers = JSON.parse(providersRow.value)
        for (const p of providers) {
          if (p.apiKey) {
            // eslint-disable-next-line no-console
            console.log(`API Key from provider "${p.name}": ${String(p.apiKey).slice(0, 12)}... (${String(p.apiKey).length} chars)`)
            hasKey = true
          }
        }
      } catch { /* ignore */ }
    }

    if (!hasKey) {
      // Check individual api_key_* entries
      const keyRows = db.prepare("SELECT key FROM settings WHERE key LIKE 'api_key_%'").all() as { key: string }[]
      if (keyRows.length === 0) {
        console.error('ERROR: No API key found in providers or api_key_* settings!')
        process.exit(1)
      }
    }
  } catch (e) {
    console.error('ERROR: Failed to read AI config:', e)
    process.exit(1)
  }

  // Load test scripts
  const testScripts: TestScript[] = JSON.parse(readFileSync(TEST_SCRIPTS_PATH, 'utf8'))
  // eslint-disable-next-line no-console
  console.log(`\nLoaded ${testScripts.length} test scripts\n`)

  // Run each script
  const results: ScriptResult[] = []
  for (const script of testScripts) {
    const result = await runScript(script)
    results.push(result)

    // Brief pause between runs to avoid rate limiting
    if (testScripts.indexOf(script) < testScripts.length - 1) {
      // eslint-disable-next-line no-console
      console.log('\nWaiting 3s before next script...')
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // Generate report
  const report = generateReport(results)
  const reportPath = join(RESULTS_DIR, 'summary.md')
  writeFileSync(reportPath, report, 'utf8')
  // eslint-disable-next-line no-console
  console.log(`\nReport written to: ${reportPath}`)

  // Also write JSON summary
  writeFileSync(join(RESULTS_DIR, 'summary.json'), JSON.stringify(results, null, 2), 'utf8')

  // Print report
  // eslint-disable-next-line no-console
  console.log('\n' + report)

  // Exit with appropriate code
  const failures = results.filter(r => !r.success).length
  process.exit(failures > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
