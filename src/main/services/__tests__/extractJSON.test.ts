import { describe, it, expect } from 'vitest'
import { extractJSON } from '../ai'

describe('extractJSON', () => {
  it('直接解析合法 JSON 对象', () => {
    const input = '{"name":"苏云","age":20}'
    const result = extractJSON(input)
    expect(JSON.parse(result)).toEqual({ name: '苏云', age: 20 })
  })

  it('直接解析合法 JSON 数组', () => {
    const input = '[{"id":1},{"id":2}]'
    const result = extractJSON(input)
    expect(JSON.parse(result)).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('从 markdown code block 提取 JSON', () => {
    const input = 'Here is the result:\n```json\n{"key":"value"}\n```\nDone.'
    const result = extractJSON(input)
    expect(JSON.parse(result)).toEqual({ key: 'value' })
  })

  it('从 markdown code block 提取（无 json 标记）', () => {
    const input = 'Output:\n```\n{"key":"value"}\n```'
    const result = extractJSON(input)
    expect(JSON.parse(result)).toEqual({ key: 'value' })
  })

  it('从文本中提取最外层 JSON 对象', () => {
    const input = 'The result is: {"characters": [{"name": "苏云"}, {"name": "叶尘"}], "count": 2}. That is all.'
    const result = extractJSON(input)
    expect(JSON.parse(result)).toEqual({
      characters: [{ name: '苏云' }, { name: '叶尘' }],
      count: 2
    })
  })

  it('修复尾部多余逗号', () => {
    const input = '{"name":"test",}'
    const result = extractJSON(input)
    expect(JSON.parse(result)).toEqual({ name: 'test' })
  })

  it('修复单引号键名（部分模型不遵循 json_object 格式时的输出）', () => {
    const input = "{'name': \"苏云\", 'age': 20, 'shots': [{'id': 1, 'title': \"开场\"}]}"
    const result = extractJSON(input)
    expect(JSON.parse(result)).toEqual({ name: '苏云', age: 20, shots: [{ id: 1, title: '开场' }] })
  })

  it('从文本中提取 JSON 数组', () => {
    const input = 'Generated: [{"scene": "forest"}, {"scene": "castle"}] end'
    const result = extractJSON(input)
    expect(JSON.parse(result)).toEqual([{ scene: 'forest' }, { scene: 'castle' }])
  })

  it('嵌套对象的 JSON 提取', () => {
    const input = '{"data":{"shots":[{"id":"1","characters":[{"name":"苏云","actions":[{"verb":"walk"}]}]}]}}'
    const result = extractJSON(input)
    const parsed = JSON.parse(result)
    expect(parsed.data.shots[0].characters[0].name).toBe('苏云')
  })

  it('包含字符串中花括号的 JSON', () => {
    const input = '{"text":"hello {world}","count":1}'
    const result = extractJSON(input)
    // cleanJSON + indexOf lastBrace 提取最外层
    expect(JSON.parse(result)).toEqual({ text: 'hello {world}', count: 1 })
  })

  it('非法 JSON 抛出错误', () => {
    expect(() => extractJSON('this is just plain text no json')).toThrow('无法从AI返回内容中提取有效JSON')
  })
})
