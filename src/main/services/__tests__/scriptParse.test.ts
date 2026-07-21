import { describe, it, expect } from 'vitest'
import { normalizeShotData, findNamesInText, buildAutoVideoPrompt, ensureChinese } from '../scriptParse'

// ===== normalizeShotData =====
describe('normalizeShotData', () => {
  it('空值抛错（seedance parser 不静默吞无效输入）', () => {
    expect(() => normalizeShotData(null)).toThrow()
    expect(() => normalizeShotData(undefined)).toThrow()
    expect(() => normalizeShotData('')).toThrow()
  })

  it('数组格式 — 每个元素作为章节（标准 v0-01 输出）', () => {
    const raw = [
      {
        chapter_title: '第一章',
        shots: [
          { frame_index: 1, description: '镜头1', dialogue: '你好' },
          { frame_index: 2, description: '镜头2' },
        ]
      }
    ]
    const result = normalizeShotData(raw)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].title).toBe('第一章')
    expect(result.chapters[0].shots).toHaveLength(2)
    expect((result.chapters[0].shots[0] as any).shot_index).toBe(1)
    expect((result.chapters[0].shots[1] as any).shot_index).toBe(2)
  })

  it('数组格式 — 无 shots 属性时包装为单章', () => {
    const raw = [
      { frame_index: 1, description: 'desc1' },
      { frame_index: 2, description: 'desc2' },
    ]
    const result = normalizeShotData(raw)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].shots).toHaveLength(2)
  })

  it('已含 chapters 数组', () => {
    const raw = {
      chapters: [
        { title: 'Ch1', shots: [{ description: 'd1' }] },
        { title: 'Ch2', shots: [{ description: 'd2' }, { description: 'd3' }] },
      ]
    }
    const result = normalizeShotData(raw)
    expect(result.chapters).toHaveLength(2)
    expect(result.chapters[1].shots).toHaveLength(2)
  })

  it('scenes 数组 — 每个 scene 有 shots', () => {
    const raw = {
      scenes: [
        { scene_name: '场景A', shots: [{ description: 'd1' }] },
        { scene_name: '场景B', shots: [{ description: 'd2' }] },
      ]
    }
    const result = normalizeShotData(raw)
    expect(result.chapters).toHaveLength(2)
    expect(result.chapters[0].title).toBe('场景A')
  })

  it('scenes 数组 — 无 shots 则每个 scene 作为一个 shot', () => {
    const raw = {
      scenes: [
        { scene_name: 'Scene1', description: 'desc1' },
        { scene_name: 'Scene2', description: 'desc2' },
      ]
    }
    const result = normalizeShotData(raw)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].shots).toHaveLength(2)
  })

  it('单个章节对象（有 shots 属性）', () => {
    const raw = {
      chapter_title: '单章',
      shots: [
        { description: 'd1' },
        { description: 'd2' },
      ]
    }
    const result = normalizeShotData(raw)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].shots).toHaveLength(2)
  })

  it('shot_index 从 frame_index 映射（normalizeShotData 不做 renumber）', () => {
    // P0-1 拆分后 normalizeShotData 只做解析映射，renumber 由 dialogue.ts 管线做
    const raw = {
      shots: [
        { frame_index: 5, description: 'd5' },
        { frame_index: 10, description: 'd10' },
      ]
    }
    const result = normalizeShotData(raw)
    expect((result.chapters[0].shots[0] as any).shot_index).toBe(5)
    expect((result.chapters[0].shots[1] as any).shot_index).toBe(10)
  })

  it('无 frame_index 时自动编号 1,2,3...', () => {
    const raw = {
      shots: [
        { description: 'a' },
        { description: 'b' },
        { description: 'c' },
      ]
    }
    const result = normalizeShotData(raw)
    expect((result.chapters[0].shots[0] as any).shot_index).toBe(1)
    expect((result.chapters[0].shots[1] as any).shot_index).toBe(2)
    expect((result.chapters[0].shots[2] as any).shot_index).toBe(3)
  })

  it('镜9对白保留在 normalizeShotData（清除由 redistributeDialogue 管线做）', () => {
    // P0-1 拆分后 normalizeShotData 只做解析，dialogue 清除由 dialogue.ts 管线负责
    const raw = {
      shots: Array.from({ length: 9 }, (_, i) => ({
        description: `shot ${i + 1}`,
        dialogue: i === 8 ? '不应该存在的对白' : '',
      }))
    }
    const result = normalizeShotData(raw)
    // normalizeShotData 保留原始数据——清除由对话管线负责
    expect((result.chapters[0].shots[8] as any).dialogue).toBe('不应该存在的对白')
  })

  it('duration_seconds 透传（时长计算由 duration.ts 管线做）', () => {
    // P0-1 拆分后 normalizeShotData 只做解析，时长由 assignShotDurations 管线负责
    const raw = {
      shots: [
        { description: '画面镜', duration_seconds: 2 },
        { description: '对白镜', dialogue: '李白：床前明月光疑是地上霜', duration_seconds: 1.5 },
      ]
    }
    const result = normalizeShotData(raw)
    // 透传 AI 原始值 — duration 管线再计算
    expect((result.chapters[0].shots[0] as any).duration_seconds).toBe(2)
    expect((result.chapters[0].shots[1] as any).duration_seconds).toBe(1.5)
  })

  it('对白完整保留在 normalizeShotData（溢流由 dialogue.ts 管线做）', () => {
    // P0-1 拆分后 normalizeShotData 只做解析，对白溢流由 processDialoguePipeline 负责
    const raw = {
      shots: [
        { description: '镜1', dialogue: '李白：床前明月光疑是地上霜举头望明月', duration_seconds: 1.5 },
        { description: '镜2', duration_seconds: 1.5 },
      ]
    }
    const result = normalizeShotData(raw)
    const s1 = result.chapters[0].shots[0] as any
    const s2 = result.chapters[0].shots[1] as any
    // normalizeShotData 保留完整对白，溢流由管线负责
    expect(s1.dialogue).toBe('李白：床前明月光疑是地上霜举头望明月')
    expect((s2.dialogue || '')).toBe('')
  })
})

// ===== findNamesInText =====
describe('findNamesInText', () => {
  it('空文本返回空数组', () => {
    expect(findNamesInText('', ['张三', '李四'])).toEqual([])
  })

  it('精确匹配', () => {
    expect(findNamesInText('张三走进了房间', ['张三', '李四'])).toEqual(['张三'])
    expect(findNamesInText('张三和李四一起', ['张三', '李四'])).toEqual(['张三', '李四'])
  })

  it('无匹配返回空', () => {
    expect(findNamesInText('今天天气不错', ['张三', '李四'])).toEqual([])
  })

  it('部分包含即匹配', () => {
    expect(findNamesInText('张三丰是武林高手', ['张三', '张'])).toEqual(['张三', '张'])
  })

  it('names 为空数组', () => {
    expect(findNamesInText('任意文本', [])).toEqual([])
  })
})

// ===== buildAutoVideoPrompt =====
describe('buildAutoVideoPrompt', () => {
  it('基本 prompt 构建', () => {
    const p = buildAutoVideoPrompt('描述文本', [], '')
    expect(p).toContain('描述文本')
    expect(p).toContain('中景')
    expect(p).toContain('固定')
  })

  it('包含角色名和场景', () => {
    const p = buildAutoVideoPrompt('动作描述', ['张三', '李四'], '大殿')
    expect(p).toContain('张三、李四')
    expect(p).toContain('大殿')
  })

  it('包含时长', () => {
    const p = buildAutoVideoPrompt('desc', [], '', '特写', '推镜头', '自然光', 3.5)
    expect(p).toContain('3.5秒')
    expect(p).toContain('特写')
    expect(p).toContain('推镜头')
  })

  it('有对白时标注 "角色正在说话"', () => {
    const p = buildAutoVideoPrompt('desc', ['角色A'], '', undefined, undefined, undefined, undefined, '你好')
    expect(p).toContain('角色正在说话')
  })

  it('有旁白时标注 "旁白配音中"', () => {
    const p = buildAutoVideoPrompt('desc', [], '', undefined, undefined, undefined, undefined, undefined, '旁白内容')
    expect(p).toContain('旁白配音中')
  })
})

// ===== ensureChinese =====
describe('ensureChinese', () => {
  it('包含中文则直接返回', () => {
    expect(ensureChinese('这是中文描述', 'fallback', 'test')).toBe('这是中文描述')
  })

  it('纯英文回退到 fallback', () => {
    expect(ensureChinese('English only', '回退文本', 'test label')).toBe('回退文本')
  })

  it('空文本回退', () => {
    expect(ensureChinese('', 'fallback', 'label')).toBe('fallback')
  })

  it('fallback 为空时返回原文', () => {
    // ensureChinese 实现: return /[一-鿿]/.test(text) ? text : (fallback || text)
    expect(ensureChinese('no chinese', '', 'label')).toBe('no chinese')
  })
})
