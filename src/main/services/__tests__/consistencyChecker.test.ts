import { describe, it, expect } from 'vitest'
import { checkCharacterConsistency, checkShotConsistency } from '../consistencyChecker'

// ===== checkCharacterConsistency =====
describe('checkCharacterConsistency', () => {
  const charDesc = 'A young woman with long jet-black hair flowing past her waist, clear almond-shaped brown eyes, and fair porcelain skin. She wears a moon-white crossed-collar ruqun dress with a pale cyan outer jacket.'

  it('完全一致时返回空数组', () => {
    const shotPrompt = 'A young woman with long black hair flowing past her waist. She wears a white dress. Close-up front view.'
    const warnings = checkCharacterConsistency(shotPrompt, charDesc, '苏云')
    expect(warnings).toHaveLength(0)
  })

  it('发色不一致时返回告警', () => {
    const shotPrompt = 'A young woman with golden blonde hair. She wears a white dress. Full body view.'
    const warnings = checkCharacterConsistency(shotPrompt, charDesc, '苏云')
    expect(warnings.length).toBeGreaterThan(0)
    const hairWarn = warnings.find(w => w.attribute === '发色')
    expect(hairWarn).toBeDefined()
    expect(hairWarn!.expected).toContain('black')
    // 'blonde' 比 'golden' 离 'hair' 更近，取最近颜色词
    expect(['golden', 'blonde']).toContain(hairWarn!.found)
  })

  it('瞳色不一致时返回告警', () => {
    const shotPrompt = 'Close-up portrait with piercing blue eyes. Long black hair.'
    const warnings = checkCharacterConsistency(shotPrompt, charDesc, '苏云')
    const eyeWarn = warnings.find(w => w.attribute === '瞳色')
    expect(eyeWarn).toBeDefined()
  })

  it('描述为空时返回空数组', () => {
    expect(checkCharacterConsistency('', charDesc, '苏云')).toHaveLength(0)
    expect(checkCharacterConsistency('some prompt', '', '苏云')).toHaveLength(0)
  })

  it('分镜 prompt 未提及某属性时，该属性不告警', () => {
    // prompt 中没有眼瞳相关描述 → 不报瞳色不一致
    const shotPrompt = 'Full body shot of a character with long black hair. White dress flowing in wind.'
    const warnings = checkCharacterConsistency(shotPrompt, charDesc, '苏云')
    const eyeWarn = warnings.find(w => w.attribute === '瞳色')
    expect(eyeWarn).toBeUndefined()
  })

  it('同色系视为一致（black ≈ dark ≈ jet-black）', () => {
    // 发色 dark ≈ jet-black，服装 white ≈ moon-white
    const shotPrompt = 'A woman with dark hair and white dress. Side view.'
    const warnings = checkCharacterConsistency(shotPrompt, charDesc, '苏云')
    expect(warnings).toHaveLength(0)
  })
})

// ===== checkShotConsistency =====
describe('checkShotConsistency', () => {
  it('批量检查多个角色', () => {
    const chars = [
      { name: '苏云', description: 'Young woman with long black hair, brown eyes, white dress.' },
      { name: '叶尘', description: 'A man with short silver hair, golden eyes, black robe.' },
    ]
    // prompt 把苏云的发色写错了
    const shotPrompt = '苏云 with golden hair in white dress. 叶尘 with silver hair in black robe.'
    const warnings = checkShotConsistency(shotPrompt, chars)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].characterName).toBe('苏云')
  })

  it('全部一致时返回空数组', () => {
    const chars = [
      { name: '苏云', description: 'Young woman with long black hair.' },
    ]
    const shotPrompt = '苏云 with long black hair. Front view.'
    expect(checkShotConsistency(shotPrompt, chars)).toHaveLength(0)
  })

  it('角色无描述时跳过', () => {
    const chars = [
      { name: '路人甲', description: null },
    ]
    expect(checkShotConsistency('路人甲 with red hair', chars)).toHaveLength(0)
  })
})
