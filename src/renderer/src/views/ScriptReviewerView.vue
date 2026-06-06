<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Check,
  Loading,
  WarningFilled,
  CircleCheckFilled,
  CircleCloseFilled,
  InfoFilled,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Document,
  Refresh,
  QuestionFilled,
  Tools
} from '@element-plus/icons-vue'

// ========== 本地快速检查（渲染进程内执行，不依赖 IPC）==========

interface LocalRule {
  id: string
  category: 'redline' | 'quality' | 'technical'
  severity: 'fatal' | 'warning' | 'info'
  name: string
  patterns: RegExp[]
  suggestion: string
}

const LOCAL_RULES: LocalRule[] = [
  // ===== 六大红线 =====
  { id: 'RL-01', category: 'redline', severity: 'fatal', name: '禁止宣扬不良价值观',
    patterns: [/拜金|有钱就是|嫌贫|傍大款|包养|报仇|血债血偿|杀.*全家|出轨|偷情|小三|劈腿|婚外情|不伦|家暴.*爱|不择手段.*钱|废物|垃圾|贱|婊/g],
    suggestion: '修改相关情节和对白，确保传递积极向上的价值观' },
  { id: 'RL-02', category: 'redline', severity: 'fatal', name: '禁止低俗色情擦边',
    patterns: [/暴露|裸|露.*胸|上床|开房|一夜情|约炮|呻吟|床戏|肉体|勾引|挑逗|色诱|强.*暴|侵犯|猥亵|凌辱/g],
    suggestion: '删除所有低俗色情暗示内容' },
  { id: 'RL-03', category: 'redline', severity: 'fatal', name: '禁止封建迷信内容',
    patterns: [/鬼魂|厉鬼|僵尸|妖怪|邪灵|附身|驱鬼|法术|施法|作法|符咒|诅咒|下蛊|改命|逆天改命|跳大神|巫术/g],
    suggestion: '现代背景下移除封建迷信元素' },
  { id: 'RL-04', category: 'redline', severity: 'fatal', name: '禁止观感不适内容',
    patterns: [/肢解|分尸|碎尸|砍头|剥皮|挖眼|内脏|肠子|脑浆|腐烂|腐尸|蛆|尸虫/g],
    suggestion: '删减或弱化血腥恐怖描写' },
  { id: 'RL-05', category: 'redline', severity: 'fatal', name: '禁止侵权与肖像滥用',
    patterns: [/AI换脸|换脸|deepfake|模仿.*明星|火影|海贼王|柯南|哆啦A梦|龙珠|王者荣耀|原神|崩坏/g],
    suggestion: '使用原创角色设计和美术素材' },
  { id: 'RL-06', category: 'redline', severity: 'fatal', name: '禁止危害未成年及公序良俗',
    patterns: [/未成年.*暴力|校园.*暴力|霸凌.*学生|早恋|未成年.*亲密|分裂.*国家|台独|港独|辱华|歪曲.*历史/g],
    suggestion: '移除涉及未成年人不当行为的内容' },
  // ===== 六条质量要求 =====
  { id: 'QL-01', category: 'quality', severity: 'warning', name: '单集时长达标',
    patterns: [],
    suggestion: '每集建议≥75字（约30秒朗读时长），检查各集是否达标' },
  { id: 'QL-02', category: 'quality', severity: 'warning', name: '剧本结构完整性',
    patterns: [/待续|未完待续|且听下回|预知后事/g],
    suggestion: '确保剧本有完整剧情弧线和合理结局' },
  { id: 'QL-03', category: 'quality', severity: 'warning', name: '标题/简介/封面一致性',
    patterns: [/标题党|骗点击|文不对题/g],
    suggestion: '确保剧名、简介和封面准确反映剧本真实内容' },
  { id: 'QL-04', category: 'quality', severity: 'warning', name: 'AI标识合规',
    patterns: [],
    suggestion: 'AI生成内容≥50%须在片头前3秒、封面、简介标注"本作品含AI生成内容"' },
  { id: 'QL-05', category: 'quality', severity: 'warning', name: '角色价值观导向',
    patterns: [/反派.*英雄|坏人.*善良|三观不正.*主角|美化.*罪犯/g],
    suggestion: '确保主角传递正向价值观，反派得到应有批判而非美化' },
  { id: 'QL-06', category: 'quality', severity: 'warning', name: '封面合规',
    patterns: [/热播|爆款|强推|必看|神作|不看后悔|炸裂|全网.*最|抽烟|吸烟|喝酒|酗酒/g],
    suggestion: '封面避免营销夸大词和烟酒不良行为展示' },
  // ===== 四条技术规范 =====
  { id: 'TC-01', category: 'technical', severity: 'info', name: '制作质量',
    patterns: [],
    suggestion: '避免复杂口型同步场景，简化肢体交互，确保配音和字幕配合' },
  { id: 'TC-02', category: 'technical', severity: 'info', name: '非漫剧体裁检查',
    patterns: [/段子|搞笑合集|日常vlog|聊天记录|对话.*截图/g],
    suggestion: '确保内容为连续剧情的动画短剧，而非段子合集或Vlog' },
  { id: 'TC-03', category: 'technical', severity: 'info', name: '广告与外部引流',
    patterns: [/扫码|加.*微信|关注.*公众号|加.*QQ|点击.*链接|抖音号|快手号|小红书.*关注/g],
    suggestion: '删除所有非官方广告、二维码、外链和平台水印' },
  { id: 'TC-04', category: 'technical', severity: 'info', name: '集数与节奏',
    patterns: [],
    suggestion: '调整各集信息量均衡，每集设置明确看点，保持节奏紧凑' },
]

function quickCheckLocal(scriptText: string): ReviewFinding[] {
  return LOCAL_RULES.map(rule => {
    const matched: string[] = []
    const indices: MatchedIndex[] = []

    // 正则模式匹配
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(scriptText)) !== null) {
        if (m[0].length === 0) { pattern.lastIndex++; continue }
        const start = Math.max(0, m.index - 15)
        const end = Math.min(scriptText.length, m.index + m[0].length + 15)
        const ctx = scriptText.slice(start, end)
        if (!matched.includes(ctx)) {
          matched.push(ctx)
          indices.push({ start: m.index, end: m.index + m[0].length })
        }
        if (matched.length >= 5) break
      }
    }

    // 无正则模式的规则：做结构化分析
    let extraDetail = ''
    if (rule.id === 'QL-01') {
      const episodes = scriptText.split(/【第\d+集[^】]*】/)
      const shortEps: number[] = []
      for (let i = 1; i < episodes.length; i++) {
        if (episodes[i].length < 75) shortEps.push(i)
      }
      if (scriptText.length < 75 && episodes.length <= 2) {
        extraDetail = '全文不足75字，预估不足30秒'
        matched.push('（全文过短）')
      } else if (shortEps.length > 0) {
        extraDetail = `第${shortEps.join('、')}集不足75字，预估不足30秒`
        matched.push(`第${shortEps.join('、')}集过短`)
      }
    } else if (rule.id === 'QL-04') {
      extraDetail = '如AI生成内容≥50%，需在片头/封面/简介标注。快速检查无法确定AI占比，建议用AI深度审查'
    } else if (rule.id === 'TC-01') {
      const longDialogues = scriptText.match(/[^：\n]{20,}：[^：\n]{50,}/g)
      if (longDialogues && longDialogues.length > 0) {
        extraDetail = `发现${longDialogues.length}处长对白，可能导致配音口型同步困难`
        matched.push(longDialogues[0].slice(0, 60))
      }
    } else if (rule.id === 'TC-04') {
      const eps = scriptText.split(/【第\d+集[^】]*】/).filter(s => s.trim())
      if (eps.length >= 2) {
        const lengths = eps.map(e => e.length)
        const max = Math.max(...lengths)
        const min = Math.min(...lengths)
        if (max > min * 3) {
          extraDetail = `各集长度不均（最短${min}字，最长${max}字），建议平衡信息量`
          matched.push(`集数不均衡：${min}-${max}字`)
        }
      }
    }

    const passed = matched.length === 0
    return {
      ruleId: rule.id,
      category: rule.category,
      severity: rule.severity,
      ruleName: rule.name,
      passed,
      details: passed
        ? (extraDetail || '未检测到违规')
        : (extraDetail || `检测到 ${matched.length} 处潜在违规关键词`),
      matchedContent: matched,
      matchedIndices: indices,
      suggestions: passed ? (extraDetail ? [extraDetail] : []) : [rule.suggestion]
    }
  })
}

function generateReportLocal(findings: ReviewFinding[], mode: string): ReviewReport {
  const redlineFailed = findings.filter(f => f.category === 'redline' && !f.passed)
  const qualityFailed = findings.filter(f => f.category === 'quality' && !f.passed)
  const technicalFailed = findings.filter(f => f.category === 'technical' && !f.passed)

  let score = 100 - redlineFailed.length * 20 - qualityFailed.length * 8 - technicalFailed.length * 3
  score = Math.max(0, score)

  let verdict = 'pass'
  if (redlineFailed.length > 0) verdict = 'fail'
  else if (qualityFailed.length >= 3 || score < 70) verdict = 'conditional_pass'

  const parts: string[] = []
  if (redlineFailed.length > 0) parts.push(`❌ 触犯${redlineFailed.length}条红线：${redlineFailed.map(f => f.ruleName).join('、')}`)
  if (qualityFailed.length > 0) parts.push(`⚠️ 存在${qualityFailed.length}个质量问题：${qualityFailed.map(f => f.ruleName).join('、')}`)
  if (technicalFailed.length > 0) parts.push(`ℹ️ 发现${technicalFailed.length}个技术建议：${technicalFailed.map(f => f.ruleName).join('、')}`)
  if (parts.length === 0) parts.push('✅ 剧本通过全部审查项，符合2026年抖音漫剧内容审核标准')

  return {
    overallVerdict: verdict,
    score,
    redlineCount: redlineFailed.length,
    qualityIssueCount: qualityFailed.length,
    technicalIssueCount: technicalFailed.length,
    findings,
    summary: parts.join('\n'),
    checkedAt: new Date().toISOString(),
    mode
  }
}

// 审查结果类型（与主进程 scriptReviewer.ts 中的接口一致）
interface MatchedIndex { start: number; end: number }
interface ReviewFinding {
  ruleId: string
  category: string
  severity: string
  ruleName: string
  passed: boolean
  details: string
  matchedContent: string[]
  matchedIndices?: MatchedIndex[]
  suggestions: string[]
}

interface ReviewReport {
  overallVerdict: string
  score: number
  redlineCount: number
  qualityIssueCount: number
  technicalIssueCount: number
  findings: ReviewFinding[]
  summary: string
  checkedAt: string
  mode: string
}

const router = useRouter()

// ===== 状态 =====
const script = ref('')
const reviewMode = ref<'quick' | 'deep'>('quick')
const isReviewing = ref(false)
const report = ref<ReviewReport | null>(null)
const activeTab = ref<'all' | 'redline' | 'quality' | 'technical'>('all')
const expandedFindings = ref<Set<string>>(new Set())

// ===== 修改状态 =====
const isFixingItem = ref<string | null>(null)
const fixSnippets = ref<Record<string, { fixedSnippet: string; reason: string }>>({})

// ===== 预置示例 =====
const DEMO_SCRIPT = `【第1集：命运的转折】

场景：现代都市，豪华写字楼内

李明（男主角，28岁，西装革履）坐在总裁办公室，手里拿着一份文件。

李明（自信地）：这个项目，我势在必得。只要拿下它，公司就能进入世界500强。

助理小王推门进来。

小王（恭敬地）：李总，对方公司的代表已经到了。

李明站起身，整理了一下领带。

李明：好，让他们见识一下我们的实力。

[转场：会议室]

对方代表是一位干练的女性——张薇（28岁）。

张薇（微笑）：李总，久仰大名。希望我们合作愉快。

李明（握手）：张总客气了。我相信这次合作对双方都有利。

两人坐下开始商谈，气氛融洽。

[结尾hook]

张薇突然收起笑容：不过李总，我听说你们公司最近遇到了一些麻烦？

李明表情一沉。

【第2集：暗流涌动】

场景：深夜，李明独自在办公室

李明看着电脑屏幕，面色凝重。

李明（内心独白）：她怎么会知道那件事？难道公司内部有内鬼？

手机响起，是老友陈浩打来的。

陈浩（电话中）：明哥，我查到张薇的背景了。她不是普通的商务代表。

李明：什么意思？

陈浩：她和你父亲的破产案有关。

李明震惊地站起来。`

// ===== 计算属性 =====
const filteredFindings = computed(() => {
  if (!report.value) return []
  if (activeTab.value === 'all') return report.value.findings
  return report.value.findings.filter((f) => f.category === activeTab.value)
})

const statsCards = computed(() => {
  if (!report.value) return []
  return [
    {
      label: '红线违规',
      count: report.value.redlineCount,
      icon: CircleCloseFilled,
      color: '#ef4444',
      bg: 'rgba(239,68,68,0.1)'
    },
    {
      label: '质量问题',
      count: report.value.qualityIssueCount,
      icon: WarningFilled,
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.1)'
    },
    {
      label: '技术建议',
      count: report.value.technicalIssueCount,
      icon: InfoFilled,
      color: '#3b82f6',
      bg: 'rgba(59,130,246,0.1)'
    }
  ]
})

const verdictInfo = computed(() => {
  if (!report.value) return null
  switch (report.value.overallVerdict) {
    case 'pass':
      return {
        label: '审核通过',
        color: '#22c55e',
        icon: CircleCheckFilled,
        description: '剧本符合2026年抖音漫剧内容审核标准，可以进入制作阶段'
      }
    case 'conditional_pass':
      return {
        label: '有条件通过',
        color: '#f59e0b',
        icon: WarningFilled,
        description: '剧本存在质量问题需整改，整改后可上线'
      }
    case 'fail':
      return {
        label: '审核不通过',
        color: '#ef4444',
        icon: CircleCloseFilled,
        description: '剧本触犯红线标准，必须修改后重新审查'
      }
    default:
      return {
        label: '审查完成',
        color: '#6b7280',
        icon: InfoFilled,
        description: '剧本审查完成'
      }
  }
})

const scoreColor = computed(() => {
  if (!report.value) return '#6b7280'
  const s = report.value.score
  if (s >= 80) return '#22c55e'
  if (s >= 60) return '#f59e0b'
  return '#ef4444'
})

// ===== 方法 =====
async function startReview(): Promise<void> {
  if (!script.value.trim()) {
    ElMessage.warning('请输入剧本内容')
    return
  }

  isReviewing.value = true
  report.value = null

  try {
    let result: ReviewReport

    if (reviewMode.value === 'quick') {
      // 快速检查：直接在渲染进程执行，不经过 IPC
      const findings = quickCheckLocal(script.value)
      result = generateReportLocal(findings, 'quick')
    } else {
      // AI 深度审查：通过 IPC 调用主进程
      result = await window.api.reviewScript(script.value, { mode: 'deep' })
    }

    // 为来自主进程的结果补充 matchedIndices（主进程不返回索引）
    for (const f of result.findings) {
      if (!f.matchedIndices || f.matchedIndices.length === 0) {
        f.matchedIndices = []
        for (const match of f.matchedContent) {
          let clean = match.replace(/^\.{3}|\.{3}$/g, '').trim()
          if (!clean) continue
          // 逐级缩短查找
          let found = false
          const candidates = [clean]
          if (clean.length > 30) candidates.push(clean.slice(0, Math.floor(clean.length / 2)))
          if (clean.length > 20) candidates.push(clean.slice(0, Math.floor(clean.length / 3)))
          // 取前几个字
          const firstPart = clean.split(/[；;，,。！？\n]+/).filter((s: string) => s.length >= 6)[0]
          if (firstPart && !candidates.includes(firstPart)) candidates.push(firstPart)
          for (const c of candidates) {
            if (script.value.includes(c)) {
              const idx = script.value.indexOf(c)
              f.matchedIndices.push({ start: idx, end: idx + c.length })
              found = true
              break
            }
          }
          if (!found) {
            // 实在找不到，给一个空占位（防止索引数量与matchedContent不一致）
            f.matchedIndices.push({ start: 0, end: 0 })
          }
        }
      }
    }

    report.value = result
    // 自动展开所有未通过的检查项
    expandedFindings.value = new Set(
      result.findings.filter((f) => !f.passed).map((f) => f.ruleId)
    )

    if (result.overallVerdict === 'fail') {
      ElMessage.error(`审查不通过！触犯${result.redlineCount}条红线`)
    } else if (result.overallVerdict === 'conditional_pass') {
      ElMessage.warning(`有条件通过，存在${result.qualityIssueCount}个质量问题需整改`)
    } else {
      ElMessage.success('恭喜！剧本通过审查')
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '审查失败，请重试')
    console.error('审查出错:', err)
  } finally {
    isReviewing.value = false
  }
}

function loadDemo(): void {
  script.value = DEMO_SCRIPT
  report.value = null
  fixSnippets.value = {}
}

function clearScript(): void {
  script.value = ''
  report.value = null
  fixSnippets.value = {}
}

// ===== 逐条修改 =====

// 定位单条匹配
function locateSingleItem(finding: ReviewFinding, itemIdx: number): void {
  if (!scriptTextarea.value) return
  const indices = finding.matchedIndices
  if (indices && indices[itemIdx] && !(indices[itemIdx].start === 0 && indices[itemIdx].end === 0)) {
    const { start, end } = indices[itemIdx]
    selectAndScroll(start, end - start)
    const lineNum = script.value.slice(0, start).split('\n').length
    ElMessage.success('已定位第 ' + lineNum + ' 行')
    return
  }
  const text = finding.matchedContent?.[itemIdx]?.replace(/^\.{3}|\.{3}$/g, '').trim() || ''
  if (text && script.value.includes(text)) {
    const idx = script.value.indexOf(text)
    selectAndScroll(idx, text.length)
    return
  }
  ElMessage.info('无法精确定位')
}

// AI修改单条匹配
async function handleFixSingleItem(finding: ReviewFinding, itemIdx: number): Promise<void> {
  if (!script.value) return
  const key = `${finding.ruleId}_${itemIdx}`
  isFixingItem.value = key
  try {
    // 用本条匹配内容单独请求AI修改
    const matchText = finding.matchedContent[itemIdx] || ''
    const plainFinding = JSON.parse(JSON.stringify({
      ruleId: finding.ruleId,
      category: finding.category,
      severity: finding.severity,
      ruleName: finding.ruleName,
      passed: finding.passed,
      details: finding.details,
      matchedContent: [matchText],
      suggestions: finding.suggestions
    }))
    const result = await window.api.generateFixSuggestion(script.value, plainFinding)
    fixSnippets.value = { ...fixSnippets.value, [key]: result }

    // AI确认误报 → 只标记本条，不影响同规则的其他条
    if (!result.fixedSnippet || /无需修改|无违规|误报|保持原样|原文字.*无.*问题|无.*需要修改/i.test(result.fixedSnippet)) {
      // 不自动消红（单条不足以判断整条规则）
      ElMessage.info('AI认为本条可能为误报')
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '生成修改建议失败')
  } finally {
    isFixingItem.value = null
  }
}

// 替换单条匹配
function replaceSingleItem(finding: ReviewFinding, itemIdx: number, fixSnippet: string): void {
  const indices = finding.matchedIndices
  if (indices && indices[itemIdx]) {
    const { start, end } = indices[itemIdx]
    script.value = script.value.slice(0, start) + fixSnippet + script.value.slice(end)
    report.value = null
    if (scriptTextarea.value) selectAndScroll(start, fixSnippet.length)
    ElMessage.success('已替换')
    return
  }
  // 回退
  const text = finding.matchedContent[itemIdx]?.replace(/^\.{3}|\.{3}$/g, '').trim()
  if (text && script.value.includes(text)) {
    script.value = script.value.replace(text, fixSnippet)
    report.value = null
    const ni = script.value.indexOf(fixSnippet)
    if (ni !== -1 && scriptTextarea.value) selectAndScroll( ni, fixSnippet.length)
    ElMessage.success('已替换')
    return
  }
  ElMessage.warning('无法定位，修改建议已追加到末尾')
}

const scriptTextarea = ref<HTMLTextAreaElement | null>(null)

function selectAndScroll(idx: number, len: number): void {
  const ta = scriptTextarea.value
  if (!ta) return

  const maxLen = script.value.length
  const start = Math.max(0, Math.min(idx, maxLen))
  const end = Math.max(start, Math.min(idx + len, maxLen))
  if (start === end && maxLen > 0) return

  // 精确滚动：算上 textarea 自动折行
  const cs = getComputedStyle(ta)
  const lineH = Math.round(parseFloat(cs.lineHeight) || 25)
  // 一行的字符数（用 textarea 实际宽度和等宽字体估算）
  const taWidth = ta.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
  const charW = 8.4 // 14px等宽字体每字符约8.4px
  const charsPerLine = Math.max(1, Math.floor(taWidth / charW))
  // 计算 start 之前的总视觉行数（换行符 + 自动折行）
  const textBefore = script.value.slice(0, start)
  const hardBreaks = textBefore.split('\n')
  let visualLines = 0
  for (const line of hardBreaks) {
    visualLines += Math.max(1, Math.ceil(line.length / charsPerLine))
  }
  // 先设光标和选区（让浏览器知道目标在哪）
  ta.focus()
  ta.setSelectionRange(start, end)
  // 再滚动（此时浏览器已知光标位置，不会重置）
  // 居中目标：textarea可见行数的一半作为上偏移
  const visibleLines = Math.floor(ta.clientHeight / lineH)
  const offsetLines = Math.floor(visibleLines / 2)
  ta.scrollTop = Math.max(0, (visualLines - offsetLines) * lineH)

  // 外框闪烁
  ta.classList.add('locating')
  setTimeout(() => ta.classList.remove('locating'), 1200)
}

function toggleExpand(ruleId: string): void {
  const newSet = new Set(expandedFindings.value)
  if (newSet.has(ruleId)) {
    newSet.delete(ruleId)
  } else {
    newSet.add(ruleId)
  }
  expandedFindings.value = newSet
}

function getCategoryTag(category: string): { label: string; color: string } {
  switch (category) {
    case 'redline':
      return { label: '红线', color: '#ef4444' }
    case 'quality':
      return { label: '质量', color: '#f59e0b' }
    case 'technical':
      return { label: '技术', color: '#3b82f6' }
    default:
      return { label: '其他', color: '#6b7280' }
  }
}

function getSeverityTag(severity: string): { label: string; color: string } {
  switch (severity) {
    case 'fatal':
      return { label: '严重', color: '#ef4444' }
    case 'warning':
      return { label: '警告', color: '#f59e0b' }
    case 'info':
      return { label: '建议', color: '#3b82f6' }
    default:
      return { label: '未知', color: '#6b7280' }
  }
}

// ===== 快捷键 =====
function handleKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    startReview()
  }
}

// 组件挂载时添加键盘监听
onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="reviewer-container">
    <!-- 顶部导航 -->
    <header class="reviewer-header">
      <div class="header-left">
        <el-button text :icon="ArrowLeft" class="back-btn" @click="router.push('/')">
          返回
        </el-button>
        <h1 class="title">
          <span class="gradient-text">漫剧剧本审查器</span>
          <span class="badge">2026版</span>
        </h1>
      </div>
      <div class="header-right">
        <el-tooltip content="基于2026年抖音×红果《动画微短剧内容创作建议》及广电总局AI漫剧备案新规" placement="bottom">
          <el-button text :icon="QuestionFilled" class="help-btn">审查标准</el-button>
        </el-tooltip>
      </div>
    </header>

    <!-- 主体内容 -->
    <div class="reviewer-body">
      <!-- 左侧：剧本输入 -->
      <div class="panel input-panel">
        <div class="panel-header">
          <div class="panel-title">
            <el-icon><Document /></el-icon>
            <span>剧本内容</span>
          </div>
          <div class="panel-actions">
            <el-button size="small" text @click="loadDemo">加载示例</el-button>
            <el-button size="small" text :icon="Refresh" @click="clearScript">清空</el-button>
          </div>
        </div>
        <textarea
          ref="scriptTextarea"
          v-model="script"
          class="script-input"
          placeholder="在此粘贴漫剧剧本内容...
支持多集剧本，建议包含场景描述、角色对白、动作说明等"
          rows="20"
          style="resize:none"
        />
        <div class="input-footer">
          <div class="char-count">
            {{ script.length }} 字
            <span v-if="script.length > 0">
              （预估 {{ Math.max(1, Math.round(script.length / 150)) }} 分钟阅读时长）
            </span>
          </div>
          <div class="review-controls">
            <el-radio-group v-model="reviewMode" size="small" :disabled="isReviewing">
              <el-radio-button value="quick">
                快速检查
                <el-tooltip content="基于关键词和正则匹配的快速审查，无需联网" placement="top">
                  <el-icon class="mode-hint"><QuestionFilled /></el-icon>
                </el-tooltip>
              </el-radio-button>
              <el-radio-button value="deep">
                AI深度审查
                <el-tooltip content="使用AI进行语义级深度审查，需要配置API（较慢但更准确）" placement="top">
                  <el-icon class="mode-hint"><QuestionFilled /></el-icon>
                </el-tooltip>
              </el-radio-button>
            </el-radio-group>
            <el-button
              type="primary"
              size="large"
              :icon="isReviewing ? Loading : Check"
              :loading="isReviewing"
              @click="startReview"
            >
              {{ isReviewing ? '审查中...' : '开始审查' }}
            </el-button>
          </div>
          <div class="shortcut-hint">Ctrl + Enter 快速审查</div>
        </div>
      </div>

      <!-- 右侧：审查结果 -->
      <div class="panel result-panel">
        <template v-if="!report && !isReviewing">
          <div class="empty-result">
            <div class="empty-icon">
              <el-icon :size="64"><Document /></el-icon>
            </div>
            <h3>等待审查</h3>
            <p>输入剧本后点击「开始审查」或按 Ctrl+Enter</p>
            <div class="empty-tips">
              <h4>审查维度包括：</h4>
              <ul>
                <li><span class="dot red"></span> 六大红线（不良价值观、低俗色情、封建迷信、观感不适、侵权滥用、危害未成年）</li>
                <li><span class="dot yellow"></span> 六大质量要求（单集时长、结构完整、一致性、AI标识、角色塑造、封面合规）</li>
                <li><span class="dot blue"></span> 四大技术规范（制作质量、体裁检查、广告外链、节奏合理性）</li>
              </ul>
            </div>
          </div>
        </template>

        <template v-if="isReviewing">
          <div class="reviewing-state">
            <el-icon :size="48" class="is-loading"><Loading /></el-icon>
            <h3>正在审查中...</h3>
            <p>{{ reviewMode === 'deep' ? 'AI正在逐项深度分析剧本内容，请耐心等待' : '正在执行关键词和模式匹配检查' }}</p>
          </div>
        </template>

        <template v-if="report && !isReviewing">
          <!-- 结论头部 -->
          <div class="verdict-header" :style="{ borderColor: verdictInfo?.color }">
            <div class="verdict-main">
              <el-icon :size="36" :style="{ color: verdictInfo?.color }">
                <component :is="verdictInfo?.icon" />
              </el-icon>
              <div class="verdict-text">
                <h2 :style="{ color: verdictInfo?.color }">{{ verdictInfo?.label }}</h2>
                <p>{{ verdictInfo?.description }}</p>
              </div>
            </div>
            <div class="verdict-score">
              <div class="score-circle" :style="{ borderColor: scoreColor, color: scoreColor }">
                {{ report.score }}
              </div>
              <span class="score-label">综合评分</span>
            </div>
          </div>

          <!-- 统计卡片 -->
          <div class="stats-row">
            <div
              v-for="stat in statsCards"
              :key="stat.label"
              class="stat-card"
              :style="{ borderColor: stat.color, background: stat.bg }"
            >
              <el-icon :size="20" :style="{ color: stat.color }">
                <component :is="stat.icon" />
              </el-icon>
              <span class="stat-count" :style="{ color: stat.color }">{{ stat.count }}</span>
              <span class="stat-label">{{ stat.label }}</span>
            </div>
          </div>

          <!-- 审查摘要 -->
          <div class="summary-box" :class="report.overallVerdict">
            <pre>{{ report.summary }}</pre>
          </div>

          <!-- Tab筛选 -->
          <div class="tab-row">
            <el-radio-group v-model="activeTab" size="small">
              <el-radio-button value="all">
                全部 ({{ report.findings.length }})
              </el-radio-button>
              <el-radio-button value="redline">
                红线 ({{ report.findings.filter(f => f.category === 'redline').length }})
              </el-radio-button>
              <el-radio-button value="quality">
                质量 ({{ report.findings.filter(f => f.category === 'quality').length }})
              </el-radio-button>
              <el-radio-button value="technical">
                技术 ({{ report.findings.filter(f => f.category === 'technical').length }})
              </el-radio-button>
            </el-radio-group>
          </div>

          <!-- 审查详情列表 -->
          <div class="findings-list">
            <div
              v-for="finding in filteredFindings"
              :key="finding.ruleId"
              class="finding-item"
              :class="{ failed: !finding.passed, expanded: expandedFindings.has(finding.ruleId) }"
              @click="toggleExpand(finding.ruleId)"
            >
              <div class="finding-header">
                <div class="finding-status">
                  <el-icon v-if="finding.passed" class="pass-icon">
                    <CircleCheckFilled />
                  </el-icon>
                  <el-icon v-else class="fail-icon">
                    <CircleCloseFilled />
                  </el-icon>
                </div>
                <div class="finding-title">
                  <span class="finding-name">{{ finding.ruleName }}</span>
                  <span
                    class="finding-category-tag"
                    :style="{
                      background: getCategoryTag(finding.category).color + '20',
                      color: getCategoryTag(finding.category).color,
                      border: '1px solid ' + getCategoryTag(finding.category).color + '40'
                    }"
                  >
                    {{ getCategoryTag(finding.category).label }}
                  </span>
                  <span
                    class="finding-severity-tag"
                    :style="{
                      background: getSeverityTag(finding.severity).color + '20',
                      color: getSeverityTag(finding.severity).color,
                      border: '1px solid ' + getSeverityTag(finding.severity).color + '40'
                    }"
                  >
                    {{ getSeverityTag(finding.severity).label }}
                  </span>
                </div>
                <el-icon class="expand-icon">
                  <component
                    :is="expandedFindings.has(finding.ruleId) ? ArrowUp : ArrowDown"
                  />
                </el-icon>
              </div>

              <div class="finding-body" v-show="expandedFindings.has(finding.ruleId)">
                <div class="finding-description">
                  <strong>审查详情：</strong>
                  <p>{{ finding.details }}</p>
                </div>

                <!-- 逐条违规内容 -->
                <div v-if="finding.matchedContent.length > 0" class="finding-matches">
                  <strong style="margin-bottom:6px;display:block">匹配内容（共{{ finding.matchedContent.length }}处）：</strong>
                  <div
                    v-for="(match, idx) in finding.matchedContent"
                    :key="idx"
                    class="match-item-row"
                  >
                    <div class="match-snippet">...{{ match }}...</div>
                    <div class="match-item-actions">
                      <el-button size="small" text type="primary" @click.stop="locateSingleItem(finding, idx)">
                        定位
                      </el-button>
                      <el-button
                        size="small"
                        text
                        type="warning"
                        :icon="Tools"
                        :loading="isFixingItem === `${finding.ruleId}_${idx}`"
                        @click.stop="handleFixSingleItem(finding, idx)"
                      >
                        {{ isFixingItem === `${finding.ruleId}_${idx}` ? 'AI生成中...' : 'AI修改' }}
                      </el-button>
                    </div>
                    <!-- 本条修改结果 -->
                    <div v-if="fixSnippets[`${finding.ruleId}_${idx}`]" class="fix-snippet-result">
                      <div class="fix-snippet-text">
                        <strong>修改：</strong>{{ fixSnippets[`${finding.ruleId}_${idx}`].fixedSnippet }}
                      </div>
                      <div class="fix-snippet-reason">
                        <strong>理由：</strong>{{ fixSnippets[`${finding.ruleId}_${idx}`].reason }}
                      </div>
                      <el-button size="small" type="success" text @click.stop="replaceSingleItem(finding, idx, fixSnippets[`${finding.ruleId}_${idx}`].fixedSnippet)">
                        替换
                      </el-button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部信息 -->
          <div class="report-footer">
            <span>审查时间：{{ new Date(report.checkedAt).toLocaleString('zh-CN') }}</span>
            <span>审查模式：{{ report.mode === 'deep' ? 'AI深度审查' : '快速检查' }}</span>
          </div>
        </template>
      </div>
    </div>

  </div>
</template>

<style scoped>
.reviewer-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #0f0f11 0%, #1a1a20 100%);
  color: #e5e7eb;
}

/* ===== 顶部 ===== */
.reviewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 32px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-btn {
  color: #9ca3af;
}
.back-btn:hover {
  color: #e5e7eb;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
}

.gradient-text {
  background: linear-gradient(90deg, #a78bfa, #60a5fa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.badge {
  font-size: 11px;
  background: linear-gradient(90deg, #a78bfa, #60a5fa);
  color: #fff;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  -webkit-text-fill-color: #fff;
}

.help-btn {
  color: #6b7280;
  font-size: 13px;
}
.help-btn:hover {
  color: #e5e7eb;
}

/* ===== 主体 ===== */
.reviewer-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.input-panel {
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #d1d5db;
}

.panel-actions {
  display: flex;
  gap: 4px;
}

.script-input {
  flex: 1;
  min-height: 0;
}

.script-input {
  flex: 1;
  min-height: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  color: #e5e7eb;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.8;
  padding: 20px 24px;
  resize: none;
  outline: none;
}
.script-input:focus { box-shadow: none; }
.script-input::placeholder { color: #4b5563; }
/* 强可见选中效果 */
.script-input::selection,
.script-input ::selection {
  background: #f59e0b;
  color: #000;
}
.script-input.locating {
  outline: 2px solid #FFD54F;
  outline-offset: -2px;
  transition: outline 0.15s;
}

.input-footer {
  padding: 12px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
}

.char-count {
  font-size: 12px;
  color: #6b7280;
}

.review-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mode-hint {
  font-size: 12px;
  margin-left: 2px;
  cursor: help;
  opacity: 0.5;
}

.shortcut-hint {
  font-size: 11px;
  color: #4b5563;
  text-align: right;
}

/* ===== 结果面板 ===== */
.result-panel {
  overflow-y: auto;
}

.empty-result,
.reviewing-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px;
  text-align: center;
}

.empty-icon {
  color: #374151;
  margin-bottom: 16px;
}

.empty-result h3,
.reviewing-state h3 {
  color: #9ca3af;
  margin: 0 0 8px 0;
}

.empty-result p,
.reviewing-state p {
  color: #6b7280;
  margin: 0 0 24px 0;
  font-size: 14px;
}

.empty-tips {
  text-align: left;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 20px 24px;
  max-width: 400px;
}

.empty-tips h4 {
  margin: 0 0 12px 0;
  color: #9ca3af;
  font-size: 14px;
}

.empty-tips ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.empty-tips li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 13px;
  color: #6b7280;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.red { background: #ef4444; }
.dot.yellow { background: #f59e0b; }
.dot.blue { background: #3b82f6; }

.reviewing-state .is-loading {
  color: #a78bfa;
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ===== 审查结论 ===== */
.verdict-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 2px solid;
  background: rgba(255, 255, 255, 0.02);
}

.verdict-main {
  display: flex;
  align-items: center;
  gap: 16px;
}

.verdict-text h2 {
  margin: 0 0 4px 0;
  font-size: 22px;
  font-weight: 700;
}

.verdict-text p {
  margin: 0;
  font-size: 13px;
  color: #9ca3af;
}

.verdict-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.score-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 3px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.03);
}

.score-label {
  font-size: 11px;
  color: #6b7280;
}

/* ===== 统计卡片 ===== */
.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 16px 24px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid;
}

.stat-count {
  font-size: 28px;
  font-weight: 800;
}

.stat-label {
  font-size: 12px;
  color: #9ca3af;
}

/* ===== 摘要 ===== */
.summary-box {
  margin: 0 24px 16px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
}

.summary-box.fail {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.summary-box.conditional_pass {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.summary-box.pass {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.summary-box pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
  color: #d1d5db;
  line-height: 1.6;
}

/* ===== Tab ===== */
.tab-row {
  padding: 0 24px 12px;
}

/* ===== 审查列表 ===== */
.findings-list {
  padding: 0 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.finding-item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.finding-item:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.1);
}

.finding-item.failed {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.03);
}

.finding-item.expanded {
  border-color: rgba(167, 139, 250, 0.3);
}

.finding-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.finding-status {
  flex-shrink: 0;
}

.pass-icon { color: #22c55e; }
.fail-icon { color: #ef4444; }

.finding-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.finding-name {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
}

.finding-category-tag,
.finding-severity-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.expand-icon {
  color: #6b7280;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

/* ===== 展开详情 ===== */
.finding-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.finding-description p {
  margin: 4px 0 0 0;
  font-size: 13px;
  color: #9ca3af;
  line-height: 1.6;
}

.finding-body strong {
  font-size: 13px;
  color: #d1d5db;
}


.finding-matches {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.match-snippet {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: #fca5a5;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  line-height: 1.5;
  word-break: break-all;
}



/* ===== 底部 ===== */
.report-footer {
  padding: 16px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #4b5563;
  margin-top: auto;
}

/* ===== 响应式 ===== */
@media (max-width: 900px) {
  .reviewer-body {
    flex-direction: column;
  }

  .input-panel {
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    max-height: 45%;
  }

  .result-panel {
    max-height: 55%;
  }

  .stats-row {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* ===== 修改功能 ===== */



















</style>

