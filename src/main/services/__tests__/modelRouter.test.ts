import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock settings module — must be hoisted BEFORE import
const mockGetSetting = vi.fn()
const mockGetProviders = vi.fn()

vi.mock('../settings', () => ({
  getSetting: (key: string) => mockGetSetting(key),
  getProviders: () => mockGetProviders(),
}))

// Dynamic import to apply mocks
let resolveModelConfig: any
let resolveProviderConfig: any

beforeEach(async () => {
  // 清除调用记录但保留 hoisted mock 的身份
  vi.clearAllMocks()
  // 每个测试默认无配置
  mockGetSetting.mockReturnValue(undefined)
  mockGetProviders.mockReturnValue([])
  const mod = await import('../modelRouter')
  resolveModelConfig = mod.resolveModelConfig
  resolveProviderConfig = mod.resolveProviderConfig
})

// ===== resolveProviderConfig =====
describe('resolveProviderConfig', () => {
  it('空 providerKey 返回 null', () => {
    expect(resolveProviderConfig('')).toBeNull()
  })

  it('按 key 匹配供应商', () => {
    mockGetProviders.mockReturnValue([
      { key: 'agnes', name: 'Agnes AI', baseURL: 'https://agnes-ai.com/api', apiKey: 'sk-abc', models: [] },
    ])
    const r = resolveProviderConfig('agnes')
    expect(r).toEqual({ baseURL: 'https://agnes-ai.com/api', apiKey: 'sk-abc' })
  })

  it('按 id 匹配', () => {
    mockGetProviders.mockReturnValue([
      { key: 'k1', id: 'id-x', name: 'X', baseURL: 'https://x.com/api', apiKey: 'sk-x', models: [] },
    ])
    expect(resolveProviderConfig('id-x')?.apiKey).toBe('sk-x')
  })

  it('兜底按 name 匹配', () => {
    mockGetProviders.mockReturnValue([
      { key: 'nk', name: 'Agnes AI', baseURL: 'https://a.com/api', apiKey: 'sk-name', models: [] },
    ])
    expect(resolveProviderConfig('Agnes AI')?.apiKey).toBe('sk-name')
  })

  it('无 apiKey → null', () => {
    mockGetProviders.mockReturnValue([
      { key: 'nk', name: 'NK', baseURL: 'https://x.com/api', apiKey: '', models: [] },
    ])
    expect(resolveProviderConfig('nk')).toBeNull()
  })
})

// ===== resolveModelConfig =====
describe('resolveModelConfig', () => {
  const EMPTY = {}

  it('L1: input 参数直接使用', () => {
    const r = resolveModelConfig('ci', EMPTY, 'my:model', 'my-chan', 'sk-in')
    expect(r.model).toBe('my:model')
    expect(r.channel).toBe('my-chan')
    expect(r.apiKey).toBe('sk-in')
  })

  it('L2: 项目配置补全', () => {
    const r = resolveModelConfig('ci', { ci: { model: 'pm', channel: 'pc' } })
    expect(r.model).toBe('pm')
    expect(r.channel).toBe('pc')
  })

  it('L2: input model 优先，项目配置补 channel', () => {
    const r = resolveModelConfig('ci', { ci: { model: 'pm', channel: 'pc' } }, 'im')
    expect(r.model).toBe('im')
    expect(r.channel).toBe('pc')
  })

  it('L3: model_routes 补全', () => {
    mockGetSetting.mockImplementation((k: string) => {
      if (k === 'model_routes') return JSON.stringify({ ci: { model: 'rm', channel: 'rc' } })
      return undefined
    })
    const r = resolveModelConfig('ci', EMPTY)
    expect(r.model).toBe('rm')
    expect(r.channel).toBe('rc')
  })

  it('L3: 非法 JSON 静默忽略', () => {
    mockGetSetting.mockImplementation((k: string) => {
      if (k === 'model_routes') return 'bad{{{'
      return undefined
    })
    const r = resolveModelConfig('ci', EMPTY)
    expect(r.model).toBeUndefined()
  })

  it('L4a: 全局 provider/model', () => {
    mockGetSetting.mockImplementation((k: string) => {
      if (k === 'provider') return 'gp'
      if (k === 'model') return 'gm'
      return undefined
    })
    const r = resolveModelConfig('ci', EMPTY)
    expect(r.model).toBe('gp:gm')
    expect(r.channel).toBe('gp')
  })

  it('L4b: 自动匹配供应商', () => {
    mockGetProviders.mockReturnValue([
      { key: 'p1', baseURL: 'https://p1.com', apiKey: '', models: [] },
      { key: 'p2', baseURL: 'https://p2.com', apiKey: 'sk-p2', models: [{ key: 'mx', name: 'MX', type: 'image', free: false }] },
    ])
    const r = resolveModelConfig('ci', EMPTY)
    expect(r.model).toBe('p2:mx')
    expect(r.channel).toBe('p2')
  })

  it('L4b: 字符串 models 兼容', () => {
    mockGetProviders.mockReturnValue([
      { key: 's', baseURL: 'https://s.com', apiKey: 'sk-s', models: ['str-m'] },
    ])
    const r = resolveModelConfig('ci', EMPTY)
    expect(r.model).toBe('s:str-m')
  })

  it('model 含 : 时 apiKey 从供应商解析', () => {
    mockGetProviders.mockReturnValue([
      { key: 'mp', baseURL: 'https://mp.com', apiKey: 'sk-resolved', models: [] },
    ])
    const r = resolveModelConfig('ci', EMPTY, 'mp:specific-model')
    expect(r.model).toBe('mp:specific-model')
    expect(r.apiKey).toBe('sk-resolved')
  })

  it('全部降级失败 → undefined', () => {
    const r = resolveModelConfig('ci', EMPTY)
    expect(r.model).toBeUndefined()
    expect(r.apiKey).toBeUndefined()
  })

  it('不同 purposeKey 路由隔离', () => {
    mockGetSetting.mockImplementation((k: string) => {
      if (k === 'model_routes') return JSON.stringify({
        first_frame: { model: 'fm', channel: 'fc' },
        video: { model: 'vm', channel: 'vc' },
      })
      return undefined
    })
    expect(resolveModelConfig('first_frame', EMPTY).model).toBe('fm')
    expect(resolveModelConfig('video', EMPTY).model).toBe('vm')
  })

  it('空配置不报错', () => {
    expect(() => resolveModelConfig('k', {})).not.toThrow()
  })
})
