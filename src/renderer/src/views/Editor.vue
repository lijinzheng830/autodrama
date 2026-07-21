<script setup lang="ts">
import '../assets/global.css'
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft,
  ArrowRight,
  Setting,
  Plus,
  VideoPlay,
  DocumentAdd,
  Upload,
  Grid,
  Document,
  RefreshLeft,
  RefreshRight,
  Delete,
  Download,
  Close
} from '@element-plus/icons-vue'
import { useEditorStore } from '../stores/editor'
import CanvasView from './CanvasView.vue'
import AssetPanel from '../components/AssetPanel.vue'
import GenerationOrchestrator from '../components/GenerationOrchestrator.vue'
import ShotListCard from '../components/ShotListCard.vue'
import { useTopToolbar } from '../composables/useTopToolbar'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id as string
const store = useEditorStore()




interface Project {
  id: string
  name: string
  path: string
  style_name: string
  style_prompt: string
  style_negative_prompt: string
  aspect_ratio: string
  created_at: number
  updated_at: number
  script_text?: string
  era?: string
  model_config_json?: string
}

const project = ref<Project | null>(null)
const activeNav = ref('overview')
const currentModel = ref('')

// 风格/比例
const selectedStyle = ref('')
const selectedAspectRatio = ref('16:9')

// 项目数据（剧集结构页用）
const projectData = ref<any>(null)
const episodesLoading = ref(false)

// 项目统计
const projectStats = ref({ characters: 0, scenes: 0, props: 0, chapters: 0, shots: 0 })

// 全选
const selectedShots = ref<Set<string>>(new Set())

// 右侧面板
const panelMode = ref<'resident' | 'detail'>('resident')
const residentTab = ref<'characters' | 'scenes' | 'props' | 'videos'>('characters')
const detailType = ref('')
const detailData = ref<any>(null)
const searchKeyword = ref('')

// 编辑状态
const editingCell = ref<{ shotId: string; field: string } | null>(null)
const editText = ref('')

// 视图模式
const viewMode = ref<'table' | 'canvas'>('table')

// 生成记录弹窗
const genRecordVisible = ref(false)
const genRecords = ref<any[]>([])
const genRecordTab = ref<'video' | 'image' | 'other'>('image')
const genRecordStatusFilter = ref<'all' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'>('all')
const genRecordTypeFilter = ref<
  | 'all'
  | 'character_reference'
  | 'scene_reference'
  | 'prop_reference'
>('all')

function setGenRecordTab(tab: string): void {
  genRecordTab.value = tab as any
  genRecordTypeFilter.value = 'all'
}

// 任务播报条
const broadcastTimer = ref<number | null>(null)
const broadcastAllDone = ref(false)
const broadcastAllDoneTimer = ref<number | null>(null)
const broadcastItems = ref<Array<{ label: string; current: number; total: number }>>([])

// 项目名称编辑
const editingProjectName = ref(false)
const projectNameEdit = ref('')

// Popover 控制
const stylePopoverVisible = ref(false)
const eraPopoverVisible = ref(false)

// 年代预设
const eraPresets = ['古代', '近代', '现代', '未来', '末世废土', '仙侠', '架空世界', '赛博朋克', '蒸汽朋克']
const customEra = ref('')

// 模型配置弹窗
const modelConfigVisible = ref(false)
const modelConfigTab = ref(0)
const modelConfigMode = ref('novice')
const modelConfig = ref<Record<string, any>>({})
const providerModels = ref<any[]>([])
const providerChannels = ref<any[]>([])
const modelConfigTemplates = ref<any[]>([])
const modelConfigTemplateTab = ref('official')
const modelConfigRefImages = ref<Record<string, string>>({})

async function handleSelectRefImage(): Promise<void> {
  const tabKey = modelConfigTabs[modelConfigTab.value].key
  try {
    const proj = await window.api.getProject(projectId) as any
    const result = await window.api.selectImage(proj.path)
    if (result) {
      modelConfigRefImages.value[tabKey] = result
      setModelConfigField(tabKey, 'refImage', result)
    }
  } catch (_err) {
    ElMessage.error('选择图片失败')
  }
}

function handleRemoveRefImage(): void {
  const tabKey = modelConfigTabs[modelConfigTab.value].key
  delete modelConfigRefImages.value[tabKey]
  setModelConfigField(tabKey, 'refImage', '')
}

const modelConfigTabs = [
  { key: 'language_model', label: '语言模型' },
  { key: 'script_rewrite', label: '单分镜剧本改写' },
  { key: 'character_image', label: '角色生图模型' },
  { key: 'scene_image', label: '场景生图模型' },
  { key: 'prop_image', label: '道具生图模型' },
  { key: 'video', label: '视频生成模型' }
]

// 生图控制 & 批量生成
const pickerVisible = ref(false)
const pickerType = ref<'character' | 'scene' | 'prop'>('character')
const pickerShotId = ref('')

const batchDialogVisible = ref(false)
const batchType = ref('')
const batchMode = ref<'asset' | 'shot'>('asset')
const batchCount = ref(1)
const batchTotalAssets = ref(0)
const batchMissingCount = ref(0)
const batchCancelled = ref(false)
const batchProgress = ref<Record<string, { current: number; total: number }>>({})

const genCount = ref(1)
const sessionOverrides = ref<Record<string, { model: string; channel: string }>>({})
const editAssetDesc = ref('')
const editAssetName = ref('')
const editVideoPrompt = ref('')
const assetImages = ref<any[]>([])
const assetVideos = ref<any[]>([])

const lastExportDir = ref('')
const exportProgressVisible = ref(false)
const exportProgressCurrent = ref(0)
const exportProgressTotal = ref(0)
const exportProgressMsg = ref('')

let _videoGenerating = false
const videoDuration = ref(15)
async function handleGenerateVideo(): Promise<void> {
  if (_videoGenerating) return
  // 优先取 detailData，否则从 selectedShotDetail 取；如果 detailData 不属于当前激活章节，则用当前章节第一镜
  let shotId = detailData.value?.id || selectedShotDetail.value?.id
  if (shotId && activeChapterId.value !== 'all') {
    const shot = projectData.value?.shots?.find((s: any) => s.id === shotId)
    if (shot && shot.chapter_id !== activeChapterId.value) {
      // detailData 是其他章节的残留数据 → 改用当前章节第一镜
      const chapterShots = (projectData.value?.shots || []).filter((s: any) => s.chapter_id === activeChapterId.value)
      if (chapterShots.length > 0) shotId = chapterShots[0].id
    }
  }
  if (!shotId) return
  _videoGenerating = true
  try {
    const result = await window.api.generateVideo({ projectId, shotId } as any)
    // 更新本地 shot 数据 — 创建新对象引用触发 AssetPanel watch 重载
    if (result?.videoPaths?.length > 0) {
      const shot = projectData.value?.shots?.find((s: any) => s.id === shotId)
      if (shot) shot.video_path = result.videoPaths[0]
      if (detailData.value) {
        detailData.value = { ...detailData.value, video_path: result.videoPaths[0] }
      }
      await nextTick()
      // 自动切到视频详情页
      const targetShot = projectData.value?.shots?.find((s: any) => s.id === shotId)
      if (targetShot) {
        showDetail('video', targetShot)
      }
    }
    ElMessage.success('视频已生成')
    await loadGenerationRecords()
    startBroadcastPolling()
  } catch (err: any) {
    ElMessage.error(err?.message || '视频生成失败')
  } finally { _videoGenerating = false }
}

// AI解析弹窗（保留）
const parseDialogVisible = ref(false)
const parseMode = ref<'full' | 'append'>('full')
const parseEngine = ref<'standard' | 'seedance'>('seedance')
const parseScriptText = ref('')
const selectedTemplate = ref('')
const templates = ref<any[]>([])
const templatePreview = ref('')
const selectedModel = ref('')
const parseGenerating = ref(false)
const parseProgressSteps = ref([
  { step: 1, status: 'pending', message: '分析剧本、拆分镜头' },
  { step: 2, status: 'pending', message: '提取角色、场景和道具' },
  { step: 3, status: 'pending', message: '关联角色、场景和道具到分镜' },
  { step: 4, status: 'pending', message: '保存项目' }
] as { step: number; status: string; message: string }[])
const activeTab = ref('ai')

let removeAIProgress: (() => void) | null = null

const activeChapterId = ref<string>("all")
const collapsedGroups = ref<string[]>([])

const navItems = computed(() => {
  const shots = projectData.value?.shots || []
  const chapters = projectData.value?.chapters || []
  const items: Array<{ key: string; label: string; isGroup?: boolean; children?: Array<{ key: string; label: string }> }> = [
    { key: 'overview', label: '项目总览' },
    { key: 'all', label: `全部 (${shots.length}镜)` },
  ]
  // 按 parse_group 分组
  const groups = new Map<number, { key: string; label: string }[]>()
  for (const ch of chapters) {
    const pg = ch.parse_group ?? 0
    if (!groups.has(pg)) groups.set(pg, [])
    const chShots = shots.filter((s: any) => s.chapter_id === ch.id).length
    groups.get(pg)!.push({ key: ch.id, label: `${ch.title || '未命名'} (${chShots}镜)` })
  }
  // 插入分组（按 parse_group 排序）
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0] - b[0])
  for (const [pg, children] of sortedGroups) {
    const firstTitle = children[0]?.label?.replace(/\s*\(\d+镜\)/, '') || ''
    const shotCount = children.reduce((sum, c) => sum + parseInt(c.label.match(/\((\d+)镜\)/)?.[1] || '0'), 0)
    items.push({
      key: `group-${pg}`,
      label: `${firstTitle || '未命名'} · ${shotCount}镜`,
      isGroup: true,
      children
    })
  }
  return items
})

// 按当前选中章节过滤的分镜数据（'all' = 全部）
const chapterFilteredProjectData = computed(() => {
  if (!projectData.value) return null
  if (activeChapterId.value === 'all') return projectData.value
  const shots = (projectData.value.shots || []).filter((s: any) => s.chapter_id === activeChapterId.value)
  return { ...projectData.value, shots }
})

// 风格预设（保留）
const stylePresets = [
  {
    name: '写实摄影',
    prompt:
      'Photorealistic, high detail, natural lighting, 8k uhd, cinematic grading, film grain, color graded, cinematic shot, depth of field, professional photography, realistic textures, lifelike',
    negative:
      'painting, illustration, cartoon, anime, 3d render, blurry, low quality, artificial, oversaturated',
    color: '#4ecdc4'
  },
  {
    name: '仙侠动漫',
    prompt:
      'Chinese Xianxia fantasy art, semi-realistic cel-shaded rendering, ink wash influences, ethereal glow, dramatic god rays, cinematic grading, film grain, misty atmosphere, jade green and celestial gold palette, painterly textures, spiritual mood',
    negative:
      'modern, urban, western, photorealistic, 3d render, dark gritty, cartoon, anime, mecha, sci-fi, blurry, low quality, mundane',
    color: '#7BC5A8'
  },
  {
    name: '3D渲染',
    prompt:
      '3D render, octane render, blender, cinematic lighting, cinematic grading, color graded, ray tracing, subsurface scattering, physically based rendering, high poly model, studio lighting',
    negative: '2d, flat, painting, sketch, hand drawn, low poly, blurry, low quality, cartoon',
    color: '#a78bfa'
  },
  {
    name: '赛博朋克',
    prompt:
      'Cyberpunk, neon lights, futuristic, dystopian city, holographic displays, rain-soaked streets, high tech low life, glowing accents, blade runner aesthetic, cinematic grading, color graded',
    negative:
      'medieval, natural landscape, pastel colors, soft lighting, cottagecore, blurry, low quality, boring, plain',
    color: '#f472b6'
  },
  {
    name: '二次元动漫',
    prompt:
      'Anime style, vibrant colors, detailed eyes, cel shading, clean line art, expressive characters, dynamic composition, high quality illustration',
    negative:
      'photorealistic, 3d render, blurry, low quality, bad anatomy, deformed, ugly, duplicate, watermark, signature',
    color: '#ff6b9d'
  },
  {
    name: '水彩插画',
    prompt:
      'Watercolor painting, soft edges, artistic, hand-painted, flowing colors, translucent layers, delicate brushwork, paper texture, dreamy atmosphere',
    negative:
      'photorealistic, 3d render, sharp edges, digital art, oversaturated, blurry, low quality, dark, gloomy',
    color: '#67e8f9'
  },
  {
    name: '中国水墨',
    prompt:
      'Chinese ink wash painting, traditional art, brush strokes, ink splatter, monochrome, xuan paper texture, poetic composition, calligraphic lines, misty mountains',
    negative:
      'colorful, photorealistic, 3d render, western style, oil painting, blurry, low quality, modern, digital',
    color: '#9ca3af'
  },
  {
    name: '像素复古',
    prompt:
      'Pixel art, retro game style, 8-bit, 16-bit, dithering, limited color palette, crisp pixels, nostalgic, arcade aesthetic',
    negative:
      'photorealistic, 3d render, smooth gradients, anti-aliasing, blurry, low quality, modern, realistic',
    color: '#fbbf24'
  },
  {
    name: '油画质感',
    prompt:
      'Oil painting, rich textures, classical art, impasto, chiaroscuro, canvas texture, masterwork, museum quality, traditional techniques',
    negative:
      'photorealistic, 3d render, digital art, flat, cartoon, anime, blurry, low quality, modern',
    color: '#f97316'
  },
  {
    name: '扁平插画',
    prompt:
      'Flat illustration, minimal design, vector art, clean lines, solid colors, geometric shapes, modern UI style, simple and elegant',
    negative:
      'photorealistic, 3d render, gradients, textures, shadows, realistic, blurry, low quality, cluttered, complex',
    color: '#34d399'
  },
  {
    name: '吉卜力',
    prompt:
      'Studio Ghibli style, whimsical, hand-drawn, pastoral scenery, warm colors, soft clouds, detailed nature, Miyazaki aesthetic, enchanting',
    negative:
      'photorealistic, 3d render, dark, gritty, cyberpunk, violent, blurry, low quality, modern urban, sterile',
    color: '#86efac'
  },
  {
    name: '美漫风格',
    prompt:
      'American comic style, bold lines, dynamic poses, halftone, pop art, action-packed, inked outlines, vibrant primary colors, dramatic shading',
    negative:
      'photorealistic, 3d render, anime, manga, soft colors, realistic proportions, blurry, low quality, muted',
    color: '#fb7185'
  },
  {
    name: '暗黑奇幻',
    prompt:
      'Dark fantasy, gothic atmosphere, ominous, dramatic shadows, ancient ruins, mythical creatures, epic scale, moody lighting, cinematic grading, tormented souls',
    negative:
      'cheerful, bright colors, modern, cute, minimalist, photorealistic, blurry, low quality, mundane, everyday',
    color: '#7c3aed'
  },
  {
    name: '日系治愈',
    prompt:
      'Japanese iyashikei, cozy, warm atmosphere, slice of life, soft lighting, gentle colors, peaceful scenery, comforting, slow living',
    negative:
      'dark, violent, scary, intense, dramatic, photorealistic, 3d render, blurry, low quality, chaotic',
    color: '#fcd34d'
  },
]


// 风格参考图
const styleTemplateList = ref<any[]>([])
async function loadStyleTemplates() {
  try { styleTemplateList.value = await window.api.getStyleTemplates() || [] }
  catch (e) { console.warn("[Editor] 加载风格参考图失败", e) }
}
const currentStyleRefs = computed(() => {
  const tpl = styleTemplateList.value.find((s: any) => s.name === selectedStyle.value)
  if (!tpl) return []
  const toUrl = (p: string|null) => p ? "file://" + p.replace(/\\/g, "/") : ""
  return [
    { label: "风格参考", url: toUrl(tpl.styleRefImage) },
    { label: "场景布局", url: toUrl(tpl.sceneRefImage) },
    { label: "宫格排版", url: toUrl(tpl.gridRefImage) },
    { label: "角色布局", url: toUrl(tpl.characterRefImage) },
  ].filter(r => r.url)
})
const aspectRatios = [
  { label: '16:9 横屏', value: '16:9' },
  { label: '9:16 竖屏', value: '9:16' },
  { label: '1:1 方形', value: '1:1' }
]

// ===== 数据加载 =====

async function loadProject(): Promise<void> {
  try {
    const data = (await window.api.getProject(projectId)) as Project | null
    project.value = data
    if (data) {
      selectedStyle.value = data.style_name || ''
      selectedAspectRatio.value = data.aspect_ratio || '16:9'
      if (data.script_text) store.scriptText = data.script_text
    }
    const stats = await window.api.getProjectStats(projectId)
    projectStats.value = stats as { characters: number; scenes: number; props: number; chapters: number; shots: number }
    const savedDir = await window.api.getSetting('last_export_dir')
    if (savedDir) lastExportDir.value = savedDir
  } catch (err) {
    ElMessage.error('加载项目失败')
    console.error(err)
  }
}

async function loadEpisodesData(): Promise<void> {
  // 在所有可能的滚动容器上保存位置
  const containers = ['.shot-table', '.shot-table-wrapper', '.episodes-body']
  const saved: number[] = containers.map(sel => {
    const el = document.querySelector(sel) as HTMLElement | null
    return el?.scrollTop || 0
  })
  episodesLoading.value = true
  try {
    const data = await window.api.getProjectData(projectId)
    projectData.value = data
    await nextTick()
    // 恢复所有滚动容器位置
    requestAnimationFrame(() => {
      containers.forEach((sel, i) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (el && saved[i] > 0) el.scrollTop = saved[i]
      })
    })
  } catch (err) {
    ElMessage.error('加载剧集数据失败')
    console.error(err)
  } finally {
    episodesLoading.value = false
  }
}

async function handleDeleteParseGroup(groupKey: string): Promise<void> {
  const pg = parseInt(String(groupKey).split('-')[1])
  try {
    await ElMessageBox.confirm(
      `确定删除该集的所有章节和分镜吗？此操作不可恢复。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
    await window.api.deleteParseGroup(projectId, pg)
    ElMessage.success('已删除')
    await loadEpisodesData()
  } catch {
    // 用户取消
  }
}

async function loadModelName(): Promise<void> {
  try {
    const provider = await window.api.getSetting('provider')
    const model = await window.api.getSetting('model')
    const providers = await window.api.getProviders()
    const p = providers.find((pr: any) => pr.key === provider) as any
    const m = p?.models?.find((mo: any) => mo.key === model)
    currentModel.value = m?.name || model || '未配置'
  } catch (_err) {
    currentModel.value = '未配置'
  }
}

// ===== 风格/比例（总览页）=====

async function handleStyleSelect(style: any): Promise<void> {
  selectedStyle.value = style.name
  await saveStyleToProject()
}

async function handleAspectRatioSelect(ratio: string): Promise<void> {
  selectedAspectRatio.value = ratio
  await saveStyleToProject()
}

async function saveStyleToProject(): Promise<void> {
  if (!project.value) return
  try {
    const style = stylePresets.find((s) => s.name === selectedStyle.value)
    await window.api.updateProject(projectId, {
      styleName: selectedStyle.value,
      styleNegativePrompt: style?.negative || '',
      aspectRatio: selectedAspectRatio.value
    })
    await loadProject()
  } catch (err) {
    console.error('保存风格失败', err)
  }
}

function handleCustomStyle(): void {
  ElMessage.info('自定义风格功能后续版本开放')
}

// ===== AI解析弹窗（保留）=====

async function openParseDialog(mode: 'full' | 'append'): Promise<void> {
  parseMode.value = mode
  parseScriptText.value = ''
  parseGenerating.value = false
  activeTab.value = 'ai'
  parseProgressSteps.value = [
    { step: 1, status: 'pending', message: '分析剧本、拆分镜头' },
    { step: 2, status: 'pending', message: '提取角色、场景和道具' },
    { step: 3, status: 'pending', message: '关联角色、场景和道具到分镜' },
    { step: 4, status: 'pending', message: '保存项目' }
  ]
  loadTemplates()
  await loadProviderModels()
  await loadParseModel()
  parseDialogVisible.value = true
}

async function loadTemplates(): Promise<void> {
  try {
    const list1 = (await window.api.getPromptTemplates(projectId, 'script_parse')) as any[]
    const list2 = (await window.api.getPromptTemplates(projectId, 'shot_script_parse')) as any[]
    const list3 = (await window.api.getPromptTemplates(projectId, 'seedance_9grid')) as any[]
    // 如果 DB 中没有 seedance 模板，从文件系统加载作为默认选项
    if (list3.length === 0) {
      list3.push({
        id: 'seedance_9grid',
        name: 'Seedance 2.0 九宫格',
        usage: 'seedance_9grid',
        content: '',
        isOfficial: true,
      })
    }
    const list = [...list1, ...list2, ...list3]
    templates.value = list
    if (list.length > 0 && !selectedTemplate.value) {
      // 默认选 seedance_9grid
      const seedanceTpl = list.find((t: any) => t.id === 'seedance_9grid')
      const def = seedanceTpl || list[0]
      selectedTemplate.value = def.id
      templatePreview.value = def.content
    }
  } catch (err) {
    console.error('加载模板失败: ' + String(err))
  }
}

function handleTemplateChange(templateId: string): void {
  const t = templates.value.find((tm: any) => tm.id === templateId)
  templatePreview.value = t?.content || ''
}

async function loadParseModel(): Promise<void> {
  try {
    const provider = await window.api.getSetting('provider')
    const model = await window.api.getSetting('model')
    const providers = (await window.api.getProviders()) as any[]
    const p = providers.find((pr: any) => pr.key === provider)
    const m = p?.models?.find((mo: any) => mo.key === model)
    const pKey = p?.key || p?.id || ''
    const mKey = typeof m === 'string' ? m : m?.key || ''
    if (pKey && mKey) {
      // Store in providerKey:modelKey format to match providerModels values
      const existingModel = providerModels.value.find((pm) => pm.value === `${pKey}:${mKey}`)
      selectedModel.value = existingModel ? existingModel.value : `${pKey}:${mKey}`
    } else {
      selectedModel.value = ''
    }
  } catch (_err) {
    selectedModel.value = ''
  }
}

async function handleParseSubmit(): Promise<void> {
  if (!parseScriptText.value.trim()) {
    ElMessage.warning('请输入剧本内容')
    return
  }
  try {
    const provider = await window.api.getSetting('provider')
    // First check the dedicated api_key_<provider> setting
    const apiKey = await window.api.getSetting(`api_key_${provider}`)
    if (!apiKey) {
      // Fall back to checking the providers JSON
      const providers = (await window.api.getProviders()) as any[]
      const p = providers.find((pr: any) => pr.key === provider)
      if (!p?.apiKey) {
        ElMessage.warning('请先配置 API Key')
        router.push('/settings')
        return
      }
    }
  } catch {
    ElMessage.warning('无法读取设置，请检查配置')
    return
  }

  parseGenerating.value = true
  removeAIProgress = window.api.onAIProgress((data: any) => {
    if (data.step >= 1 && data.step <= 4) {
      const idx = data.step - 1
      parseProgressSteps.value[idx] = {
        ...parseProgressSteps.value[idx],
        status: data.status,
        message: data.message
      }
      for (let i = 0; i < idx; i++) {
        if (parseProgressSteps.value[i].status !== 'done') {
          parseProgressSteps.value[i] = {
            ...parseProgressSteps.value[i],
            status: 'done',
            message: parseProgressSteps.value[i].message + ' 完成'
          }
        }
      }
    }
    if (data.status === 'error') {
      parseGenerating.value = false
      ElMessage.error(data.message || '生成失败')
    }
  })

  try {
    const template = templates.value.find((t: any) => t.id === selectedTemplate.value)
    const opts = {
      promptTemplate: template?.content,
      aspectRatio: selectedAspectRatio.value,
      model: selectedModel.value || undefined,
      mode: parseMode.value
    }
    if (parseEngine.value === 'seedance') {
      await window.api.autoProcessSeedance(projectId, parseScriptText.value.trim(), opts)
    } else {
      await window.api.autoProcess(projectId, parseScriptText.value.trim(), opts)
    }
    ElMessage.success('生成完成！')
    parseDialogVisible.value = false
    activeNav.value = 'episodes'
    detailData.value = null  // 清旧分镜引用，避免后续操作拿旧ID报"分镜不存在"
    await loadEpisodesData()
  } catch (err: any) {
    console.error(err)
    if (!err.message?.includes('请')) ElMessage.error(err.message || '生成失败，请重试')
  } finally {
    parseGenerating.value = false
    if (removeAIProgress) {
      removeAIProgress()
      removeAIProgress = null
    }
  }
}

function handleSkipParse(): void {
  parseDialogVisible.value = false
}

// ===== 分镜列表 =====


let docMouseDownHandler: ((e: MouseEvent) => void) | null = null
let currentEditTextarea: HTMLTextAreaElement | null = null

function cleanupDocMouseDown(): void {
  if (docMouseDownHandler) {
    document.removeEventListener('mousedown', docMouseDownHandler)
    docMouseDownHandler = null
  }
  currentEditTextarea = null
}

function startEdit(shotId: string, field: string, currentText: string): void {
  cleanupDocMouseDown()
  editingCell.value = { shotId, field }
  editText.value = currentText
  // 延迟添加监听，等 DOM 更新后获取 textarea
  setTimeout(() => {
    const editCell = document.querySelector('.edit-cell') as HTMLElement | null
    currentEditTextarea = editCell?.querySelector('textarea') as HTMLTextAreaElement | null
    if (currentEditTextarea) currentEditTextarea.focus()

    docMouseDownHandler = (e: MouseEvent) => {
      if (!editingCell.value || !currentEditTextarea) {
        cleanupDocMouseDown()
        return
      }
      const target = e.target as HTMLElement
      if (target.closest('.edit-cell')) return
      currentEditTextarea.blur()
    }
    document.addEventListener('mousedown', docMouseDownHandler)
  }, 0)
}

function cancelEdit(): void {
  const shotId = editingCell.value?.shotId
  cleanupDocMouseDown()
  editingCell.value = null
  // 退出编辑后滚动到刚才编辑的行
  if (shotId) {
    nextTick(() => {
      const row = document.querySelector(`.shot-row[data-shot-id="${shotId}"]`)
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
}

async function saveEdit(shotId: string, field: string): Promise<void> {
  cleanupDocMouseDown()
  if (!editingCell.value) return
  try {
    const update: any = {}
    if (field === 'description') {
      // 自动提取描述中的旁白/独白/对白（段中+行首双格式）
      let raw = editText.value || ''
      const descLines: string[] = []; const nLines: string[] = []; const mLines: string[] = []; const dLines: string[] = []
      // 1. 段中嵌入："，旁白："xxx"" → 提取到 narration，原文去掉
      const embedN = [...raw.matchAll(/[，,。！？\s]旁白[：:]["'""]([^"'""]+)["'""]/g)]
      for (const m of embedN) { nLines.push('旁白：' + m[1]); raw = raw.replace(m[0], '') }
      // 无引号备选：，旁白：检测到内容结尾（截到下一个标点）
      const embedN2 = [...raw.matchAll(/[，,。！？\s]旁白[：:]([^，,。！？]+)/g)]
      for (const m of embedN2) { if (!nLines.length) { nLines.push('旁白：' + m[1].trim()); raw = raw.replace(m[0], '') } }
      const embedM = [...raw.matchAll(/[，,。！？\s]([^，,。！？\s]{1,12}的内心独白)[：:]["'""]([^"'""]+)["'""]/g)]
      for (const m of embedM) { mLines.push(m[1] + '：' + m[2]); raw = raw.replace(m[0], '') }
      // 2. 行首前缀
      for (const line of raw.split('\n')) {
        const t = line.trim()
        if (!t) { descLines.push(''); continue }
        if (t.startsWith('旁白：') || t.startsWith('旁白:')) { nLines.push(t); descLines.push('') }
        else if (t.includes('的内心独白：') || t.includes('的内心独白:')) { mLines.push(t); descLines.push('') }
        else if (/^[^：:]{1,12}[：:]/.test(t)) {
          // 导演术语留在描述，不提取
          const pn = t.match(/^([^：:]{1,12})[：:]/)?.[1] || ''
          if (pn === '分屏' || pn === '切至' || pn === '转场') { descLines.push(t) }
          else { dLines.push(t); descLines.push('') }
        }
        else { descLines.push(t) }
      }
      update.description = descLines.join('\n').trim() || ''
      update.narration = nLines.join('\n') || ''
      update.inner_monologue = mLines.join('\n') || ''
      if (dLines.length) update.dialogue = (update.dialogue ? update.dialogue + '\n' : '') + dLines.join('\n')
      if (editText.value) update.description_zh = editText.value
    }
    else if (field === 'video_prompt') {
      const v = editText.value; update.video_prompt_zh = v
      update.video_prompt = /[一-鿿]/.test(v) ? await window.api.translateToEnglish(v) : v
    }
    else if (field === 'dialogue' || field === 'narration') {
      // 按前缀拆分到正确的字段（与配音路由一致）
      const raw = editText.value || ''
      const lines = raw.split('\n').filter((s: string) => s.trim())
      const d: string[] = []; const n: string[] = []; const m: string[] = []
      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith('旁白：') || t.startsWith('旁白:')) { n.push(t) }
        else if (t.includes('的内心独白：') || t.includes('的内心独白:')) { m.push(t) }
        else { d.push(t) }
      }
      if (d.length) update.dialogue = d.join('\n'); else update.dialogue = ''
      if (n.length) update.narration = n.join('\n'); else update.narration = ''
      if (m.length) update.inner_monologue = m.join('\n')
    }
    console.log('[saveEdit] field=' + field, JSON.stringify(update).slice(0, 200))
    await window.api.updateShot(shotId, update)
    // 前端直接更新当前 shot，避免全量刷新导致闪烁
    const shot = projectData.value?.shots?.find((s: any) => s.id === shotId)
    if (shot) {
      Object.assign(shot, update)
    }
    // 智能关联（异步，不阻塞 UI 退出）
    checkAndCreateAssociations(shotId, editText.value).catch(console.error)
  } catch (err) {
    ElMessage.error('保存失败')
    console.error(err)
  } finally {
    editingCell.value = null
    // 退出编辑后滚动到刚才编辑的行
    nextTick(() => {
      const row = document.querySelector(`.shot-row[data-shot-id="${shotId}"]`)
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
}

async function checkAndCreateAssociations(shotId: string, text: string): Promise<boolean> {
  const chars = projectData.value?.characters || []
  const scenes = projectData.value?.scenes || []
  const props = projectData.value?.props || []
  const shot = projectData.value?.shots?.find((s: any) => s.id === shotId)
  if (!shot) return false

  let created = false

  for (const c of chars) {
    if (text.includes(c.name) && !shot.characters?.some((sc: any) => sc.id === c.id)) {
      await window.api.addShotAssociation(shotId, 'character', c.id)
      if (!shot.characters) shot.characters = []
      shot.characters.push(c)
      created = true
    }
  }
  for (const s of scenes) {
    if (text.includes(s.name) && !shot.scenes?.some((ss: any) => ss.id === s.id)) {
      await window.api.addShotAssociation(shotId, 'scene', s.id)
      if (!shot.scenes) shot.scenes = []
      shot.scenes.push(s)
      created = true
    }
  }
  for (const p of props) {
    if (text.includes(p.name) && !shot.props?.some((sp: any) => sp.id === p.id)) {
      await window.api.addShotAssociation(shotId, 'prop', p.id)
      if (!shot.props) shot.props = []
      shot.props.push(p)
      created = true
    }
  }

  return created
}


async function handleBatchDeleteShots(): Promise<void> {
  if (selectedShots.value.size === 0) return
  try {
    await ElMessageBox.confirm(
      `确定删除 ${selectedShots.value.size} 个分镜吗？此操作不可撤销`,
      '批量删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    const ids = Array.from(selectedShots.value)
    for (const id of ids) await window.api.deleteShot(id).catch(() => {})
    selectedShots.value = new Set()
    await loadEpisodesData()
    ElMessage.success(`已删除 ${ids.length} 个分镜`)
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') console.error(err)
  }
}

async function removeAssociation(shotId: string, type: string, assetId: string): Promise<void> {
  try {
    await window.api.removeShotAssociation(shotId, type, assetId)
    // 直接更新本地数据，不重新加载
    if (projectData.value?.shots) {
      const shot = projectData.value.shots.find((s: any) => s.id === shotId)
      if (shot) {
        if (type === 'character') shot.characters = (shot.characters || []).filter((c: any) => c.id !== assetId)
        else if (type === 'scene') shot.scenes = (shot.scenes || []).filter((s: any) => s.id !== assetId)
        else if (type === 'prop') shot.props = (shot.props || []).filter((p: any) => p.id !== assetId)
      }
    }
  } catch { ElMessage.error('移除失败') }
}
function addAssociationFromTable(shotId: string, type: string): void {
  const list = type === 'character' ? projectData.value?.characters : type === 'scene' ? projectData.value?.scenes : projectData.value?.props
  if (!list?.length) { ElMessage.warning('没有可用选项'); return }
  pickerType.value = type as 'character' | 'scene' | 'prop'
  pickerShotId.value = shotId
  pickerVisible.value = true
}
const pickerAssets = computed(() => {
  const t = pickerType.value
  return (projectData.value?.[t === 'character' ? 'characters' : t === 'scene' ? 'scenes' : 'props'] || []) as any[]
})
async function pickerSelect(asset: any): Promise<void> {
  pickerVisible.value = false
  try {
    await window.api.addShotAssociation(pickerShotId.value, pickerType.value, asset.id)
    ElMessage.success(`已添加`)
    const shot = projectData.value?.shots?.find((s: any) => s.id === pickerShotId.value)
    if (shot) {
      const t = pickerType.value
      if (t === 'character' && !shot.characters?.find((c: any) => c.id === asset.id)) shot.characters = [...(shot.characters || []), asset]
      else if (t === 'scene' && !shot.scenes?.find((s: any) => s.id === asset.id)) shot.scenes = [...(shot.scenes || []), asset]
      else if (t === 'prop' && !shot.props?.find((p: any) => p.id === asset.id)) shot.props = [...(shot.props || []), asset]
    }
  } catch { ElMessage.error('添加失败') }
}

function handleBatchGenerate(type: string): void {
  if (['人物', '场景', '道具', '批量'].includes(type)) {
    // 资产模式：不依赖分镜勾选，对当前项目的全部资产操作
    let assetType: string
    if (type === '批量') {
      assetType =
        residentTab.value === 'characters'
          ? '人物'
          : residentTab.value === 'scenes'
            ? '场景'
            : '道具'
    } else {
      assetType = type
      // 列头点击时切换到右侧面板对应 Tab
      if (type === '人物') residentTab.value = 'characters'
      if (type === '场景') residentTab.value = 'scenes'
      if (type === '道具') residentTab.value = 'props'
      panelMode.value = 'resident'
    }
    openBatchDialog(assetType, 'asset')
  } else {
    if (selectedShots.value.size === 0) {
      ElMessage.warning('请先勾选分镜')
      return
    }
    openBatchDialog(type, 'shot')
  }
}

// ===== 批量操作弹窗 =====

function openBatchDialog(type: string, mode: 'asset' | 'shot' = 'shot'): void {
  batchType.value = type
  batchMode.value = mode
  batchCount.value = 1
  batchProgress.value[type] = { current: 0, total: 0 }
  const { total, missing } = scanBatchTasks(type, mode)
  batchTotalAssets.value = total
  batchMissingCount.value = missing
  batchDialogVisible.value = true
}

function scanBatchTasks(
  type: string,
  mode: 'asset' | 'shot' = 'shot'
): { total: number; missing: number } {
  if (mode === 'asset') {
    const assetKey = type === '人物' ? 'characters' : type === '场景' ? 'scenes' : 'props'
    const assets = projectData.value?.[assetKey] || []
    const total = assets.length
    const missing = assets.filter((a: any) => !a.reference_image).length
    return { total, missing }
  }

  const selectedShotIds = Array.from(selectedShots.value)
  const shots = projectData.value?.shots || []
  let total = 0
  let missing = 0

  for (const shot of shots) {
    if (!selectedShotIds.includes(shot.id)) continue
    switch (type) {
      case '视频':
        total += 1
        missing += shot.video_path ? 0 : 1
        break
    }
  }

  return { total, missing }
}

async function handleBatchSubmit(mode: 'all' | 'missing'): Promise<void> {
  const type = batchType.value
  let createdCount = 0
  batchCancelled.value = false

  // 读取项目模型配置（获取模板和参考图）
  let batchModelConfig: Record<string, any> = {}
  try {
    const proj = await window.api.getProject(projectId)
    const raw = (proj as Record<string, any>)?.model_config_json
    if (raw) batchModelConfig = JSON.parse(raw)
  } catch { /* ignore */ }

  // 收集任务参数列表
  interface BatchTaskItem {
    kind: 'asset' | 'shot' | 'video'
    assetId?: string
    assetType?: 'character' | 'scene' | 'prop'
    description?: string
    aspectRatio?: string
    shotId?: string
    frameType?: 'first' | 'last'
  }
  const taskItems: BatchTaskItem[] = []

  if (batchMode.value === 'asset') {
    const assetKey = type === '人物' ? 'characters' : type === '场景' ? 'scenes' : 'props'
    const assets = projectData.value?.[assetKey] || []
    const assetType = type === '人物' ? 'character' : type === '场景' ? 'scene' : 'prop'
    for (const asset of assets) {
      if (mode === 'missing' && asset.reference_image) continue
      taskItems.push({
        kind: 'asset',
        assetId: asset.id,
        assetType,
        description: asset.description || asset.name || '',
        aspectRatio: asset.aspect_ratio || undefined
      })
    }
  } else {
    const selectedShotIds = Array.from(selectedShots.value)
    const shots = projectData.value?.shots || []
    for (const shot of shots) {
      if (!selectedShotIds.includes(shot.id)) continue
      if (type === '视频') {
        taskItems.push({ kind: 'video', shotId: shot.id })
      }
    }
  }

  // 预创建 generation_tasks 记录
  let taskIds: string[] = []
  if (taskItems.length > 0) {
    const batchTasks = taskItems.map((item) => {
      if (item.kind === 'asset') {
        return {
          type: 'image',
          purpose: 'image',
          inputParams: JSON.stringify({ assetId: item.assetId, count: batchCount.value, description: item.description })
        }
      } else if (item.kind === 'shot') {
        return {
          shotId: item.shotId,
          type: 'image',
          purpose: item.frameType || 'image',
          inputParams: JSON.stringify({ shotId: item.shotId, frameType: item.frameType, count: batchCount.value })
        }
      } else {
        return {
          shotId: item.shotId,
          type: 'video',
          purpose: 'video',
          inputParams: JSON.stringify({ count: batchCount.value })
        }
      }
    })
    try {
      const result = await window.api.batchCreateGenerationTasks({ projectId, tasks: batchTasks })
      taskIds = result.ids
    } catch (err) {
      console.error('预创建任务失败:', err)
      ElMessage.error('预创建任务失败')
      return
    }
  }

  batchProgress.value[type] = { current: 0, total: taskItems.length }
  startBroadcastPolling()

  // 辅助函数：带429重试
  async function tryGenerate(generateFn: () => Promise<unknown>): Promise<boolean> {
    try {
      await generateFn()
      return true
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase()
      if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          await generateFn()
          return true
        } catch (retryErr: any) {
          console.error('重试失败:', retryErr)
          return false
        }
      }
      console.error('生图失败:', err)
      return false
    }
  }

  // 并发队列：3并发 + 每个完成后3秒间隔
  let index = 0
  const total = taskItems.length

  async function worker(): Promise<void> {
    while (index < total) {
      if (batchCancelled.value) break
      const taskIndex = index++
      const item = taskItems[taskIndex]
      const taskId = taskIds[taskIndex]
      const purposeMap2: Record<string, string> = { character: 'character_image', scene: 'scene_image', prop: 'prop_image' }
      const purposeKey = purposeMap2[item.assetType || ''] || ''
      const purposeConfig = purposeKey ? (batchModelConfig[purposeKey] || {}) : {}
      const success = await tryGenerate(async () => {
        if (item.kind === 'asset') {
          await window.api.generateImage({
            projectId,
            type: item.assetType!,
            assetId: item.assetId!,
            description: item.description || '',
            count: batchCount.value,
            taskId,
            templateId: purposeConfig.templateId || '',
            refImage: purposeConfig.refImage || ''
          })
        } else if (item.kind === 'shot') {
          await window.api.generateShotImage({
            projectId,
            shotId: item.shotId!,
            frameType: item.frameType!,
            count: batchCount.value,
            taskId
          })
        } else {
          await window.api.generateVideo({
            projectId,
            shotId: item.shotId!,
            taskId
          })
        }
      })
      if (success) {
        createdCount++
      }
      const prog = batchProgress.value[type] || { current: 0, total }
      batchProgress.value[type] = { current: Math.min(prog.current + 1, total), total }
      // 间隔 500ms（实测 Agnes 20并发无429限流）
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  // 并发策略：Agnes视频模型单GPU，保守2并发+3s错峰避免503
  const isVideoItem = (item: any) => item.kind === 'video'
  const hasVideos = taskItems.some(isVideoItem)
  const workerCount = hasVideos ? Math.min(2, total) : Math.min(5, total)
  const videoStagger = hasVideos ? 3000 : 500
  const workers: Promise<void>[] = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
    await new Promise(r => setTimeout(r, videoStagger))
  }
  await Promise.all(workers)

  if (batchMode.value === 'asset' && createdCount > 0) {
    ElMessage.success(`已成功生成 ${createdCount} 个资产的图片`)
    await loadEpisodesData()
  } else if (createdCount > 0) {
    ElMessage.success(`已成功生成 ${createdCount} 个分镜图片`)
    await loadEpisodesData()
  } else {
    ElMessage.info(`已创建 ${taskItems.length > 0 ? 0 : 0} 个生成任务`)
  }
  batchDialogVisible.value = false
  batchProgress.value[type] = { current: 0, total: 0 }
}

// ===== 右侧面板 =====

async function showDetail(type: string, data: any): Promise<void> {
  panelMode.value = 'detail'
  detailType.value = type
  detailData.value = data
  genCount.value = 1
  assetImages.value = []
  assetVideos.value = []
  // 同步编辑缓冲
  editVideoPrompt.value = data?.video_prompt_zh || data?.video_prompt || ''
  editAssetName.value = data?.name || ''
  editAssetDesc.value = data?.description || ''
  // AssetPanel 通过 watch(detailData) 自动加载历史图片/视频
}



// 生图按钮（MVP2真实服务）
async function handleGenerateImage(type: string, assetId?: string): Promise<void> {
  if (!assetId) return

  // 资产生图（character/scene/prop）
  const assetType = type === 'character' ? 'character' : type === 'scene' ? 'scene' : 'prop'
  const asset = projectData.value?.[
    assetType === 'character' ? 'characters' : assetType === 'scene' ? 'scenes' : 'props'
  ]?.find((a: any) => a.id === assetId)
  if (!asset) {
    ElMessage.error('资产不存在')
    return
  }

  // 读取项目模型配置（优先传给后端，减少后端猜测）
  let modelConfig: any = {}
  try {
    const proj = await window.api.getProject(projectId)
    const raw = (proj as Record<string, any>)?.model_config_json
    if (raw) modelConfig = JSON.parse(raw)
  } catch { /* ignore */ }

  const purposeMap: Record<string, string> = {
    character: 'character_image',
    scene: 'scene_image',
    prop: 'prop_image'
  }
  const purposeKey = purposeMap[assetType]

  // 优先读会话级覆盖（齿轮确认写入的）
  const override = purposeKey ? sessionOverrides.value[purposeKey] : undefined
  let model = override?.model || ''
  let channel = override?.channel || ''

  // 无覆盖时回退到项目模型配置
  if (!model || !channel) {
    const purposeConfig = modelConfig[purposeKey] || {}
    if (!model) model = purposeConfig.model || ''
    if (!channel) channel = purposeConfig.channel || ''
  }

  try {
    // 读取该用途的模板和参考图
    const purposeConfig = modelConfig[purposeKey] || {}
    const templateId = purposeConfig.templateId || ''
    const refImage = purposeConfig.refImage || ''

    await window.api.generateImage({
      projectId,
      type: assetType,
      assetId,
      description: asset.description || asset.name || '',
      count: genCount.value,
      model: model || undefined,
      channel: channel || undefined,
      templateId,
      refImage
    })
    ElMessage.success('图片生成成功')
    // 直接更新本地数据，避免全量刷新闪跳
    try {
      const fresh = await window.api.getProjectData(projectId)
      const key = assetType === 'character' ? 'characters' : assetType === 'scene' ? 'scenes' : 'props'
      const freshAsset = (fresh as any)[key]?.find((a: any) => a.id === assetId)
      if (freshAsset && projectData.value?.[key]) {
        const localAsset = projectData.value[key].find((a: any) => a.id === assetId)
        if (localAsset) localAsset.reference_image = freshAsset.reference_image
      }
      if (detailData.value?.id === assetId) {
        detailData.value = { ...detailData.value, reference_image: freshAsset?.reference_image || '' }
        // 强制触发 AssetPanel 的 detailData watcher 以刷新历史图片列表
        detailData.value = { ...detailData.value }
      }
    } catch { /* silent */ }
    await loadGenerationRecords()
  } catch (err: any) {
    ElMessage.error(err?.message || '图片生成失败')
    console.error(err)
  } finally {
  }
}

function goHome(): void {
  router.push('/')
}

function goSettings(): void {
  router.push('/settings')
}

const storyboardGenerating = ref(false)
const storyboardSingleGenLoading = ref('') // 正在生成故事板的 shotId

// shot cards 视图
const shotCardsSelectAll = ref(false)
const shotCardsStoryboardRes = ref('16:9')
const shotCardsStoryboardResOptions = [
  { label: '标准 (1920x1088)', value: '16:9' },
  { label: '2K (2880x1616)', value: '16:9_2k' },
  { label: '4K (3840x2160)', value: '16:9_4k' },
]
// 当前章节的故事板图（取第一张 poster）
const _currentStoryboardUrl = ref('')
const shotCardsHistoryUrls = computed<string[]>(() => {
  const shots = chapterFilteredProjectData.value?.shots || []
  const urls = new Set<string>()
  for (const s of shots) {
    if (s.poster_image_path) urls.add("file:///" + s.poster_image_path.replace(/\\/g, "/"))
    try {
      const hist = s.poster_history ? JSON.parse(s.poster_history) : []
      for (const h of hist) { if (h) urls.add("file:///" + h.replace(/\\/g, "/")) }
    } catch {}
  }
  return [...urls]
})
// 历史缩略图：2 槽位，填充到 2 个（空字符串 = 暂无）
const shotCardsHistoryThumbs = computed(() => {
  const urls = shotCardsHistoryUrls.value.slice(0, 2)
  while (urls.length < 2) urls.push('')
  return urls
})
// 首次加载时取第一张，后续由用户点击切换
const shotCardsPosterUrl = computed(() => {
  if (_currentStoryboardUrl.value && shotCardsHistoryUrls.value.includes(_currentStoryboardUrl.value)) {
    return _currentStoryboardUrl.value
  }
  return shotCardsHistoryUrls.value[0] || ''
})
function switchStoryboardImage(url: string): void {
  _currentStoryboardUrl.value = url
}
const storyboardFullscreen = ref(false)
const fsImageIndex = ref(0)
const fsCurrentUrl = computed(() => shotCardsHistoryUrls.value[fsImageIndex.value] || '')
function openStoryboardFullscreen(): void {
  fsImageIndex.value = shotCardsHistoryUrls.value.indexOf(shotCardsPosterUrl.value)
  if (fsImageIndex.value < 0) fsImageIndex.value = 0
  storyboardFullscreen.value = true
}
function closeStoryboardFullscreen(): void { storyboardFullscreen.value = false }
function fsPrevImage(): void { if (fsImageIndex.value > 0) fsImageIndex.value-- }
function fsNextImage(): void { if (fsImageIndex.value < shotCardsHistoryUrls.value.length - 1) fsImageIndex.value++ }
async function fsDeleteImage(): Promise<void> {
  const url = fsCurrentUrl.value
  if (!url) return
  try { await ElMessageBox.confirm('删除该故事板图片？', '确认', { type: 'warning' }) } catch { return }
  // 清除所有使用此 poster 的 shot
  const filePath = url.replace('file:///', '').replace(/\//g, '\\')
  for (const s of (projectData.value?.shots || [])) {
    if (s.poster_image_path === filePath) {
      await (window as any).api.saveShotField(s.id, 'poster_image_path', null)
      s.poster_image_path = null
    }
  }
  // 删除磁盘文件
  try { await (window as any).api.deleteFile(filePath) } catch { /* ignore */ }
  // 重置索引
  if (fsImageIndex.value >= shotCardsHistoryUrls.value.length) fsImageIndex.value = Math.max(0, shotCardsHistoryUrls.value.length - 1)
  if (shotCardsHistoryUrls.value.length === 0) closeStoryboardFullscreen()
  ElMessage.success('已删除')
}
function fsDownloadImage(): void {
  const url = fsCurrentUrl.value
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = url.split('/').pop() || 'storyboard.png'
  a.click()
}
async function deleteHistoryImage(index: number): Promise<void> {
  const url = shotCardsHistoryThumbs.value[index]
  if (!url) return
  try { await ElMessageBox.confirm('删除该故事板图片？', '确认', { type: 'warning' }) } catch { return }
  const filePath = url.replace('file:///', '').replace(/\//g, '\\')
  for (const s of (projectData.value?.shots || [])) {
    if (s.poster_image_path === filePath) {
      await (window as any).api.saveShotField(s.id, 'poster_image_path', null)
      s.poster_image_path = null
    }
  }
  try { await (window as any).api.deleteFile(filePath) } catch { /* ignore */ }
  if (shotCardsHistoryUrls.value.length === 0 && _currentStoryboardUrl.value) _currentStoryboardUrl.value = ''
  ElMessage.success('已删除')
}

// 故事板下方选中的镜头详情
const selectedShotDetail = computed(() => {
  const shots = chapterFilteredProjectData.value?.shots || []
  const selArr = [...selectedShots.value]
  if (selArr.length === 0) return shots[0] || null
  return shots.find((s: any) => s.id === selArr[0]) || shots[0] || null
})
const _editingShotDesc = ref('')
const _editingShotVideo = ref('')
// 当选中的shot变化时同步编辑值
watch(() => selectedShotDetail.value?.id, () => {
  const s = selectedShotDetail.value
  _editingShotDesc.value = s?.description || s?.description_zh || ''
  _editingShotVideo.value = s?.video_prompt_zh || s?.video_prompt || ''
}, { immediate: true })
async function saveSelectedShotField(field: string): Promise<void> {
  const shot = selectedShotDetail.value
  if (!shot) return
  const v = field === 'description_zh' ? _editingShotDesc.value : _editingShotVideo.value
  try {
    const update: any = { [field]: v }
    if (field === 'description_zh' && /[一-鿿]/.test(v)) {
      update.description_en = await (window as any).api.translateToEnglish(v)
    }
    if (field === 'video_prompt_zh' && /[一-鿿]/.test(v)) {
      update.video_prompt = await (window as any).api.translateToEnglish(v)
    }
    await (window as any).api.updateShot(shot.id, update)
    Object.assign(shot, update)
    ElMessage.success('已保存')
  } catch (e: any) { ElMessage.error('保存失败') }
}

async function handleGenerateStoryboardForCurrentChapter(): Promise<void> {
  const allShots = projectData.value?.shots || []
  const chapterShots = activeChapterId.value === 'all' ? allShots : allShots.filter((s: any) => s.chapter_id === activeChapterId.value)
  const shotIds = chapterShots.map((s: any) => s.id)
  await handleGenerateSingleStoryboard(shotIds[0] || '', shotCardsStoryboardRes.value)
}

async function handleGenerateSingleStoryboard(shotId: string, resolution?: string): Promise<void> {
  if (storyboardSingleGenLoading.value) return
  storyboardSingleGenLoading.value = shotId
  try {
    const allShots = projectData.value?.shots || []
    const chapterShots = activeChapterId.value === 'all' ? allShots : allShots.filter((s: any) => s.chapter_id === activeChapterId.value)
    const shotIds = chapterShots.map((s: any) => s.id)
    const chapterLabel = activeChapterId.value === 'all' ? '全部' : (projectData.value?.chapters?.find((c: any) => c.id === activeChapterId.value)?.title || '当前幕')
    ElMessage.info(`正在为 ${chapterLabel} 生成故事板 (${shotIds.length}镜)...`)
    const result = await (window as any).api.generateStoryboard({ projectId, shotIds, resolution })
    if (result.errors?.length) {
      ElMessage.error('生成失败: ' + result.errors.join(', '))
    } else {
      ElMessage.success('故事板已生成')
    }
    await loadEpisodesData()
    startBroadcastPolling()
    // 更新 detailData 让详情页刷新图片
    const freshShot = projectData.value?.shots?.find((s: any) => s.id === shotId)
    if (freshShot && detailData.value?.id === shotId) {
      detailData.value = { ...detailData.value, poster_image_path: freshShot.poster_image_path }
    }
  } catch (err: any) {
    ElMessage.error(err?.message || '故事板生成失败')
  } finally {
    storyboardSingleGenLoading.value = ''
  }
}

async function handleGenerateStoryboard(): Promise<void> {
  if (storyboardGenerating.value) return
  storyboardGenerating.value = true
  try {
    const shotIds = selectedShots.value.size > 0 ? Array.from(selectedShots.value) : undefined
    const count = shotIds?.length || projectData.value?.shots?.length || 0
    ElMessage.info(`开始生成 ${count} 个分镜故事板…`)
    const result = await (window as any).api.generateStoryboard({ projectId, shotIds })
    if (result.errors?.length) {
      ElMessage.warning(`故事板生成完成：${result.generated} 成功，${result.errors.length} 失败`)
      console.error('故事板错误:', result.errors)
    } else {
      ElMessage.success(`故事板已生成 ${result.generated} 个`)
    }
    await loadEpisodesData()
    startBroadcastPolling()
  } catch (err: any) {
    ElMessage.error(err?.message || '故事板生成失败')
  } finally {
    storyboardGenerating.value = false
  }
}

const toolbar = useTopToolbar({
  projectId,
  project,
  projectData,
  selectedShots,
  selectedStyle,
  viewMode: viewMode as any,
  genRecordVisible,
  genRecords,
  genRecordTab: genRecordTab as any,
  genRecordStatusFilter: genRecordStatusFilter as any,
  genRecordTypeFilter: genRecordTypeFilter as any,
  broadcastItems,
  broadcastTimer,
  broadcastAllDone,
  broadcastAllDoneTimer,
  batchCancelled,
  exportProgressVisible,
  exportProgressCurrent,
  exportProgressTotal,
  exportProgressMsg,
  lastExportDir,
  stylePopoverVisible,
  eraPopoverVisible,
  customEra,
  editingProjectName,
  projectNameEdit,
  modelConfigVisible,
  modelConfigTab,
  modelConfigMode,
  modelConfig,
  modelConfigRefImages,
  modelConfigTemplates,
  providerModels,
  providerChannels,
  parseScriptText,
  saveStyleToProject,
  loadProject,
  loadEpisodesData,
})
const {
  openGenRecord, loadGenerationRecords,
  startBroadcastPolling,
  handleCancelBatch, retryTask, deleteGenRecord,
  handleUndo, handleRedo,
  handleExport, handleVideoConcat,
  handleBatchGenerateVoices, handlePDFExport,
  startEditProjectName, saveProjectName,
  handleStyleSelectFromToolbar, handleEraSelect, handleCustomEraSubmit,
  loadProviderModels,
  loadModelConfigTemplates, setModelConfigTab, handleModelConfigSave,
  setModelConfigField, handleModelConfigModelChange, handleModelConfigChannelChange,
  filteredConfigModels, textProviderModels, filteredConfigChannels, scriptCharCount,
} = toolbar

onMounted(() => {
  loadStyleTemplates()
  store.resetResult()
  store.scriptText = ''
  loadProject().then(() => loadEpisodesData())
  loadModelName()
})

onUnmounted(() => {
  if (removeAIProgress) removeAIProgress()
  toolbar.cleanup()
})
</script>

<template>
  <div class="editor-layout">
    <!-- 顶部栏 -->
    <header class="editor-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" text class="back-btn" @click="goHome">返回首页</el-button>
        <span class="project-name">{{ project?.name || '加载中...' }}</span>
      </div>
      <div class="header-right">
        <span class="model-badge"><span class="model-dot" />{{ currentModel }}</span>
        <span class="project-id">ID: {{ projectId }}</span>
        <el-button text :icon="Setting" class="settings-btn" @click="goSettings" />
      </div>
    </header>

    <div class="editor-body">
      <!-- 左侧导航栏 -->
      <aside class="editor-sidebar">
        <template v-for="item in navItems" :key="item.key">
          <div v-if="item.isGroup" class="nav-group-header" @click="() => { const gid = String(item.key).split('-')[1]; collapsedGroups = collapsedGroups.includes(gid) ? collapsedGroups.filter(g => g !== gid) : [...collapsedGroups, gid] }">
            <span class="nav-group-arrow">{{ collapsedGroups.includes(String(item.key).split('-')[1]) ? '▸' : '▾' }}</span>
            <span>{{ item.label }}</span>
            <el-button :icon="Close" size="small" text class="nav-group-del" @click.stop="handleDeleteParseGroup(item.key)" />
          </div>
          <div v-if="item.children" v-show="item.isGroup && !collapsedGroups.includes(String(item.key).split('-')[1])">
            <div v-for="child in item.children" :key="child.key" class="nav-item nav-sub" :class="{ active: activeNav === 'episodes' && activeChapterId === child.key }" @click="activeNav = 'episodes'; activeChapterId = child.key">
              {{ child.label }}
            </div>
          </div>
          <div v-if="!item.isGroup" class="nav-item" :class="{ active: item.key === 'overview' ? activeNav === 'overview' : activeNav === 'episodes' && activeChapterId === item.key }" @click="item.key === 'overview' ? (activeNav = 'overview') : (activeNav = 'episodes', activeChapterId = item.key)">
            {{ item.label }}
          </div>
        </template>
      </aside>

      <!-- 中间内容区 -->
      <main class="editor-content">
        <!-- 项目总览 -->
        <div v-if="activeNav === 'overview'" class="content-panel">
          <h2 class="panel-title">项目总览</h2>

          <div class="section-block">
            <div class="section-header">
              <span class="section-title">画面风格</span>
            </div>
            <div class="style-grid">
              <div
                v-for="s in stylePresets"
                :key="s.name"
                class="style-card"
                :class="{ active: selectedStyle === s.name }"
                @click="handleStyleSelect(s)"
              >
                <div class="style-preview" :style="{ background: s.color }" />
                <span class="style-name">{{ s.name }}</span>
              </div>
              <div class="style-card custom-style-card" @click="handleCustomStyle">
                <div class="style-preview custom-preview">
                  <el-icon :size="20"><Plus /></el-icon>
                </div>
                <span class="style-name">自定义</span>
                <span class="custom-tag">自定义</span>
              </div>
            </div>
          </div>

          <!-- 风格参考图 -->
          <div v-if="currentStyleRefs.length" class="section-block">
            <span class="section-title">风格参考图</span>
            <div class="style-refs-list">
              <div v-for="ref in currentStyleRefs" :key="ref.label" class="style-ref-item">
                <img :src="ref.url" :alt="ref.label" class="style-ref-thumb" loading="lazy" />
                <span class="style-ref-label">{{ ref.label }}</span>
              </div>
            </div>
          </div>

          <div class="section-block">
            <span class="section-title">画面比例</span>
            <div class="ratio-group">
              <div
                v-for="r in aspectRatios"
                :key="r.value"
                class="ratio-card"
                :class="{ active: selectedAspectRatio === r.value }"
                @click="handleAspectRatioSelect(r.value)"
              >
                <div class="ratio-icon" :class="'_' + r.value.replace(':', '_')" />
                <span class="ratio-label">{{ r.label }}</span>
              </div>
            </div>
          </div>

          <div class="section-block">
            <span class="section-title">项目统计</span>
            <div class="stat-grid">
              <div class="stat-card">
                <span class="stat-value">{{ projectStats.characters }}</span>
                <span class="stat-label">角色</span>
              </div>
              <div class="stat-card">
                <span class="stat-value">{{ projectStats.scenes }}</span>
                <span class="stat-label">场景</span>
              </div>
              <div class="stat-card">
                <span class="stat-value">{{ projectStats.props }}</span>
                <span class="stat-label">道具</span>
              </div>
              <div class="stat-card">
                <span class="stat-value">{{ projectStats.chapters }}</span>
                <span class="stat-label">剧集</span>
              </div>
              <div class="stat-card">
                <span class="stat-value">{{ projectStats.shots }}</span>
                <span class="stat-label">分镜</span>
              </div>
            </div>
          </div>

          <div class="section-block">
            <span class="section-title">剧本解析</span>
            <div class="action-grid">
              <div class="action-card" @click="openParseDialog('full')">
                <el-icon :size="28" class="action-icon"><VideoPlay /></el-icon>
                <span class="action-name">AI解析剧本</span>
              </div>
              <div class="action-card" @click="openParseDialog('append')">
                <el-icon :size="28" class="action-icon"><DocumentAdd /></el-icon>
                <span class="action-name">追加解析</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 剧集结构页 -->
        <div v-else-if="activeNav === 'episodes'" class="episodes-layout">
          <!-- 顶部工具栏 -->
          <div class="episodes-toolbar">
            <!-- 左侧区域 -->
            <div class="toolbar-left">
              <!-- 项目名称 -->
              <div class="toolbar-project-name">
                <template v-if="editingProjectName">
                  <el-input
                    v-model="projectNameEdit"
                    size="small"
                    class="project-name-input"
                    @blur="saveProjectName"
                    @keydown.enter.prevent="saveProjectName"
                  />
                </template>
                <template v-else>
                  <span class="project-name-text" @dblclick="startEditProjectName">{{
                    project?.name || '加载中...'
                  }}</span>
                </template>
              </div>

              <!-- 风格标签 -->
              <el-popover
                v-model:visible="stylePopoverVisible"
                placement="bottom"
                :width="480"
                trigger="click"
                popper-class="dark-popover style-popover"
              >
                <template #reference>
                  <div
                    class="toolbar-tag style-tag"
                    :style="{
                      background: stylePresets.find((s) => s.name === project?.style_name)?.color
                        ? stylePresets.find((s) => s.name === project?.style_name)?.color + '33'
                        : 'rgba(255,255,255,0.08)',
                      color: '#fff'
                    }"
                  >
                    {{ project?.style_name || '选择风格' }}
                  </div>
                </template>
                <div class="style-popover-body">
                  <div class="style-popover-grid">
                    <div
                      v-for="s in stylePresets"
                      :key="s.name"
                      class="style-popover-card"
                      :class="{ active: project?.style_name === s.name }"
                      @click="handleStyleSelectFromToolbar(s)"
                    >
                      <div class="style-popover-preview" :style="{ background: s.color }" />
                      <span class="style-popover-name">{{ s.name }}</span>
                    </div>
                  </div>
                  <div class="style-popover-footer">
                    <el-button
                      text
                      size="small"
                      :icon="Plus"
                      @click="ElMessage.info('自定义风格后续版本开放')"
                      >+ 自定义风格</el-button
                    >
                  </div>
                </div>
              </el-popover>

              <!-- 年代标签 -->
              <el-popover
                v-model:visible="eraPopoverVisible"
                placement="bottom"
                :width="200"
                trigger="click"
                popper-class="dark-popover era-popover"
              >
                <template #reference>
                  <div class="toolbar-tag era-tag">
                    {{ project?.era || '设置年代' }}
                  </div>
                </template>
                <div class="era-popover-body">
                  <div
                    v-for="era in eraPresets"
                    :key="era"
                    class="era-popover-item"
                    :class="{ active: project?.era === era }"
                    @click="handleEraSelect(era)"
                  >
                    {{ era }}
                  </div>
                  <div class="era-popover-custom">
                    <el-input
                      v-model="customEra"
                      size="small"
                      placeholder="自定义年代"
                      @keydown.enter.prevent="handleCustomEraSubmit"
                    />
                    <el-button text size="small" @click="handleCustomEraSubmit">确定</el-button>
                  </div>
                </div>
              </el-popover>

            </div>

            <!-- 中间区域 -->
            <div class="toolbar-center">
              <el-button
                text
                size="small"
                :icon="Document"
                :class="{ active: viewMode === 'table' }"
                class="view-mode-btn"
                @click="viewMode = 'table'"
              >
                编辑器
              </el-button>
              <el-button
                text
                size="small"
                :icon="Grid"
                :class="{ active: viewMode === 'canvas' }"
                class="view-mode-btn"
                @click="viewMode = 'canvas'"
              >
                画布
              </el-button>
            </div>

            <!-- 播报条 -->
            <div
              v-if="broadcastItems.length > 0 || broadcastAllDone"
              class="broadcast-bar"
              @click="openGenRecord"
            >
              <template v-if="broadcastAllDone">
                <span class="broadcast-all-done">全部完成 ✓</span>
              </template>
              <template v-else>
                <span
                  v-for="(item, idx) in broadcastItems.slice(0, 3)"
                  :key="item.label"
                  class="broadcast-item"
                >
                  {{ item.label }} {{ item.current }}/{{ item.total }}
                  <template v-if="idx < Math.min(broadcastItems.length, 3) - 1"> · </template>
                </span>
                <span v-if="broadcastItems.length > 3" class="broadcast-more">+{{ broadcastItems.length - 3 }}</span>
              </template>
            </div>

            <!-- 右侧区域 -->
            <div class="toolbar-right">
              <el-button
                text
                size="small"
                :icon="DocumentAdd"
                title="生成记录"
                class="toolbar-icon-btn"
                @click="openGenRecord"
              />
              <el-button
                text
                size="small"
                type="danger"
                :icon="Delete"
                title="删除所选分镜"
                :disabled="selectedShots.size === 0"
                @click="handleBatchDeleteShots"
              />
              <el-button
                text
                size="small"
                :icon="RefreshLeft"
                title="撤销"
                class="toolbar-icon-btn"
                disabled
                @click="handleUndo"
              />
              <el-button
                text
                size="small"
                :icon="RefreshRight"
                title="重做"
                class="toolbar-icon-btn"
                disabled
                @click="handleRedo"
              />
              <el-dropdown trigger="click" popper-class="dark-dropdown">
                <el-button text size="small" :icon="Upload" title="导出" class="toolbar-icon-btn" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="handleExport('视频')">视频导出（独立文件）</el-dropdown-item>
                    <el-dropdown-item @click="handleVideoConcat">视频合成导出（单文件）</el-dropdown-item>
                    <el-dropdown-item @click="handleExport('场景')">场景导出</el-dropdown-item>
                    <el-dropdown-item @click="handleExport('角色')">角色导出</el-dropdown-item>
                    <el-dropdown-item @click="handleExport('道具')">道具导出</el-dropdown-item>
                    <el-dropdown-item divided @click="handleBatchGenerateVoices">🎙️ 批量配音</el-dropdown-item>
                    <el-dropdown-item @click="handlePDFExport">📄 分镜表 PDF</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-dropdown trigger="click" popper-class="dark-dropdown">
                <el-button text size="small" :icon="Grid" title="批量生成" class="toolbar-icon-btn" :loading="storyboardGenerating" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="handleBatchGenerate('人物')">🧑 批量生成角色</el-dropdown-item>
                    <el-dropdown-item @click="handleBatchGenerate('场景')">🏞️ 批量生成场景</el-dropdown-item>
                    <el-dropdown-item @click="handleBatchGenerate('道具')">🔧 批量生成道具</el-dropdown-item>
                    <el-dropdown-item divided @click="handleGenerateStoryboard">🎬 批量生成故事板</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button
                text
                size="small"
                :icon="Setting"
                title="设置"
                class="toolbar-icon-btn"
                @click="goSettings"
              />
            </div>
          </div>

          <!-- shot cards + 故事板卡片 + AssetPanel -->
          <div class="shot-cards-layout">
            <!-- 加载中 -->
            <div v-if="episodesLoading" class="loading-mask">加载中...</div>

            <template v-else>
              <ShotListCard
                :shots="chapterFilteredProjectData?.shots || []"
                :selected-shots="selectedShots"
                :editing-cell="editingCell"
                :edit-text="editText"
                :is-select-all="shotCardsSelectAll"
                @update:selected-shots="(v: Set<string>) => selectedShots = v"
                @update:is-select-all="(v: boolean) => shotCardsSelectAll = v"
                @start-edit="(shotId: string, field: string, text: string) => startEdit(shotId, field, text)"
                @save-edit="(shotId: string, field: string) => saveEdit(shotId, field)"
                @cancel-edit="cancelEdit"
                @update:edit-text="(v: string) => editText = v"
                @add-association="(shotId: string, type: 'character'|'scene'|'prop') => addAssociationFromTable(shotId, type)"
                @remove-association="(shotId: string, type: 'character'|'scene'|'prop', assetId: string) => removeAssociation(shotId, type, assetId)"
              />

              <!-- 中列：故事板卡片 + 选中镜头详情 -->
              <div class="storyboard-card-column">
                <div class="storyboard-card-wrap">
                  <img v-if="shotCardsPosterUrl" :src="shotCardsPosterUrl" class="storyboard-card-img" @dblclick="openStoryboardFullscreen" />
                  <div v-else class="storyboard-card-empty">暂无故事板</div>
                </div>
                <div class="storyboard-card-actions">
                  <div class="storyboard-actions-left">
                    <el-select v-model="shotCardsStoryboardRes" size="small" style="width:130px">
                      <el-option v-for="o in shotCardsStoryboardResOptions" :key="o.value" :label="o.label" :value="o.value" />
                    </el-select>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="!!storyboardSingleGenLoading"
                      @click="handleGenerateStoryboardForCurrentChapter"
                    >生成故事板</el-button>
                  </div>
                  <div class="storyboard-history-strip">
                    <div
                      v-for="(url, i) in shotCardsHistoryThumbs"
                      :key="i"
                      class="storyboard-history-box"
                      :class="{ active: url && url === shotCardsPosterUrl, empty: !url }"
                      @click="url && switchStoryboardImage(url)"
                    >
                      <img v-if="url" :src="url" class="storyboard-history-box-img" />
                      <span v-else class="storyboard-history-box-empty">暂无</span>
                      <el-button v-if="url" :icon="Close" class="history-del-btn" circle size="small" @click.stop="deleteHistoryImage(i)" title="删除" />
                    </div>
                  </div>
                  <!-- 镜头元信息 inline + 视频 -->
                  <div v-if="selectedShotDetail" class="storyboard-shot-meta-inline">
                    <span class="shot-meta-index">镜头 #{{ selectedShotDetail.shot_index }}</span>
                    <span class="shot-meta-type">{{ selectedShotDetail.shot_type || '-' }}</span>
                    <span class="shot-meta-cam">{{ selectedShotDetail.camera_movement || selectedShotDetail.focal_length || '-' }}</span>
                    <span class="shot-meta-spacer" />
                    <el-select v-model="videoDuration" size="small" style="width:80px" title="视频时长">
                      <el-option v-for="d in [4,5,8,10,12,15]" :key="d" :label="d+'s'" :value="d" />
                    </el-select>
                    <el-button :icon="VideoPlay" size="small" type="primary" :loading="!!_videoGenerating" @click="handleGenerateVideo()" title="生成视频">生成视频</el-button>
                  </div>
                </div>
                <!-- 编辑区 -->
                <div v-if="selectedShotDetail" class="storyboard-shot-detail">
                  <div class="detail-field">
                    <label>分镜描述</label>
                    <el-input v-model="_editingShotDesc" @blur="saveSelectedShotField('description_zh')" type="textarea" :rows="4" size="small" />
                  </div>
                  <div class="detail-field">
                    <label>视频提示词</label>
                    <el-input v-model="_editingShotVideo" @blur="saveSelectedShotField('video_prompt_zh')" type="textarea" :rows="3" size="small" />
                  </div>
                </div>
              </div>

              <!-- 右列：AssetPanel -->
              <AssetPanel
                :project-id="projectId"
                :project-path="project?.path || ''"
                :project-data="projectData"
                :panel-mode="panelMode"
                :resident-tab="residentTab"
                :detail-type="detailType"
                :detail-data="detailData"
                :search-keyword="searchKeyword"
                :generating-video="_videoGenerating"
                @update:panel-mode="(v: 'resident' | 'detail') => panelMode = v"
                @update:resident-tab="(v: 'characters' | 'scenes' | 'props' | 'videos') => residentTab = v"
                @update:search-keyword="(v: string) => searchKeyword = v"
                @refresh-data="loadEpisodesData()"
                @show-detail="(type: string, data: any) => showDetail(type, data)"
                @generate-image="(payload: any) => handleGenerateImage(payload.type, payload.assetId || payload.shotId)"
                @generate-video="(payload: any) => { if (payload.shotId) { showDetail('video', projectData?.shots?.find((s:any) => s.id === payload.shotId)); nextTick(() => handleGenerateVideo()); } }"
                @generate-storyboard="(_payload: any) => { handleGenerateStoryboardForCurrentChapter(); }"
                @voice-preset-changed="(characterId: string, preset: string) => { if (projectData) { const ch = projectData.characters?.find((c: any) => c.id === characterId); if (ch) ch.voice_preset = preset; for (const s of (projectData.shots || [])) { const sc = s.characters?.find((c: any) => c.id === characterId); if (sc) sc.voice_preset = preset; } } }"
              />
            </template>
          </div>

          <!-- 画布视图 -->
          <CanvasView
            v-if="viewMode === 'canvas'"
            :project-data="projectData"
            :project-id="projectId"
            @back-to-editor="viewMode = 'table'"
            @refresh-data="loadEpisodesData()"
            @generate-video="(shotId: string) => { const shot = projectData?.shots?.find((s:any) => s.id === shotId); if (shot) { showDetail('video', shot); nextTick(() => handleGenerateVideo()); } }"
          />
        </div>
      </main>
    </div>

    <!-- 生成记录弹窗（已迁入 GenerationOrchestrator） -->

    <!-- 角色/场景/道具选择器 -->
    <el-dialog v-model="pickerVisible" :title="'选择' + (pickerType === 'character' ? '角色' : pickerType === 'scene' ? '场景' : '道具')" width="500px">
      <div class="picker-grid">
        <div v-for="a in pickerAssets" :key="a.id" class="picker-card" @click="pickerSelect(a)">
          <img v-if="a.reference_image" :src="'file://' + a.reference_image.replace(/\\/g, '/')" class="picker-thumb" />
          <div v-else class="picker-placeholder">{{ a.name?.slice(0,2) }}</div>
          <span class="picker-name">{{ a.name }}</span>
        </div>
        <div v-if="pickerAssets.length === 0" class="picker-empty">暂无可用</div>
      </div>
    </el-dialog>

    <!-- GenerationOrchestrator：对话框组（生成记录/AI解析/模型配置/导出/批量） -->
    <GenerationOrchestrator
      :project-id="projectId"
      :project-data="projectData"
      :style-presets="stylePresets"
      :aspect-ratios="aspectRatios"
      :selected-style="selectedStyle"
      :selected-aspect-ratio="selectedAspectRatio"
      :selected-shots="selectedShots"
      :provider-models="providerModels"
      :provider-channels="providerChannels"
      :text-provider-models="textProviderModels"
      :gen-record-visible="genRecordVisible"
      :gen-records="genRecords"
      :gen-record-tab="genRecordTab"
      :gen-record-status-filter="genRecordStatusFilter"
      :gen-record-type-filter="genRecordTypeFilter"
      :parse-dialog-visible="parseDialogVisible"
      :parse-mode="parseMode"
      :parse-engine="parseEngine"
      :parse-script-text="parseScriptText"
      :selected-template="selectedTemplate"
      :template-preview="templatePreview"
      :selected-model="selectedModel"
      :parse-generating="parseGenerating"
      :parse-progress-steps="parseProgressSteps"
      :templates="templates"
      :model-config-visible="modelConfigVisible"
      :model-config-tab="modelConfigTab"
      :model-config-mode="modelConfigMode"
      :model-config="modelConfig"
      :model-config-templates="modelConfigTemplates"
      :model-config-ref-images="modelConfigRefImages"
      :model-config-template-tab="modelConfigTemplateTab"
      :export-progress-visible="exportProgressVisible"
      :export-progress-current="exportProgressCurrent"
      :export-progress-total="exportProgressTotal"
      :export-progress-msg="exportProgressMsg"
      :batch-dialog-visible="batchDialogVisible"
      :batch-type="batchType"
      :batch-mode="batchMode"
      :batch-count="batchCount"
      :batch-total-assets="batchTotalAssets"
      :batch-missing-count="batchMissingCount"
      :batch-progress="batchProgress"
      :batch-cancelled="batchCancelled"
      :filtered-config-models="filteredConfigModels"
      :filtered-config-channels="filteredConfigChannels"
      :script-char-count="scriptCharCount"
      @update:gen-record-visible="(v) => genRecordVisible = v"
      @update:gen-record-tab="(v) => setGenRecordTab(v)"
      @update:gen-record-status-filter="(v) => genRecordStatusFilter = v"
      @update:gen-record-type-filter="(v) => genRecordTypeFilter = v"
      @gen-record-reload="loadGenerationRecords"
      @gen-record-retry="retryTask"
      @gen-record-delete="deleteGenRecord"
      @batch-cancel="handleCancelBatch"
      @update:batch-dialog-visible="(v) => batchDialogVisible = v"
      @update:batch-count="(v) => batchCount = v"
      @batch-submit="(mode: string) => handleBatchSubmit(mode as 'all' | 'missing')"
      @update:export-progress-visible="(v) => exportProgressVisible = v"
      @export-video="handleExport('视频')"
      @export-concat="handleVideoConcat"
      @export-pdf="handlePDFExport"
      @update:parse-dialog-visible="(v) => parseDialogVisible = v"
      @update:parse-engine="(v) => parseEngine = v"
      @update:parse-script-text="(v) => parseScriptText = v"
      @update:selected-template="(v) => selectedTemplate = v"
      @update:selected-model="(v) => selectedModel = v"
      @parse-template-change="handleTemplateChange"
      @parse-submit="(_mode, _script, _templateId, _model) => handleParseSubmit()"
      @parse-skip="handleSkipParse"
      @parse-load-templates="loadTemplates"
      @update:model-config-visible="(v) => modelConfigVisible = v"
      @update:model-config-tab="(v) => setModelConfigTab(v)"
      @update:model-config="(c) => modelConfig = c"
      @model-config-save="handleModelConfigSave"
      @model-config-load-templates="loadModelConfigTemplates"
      @model-config-select-ref-image="handleSelectRefImage"
      @model-config-remove-ref-image="handleRemoveRefImage"
      @model-config-model-change="(tabKey, val) => handleModelConfigModelChange(tabKey, val)"
      @model-config-channel-change="(tabKey, val) => handleModelConfigChannelChange(tabKey, val)"
      @model-config-set-field="(key, field, value) => setModelConfigField(key, field, value)"
    />
  </div>

  <!-- 故事板全屏 -->
  <div v-if="storyboardFullscreen" class="storyboard-fs-overlay" @click="closeStoryboardFullscreen">
    <div class="storyboard-fs-nav storyboard-fs-prev" @click.stop>
      <el-button :icon="ArrowLeft" circle :disabled="fsImageIndex <= 0" @click="fsPrevImage" />
    </div>
    <img :src="fsCurrentUrl" class="storyboard-fs-img" @click.stop />
    <div class="storyboard-fs-nav storyboard-fs-next" @click.stop>
      <el-button :icon="ArrowRight" circle :disabled="fsImageIndex >= shotCardsHistoryUrls.length - 1" @click="fsNextImage" />
    </div>
    <div class="storyboard-fs-topright" @click.stop>
      <span class="fs-counter">{{ fsImageIndex + 1 }} / {{ shotCardsHistoryUrls.length }}</span>
      <el-button :icon="Download" circle size="small" class="fs-btn-download" @click="fsDownloadImage" title="下载" />
      <el-button :icon="Delete" circle size="small" class="fs-btn-delete" @click="fsDeleteImage" title="删除" />
      <el-button :icon="Close" circle size="small" class="fs-btn-close" @click="closeStoryboardFullscreen" title="关闭" />
    </div>
  </div>
</template>


<style scoped src="./Editor.css"></style>
