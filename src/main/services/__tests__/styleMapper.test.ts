import { describe, it, expect } from 'vitest'
import {
  ERA_MAP,
  mapEra,
  fillZhFallback,
  STYLE_PROMPT_ZH,
  getStylePromptZh,
  getStylePrompt,
  getAPISize,
  getAngleSize,
  getAngleLabel,
  getAnglePrompt,
  applyTemplate,
  parseDescField,
} from '../styleMapper'

// ===== ERA_MAP (常量) =====
describe('ERA_MAP', () => {
  it('包含 20 条年代映射', () => {
    expect(Object.keys(ERA_MAP)).toHaveLength(20)
  })

  it('包含常见年代键', () => {
    expect(ERA_MAP).toHaveProperty('古代')
    expect(ERA_MAP).toHaveProperty('现代')
    expect(ERA_MAP).toHaveProperty('仙侠')
    expect(ERA_MAP).toHaveProperty('赛博朋克')
  })

  it('所有值都是非空英文字符串', () => {
    for (const v of Object.values(ERA_MAP)) {
      expect(v).toBeTruthy()
      expect(v.length).toBeGreaterThan(10)
    }
  })
})

// ===== mapEra =====
describe('mapEra', () => {
  it('精确匹配返回英文描述', () => {
    expect(mapEra('古代')).toBe(ERA_MAP['古代'])
    expect(mapEra('赛博朋克')).toBe(ERA_MAP['赛博朋克'])
  })

  it('模糊匹配 — 包含关键词', () => {
    expect(mapEra('古代中国宋朝')).toBe(ERA_MAP['古代'])
    expect(mapEra('仙侠玄幻世界')).toBe(ERA_MAP['仙侠'])
  })

  it('模糊匹配 — 被键包含', () => {
    expect(mapEra('赛博')).toBe(ERA_MAP['赛博朋克'])
    expect(mapEra('蒸汽')).toBe(ERA_MAP['蒸汽朋克'])
  })

  it('空值和空字符串返回空', () => {
    expect(mapEra('')).toBe('')
    expect(mapEra('  ')).toBe('')
  })

  it('未匹配的英文/自定义原样返回', () => {
    expect(mapEra('Victorian era')).toBe('Victorian era')
    expect(mapEra('future sci-fi')).toBe('future sci-fi')
    expect(mapEra('中日混合')).toBe('中日混合')
  })

  it('前后空格不影响匹配', () => {
    expect(mapEra('  现代  ')).toBe(ERA_MAP['现代'])
  })
})

// ===== fillZhFallback =====
describe('fillZhFallback', () => {
  it('空值的 _zh 键回退到英文值', () => {
    const vars = { style_prompt: 'photorealistic', style_prompt_zh: '' }
    fillZhFallback(vars)
    expect(vars.style_prompt_zh).toBe('photorealistic')
  })

  it('已存在的 _zh 值不被覆盖', () => {
    const vars = { era: 'modern', era_zh: '现代都市' }
    fillZhFallback(vars)
    expect(vars.era_zh).toBe('现代都市')
  })

  it('非 _zh 键不受影响', () => {
    const vars = { style_prompt: 'test', era: 'modern', foo: 'bar' }
    fillZhFallback(vars)
    expect(vars.style_prompt).toBe('test')
    expect(vars.era).toBe('modern')
    expect(vars.foo).toBe('bar')
  })

  it('多个 _zh 键同时回退', () => {
    const vars = {
      style_prompt: 's1', style_prompt_zh: '',
      era: 'e1', era_zh: '',
      dialogue: 'd1', dialogue_en: '',
    }
    fillZhFallback(vars)
    expect(vars.style_prompt_zh).toBe('s1')
    expect(vars.era_zh).toBe('e1')
    // dialogue_en 以 _en 结尾，不走 _zh 逻辑
    expect(vars.dialogue_en).toBe('')
  })

  it('空对象不报错', () => {
    const vars: Record<string, string> = {}
    expect(() => fillZhFallback(vars)).not.toThrow()
  })
})

// ===== STYLE_PROMPT_ZH (常量) =====
describe('STYLE_PROMPT_ZH', () => {
  it('包含 14 条风格映射', () => {
    expect(Object.keys(STYLE_PROMPT_ZH)).toHaveLength(14)
  })

  it('所有值都是非空中文字符串', () => {
    for (const v of Object.values(STYLE_PROMPT_ZH)) {
      expect(v).toBeTruthy()
      expect(v.length).toBeGreaterThan(5)
    }
  })
})

// ===== getStylePromptZh =====
describe('getStylePromptZh', () => {
  it('精确匹配返回中文描述', () => {
    expect(getStylePromptZh('二次元动漫', 'default')).toBe(STYLE_PROMPT_ZH['二次元动漫'])
    expect(getStylePromptZh('中国仙侠', 'default')).toBe(STYLE_PROMPT_ZH['中国仙侠'])
  })

  it('模糊匹配返回对应描述', () => {
    expect(getStylePromptZh('二次元', 'fallback')).toBe(STYLE_PROMPT_ZH['二次元动漫'])
    expect(getStylePromptZh('吉卜力风格', 'fallback')).toBe(STYLE_PROMPT_ZH['吉卜力'])
  })

  it('未匹配返回 fallback', () => {
    expect(getStylePromptZh('未知风格', 'default_fallback')).toBe('default_fallback')
  })

  it('空名称返回 fallback', () => {
    expect(getStylePromptZh('', 'fallback')).toBe('fallback')
  })
})

// ===== getAPISize =====
describe('getAPISize', () => {
  it('16:9 → 1920x1088', () => {
    expect(getAPISize('16:9')).toBe('1920x1088')
  })

  it('9:16 → 1088x1936', () => {
    expect(getAPISize('9:16')).toBe('1088x1936')
  })

  it('1:1 → 1088x1088', () => {
    expect(getAPISize('1:1')).toBe('1088x1088')
  })

  it('4:3 → 1456x1088', () => {
    expect(getAPISize('4:3')).toBe('1456x1088')
  })

  it('空值返回 undefined', () => {
    expect(getAPISize('')).toBeUndefined()
  })
})

// ===== getAngleSize =====
describe('getAngleSize', () => {
  it('四个角度都有对应尺寸', () => {
    expect(getAngleSize('front')).toBe('1024x1024')
    expect(getAngleSize('three_quarter')).toBe('1024x768')
    expect(getAngleSize('side')).toBe('768x1024')
    expect(getAngleSize('back')).toBe('1024x1024')
  })
})

// ===== getAngleLabel =====
describe('getAngleLabel', () => {
  it('四个角度都有中文标签', () => {
    expect(getAngleLabel('front')).toContain('正面')
    expect(getAngleLabel('three_quarter')).toContain('45')
    expect(getAngleLabel('side')).toContain('90')
    expect(getAngleLabel('back')).toContain('背面')
  })
})

// ===== getAnglePrompt =====
describe('getAnglePrompt', () => {
  const desc = 'A young woman with long black hair, wearing white dress'
  const style = 'photorealistic'
  const era = 'ancient China'

  it('正面 prompt 包含 front view 关键词', () => {
    const p = getAnglePrompt('front', desc)
    expect(p).toContain('front view')
    expect(p).toContain(desc)
    expect(p).toContain('1024x1024')
  })

  it('侧面 prompt 包含 side profile 关键词', () => {
    const p = getAnglePrompt('side', desc)
    expect(p).toContain('side profile')
    expect(p).toContain('768x1024')
  })

  it('半侧面 prompt 包含 45-degree 关键词', () => {
    const p = getAnglePrompt('three_quarter', desc)
    expect(p).toContain('45-degree')
    expect(p).toContain('1024x768')
  })

  it('背面 prompt 包含 back view 关键词', () => {
    const p = getAnglePrompt('back', desc)
    expect(p).toContain('back view')
  })

  it('可选风格和年代参数', () => {
    const p = getAnglePrompt('front', desc, style, era)
    expect(p).toContain('[Style] photorealistic')
    expect(p).toContain('[Era] ancient China')
  })

  it('无风格年代时不包含对应标签', () => {
    const p = getAnglePrompt('front', desc)
    expect(p).not.toContain('[Style]')
    expect(p).not.toContain('[Era]')
  })
})

// ===== 边界 case：mapEra =====
describe('mapEra — 边界', () => {
  it('空值和空白返回空', () => {
    expect(mapEra('')).toBe('')
    expect(mapEra('  ')).toBe('')
  })

  it('自定义英文原样返回', () => {
    expect(mapEra('Victorian')).toBe('Victorian')
    expect(mapEra('cyberpunk 2077')).toBe('cyberpunk 2077')
  })

  it('已包含在键中（部分匹配）', () => {
    expect(mapEra('蒸汽')).toBe(ERA_MAP['蒸汽朋克'])
  })
})

// ===== 边界 case：fillZhFallback =====
describe('fillZhFallback — 边界', () => {
  it('键不以 _zh 结尾不受影响', () => {
    const vars: Record<string, string> = { name: 'test', name_en: 'test_en' }
    fillZhFallback(vars)
    expect(vars.name).toBe('test')
    expect(vars.name_en).toBe('test_en')
  })

  it('_zh 键有值不被覆盖', () => {
    const vars = { prompt_zh: '中文提示词', prompt: 'english prompt' }
    fillZhFallback(vars)
    expect(vars.prompt_zh).toBe('中文提示词')
  })
})

// ===== 边界 case：getStylePrompt =====
describe('getStylePrompt — 边界', () => {
  it('空名称返回 fallback', () => {
    expect(getStylePrompt('', 'default')).toBe('default')
  })

  it('模糊匹配返回对应描述', () => {
    const result = getStylePrompt('二次元', 'fallback')
    expect(result).toBeTruthy()
    expect(result).not.toBe('fallback')
  })
})

// ===== 边界 case：getAPISize =====
describe('getAPISize — 边界', () => {
  it('2K 分辨率', () => {
    expect(getAPISize('16:9_2k')).toBe('2880x1616')
    expect(getAPISize('1:1_2k')).toBe('2880x2880')
  })

  it('4K 分辨率', () => {
    expect(getAPISize('16:9_4k')).toBe('3840x2160')
    expect(getAPISize('9:16_4k')).toBe('2160x3840')
  })
})

// ===== 边界 case：applyTemplate =====
describe('applyTemplate — 边界', () => {
  it('未匹配变量被清除', () => {
    const result = applyTemplate('Hello {{name}}, {{missing}}', { name: 'World' })
    expect(result).toBe('Hello World, ')
  })

  it('全部匹配', () => {
    const result = applyTemplate('{{a}} {{b}}', { a: '1', b: '2' })
    expect(result).toBe('1 2')
  })

  it('空模板', () => {
    expect(applyTemplate('', { a: '1' })).toBe('')
  })
})

// ===== 边界 case：parseDescField =====
describe('parseDescField — 边界', () => {
  it('空描述返回空', () => {
    expect(parseDescField('', 'Outfit')).toBe('')
  })

  it('提取服装字段', () => {
    const desc = 'Role: 主角. Age: 25. Outfit: 白色长袍，金色腰带. Hair: 黑色长发'
    expect(parseDescField(desc, 'Outfit')).toBe('白色长袍，金色腰带')
  })

  it('字段不存在返回空', () => {
    expect(parseDescField('Role: 主角', 'Weapon')).toBe('')
  })
})
