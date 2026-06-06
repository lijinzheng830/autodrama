/**
 * 漫剧剧本审查器 - 基于2026年抖音/红果平台最新审核标准
 *
 * 规则来源：
 * - 2026年3月 红果短剧×抖音《动画微短剧（漫剧）内容创作建议》
 * - 2026年4月 广电总局AI漫剧备案新规
 * - 2026年4月7日 抖音红果漫剧审核大幅收严
 * - 2026年5月 抖音AI短剧审片标准
 */

import { getAIConfig } from './ai'
import { getProviders } from './settings'
import { request as httpsRequest } from 'https'
import { URL } from 'url'

// ============ 专用 AI 调用（使用 https 模块，避免 fetch 兼容问题） ============

function getEffectiveApiConfig(): { apiKey: string; model: string; baseURL: string } {
  // 先检查用户配置的供应商
  const userProviders = getProviders()
  const aiConfig = getAIConfig()
  const provider = aiConfig.provider || 'qwen'

  const userProvider = userProviders.find((p: any) => p.key === provider || p.id === provider)
  let apiKey = (userProvider as any)?.apiKey || aiConfig.apiKey
  let baseURL = (userProvider as any)?.baseURL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const model = aiConfig.model || 'qwen-plus'

  // fallback: 单独读 settings 里的 api_key
  if (!apiKey) {
    try {
      const db = require('./db').getDb()
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`api_key_${provider}`) as { value: string } | undefined
      apiKey = row?.value || ''
    } catch {}
  }

  return { apiKey, model, baseURL }
}

const REVIEWER_LOG = 'C:/Users/Administrator/autodrama_ai_review.log'

function reviewerLog(msg: string): void {
  try {
    const fs = require('fs') as typeof import('fs')
    fs.appendFileSync(REVIEWER_LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

function callAIForReview(messages: Array<{ role: string; content: string }>, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const effective = getEffectiveApiConfig()
    if (!effective.apiKey) return reject(new Error('未配置AI API Key，请前往设置页面配置'))

    const urlObj = new URL(effective.baseURL.replace(/\/$/, '') + '/chat/completions')
    const body = JSON.stringify({
      model: effective.model,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' }
    })

    // 记录请求
    const systemLen = messages[0]?.content?.length || 0
    const userLen = messages[1]?.content?.length || 0
    reviewerLog(`=== 发送请求 ===`)
    reviewerLog(`模型: ${effective.model}`)
    reviewerLog(`System Prompt: ${systemLen}字`)
    reviewerLog(`User Prompt: ${userLen}字 (剧本+审查指令)`)
    reviewerLog(`完整User Prompt前200字: ${messages[1]?.content?.slice(0, 200)}`)

    const req = httpsRequest({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${effective.apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        reviewerLog(`=== 收到响应 ===`)
        reviewerLog(`HTTP状态: ${res.statusCode}`)
        reviewerLog(`原始响应: ${data.slice(0, 3000)}${data.length > 3000 ? `\n...（共${data.length}字，已截断）` : ''}`)
        try {
          const json = JSON.parse(data)
          const content = json.choices?.[0]?.message?.content
          if (content) {
            reviewerLog(`AI审查结果内容: ${content.slice(0, 2000)}${content.length > 2000 ? `\n...（共${content.length}字）` : ''}`)
            resolve(content)
          }
          else {
            reviewerLog(`AI返回错误: ${JSON.stringify(json.error)}`)
            reject(new Error(json.error?.message || 'AI返回内容为空'))
          }
        } catch {
          reviewerLog(`JSON解析失败`)
          reject(new Error(`AI返回解析失败: ${data.slice(0, 200)}`))
        }
      })
    })

    req.on('error', (err: Error) => {
      reviewerLog(`请求失败: ${err.message}`)
      reject(new Error(`API请求失败: ${err.message}`))
    })
    req.on('timeout', () => {
      reviewerLog('请求超时')
      req.destroy()
      reject(new Error('API请求超时'))
    })
    req.write(body)
    req.end()
  })
}

// ============ 审查规则定义 ============

export type RuleCategory = 'redline' | 'quality' | 'technical'
export type Severity = 'fatal' | 'warning' | 'info'

export interface ReviewRule {
  id: string
  category: RuleCategory
  name: string
  description: string
  severity: Severity
  /** 用于快速关键词匹配的关键词/正则列表 */
  patterns: RegExp[]
  /** 用于AI深度审查的提示词 */
  aiCheckPrompt: string
  /** 整改建议模板 */
  suggestion: string
}

export interface ReviewFinding {
  ruleId: string
  category: RuleCategory
  severity: Severity
  ruleName: string
  passed: boolean
  details: string
  matchedContent: string[]
  suggestions: string[]
}

export interface ReviewReport {
  /** 整体判定 */
  overallVerdict: 'pass' | 'conditional_pass' | 'fail'
  /** 0-100评分 */
  score: number
  /** 红线违规数 */
  redlineCount: number
  /** 质量问题数 */
  qualityIssueCount: number
  /** 技术问题数 */
  technicalIssueCount: number
  /** 各项审查结果 */
  findings: ReviewFinding[]
  /** 审查摘要 */
  summary: string
  /** 审查时间 */
  checkedAt: string
  /** 审查模式 */
  mode: 'quick' | 'deep'
}

// ============ 2026年六大红线 ============

const REDLINE_RULES: ReviewRule[] = [
  {
    id: 'RL-01',
    category: 'redline',
    name: '禁止宣扬不良价值观',
    description:
      '严禁拜金主义、极端复仇、性别物化、畸形婚恋、美化出轨或家暴、宣扬不择手段获取财富、持续侮辱他人',
    severity: 'fatal',
    patterns: [
      /拜金|有钱就是|钱能解决|为了钱.*不惜|嫌贫|穷鬼|嫁.*有钱|傍大款|包养/,
      /报仇|复仇|血债血偿|以牙还牙|杀.*全家|弄死|废了.*他/,
      /女人.*就该|男人.*就该|不过是.*女人|花瓶|玩物|工具.*人/,
      /出轨|偷情|小三|劈腿|婚外情|不伦|乱伦|叔嫂|姐夫/,
      /家暴.*爱|打.*才能|揍.*听话|抽.*乖/,
      /不择手段|只要能.*钱|骗.*钱|坑.*钱/,
      /废物|垃圾|蠢货|贱|婊|傻逼|妈的|操|cnm|fuck/
    ],
    aiCheckPrompt: `请严格审查以下剧本是否存在不良价值观问题：
1. 是否宣扬拜金主义（金钱万能、嫌贫爱富、不择手段获取财富）
2. 是否宣扬极端复仇（以暴制暴、私刑、血亲复仇）
3. 是否性别物化（将女性/男性工具化、贬低某一性别）
4. 是否涉及畸形婚恋（出轨、偷情、乱伦、不伦关系）
5. 是否美化家暴（以爱之名的暴力、家暴合理化）
6. 是否持续侮辱他人（脏话、言语羞辱、肢体羞辱）

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述", "quote": "原文引用"}]}`,
    suggestion: '修改相关情节和对白，确保传递积极向上的价值观，避免负面导向内容'
  },
  {
    id: 'RL-02',
    category: 'redline',
    name: '禁止低俗色情擦边',
    description: '严禁暴露着装描述、性暗示台词、低俗性言论、以擦边内容引流变现、性暴力侵害情节',
    severity: 'fatal',
    patterns: [
      /暴露|裸|露.*胸|露.*腿|透视|若隐若现|性感.*诱惑|撩人/,
      /上床|开房|一夜情|约炮|性|呻吟|床戏|肉体|占有.*身体/,
      /勾引|挑逗|调情|暧昧.*暗示|色诱|诱惑.*身体/,
      /强.*暴|侵犯|猥亵|凌辱|性.*侵/,
      /福利|擦边|限.*制.*级|成.*人.*内容/
    ],
    aiCheckPrompt: `请严格审查以下剧本是否存在低俗色情擦边问题：
1. 是否包含暴露着装、身体部位的色情化描写
2. 是否包含性暗示台词或性挑逗情节
3. 是否包含低俗性言论或性诱导
4. 是否涉及性暴力、性侵害情节
5. 是否以擦边内容作为引流卖点

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述", "quote": "原文引用"}]}`,
    suggestion: '删除所有低俗色情暗示内容，确保角色着装和台词符合公序良俗'
  },
  {
    id: 'RL-03',
    category: 'redline',
    name: '禁止封建迷信内容',
    description: '严禁渲染邪祟灵异、玄学改命、现代法术作恶、荒诞离奇封建情节',
    severity: 'fatal',
    patterns: [
      /鬼魂|厉鬼|僵尸|妖怪|邪灵|恶灵|附身|驱鬼|招魂/,
      /法术|施法|作法|符咒|诅咒|下蛊|降头|蛊术/,
      /改命|逆天改命|算命.*改|转运.*法术|风水.*改运/,
      /跳大神|请神|出马|萨满|巫术|邪术/,
      /阴间|地府|阎王|孟婆|奈何桥|投胎/
    ],
    aiCheckPrompt: `请严格审查以下剧本是否存在封建迷信问题：
1. 是否渲染邪祟灵异、鬼怪恐怖内容
2. 是否宣扬法术逆天改命、法术作恶
3. 是否涉及现代背景下的荒诞玄学情节
4. 是否宣扬封建邪祟文化

注意：传统神话改编、仙侠玄幻架空世界观不在此列——仅针对现代背景下宣扬封建迷信的内容。

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述", "quote": "原文引用"}]}`,
    suggestion: '现代背景下的剧本需移除封建迷信元素；如为架空玄幻题材，确保不宣扬封建邪祟思想'
  },
  {
    id: 'RL-04',
    category: 'redline',
    name: '禁止观感不适内容',
    description: '严禁极端血腥恐怖、恶心猎奇、无底线审丑、静态PPT式敷衍内容',
    severity: 'fatal',
    patterns: [
      /血.*淋淋|肢解|分尸|碎尸|砍头|剥皮|挖眼|割舌/,
      /内脏|肠子|脑浆|眼珠.*掉|断肢|残肢/,
      /腐烂|腐尸|蛆|尸虫|恶臭.*尸体|溃烂/,
      /恐怖.*至极|惊悚.*画面|鬼图|吓人.*画面/,
      /呕吐物|排泄物|屎|尿.*恶心/
    ],
    aiCheckPrompt: `请严格审查以下剧本是否存在观感不适问题：
1. 是否包含极端血腥、恐怖、惊悚的视觉描写
2. 是否包含恶心、猎奇、审丑内容
3. 是否存在无底线猎奇情节
4. 剧本制作是否会沦为静态PPT（画面无变化、无动态描述）

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述", "quote": "原文引用"}]}`,
    suggestion: '删减或大幅弱化血腥、恐怖、恶心描写；增加画面动态变化和视觉丰富度'
  },
  {
    id: 'RL-05',
    category: 'redline',
    name: '禁止侵权与肖像滥用',
    description: '严禁未经授权AI换脸、盗用动漫/游戏素材、模仿明星肖像、使用他人版权内容',
    severity: 'fatal',
    patterns: [
      /AI换脸|换脸|deepfake|深度伪造/,
      /明星.*脸|像.*明星|模仿.*长相.*明星|长得像.*明星/,
      /原版.*素材|借用.*素材|别人的.*图|网上.*找.*图/,
      /火影|海贼王|柯南|哆啦A梦|龙珠|进击的巨人|鬼灭之刃|咒术回战/,
      /王者荣耀|原神|崩坏|明日方舟|阴阳师|FGO|碧蓝航线/
    ],
    aiCheckPrompt: `请严格审查以下剧本是否存在侵权与肖像滥用问题：
1. 是否涉及AI换脸技术或深度伪造内容
2. 是否涉及模仿明星/公众人物肖像
3. 是否盗用他人创作的动漫/游戏/影视素材
4. 是否引用受版权保护的知名IP角色或世界观
5. 角色设计是否与知名IP角色高度相似

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述", "quote": "原文引用"}]}`,
    suggestion: '使用原创角色设计和美术素材，避免引用或模仿任何知名IP；不涉及AI换脸技术'
  },
  {
    id: 'RL-06',
    category: 'redline',
    name: '禁止危害未成年及公序良俗',
    description: '严禁未成年人低俗暴力内容、未成年人主动错误行为、恶搞公众人物、损害国家形象',
    severity: 'fatal',
    patterns: [
      /未成年人.*暴力|小孩.*杀|孩子.*犯罪|学生.*打架.*致死/,
      /欺凌.*同学|校园.*暴力|霸凌.*学生|欺负.*弱.*小/,
      /未成年人.*恋爱|早恋|学生.*情侣|未成年.*亲密/,
      /恶搞.*总统|恶搞.*主席|恶搞.*领导|丑化.*国家/,
      /分裂.*国家|台独|港独|藏独|疆独|辱华/,
      /歪曲.*历史|否认.*屠杀|历史虚无/
    ],
    aiCheckPrompt: `请严格审查以下剧本是否存在危害未成年及公序良俗问题：
1. 是否涉及未成年人暴力、欺凌、犯罪行为
2. 是否涉及未成年人低俗、色情内容
3. 是否恶搞现实公众人物
4. 是否损害国家统一与领土主权
5. 是否涉及历史虚无主义或歪曲革命历史
6. 是否涉及民族负面内容

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述", "quote": "原文引用"}]}`,
    suggestion: '移除涉及未成年人不当行为和公序良俗违规内容，确保符合社会主义核心价值观'
  }
]

// ============ 质量要求规则 ============

const QUALITY_RULES: ReviewRule[] = [
  {
    id: 'QL-01',
    category: 'quality',
    name: '单集时长达标',
    description: '单集时长建议≥30秒。预估：按正常语速约150字/分钟，30秒需约75字以上台词或等价描述',
    severity: 'warning',
    patterns: [],
    aiCheckPrompt: `请评估以下剧本单集内容的预估时长是否达标（≥30秒）：
- 按正常语速约150汉字/分钟的台词量估算
- 如果剧本为多集，请逐集评估
- 考虑画面描述、动作描述等非台词内容也会占用时长

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"episode": "集数", "estimatedSeconds": 数字, "isPassing": true/false, "description": "说明"}]}`,
    suggestion: '增加对白、动作描述或场景过渡来扩充单集时长至30秒以上'
  },
  {
    id: 'QL-02',
    category: 'quality',
    name: '剧本结构完整性',
    description: '避免剧集缺失、乱序、断更烂尾、剧情不连贯等问题',
    severity: 'warning',
    patterns: [
      /待续|未完待续|且听下回|预知后事|请看下集/
    ],
    aiCheckPrompt: `请评估以下剧本的结构完整性：
1. 剧本是否有完整的起承转合
2. 各集之间剧情是否连贯
3. 是否存在明显的烂尾或断更迹象
4. 结局是否合理收束

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述"}]}`,
    suggestion: '确保剧本有完整的剧情弧线、合理的结局收束，各集之间剧情连贯无跳跃'
  },
  {
    id: 'QL-03',
    category: 'quality',
    name: '标题/简介/封面一致性',
    description: '剧名、简介、封面应与正片内容一致，避免标题党',
    severity: 'warning',
    patterns: [],
    aiCheckPrompt: `请评估剧本内容与其预期包装的一致性风险：
1. 剧本核心情节是否清晰可概括
2. 是否存在容易被做成"标题党"的夸张情节
3. 剧本是否存在与常见标题党模式匹配的内容
4. 建议的标题和简介方向

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述"}]}`,
    suggestion: '确保剧名、简介和封面准确反映剧本真实内容，不使用误导性标题或封面'
  },
  {
    id: 'QL-04',
    category: 'quality',
    name: 'AI标识合规性',
    description: 'AI生成内容占比≥50%的作品，须在片头前3秒、封面、简介三处标注"本作品含AI生成内容"',
    severity: 'warning',
    patterns: [],
    aiCheckPrompt: `这是一个AI生成内容标识合规检查。请确认：
- 剧本是否主要为AI生成内容（占比≥50%）
- 如果是，需要在片头前3秒、封面、简介标注"本作品含AI生成内容"
- 当前版本是否已包含此标注的说明

请以JSON格式返回：
{"isAIGenerated": true/false, "needsLabel": true/false, "description": "说明"}`,
    suggestion: '如果AI生成内容占比≥50%，请确保在片头前3秒、封面、简介三处标注"本作品含AI生成内容"'
  },
  {
    id: 'QL-05',
    category: 'quality',
    name: '角色塑造与人物价值观',
    description: '确保角色行为传递向善价值观，避免角色塑造脱离正向叙事',
    severity: 'warning',
    patterns: [],
    aiCheckPrompt: `请评估以下剧本的角色塑造：
1. 主角是否有合理的成长弧线
2. 反派是否被适当批判而非美化
3. 角色行为是否传递积极向上价值观
4. 是否存在三观不正的角色被正面描写的风险

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述"}]}`,
    suggestion: '调整角色行为逻辑，确保主角传递正向价值观，反派得到应有的批判'
  },
  {
    id: 'QL-06',
    category: 'quality',
    name: '封面合规',
    description: '封面避免低俗色情元素、恐怖画面、烟酒不良行为、营销夸大词、主体缺失变形等',
    severity: 'warning',
    patterns: [
      /热播|爆款|强推|必看|神作|不看后悔|炸裂|全网.*最/,
      /抽烟|吸烟|喝酒|酗酒|赌博|赌场/
    ],
    aiCheckPrompt: `请审查以下剧本是否存在封面合规风险（基于剧本内容推断封面方向）：
1. 剧本是否包含低俗色情/恐怖惊悚元素可能需要作为封面
2. 是否包含吸烟、酗酒等不良行为场景
3. 主角造型是否存在主体缺失、变形的风险
4. 是否存在被用"热播""爆款""强推"等营销词汇描述的风险

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述"}]}`,
    suggestion: '封面避免使用营销夸大词汇（热播/爆款/强推），不使用烟酒画面，确保主体完整清晰'
  }
]

// ============ 技术规范规则 ============

const TECHNICAL_RULES: ReviewRule[] = [
  {
    id: 'TC-01',
    category: 'technical',
    name: '制作质量：画面/声音/字幕',
    description: '禁止机械配音、音画不同步、人物穿模、画幅异常、字幕缺失错乱',
    severity: 'info',
    patterns: [],
    aiCheckPrompt: `请审查以下剧本在制作层面的潜在质量问题：
1. 剧本是否包含需要复杂口型同步的长段对白（可能增加配音难度）
2. 是否包含需要精确音效配合的特殊场景
3. 人物动作描述是否可能导致穿模（如多人紧密互动、复杂肢体动作）
4. 是否包含需要特定画幅比例的场景

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述"}]}`,
    suggestion: '优化对白节奏以适应配音，简化复杂肢体交互场景，确保字幕与画面对应'
  },
  {
    id: 'TC-02',
    category: 'technical',
    name: '非漫剧体裁检查',
    description: '确保内容为漫剧/短剧形式，而非短视频段子合集、Vlog拼接、纯对话聊天等',
    severity: 'warning',
    patterns: [],
    aiCheckPrompt: `请审查以下剧本是否符合"漫剧/动画微短剧"的体裁要求：
1. 是否有连贯的剧情叙事（而非片段式段子合集）
2. 是否有完整的角色体系和世界观
3. 是否为连续剧集形式（而非独立短视频拼接）
4. 是否为Vlog/日常记录形式

请以JSON格式返回：
{"hasIssue": true/false, "isValidFormat": true/false, "issues": [{"type": "问题类型", "description": "具体描述"}]}`,
    suggestion: '确保内容为连续剧情的动画短剧，而非段子合集或Vlog形式'
  },
  {
    id: 'TC-03',
    category: 'technical',
    name: '广告与外部引流检查',
    description: '禁止非官方渠道广告植入、二维码、外链、其他平台水印/备案号',
    severity: 'info',
    patterns: [
      /扫.*二维码|扫码|加.*微信|关注.*公众号|加.*QQ|点击.*链接/,
      /广告|赞助|合作.*品牌|植入|冠名/,
      /抖音号|快手号|小红书|B站.*关注/
    ],
    aiCheckPrompt: `请审查以下剧本是否包含：
1. 非官方渠道的广告植入
2. 二维码、外链、联系方式
3. 其他平台水印或备案号引用
4. 隐性商业推广内容

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述"}]}`,
    suggestion: '删除所有非官方广告、二维码、外链和平台水印'
  },
  {
    id: 'TC-04',
    category: 'technical',
    name: '集数与节奏合理性',
    description: '避免单集信息量过大或过小、节奏失控导致的用户流失',
    severity: 'info',
    patterns: [],
    aiCheckPrompt: `请评估以下剧本的节奏和集数分配：
1. 各集信息量是否均衡
2. 每集是否有明确的"钩子"或看点
3. 整体节奏是否紧凑（避免拖沓或过快）
4. 建议的优化方向

请以JSON格式返回：
{"hasIssue": true/false, "issues": [{"type": "问题类型", "description": "具体描述"}]}`,
    suggestion: '调整各集信息量均衡，每集设置明确看点，保持节奏紧凑'
  }
]

// ============ 全部规则 ============

const ALL_RULES: ReviewRule[] = [...REDLINE_RULES, ...QUALITY_RULES, ...TECHNICAL_RULES]

// ============ 审查引擎 ============

/**
 * 快速关键词/模式匹配审查
 */
function quickCheck(script: string): ReviewFinding[] {
      const qlog = (_msg: string) => {} // no-op
      // qlog removed
  const findings: ReviewFinding[] = []

  for (const rule of ALL_RULES) {
    const matchedContent: string[] = []
      // qlog removed

    for (let pi = 0; pi < rule.patterns.length; pi++) {
      const pattern = rule.patterns[pi]
      // 安全防护：每个模式限时200ms，超时跳过
      const patStart = Date.now()
      // qlog removed
      // 重置正则的lastIndex
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      let iterCount = 0
      while ((match = pattern.exec(script)) !== null) {
        // 防止死循环
        if (++iterCount > 1000 || Date.now() - patStart > 200) { qlog(`  模式[${pi}] 强制中断 iter=${iterCount}`); break }
        // 检查零长度匹配
        if (match[0].length === 0) { pattern.lastIndex++; if (pattern.lastIndex > script.length) break; continue }
        // 提取匹配内容的前后文
        const start = Math.max(0, match.index - 15)
        const end = Math.min(script.length, match.index + match[0].length + 15)
        const context = script.slice(start, end)
        if (!matchedContent.includes(context)) {
          matchedContent.push(context)
        }
        if (matchedContent.length >= 5) break // 最多5条匹配
      }
      if (Date.now() - patStart > 200) {
      // qlog removed
        pattern.lastIndex = 0 // reset for safety
        break // skip this pattern
      }
      // qlog removed
    }
      // qlog removed

    const passed = matchedContent.length === 0

    findings.push({
      ruleId: rule.id,
      category: rule.category,
      severity: rule.severity,
      ruleName: rule.name,
      passed,
      details: passed
        ? '未检测到明显违规关键词'
        : `检测到 ${matchedContent.length} 处潜在违规关键词`,
      matchedContent,
      suggestions: passed ? [] : [rule.suggestion]
    })
  }

  return findings
}

/**
 * AI深度语义审查（逐条规则进行语义分析）
 */
async function deepCheck(script: string): Promise<ReviewFinding[]> {
  // 先做快速检查收集模式匹配结果
  const quickFindings = quickCheck(script)
  const quickMatchMap = new Map(quickFindings.map((f) => [f.ruleId, f]))

  // 构建AI审查prompt，逐条覆盖全部规则
  const systemPrompt = `你是抖音平台漫剧内容审核员。你的职责是严格审查剧本，找出所有违规点。
你不是在写好评，你是在做合规检查。宁可多报问题，不可漏报。漏报问题会导致作品被下架，是你作为审核员的严重失职。

## 核心审核原则（必须牢记）：

1. 任何暴力打斗细节（拳打、脚踢、掐脖子、击倒、流血）都是违规，即便是主角"正当防卫"
2. 任何反派由主角/私人处置（自行制服、捆绑、关押）都是违规，必须由警方/官方出面
3. 任何宣称"治愈""攻克"重大疾病都是违规，只能表述为"取得突破""带来希望"
4. 任何关于犯罪手法的细节描写都是违规，包括武器使用、监控安装、数据窃取
5. 任何以"复仇"为核心动机的情节都是违规，必须转化为"查明真相""守护""正义"
6. 任何涉及校园/未成年冲突的情节都需要特别警惕
7. 任何生物武器、基因武器等恐怖表述都是违规

## 六大红线逐条审查标准：

### RL-01 不良价值观（违规率最高的条款，务必严格审查）

检查清单（每一项都可能导致违规）：
□ 主角是否主动攻击他人？出拳、踢腿、击倒、锁喉、掐脖子→违规
  示例违规："他冲上去一拳打在对方脸上" "掐住他的脖子按在墙上"
  合规表述："他侧身躲过攻击""他抓住对方手腕使其失去平衡"
□ 是否有"复仇""报仇""血债血偿"等动机描述？
  示例违规："我要为你报仇""杀了他为XX报仇"
  合规表述："我要查明真相""让他们受到法律制裁"
□ 反派是否由主角自行处置（捆住、铐住、关押）而非交给警方？
  示例违规："陈锋把毒蝎铐在椅子上"
  合规表述："警察赶到将毒蝎带走"
□ 是否有美化以暴制暴、私刑正义？
□ 是否有"废物""垃圾""贱人""婊子"等侮辱性词汇？
□ 是否宣扬拜金主义、嫌贫爱富、不择手段赚钱？
□ 是否涉及出轨/偷情/婚外情且未批判？

### RL-02 低俗色情擦边
□ 是否有身体部位的色情化描写（胸部、大腿等特写）？
□ 是否有性暗示台词或暧昧低俗互动？
□ 是否有强奸、性侵、猥亵情节？
□ 是否有黄色笑话或低俗性言论？
注意：正常恋爱牵手/拥抱不属于违规。

### RL-03 封建迷信
□ 是否在现代背景（非仙侠架空）下出现鬼怪、邪灵、僵尸？
□ 是否宣扬法术可改命、作法害人？
□ 是否有跳大神、请神、符咒等描写？
注意：架空修仙/古装神话世界不在此列。

### RL-04 观感不适
□ 是否有血腥描写（流血、中弹、伤口特写）？
  示例违规："鲜血从伤口涌出""子弹击中他的胸口"
  合规表述："他踉跄了一下""她扶住受伤的他"
□ 是否有肢解、分尸、砍头等极端暴力？
□ 是否有腐烂尸骸、蛆虫等恶心描写？

### RL-05 侵权与肖像滥用
□ 是否有AI换脸、深度伪造描述？
□ 是否模仿或影射现实明星/名人？
□ 是否使用火影、海贼王、原神、王者荣耀等知名IP名称或设定？

### RL-06 危害未成年及公序良俗
□ 是否有未成年人打架、欺凌、被暴力对待？
□ 是否有未成年人恋爱（早恋）描写？
□ 是否有校园冲突场景（学生打架、挑衅、威胁）？
□ 是否有恶搞政治人物或公众人物？
□ 是否有分裂国家、歪曲历史的内容？

## 质量要求逐条审查标准：

### QL-01 单集时长
每集是否≥75字（约30秒朗读时长）？逐集列出字数，指出不达标集数。

### QL-02 剧本结构完整性
是否有完整的起承转合？各集是否连贯？是否有烂尾/断更迹象？

### QL-03 标题/封面一致性
是否有标题党风险？描述是否准确反映内容？

### QL-04 AI标识合规
是否标注了AI生成内容标识？AI占比≥50%时必须标注。

### QL-05 角色价值观导向
主角成长是否正向？反派是否被批判而非美化？是否有美化犯罪/暴力？

### QL-06 封面合规
是否有烟酒赌画面？是否使用"热播""爆款""强推""必看"等禁用词？

## 技术规范逐条审查标准：

### TC-01 制作质量
是否有复杂口型同步对白？是否有易穿模的动作描述？

### TC-02 非漫剧体裁
是否为连续剧情？是否像段子合集或Vlog？

### TC-03 广告与外链
是否有二维码、微信号、外链？是否有其他平台水印？

### TC-04 节奏合理性
各集信息量是否均衡？每集是否有看点/钩子？

---
重要提醒：
- 你是在做合规审核，不是在写好评。有问题的必须如实报告。
- 如果剧本中有暴力冲突、复仇情节、犯罪元素，大概率触发RL-01。
- 如果剧本中有打斗受伤、流血，触发RL-04。
- 如果剧本中有校园场景和未成年人，需要特别审查RL-06。
- 即使一条规则没有问题，也必须在findings中包含，标明hasIssue: false。`

  const userPrompt = `作为审核员，请对以下漫剧剧本执行严格的合规审查。

你必须：
1. 先通读全剧，找出所有潜在的风险点
2. 对照16条规则逐条判断是否有问题
3. 每条有问题时必须引用原文作为证据
4. 给出的score必须真实反映问题严重程度（触及红线必须≤50分）

---
${script.slice(0, 8000)}
${script.length > 8000 ? '\n\n[剧本较长，已截取前8000字进行审查]' : ''}
---

返回JSON格式，findings必须包含全部16条规则：
{
  "findings": [
    {"ruleId": "RL-01", "hasIssue": true/false, "description": "有问题写清具体问题，没问题写明'经审查未发现'", "quote": "有问题时必须引用原文（截取关键句）", "suggestion": "有问题时给出具体可操作的修改建议"},
    ...全部16条按RL-01~RL-06, QL-01~QL-06, TC-01~TC-04顺序...
  ],
  "overallAssessment": "简明整体评价，必须包含主要风险点",
  "overallScore": 0-100（严格评分：有任何红线问题≤50，有3条以上问题≤30）
}`

  try {
    const aiResult = await callAIForReview(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      30000
    )

    // 解析AI返回
    let aiData: {
      findings?: Array<{
        ruleId?: string
        hasIssue?: boolean
        description?: string
        quote?: string
        suggestion?: string
      }>
      overallAssessment?: string
      overallScore?: number
    } | null = null

    try {
      // 尝试提取JSON
      const jsonMatch = aiResult.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        aiData = JSON.parse(jsonMatch[0])
      }
    } catch {
      console.error('[deepCheck] 无法解析AI返回的JSON:', aiResult.slice(0, 500))
    }

    // 检查AI返回是否有效
    if (!aiData || !aiData.findings || aiData.findings.length < 10) {
      console.error(`[deepCheck] AI返回不完整(${aiData?.findings?.length || 0}条规则)，回退到快速检查`)
      return quickFindings
    }

    // 合并快速检查和AI深度检查结果
    const mergedFindings: ReviewFinding[] = []

    for (const rule of ALL_RULES) {
      const quickResult = quickMatchMap.get(rule.id)
      const aiFinding = aiData?.findings?.find(
        (f) => f.ruleId === rule.id
      )

      const matchedContent: string[] = []
      if (quickResult && quickResult.matchedContent.length > 0) {
        matchedContent.push(...quickResult.matchedContent)
      }
      if (aiFinding?.quote && !matchedContent.includes(aiFinding.quote)) {
        matchedContent.push(aiFinding.quote)
      }

      // 严格合并逻辑：
      // 1. AI明确说有问题 → 标红（确认违规）
      // 2. AI明确说没问题 → 标绿（AI覆盖关键词误报）
      // 3. AI提到此规则但未在findings中 → 保留关键词结果
      // 4. AI完全没提 → 保留关键词结果
      const aiHasIssue = aiFinding?.hasIssue ?? false
      const aiChecked = aiFinding !== undefined
      const aiCleared = aiChecked && !aiHasIssue
      const quickHasIssue = quickResult ? !quickResult.passed : false
      const hasIssue = aiCleared ? false : (aiHasIssue || quickHasIssue)

      const suggestions: string[] = []
      if (hasIssue) {
        if (aiFinding?.suggestion) suggestions.push(aiFinding.suggestion)
        if (rule.suggestion && !suggestions.includes(rule.suggestion)) {
          suggestions.push(rule.suggestion)
        }
      }

      const detailsParts: string[] = []
      if (quickHasIssue && quickResult) {
        detailsParts.push(`关键词检测：${quickResult.details}`)
      }
      if (aiHasIssue && aiFinding?.description) {
        detailsParts.push(`AI分析：${aiFinding.description}`)
      }
      if (!hasIssue) {
        if (quickHasIssue && aiCleared) {
          detailsParts.push('AI明确判断无此问题，覆盖关键词结果')
        } else if (quickHasIssue) {
          detailsParts.push('AI确认无问题，关键词结果视为误报已忽略')
        } else {
          detailsParts.push('未检测到违规内容')
        }
      }

      mergedFindings.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        ruleName: rule.name,
        passed: !hasIssue,
        details: detailsParts.join('；'),
        matchedContent,
        suggestions
      })
    }

    // 注入AI整体评估到第一个rule的details中（只做标记，不做独立规则）
    if (aiData?.overallAssessment && mergedFindings.length > 0) {
      mergedFindings[0].details += `\n\n【AI整体评估】${aiData.overallAssessment}`
    }

    return mergedFindings
  } catch (err) {
    console.error('[deepCheck] AI审查失败，回退到快速检查:', err)
    return quickCheck(script)
  }
}

/**
 * 生成审查报告
 */
function generateReport(
  findings: ReviewFinding[],
  mode: 'quick' | 'deep',
  aiOverallScore?: number
): ReviewReport {
  const redlineFindings = findings.filter((f) => f.category === 'redline')
  const qualityFindings = findings.filter((f) => f.category === 'quality')
  const technicalFindings = findings.filter((f) => f.category === 'technical')

  const redlineFailed = redlineFindings.filter((f) => !f.passed)
  const qualityFailed = qualityFindings.filter((f) => !f.passed)
  const technicalFailed = technicalFindings.filter((f) => !f.passed)

  // 计算分数
  let score = aiOverallScore ?? 100

  if (aiOverallScore === undefined) {
    // 基于本地检查的扣分逻辑
    const fatalWeight = 20 // 每条红线违规扣20分
    const warningWeight = 8 // 每条质量问题扣8分
    const infoWeight = 3 // 每条技术问题扣3分

    score = Math.max(
      0,
      100 -
        redlineFailed.length * fatalWeight -
        qualityFailed.length * warningWeight -
        technicalFailed.length * infoWeight
    )
  }

  // 判定整体结论
  let overallVerdict: 'pass' | 'conditional_pass' | 'fail'
  if (redlineFailed.length > 0) {
    overallVerdict = 'fail'
  } else if (qualityFailed.length >= 3 || score < 70) {
    overallVerdict = 'conditional_pass'
  } else {
    overallVerdict = 'pass'
  }

  // 生成摘要
  const summaryParts: string[] = []
  if (redlineFailed.length > 0) {
    summaryParts.push(
      `❌ 触犯${redlineFailed.length}条红线：${redlineFailed.map((f) => f.ruleName).join('、')}`
    )
  }
  if (qualityFailed.length > 0) {
    summaryParts.push(
      `⚠️ 存在${qualityFailed.length}个质量问题：${qualityFailed.map((f) => f.ruleName).join('、')}`
    )
  }
  if (technicalFailed.length > 0) {
    summaryParts.push(
      `ℹ️ 发现${technicalFailed.length}个技术建议：${technicalFailed.map((f) => f.ruleName).join('、')}`
    )
  }
  if (summaryParts.length === 0) {
    summaryParts.push('✅ 剧本通过全部审查项，符合2026年抖音漫剧内容审核标准')
  }

  return {
    overallVerdict,
    score,
    redlineCount: redlineFailed.length,
    qualityIssueCount: qualityFailed.length,
    technicalIssueCount: technicalFailed.length,
    findings,
    summary: summaryParts.join('\n'),
    checkedAt: new Date().toISOString(),
    mode
  }
}

// ============ 对外接口 ============

export interface ReviewOptions {
  mode?: 'quick' | 'deep'
}

/**
 * 审查剧本
 */
export async function reviewScript(
  script: string,
  options: ReviewOptions = {}
): Promise<ReviewReport> {
  const mode = options.mode || 'quick'

  if (mode === 'deep') {
    const findings = await deepCheck(script)
    return generateReport(findings, 'deep')
  }

  const findings = quickCheck(script)
  return generateReport(findings, 'quick')
}

/**
 * 获取所有审查规则（供UI展示）
 */
export function getReviewRules(): ReviewRule[] {
  return ALL_RULES
}

/**
 * 获取规则分类统计
 */
export function getRuleStats(): {
  redline: number
  quality: number
  technical: number
  total: number
} {
  return {
    redline: REDLINE_RULES.length,
    quality: QUALITY_RULES.length,
    technical: TECHNICAL_RULES.length,
    total: ALL_RULES.length
  }
}

// ============ AI 修改功能 ============

export interface FixResult {
  /** 修改后的完整剧本 */
  fixedScript: string
  /** 修改点列表 */
  changes: Array<{
    ruleName: string
    original: string
    modified: string
    reason: string
  }>
}

/**
 * 一键修复：将审查发现的所有问题用 AI 自动修改
 */
export async function autoFixScript(
  script: string,
  findings: ReviewFinding[]
): Promise<FixResult> {
  const failedFindings = findings.filter((f) => !f.passed)
  if (failedFindings.length === 0) {
    return { fixedScript: script, changes: [] }
  }

  const issuesText = failedFindings
    .map(
      (f, i) =>
        `${i + 1}. 【${f.ruleName}】${f.details}\n   匹配内容：${f.matchedContent.join('；') || '（无具体匹配，需整体检查）'}\n   整改方向：${f.suggestions.join('；')}`
    )
    .join('\n\n')

  const systemPrompt = `你是漫剧剧本修改专家。你需要根据审查发现的问题，对剧本进行修改。
修改原则：
1. 保持原有剧情结构和人物设定不变
2. 仅修改违规部分，不要改动合规内容
3. 修改后需要符合2026年抖音漫剧审核标准
4. 保持剧本的文学性和可读性
5. 如果原文用【第X集】等标记，保留这些标记

注意：
- 对白中的脏话、侮辱性语言改为文明用语
- 色情擦边描写改为含蓄表达或删除
- 暴力复仇情节改为合法途径解决冲突
- 封建迷信内容改为科学理性表达
- 侵权元素（明星名、IP名）替换为原创名称
- 广告/引流内容删除
- 保持角色性格和故事走向不变`

  const userPrompt = `请根据以下审查发现的问题，修改剧本。

【原剧本】
${script.slice(0, 6000)}${script.length > 6000 ? '\n\n[剧本较长，已截取前6000字]' : ''}

【审查发现的问题】
${issuesText}

请以JSON格式返回修改结果：
{
  "fixedScript": "修改后的完整剧本（保持原格式，包括【第X集】标记和场景描述）",
  "changes": [
    {
      "ruleName": "对应的规则名称",
      "original": "原文片段",
      "modified": "修改后片段",
      "reason": "修改理由"
    }
  ]
}`

  try {
    const aiResult = await callAIForReview(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      60000
    )

    // 解析 AI 返回
    const jsonMatch = aiResult.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0])
      return {
        fixedScript: data.fixedScript || script,
        changes: data.changes || []
      }
    }

    throw new Error('AI返回格式异常')
  } catch (err) {
    console.error('[autoFixScript] AI修改失败:', err)
    throw err
  }
}

/**
 * 逐条修改建议：对单个问题生成具体修改文本
 */
export async function generateFixSuggestion(
  script: string,
  finding: ReviewFinding
): Promise<{ fixedSnippet: string; reason: string }> {
  const systemPrompt = `你是漫剧剧本修改专家。请针对剧本中的一个具体问题，生成修改方案。
只输出JSON格式：{"fixedSnippet": "修改后的文本片段", "reason": "修改理由"}`

  const userPrompt = `【原剧本片段】
${finding.matchedContent.join('\n\n---\n\n') || script.slice(0, 3000)}

【问题描述】
规则：${finding.ruleName}
详情：${finding.details}
整改方向：${finding.suggestions.join('；')}

请针对以上问题，生成一段修改后的文本。只修改有问题的地方，保持原有风格。`

  try {
    const aiResult = await callAIForReview(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      30000
    )

    const jsonMatch = aiResult.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0])
      return {
        fixedSnippet: data.fixedSnippet || '',
        reason: data.reason || ''
      }
    }

    return { fixedSnippet: '', reason: 'AI返回格式异常，请重试' }
  } catch (err) {
    console.error('[generateFixSuggestion] 失败:', err)
    return { fixedSnippet: '', reason: `修改失败：${err instanceof Error ? err.message : '未知错误'}` }
  }
}
