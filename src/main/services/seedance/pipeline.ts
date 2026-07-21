/**
 * Seedance 后处理管线 — 唯一流程入口
 *
 *   Raw AI JSON
 *     ↓
 *   parser.normalizeSeedanceData()
 *     ↓
 *   dialogue.processDialoguePipeline()
 *     ↓
 *   duration.assignShotDurations()
 *     ↓
 *   validator.validateGridCompliance()
 *     ↓
 *   return { chapters, compliance }
 */
import { normalizeSeedanceData } from './parser'
import { processDialoguePipeline } from './dialogue'
import { assignShotDurations } from './duration'
import { validateGridCompliance } from './validator'
import type { ValidatedSeedanceData } from './types'
import { addStage, summarizeChapters, summarizeCompliance, type PipelineTrace } from './trace'

export type PipelineResult = ValidatedSeedanceData

export interface PipelineOptions {
  trace?: PipelineTrace
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function processSeedancePipeline(raw: any, options?: PipelineOptions): PipelineResult {
  const trace = options?.trace
  const t0 = Date.now()

  // 1. 解析 AI JSON → 标准化结构
  let normalized: ReturnType<typeof normalizeSeedanceData>
  try {
    normalized = normalizeSeedanceData(raw)
    if (trace) addStage(trace, 'parser', Date.now(),
      { rawType: typeof raw },
      summarizeChapters(normalized.chapters as Parameters<typeof summarizeChapters>[0]))
  } catch (e) {
    if (trace) trace.stages.push({ name: 'parser', durationMs: Date.now() - t0, inputSummary: { rawType: typeof raw }, outputSummary: null, warnings: [], error: (e as Error).message })
    throw e
  }

  // 2. 对白处理管线
  let dialogueProcessed: ReturnType<typeof processDialoguePipeline>
  try {
    const t1 = Date.now()
    dialogueProcessed = processDialoguePipeline(normalized.chapters)
    if (trace) addStage(trace, 'dialogue', t1,
      summarizeChapters(normalized.chapters as Parameters<typeof summarizeChapters>[0]),
      summarizeChapters(dialogueProcessed as Parameters<typeof summarizeChapters>[0]))
  } catch (e) {
    if (trace) trace.stages.push({ name: 'dialogue', durationMs: Date.now() - t0, inputSummary: summarizeChapters(normalized.chapters as Parameters<typeof summarizeChapters>[0]), outputSummary: null, warnings: [], error: (e as Error).message })
    throw e
  }

  // 3. 时长分配
  let timeline: ReturnType<typeof assignShotDurations>
  try {
    const t2 = Date.now()
    timeline = assignShotDurations(dialogueProcessed)
    if (trace) addStage(trace, 'duration', t2,
      summarizeChapters(dialogueProcessed as Parameters<typeof summarizeChapters>[0]),
      summarizeChapters(timeline as Parameters<typeof summarizeChapters>[0]))
  } catch (e) {
    if (trace) trace.stages.push({ name: 'duration', durationMs: Date.now() - t0, inputSummary: summarizeChapters(dialogueProcessed as Parameters<typeof summarizeChapters>[0]), outputSummary: null, warnings: [], error: (e as Error).message })
    throw e
  }

  // 4. 合规校验
  let compliance: ReturnType<typeof validateGridCompliance>
  try {
    const t3 = Date.now()
    compliance = validateGridCompliance({ chapters: timeline })
    if (trace) addStage(trace, 'validator', t3,
      summarizeChapters(timeline as Parameters<typeof summarizeChapters>[0]),
      summarizeCompliance(compliance),
      compliance.warnings)
  } catch (e) {
    if (trace) trace.stages.push({ name: 'validator', durationMs: Date.now() - t0, inputSummary: summarizeChapters(timeline as Parameters<typeof summarizeChapters>[0]), outputSummary: null, warnings: [], error: (e as Error).message })
    throw e
  }

  if (trace) trace.totalDurationMs = Date.now() - t0

  return {
    chapters: timeline,
    characters: normalized.characters,
    scenes: normalized.scenes,
    props: normalized.props,
    timePeriod: normalized.timePeriod,
    compliance,
  }
}
