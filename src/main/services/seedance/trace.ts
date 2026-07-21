/**
 * Pipeline Trace — 阶段观测
 *
 * 每个阶段记录输入/输出摘要、耗时、警告。
 * 用于线上定位：LLM 问题 / parser 问题 / dialogue 问题 / duration 问题。
 */
import type { ComplianceResult, NormalizedChapter } from './types'

export interface StageTrace {
  name: string
  durationMs: number
  inputSummary: Record<string, number | string | null>
  outputSummary: Record<string, number | string | null> | null
  warnings: string[]
  error?: string
}

export interface PipelineTrace {
  stages: StageTrace[]
  totalDurationMs: number
}

export function createTrace(): PipelineTrace {
  return { stages: [], totalDurationMs: 0 }
}

export function addStage(
  trace: PipelineTrace,
  name: string,
  startMs: number,
  inputSummary: Record<string, number | string>,
  outputSummary: Record<string, number | string>,
  warnings: string[] = [],
): void {
  trace.stages.push({
    name,
    durationMs: Date.now() - startMs,
    inputSummary,
    outputSummary,
    warnings,
  })
}

/** Summarize chapters for trace */
export function summarizeChapters(chapters: NormalizedChapter[]): Record<string, number | string> {
  const totalShots = chapters.reduce((s, ch) => s + ch.shots.length, 0)
  const dialogueShots = chapters.reduce(
    (s, ch) => s + ch.shots.filter(sh => sh.dialogue).length,
    0,
  )
  const trackIds = new Set(
    chapters.flatMap(ch => ch.shots.map(s => s.audio_track_id).filter(Boolean)),
  )
  return {
    chapters: chapters.length,
    totalShots,
    dialogueShots,
    audioTracks: trackIds.size,
  }
}

export function summarizeCompliance(c: ComplianceResult): Record<string, number | string> {
  return {
    passed: c.passed ? 1 : 0,
    score: c.score,
    errors: c.errors.length,
    warnings: c.warnings.length,
  }
}
