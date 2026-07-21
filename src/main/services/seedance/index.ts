/**
 * Seedance 模块 — 统一出口
 */
export type { OverflowItem, DialogueContext, ComplianceResult, DialoguePlan, RhythmProfile, RhythmWarning, ShotPurpose } from './types'
export { TARGET_TOTAL, DIALOGUE_RATE, SHOT_TYPE_PROFILE, SHOT_9_PROFILE, DEFAULT_RHYTHM_PROFILE } from './types'

export { charCount, speechPrefix, splitByChineseChars, splitBySemanticBoundary,
         ensureShotDescription, truncateDesc, ensureChinese,
         isSuspiciousName, findNamesInText } from './utils'

export { normalizeShotData, normalizeSeedanceData } from './parser'

export { redistributeDialogue, splitDialogueSegments, allocateDialogueSegments, overflowDialogue,
         buildOverflowChapters, consolidateChapters, renumberShots,
         enforceDialogueShotLimit, processDialoguePipeline } from './dialogue'

export { getShotProfile, shotDialogueCapacity, assignShotDurations,
         fixChapterTotalDuration } from './duration'

export { buildSeedanceVideoPrompt, buildSeedanceVideoPromptZh,
         buildAutoVideoPrompt } from './prompt'

export { validateGridCompliance } from './validator'

export { processSeedancePipeline, type PipelineResult } from './pipeline'
