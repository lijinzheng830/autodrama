import { describe, it, expect } from 'vitest'
import { sanitizePromptContent } from '../imageGenerator'

describe('sanitizePromptContent', () => {
  it('干净文本不修改', () => {
    const r = sanitizePromptContent('A beautiful landscape with mountains')
    expect(r.count).toBe(0)
    expect(r.text).toBe('A beautiful landscape with mountains')
  })

  it('替换英文暴力词', () => {
    const r = sanitizePromptContent('He killed the enemy with a sword')
    expect(r.count).toBeGreaterThan(0)
    expect(r.text).not.toContain('killed')
    expect(r.text).toContain('defeated')
  })

  it('替换中文敏感词', () => {
    const r = sanitizePromptContent('战场上血腥的屠杀')
    expect(r.count).toBeGreaterThan(0)
    expect(r.text).not.toContain('屠杀')
  })

  it('古代题材豁免武器词汇过滤', () => {
    const r = sanitizePromptContent('A warrior with a sword on the battlefield', '古代')
    // 古代题材不应过滤 sword/battlefield
    expect(r.text).toContain('sword')
    expect(r.text).toContain('battlefield')
  })

  it('非历史题材不过滤武器', () => {
    const r = sanitizePromptContent('A soldier holding a weapon', '现代')
    expect(r.text).toContain('tool') // weapon→tool
  })

  it('仙侠题材豁免', () => {
    const r = sanitizePromptContent('刀剑相交，战场惨烈', '仙侠')
    expect(r.text).toContain('刀剑')
  })

  it('空文本', () => {
    const r = sanitizePromptContent('')
    expect(r.count).toBe(0)
    expect(r.text).toBe('')
  })

  it('替换后保留原文结构', () => {
    const r = sanitizePromptContent('He slays the dragon')
    expect(r.text).toMatch(/defeats?\s+the\s+dragon/i)
  })

  it('多个敏感词全部替换', () => {
    const r = sanitizePromptContent('blood corpse slave')
    expect(r.count).toBeGreaterThanOrEqual(3)
  })
})
