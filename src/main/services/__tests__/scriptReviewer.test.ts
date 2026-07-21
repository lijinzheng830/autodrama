import { describe, it, expect } from 'vitest'
import { quickCheck } from '../scriptReviewer'

describe('quickCheck — 关键词模式匹配', () => {
  it('干净剧本无违规', () => {
    const script = '苏云走在清晨的街道上，阳光洒在她的脸上。她微笑着和邻居打招呼。'
    const findings = quickCheck(script)
    const failed = findings.filter(f => !f.passed)
    expect(failed).toHaveLength(0)
  })

  it('检测复仇关键词 → RL-01 不良价值观', () => {
    const script = '我要为你报仇！血债血偿！杀了他全家！'
    const findings = quickCheck(script)
    const rl01 = findings.find(f => f.ruleId === 'RL-01')
    expect(rl01).toBeDefined()
    expect(rl01!.passed).toBe(false)
    expect(rl01!.matchedContent.length).toBeGreaterThan(0)
  })

  it('检测拜金主义关键词', () => {
    const script = '只要有钱，什么都能解决。这个穷鬼不配和我说话。'
    const findings = quickCheck(script)
    const rl01 = findings.find(f => f.ruleId === 'RL-01')
    expect(rl01!.passed).toBe(false)
  })

  it('检测低俗色情擦边 → RL-02', () => {
    const script = '她穿着若隐若现的衣服，挑逗着看着他，气氛暧昧。'
    const findings = quickCheck(script)
    const rl02 = findings.find(f => f.ruleId === 'RL-02')
    expect(rl02!.passed).toBe(false)
  })

  it('检测封建迷信 → RL-03', () => {
    const script = '那个房间里有鬼魂！必须找道士来驱鬼作法。'
    const findings = quickCheck(script)
    const rl03 = findings.find(f => f.ruleId === 'RL-03')
    expect(rl03!.passed).toBe(false)
  })

  it('检测血腥暴力 → RL-04', () => {
    const script = '鲜血淋淋的断肢散落在地上，内脏和肠子到处都是。'
    const findings = quickCheck(script)
    const rl04 = findings.find(f => f.ruleId === 'RL-04')
    expect(rl04!.passed).toBe(false)
  })

  it('检测侵权与肖像滥用 → RL-05', () => {
    const script = '这个场景使用AI换脸技术，模仿明星的脸。参考火影忍者的打斗风格。'
    const findings = quickCheck(script)
    const rl05 = findings.find(f => f.ruleId === 'RL-05')
    expect(rl05!.passed).toBe(false)
  })

  it('检测危害未成年 → RL-06', () => {
    const script = '几个未成年人在学校打架，校园暴力欺凌同学。'
    const findings = quickCheck(script)
    const rl06 = findings.find(f => f.ruleId === 'RL-06')
    expect(rl06!.passed).toBe(false)
  })

  it('检测广告引流 → TC-03', () => {
    const script = '请扫码关注我们的公众号，加微信了解更多。'
    const findings = quickCheck(script)
    const tc03 = findings.find(f => f.ruleId === 'TC-03')
    expect(tc03!.passed).toBe(false)
  })

  it('检测营销禁用词 → QL-06', () => {
    const script = '这是一部爆款神作！全网最炸裂的热播短剧！'
    const findings = quickCheck(script)
    const ql06 = findings.find(f => f.ruleId === 'QL-06')
    expect(ql06!.passed).toBe(false)
  })

  it('返回全部 16 条规则的结果', () => {
    const script = '正常剧本内容，无任何违规。'
    const findings = quickCheck(script)
    expect(findings).toHaveLength(16)
    expect(findings.every(f => f.passed)).toBe(true)
  })

  it('每条结果包含必要字段', () => {
    const findings = quickCheck('测试文本')
    for (const f of findings) {
      expect(f.ruleId).toBeTruthy()
      expect(f.category).toBeTruthy()
      expect(f.severity).toBeTruthy()
      expect(typeof f.passed).toBe('boolean')
    }
  })

  it('空字符串不报任何违规', () => {
    const findings = quickCheck('')
    expect(findings.every(f => f.passed)).toBe(true)
  })
})
