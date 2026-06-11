<script setup lang="ts">
import '../assets/global.css'
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft,
  Setting,
  Plus,
  VideoPlay,
  DocumentAdd,
  Tools,
  Upload,
  Grid,
  Document,
  RefreshLeft,
  RefreshRight
} from '@element-plus/icons-vue'
import { useEditorStore } from '../stores/editor'
import CanvasView from './CanvasView.vue'
import ShotFlowEditor from '../components/ShotFlowEditor.vue'
import AssetPanel from '../components/AssetPanel.vue'
import GenerationOrchestrator from '../components/GenerationOrchestrator.vue'

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
const residentTab = ref<'characters' | 'scenes' | 'props'>('characters')
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
  | 'first_frame'
  | 'last_frame'
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
const eraPresets = ['古代', '近代', '现代', '近未来', '远未来', '末日废土', '架空世界']
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
  { key: 'first_frame', label: '首帧生图模型' },
  { key: 'last_frame', label: '尾帧生图模型' },
  { key: 'video', label: '视频生成模型' }
]

function setModelConfigTab(idx: number): void {
  modelConfigTab.value = idx
  loadModelConfigTemplates()
}

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
const editFirstFramePrompt = ref('')
const editLastFramePrompt = ref('')
const editVideoPrompt = ref('')
const assetImages = ref<any[]>([])
const assetVideos = ref<any[]>([])

const exportAssetMode = ref(false)
const exportAssetType = ref('')
const exportAssetIds = ref<Set<string>>(new Set())
const lastExportDir = ref('')
const exportProgressVisible = ref(false)
const exportProgressCurrent = ref(0)
const exportProgressTotal = ref(0)
const exportProgressMsg = ref('')

let _videoGenerating = false
async function handleGenerateVideo(): Promise<void> {
  if (!detailData.value?.id || _videoGenerating) return
  _videoGenerating = true
  try {
    const result = await window.api.generateVideo({ projectId, shotId: detailData.value.id })
    ElMessage.success('视频生成任务已提交')
    // 更新本地 shot 数据
    if (result?.videoPaths?.length > 0) {
      const shot = projectData.value?.shots?.find((s: any) => s.id === detailData.value.id)
      if (shot) shot.video_path = result.videoPaths[0]
      if (detailData.value) detailData.value.video_path = result.videoPaths[0]
    }
    await loadGenerationRecords()
    startBroadcastPolling()
  } catch (err: any) {
    ElMessage.error(err?.message || '视频生成失败')
  } finally { _videoGenerating = false }
}

// AI解析弹窗（保留）
const parseDialogVisible = ref(false)
const parseMode = ref<'full' | 'append'>('full')
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

const navItems = computed(() => {
  const chapters = projectData.value?.chapters?.length || 0
  const shots = projectData.value?.shots?.length || 0
  return [
    { key: 'overview', label: '项目总览' },
    { key: 'episodes', label: `剧集结构 ${chapters}集·${shots}镜` }
  ]
})

// 风格预设（保留）
const stylePresets = [
  {
    name: '二次元动漫',
    prompt:
      'Anime style, vibrant colors, detailed eyes, cel shading, clean line art, expressive characters, dynamic composition, high quality illustration',
    negative:
      'photorealistic, 3d render, blurry, low quality, bad anatomy, deformed, ugly, duplicate, watermark, signature',
    color: '#ff6b9d'
  },
  {
    name: '写实摄影',
    prompt:
      'Photorealistic, high detail, natural lighting, 8k uhd, cinematic grading, film grain, color graded, cinematic shot, depth of field, professional photography, realistic textures, lifelike',
    negative:
      'painting, illustration, cartoon, anime, 3d render, blurry, low quality, artificial, oversaturated',
    color: '#4ecdc4'
  },
  {
    name: '3D渲染',
    prompt:
      '3D render, octane render, blender, cinematic lighting, cinematic grading, color graded, ray tracing, subsurface scattering, physically based rendering, high poly model, studio lighting',
    negative: '2d, flat, painting, sketch, hand drawn, low poly, blurry, low quality, cartoon',
    color: '#a78bfa'
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
    name: '赛博朋克',
    prompt:
      'Cyberpunk, neon lights, futuristic, dystopian city, holographic displays, rain-soaked streets, high tech low life, glowing accents, blade runner aesthetic, cinematic grading, color graded',
    negative:
      'medieval, natural landscape, pastel colors, soft lighting, cottagecore, blurry, low quality, boring, plain',
    color: '#f472b6'
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
  {
    name: '中国仙侠',
    prompt:
      'Chinese Xianxia fantasy art, semi-realistic cel-shaded rendering, ink wash influences, ethereal glow, dramatic god rays, cinematic grading, film grain, misty atmosphere, jade green and celestial gold palette, painterly textures, spiritual mood',
    negative:
      'modern, urban, western, photorealistic, 3d render, dark gritty, cartoon, anime, mecha, sci-fi, blurry, low quality, mundane',
    color: '#7BC5A8'
  }
]

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
      stylePrompt: style?.prompt || '',
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
    const list = (await window.api.getPromptTemplates(projectId, 'script_parse')) as any[]
    templates.value = list
    if (list.length > 0 && !selectedTemplate.value) {
      selectedTemplate.value = list[0].id
      templatePreview.value = list[0].content
    }
  } catch (err) {
    console.error('加载模板失败', err)
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
    await window.api.autoProcess(projectId, parseScriptText.value.trim(), {
      promptTemplate: template?.content,
      aspectRatio: selectedAspectRatio.value,
      model: selectedModel.value || undefined,
      mode: parseMode.value
    })
    ElMessage.success('生成完成！')
    parseDialogVisible.value = false
    activeNav.value = 'episodes'
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
    if (field === 'description') { update.description_zh = editText.value; update.description = editText.value }
    else if (field === 'first_frame_prompt') {
      const v = editText.value; update.first_frame_prompt_zh = v
      update.first_frame_prompt = /[一-鿿]/.test(v) ? await window.api.translateToEnglish(v) : v
    }
    else if (field === 'last_frame_prompt') {
      const v = editText.value; update.last_frame_prompt_zh = v
      update.last_frame_prompt = /[一-鿿]/.test(v) ? await window.api.translateToEnglish(v) : v
    }
    else if (field === 'video_prompt') {
      const v = editText.value; update.video_prompt_zh = v
      update.video_prompt = /[一-鿿]/.test(v) ? await window.api.translateToEnglish(v) : v
    }
    else if (field === 'dialogue') { update.dialogue = editText.value }
    else if (field === 'narration') { update.narration = editText.value }
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


async function handleMoveUp(shotId: string): Promise<void> {
  try {
    await window.api.moveShotUp(shotId)
    await loadEpisodesData()
  } catch (err) {
    ElMessage.error('移动失败')
    console.error(err)
  }
}

async function handleMoveDown(shotId: string): Promise<void> {
  try {
    await window.api.moveShotDown(shotId)
    await loadEpisodesData()
  } catch (err) {
    ElMessage.error('移动失败')
    console.error(err)
  }
}

async function handleDeleteShot(shotId: string): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除该分镜吗？此操作不可撤销', '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await window.api.deleteShot(shotId)
    selectedShots.value.delete(shotId)
    await loadEpisodesData()
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      ElMessage.error('删除失败')
      console.error(err)
    }
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
    // 分镜模式：首帧/尾帧/视频，依赖分镜勾选
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
      case '首帧':
        total += 1
        missing += shot.first_frame_image_path ? 0 : 1
        break
      case '尾帧':
        total += 1
        missing += shot.last_frame_image_path ? 0 : 1
        break
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
        description: asset.description || asset.name || ''
      })
    }
  } else {
    const selectedShotIds = Array.from(selectedShots.value)
    const shots = projectData.value?.shots || []
    for (const shot of shots) {
      if (!selectedShotIds.includes(shot.id)) continue
      if (type === '首帧' && mode === 'missing' && shot.first_frame_image_path) continue
      if (type === '尾帧' && mode === 'missing' && shot.last_frame_image_path) continue
      if (type === '视频' && mode === 'missing' && shot.video_path) continue

      switch (type) {
        case '首帧':
          taskItems.push({ kind: 'shot', shotId: shot.id, frameType: 'first' })
          break
        case '尾帧':
          taskItems.push({ kind: 'shot', shotId: shot.id, frameType: 'last' })
          break
        case '视频':
          taskItems.push({ kind: 'video', shotId: shot.id })
          break
      }
    }
  }

  // 预创建 generation_tasks 记录
  let taskIds: string[] = []
  if (taskItems.length > 0) {
    const batchTasks = taskItems.map((item) => {
      if (item.kind === 'asset') {
        const purpose = item.assetType === 'character' ? 'character_reference' : item.assetType === 'scene' ? 'scene_reference' : 'prop_reference'
        return {
          type: 'image',
          purpose,
          inputParams: JSON.stringify({ assetId: item.assetId, count: batchCount.value, description: item.description })
        }
      } else if (item.kind === 'shot') {
        const purpose = item.frameType === 'first' ? 'first_frame' : 'last_frame'
        return {
          shotId: item.shotId,
          type: 'image',
          purpose,
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
      // 间隔 1 秒，避免 API 限流
      await new Promise((r) => setTimeout(r, 1000))
      await new Promise((r) => requestAnimationFrame(r))
    }
  }

  const workerCount = Math.min(3, total)
  const workers: Promise<void>[] = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
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
  editFirstFramePrompt.value = data?.first_frame_prompt_zh || data?.first_frame_prompt || ''
  editLastFramePrompt.value = data?.last_frame_prompt_zh || data?.last_frame_prompt || ''
  editVideoPrompt.value = data?.video_prompt_zh || data?.video_prompt || ''
  editAssetName.value = data?.name || ''
  editAssetDesc.value = data?.description || ''
  // AssetPanel 通过 watch(detailData) 自动加载历史图片/视频
}



// 生图按钮（MVP2真实服务）
async function handleGenerateImage(type: string, assetId?: string): Promise<void> {
  if (!assetId) return

  // 首帧/尾帧生图
  if (type === 'firstFrame' || type === 'lastFrame') {
    const frameType = type === 'firstFrame' ? 'first' : 'last'
    const purposeKey = type === 'firstFrame' ? 'first_frame' : 'last_frame'

    // 读取项目模型配置
    let shotModelConfig: any = {}
    try {
      const proj = await window.api.getProject(projectId)
      const raw = (proj as Record<string, any>)?.model_config_json
      if (raw) shotModelConfig = JSON.parse(raw)
    } catch { /* ignore */ }
    const purposeConfig = shotModelConfig[purposeKey] || {}

    // 只读会话级覆盖（齿轮弹窗），有覆盖才传 model/channel，否则让后端降级链全权处理
    const override = sessionOverrides.value[purposeKey]
    const model = override?.model || undefined
    const channel = override?.channel || undefined

    try {
      await window.api.generateShotImage({
        projectId,
        shotId: assetId,
        frameType,
        count: genCount.value,
        model,
        channel,
        templateId: purposeConfig.templateId || '',
        refImage: purposeConfig.refImage || ''
      })
      ElMessage.success('图片生成成功')
      // 直接更新本地数据，避免全量刷新导致滚动重置
      try {
        const fresh = await window.api.getProjectData(projectId)
        const freshShot = (fresh as any).shots?.find((s: any) => s.id === assetId)
        if (freshShot && projectData.value) {
          const key = frameType === 'first' ? 'first_frame_image_path' : 'last_frame_image_path'
          const localShot = projectData.value.shots?.find((s: any) => s.id === assetId)
          if (localShot) { localShot[key] = freshShot[key]; localShot.first_frame_prompt = freshShot.first_frame_prompt; localShot.first_frame_prompt_zh = freshShot.first_frame_prompt_zh }
          if (detailData.value?.id === assetId) detailData.value = { ...detailData.value, [key]: freshShot[key] }
        }
      } catch { /* silent */ }
      await loadGenerationRecords()
    } catch (err: any) {
      ElMessage.error(err?.message || '图片生成失败')
      console.error(err)
    } finally {
    }
    return
  }

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
      if (detailData.value?.id === assetId) detailData.value = { ...detailData.value, reference_image: freshAsset?.reference_image || '' }
    } catch { /* silent */ }
    await loadGenerationRecords()
  } catch (err: any) {
    ElMessage.error(err?.message || '图片生成失败')
    console.error(err)
  } finally {
  }
}

// 提示词编辑（首帧/尾帧详情）

function goHome(): void {
  router.push('/')
}

function goSettings(): void {
  router.push('/settings')
}

// 配音文本清洗：去角色名前缀（"林小薇："→""）和括号内表演提示（"（空灵温柔）"→""）
// 支持多轮对白："林小薇：你好。张伟：再见。" → "你好。再见。"
function cleanDialogueText(raw: string): string {
  return raw
    .replace(/(^|[。！？])\s*[^。！？：:]+[：:]/g, '$1')  // 去角色名前缀（仅限句首或标点后）
    .replace(/[（(][^）)]*[）)]/g, '')                      // 去括号内表演提示
    .replace(/\s+/g, ' ')                                   // 合并多余空白
    .trim()
}

// ===== 顶部工具栏 =====

async function openGenRecord(): Promise<void> {
  genRecordVisible.value = true
  await loadGenerationRecords()
}

async function loadGenerationRecords(): Promise<void> {
  try {
    genRecords.value = await window.api.getGenerationTasks(projectId)
  } catch (err) {
    ElMessage.error('加载生成记录失败')
    console.error(err)
  }
}

// 播报条轮询
async function pollBroadcast(): Promise<void> {
  try {
    const records = (await window.api.getGenerationTasks(projectId)) as any[]
    const active = records.filter((r: any) => ['pending', 'running'].includes(r.status))
    if (active.length === 0 && broadcastItems.value.length > 0) {
      stopBroadcastPolling()
      broadcastAllDone.value = true
      broadcastAllDoneTimer.value = window.setTimeout(() => {
        broadcastAllDone.value = false
      }, 3000)
      broadcastItems.value = []
      return
    }
    const grouped: Record<string, { current: number; total: number }> = {}
    for (const r of active) {
      const label = purposeLabel(r.purpose)
      if (!grouped[label]) grouped[label] = { current: 0, total: 0 }
      grouped[label].total++
      if (r.status === 'running') grouped[label].current++
    }
    broadcastItems.value = Object.entries(grouped).map(([label, data]) => ({ label, ...data }))
  } catch (err) {
    console.error('播报条轮询失败:', err)
  }
}

function startBroadcastPolling(): void {
  if (broadcastTimer.value) clearInterval(broadcastTimer.value)
  broadcastAllDone.value = false
  if (broadcastAllDoneTimer.value) {
    clearTimeout(broadcastAllDoneTimer.value)
    broadcastAllDoneTimer.value = null
  }
  void pollBroadcast()
  broadcastTimer.value = window.setInterval(() => {
    void pollBroadcast()
  }, 2000)
}

function stopBroadcastPolling(): void {
  if (broadcastTimer.value) {
    clearInterval(broadcastTimer.value)
    broadcastTimer.value = null
  }
}

// 全部停止
async function handleCancelBatch(): Promise<void> {
  try {
    await window.api.cancelGenerationTasks(projectId)
    batchCancelled.value = true
    ElMessage.info('已取消剩余任务')
    await loadGenerationRecords()
  } catch (err) {
    ElMessage.error('取消失败')
    console.error(err)
  }
}

const purposeLabels: Record<string, string> = {
  character_reference: '角色定妆照',
  scene_reference: '场景图',
  prop_reference: '道具图',
  first_frame: '首帧',
  last_frame: '尾帧',
  video: '视频',
  voice: '配音'
}

function purposeLabel(purpose: string): string {
  return purposeLabels[purpose] || purpose
}

async function retryTask(record: any): Promise<void> {
  try {
    await window.api.createGenerationTask({
      projectId: record.project_id,
      shotId: record.shot_id,
      type: record.type || 'image',
      purpose: record.purpose,
      model: record.model,
      inputParams: record.input_params
    })
    ElMessage.success('已创建重试任务')
    await loadGenerationRecords()
  } catch (err) {
    ElMessage.error('重试失败')
    console.error(err)
  }
}

function handleUndo(): void {
  ElMessage.info('撤销功能后续版本开放')
}

function handleRedo(): void {
  ElMessage.info('重做功能后续版本开放')
}

function handleExport(type: string): void {
  if (type === '视频') {
    handleVideoExport()
  } else if (type === '角色') {
    startAssetExport('characters')
  } else if (type === '场景') {
    startAssetExport('scenes')
  } else if (type === '道具') {
    startAssetExport('props')
  }
}

function startAssetExport(type: 'characters' | 'scenes' | 'props'): void {
  exportAssetMode.value = true
  exportAssetType.value = type
  exportAssetIds.value = new Set()
  residentTab.value = type
  panelMode.value = 'resident'
}




async function handleVideoExport(): Promise<void> {
  if (selectedShots.value.size === 0) {
    ElMessage.warning('请先勾选要导出的分镜')
    return
  }

  const shots =
    projectData.value?.shots?.filter((s: any) => selectedShots.value.has(s.id) && s.video_path) ||
    []
  const skipped = selectedShots.value.size - shots.length

  if (shots.length === 0) {
    ElMessage.warning('勾选的分镜均未生成视频，无需导出')
    return
  }

  const dir = await window.api.selectExportDirectory(lastExportDir.value || undefined)
  if (!dir) return
  lastExportDir.value = dir
  await window.api.setSetting('last_export_dir', dir)

  exportProgressVisible.value = true
  exportProgressTotal.value = shots.length
  exportProgressCurrent.value = 0
  exportProgressMsg.value = '正在导出视频...'

  const projectName = project.value?.name || 'project'
  const timestamp = Date.now()
  let successCount = 0

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    const ext = shot.video_path.split('.').pop() || 'mp4'
    const destName = `${i + 1}_${projectName}_${timestamp}.${ext}`
    const destPath = `${dir}/${destName}`
    const ok = await window.api.copyExportFile(shot.video_path, destPath)
    if (ok) successCount++
    exportProgressCurrent.value = i + 1
  }

  exportProgressVisible.value = false

  let msg = `成功导出 ${successCount} 个视频到 ${dir}`
  if (skipped > 0) msg += `，${skipped} 个分镜因未生成视频已跳过`
  if (successCount < shots.length) msg += `，${shots.length - successCount} 个复制失败`
  ElMessage.success(msg)
}

async function handleVideoConcat(): Promise<void> {
  if (selectedShots.value.size === 0) {
    ElMessage.warning('请先勾选要合成的分镜')
    return
  }

  const shots = projectData.value?.shots || []
  // 按分镜顺序排列
  const orderedShots = shots
    .filter((s: any) => selectedShots.value.has(s.id) && s.video_path)
    .sort((a: any, b: any) => {
      const ai = (a.chapter_id || '') + '_' + String(a.shot_index).padStart(5, '0')
      const bi = (b.chapter_id || '') + '_' + String(b.shot_index).padStart(5, '0')
      return ai.localeCompare(bi)
    })

  const shotIds = orderedShots.map((s: any) => s.id)
  const skipped = selectedShots.value.size - shotIds.length

  if (shotIds.length < 2) {
    ElMessage.warning('至少需要 2 个分镜才能合成导出')
    return
  }

  try {
    exportProgressVisible.value = true
    exportProgressMsg.value = `正在合成 ${shotIds.length} 个分镜视频...`

    const projectName = project.value?.name || 'project'
    const outputName = `${projectName}_合成_${Date.now()}.mp4`
    const result = await window.api.concatVideos(projectId, shotIds, outputName)

    exportProgressVisible.value = false

    let msg = `视频合成完成！已导出到 ${result.outputPath}（${result.shotCount} 个分镜）`
    if (skipped > 0) msg += `，${skipped} 个分镜因未生成视频已跳过`
    ElMessage.success(msg)
  } catch (err: any) {
    exportProgressVisible.value = false
    ElMessage.error(err?.message || '视频合成失败')
  }
}

async function handleGenerateVoice(shotId: string): Promise<void> {
  const shot = projectData.value?.shots?.find((s: any) => s.id === shotId)
  // 判断配音类型：对白 / 角色内心独白 / 系统旁白
  const narration = shot?.narration?.trim() || ''
  const dialogue = shot?.dialogue?.trim() || ''
  const text = cleanDialogueText(dialogue || narration)
  if (!text) {
    ElMessage.warning('该分镜没有对白或旁白')
    return
  }
  let voicePreset = 'narrator'

  if (dialogue) {
    // 对白：找关联角色第一个有 voice_preset 的
    const charIds = shot.characters?.map((c: any) => c.id) || []
    const charWithVoice = projectData.value?.characters?.find((c: any) => charIds.includes(c.id) && c.voice_preset)
    if (!charWithVoice) {
      ElMessage.warning('请先在角色详情中为该分镜的出场角色设置发音人')
      return
    }
    voicePreset = charWithVoice.voice_preset
  } else if (narration) {
    // 旁白：检查是否以"角色名："开头 → 角色内心独白
    const charMatch = projectData.value?.characters?.find((c: any) =>
      narration.startsWith(c.name + '：') || narration.startsWith(c.name + ':')
    )
    if (charMatch?.voice_preset) {
      voicePreset = charMatch.voice_preset
    }
    // 否则默认 narrator（系统旁白）
  }

  try {
    const audioPath = await window.api.generateVoice({
      projectId,
      shotId,
      text: text,
      voicePreset
    })
    shot.voice_path = audioPath
    ElMessage.success('配音已生成')
  } catch (err: any) {
    ElMessage.error(err?.message || '配音生成失败')
  }
}

async function handleBatchGenerateVoices(): Promise<void> {
  if (selectedShots.value.size === 0) {
    ElMessage.warning('请先勾选分镜')
    return
  }

  const shots = projectData.value?.shots || []
  const inputs: Array<{ projectId: string; shotId: string; text: string; voicePreset: string }> = []

  for (const shot of shots) {
    if (!selectedShots.value.has(shot.id)) continue
    const dialogue2 = shot.dialogue?.trim() || ''
    const narration2 = shot.narration?.trim() || ''
    const text2 = cleanDialogueText(dialogue2 || narration2)
    if (!text2) continue
    let voicePreset2 = 'narrator'
    if (dialogue2) {
      const charIds2 = shot.characters?.map((c: any) => c.id) || []
      const charWithVoice2 = projectData.value?.characters?.find((c: any) => charIds2.includes(c.id) && c.voice_preset)
      if (!charWithVoice2) continue
      voicePreset2 = charWithVoice2.voice_preset
    } else if (narration2) {
      const charMatch2 = projectData.value?.characters?.find((c: any) =>
        narration2.startsWith(c.name + '：') || narration2.startsWith(c.name + ':')
      )
      if (charMatch2?.voice_preset) voicePreset2 = charMatch2.voice_preset
    }
    inputs.push({ projectId, shotId: shot.id, text: text2, voicePreset: voicePreset2 })
  }

  if (inputs.length === 0) {
    ElMessage.warning('勾选的分镜中没有可配音的（需要有关联角色且角色已设发音人）')
    return
  }

  try {
    const result = await window.api.batchGenerateVoices(inputs)
    const count = Object.keys(result).length
    for (const [sid, audioPath] of Object.entries(result)) {
      const shot = shots.find((s: any) => s.id === sid)
      if (shot) shot.voice_path = audioPath
    }
    ElMessage.success(`成功生成 ${count}/${inputs.length} 个配音`)
  } catch (err: any) {
    ElMessage.error(err?.message || '批量配音失败')
  }
}

async function handlePDFExport(): Promise<void> {
  try {
    const shotIds = selectedShots.value.size > 0 ? Array.from(selectedShots.value) : undefined
    ElMessage.info('正在生成分镜表 PDF...')
    const outputPath = await window.api.exportStoryboardPDF({
      projectId,
      shotIds,
      includeImages: true
    })
    ElMessage.success(`分镜表已导出到: ${outputPath}`)
  } catch (err: any) {
    ElMessage.error(err?.message || 'PDF 导出失败')
  }
}

// ===== 工具栏左侧交互 =====

async function startEditProjectName(): Promise<void> {
  if (!project.value) return
  projectNameEdit.value = project.value.name
  editingProjectName.value = true
}

async function saveProjectName(): Promise<void> {
  if (!project.value || !projectNameEdit.value.trim()) {
    editingProjectName.value = false
    return
  }
  if (projectNameEdit.value.trim() === project.value.name) {
    editingProjectName.value = false
    return
  }
  try {
    await window.api.updateProject(projectId, { name: projectNameEdit.value.trim() })
    await loadProject()
    ElMessage.success('项目名称已更新')
  } catch (err) {
    ElMessage.error('保存失败')
    console.error(err)
  }
  editingProjectName.value = false
}

function handleStyleSelectFromToolbar(style: any): void {
  selectedStyle.value = style.name
  saveStyleToProject()
  stylePopoverVisible.value = false
}

function handleEraSelect(era: string): void {
  const newEra = project.value?.era === era ? '' : era
  window.api
    .updateProject(projectId, { era: newEra })
    .then(() => {
      loadProject()
      ElMessage.success(newEra ? `年代已设置为：${newEra}` : '年代已清空')
    })
    .catch((err: any) => {
      ElMessage.error('保存失败')
      console.error(err)
    })
  eraPopoverVisible.value = false
}

function handleCustomEraSubmit(): void {
  if (!customEra.value.trim()) return
  window.api
    .updateProject(projectId, { era: customEra.value.trim() })
    .then(() => {
      loadProject()
      eraPopoverVisible.value = false
      customEra.value = ''
    })
    .catch((err: any) => {
      ElMessage.error('保存失败')
      console.error(err)
    })
}


async function loadProviderModels(): Promise<void> {
  try {
    const providers = await window.api.getProviders()
    const models: any[] = []
    const channels: any[] = []
    for (const p of providers as Record<string, any>[]) {
      channels.push({
        label: p.name,
        value: p.key || p.id
      })
      for (const m of (p as Record<string, any>).models || []) {
        const modelKey = typeof m === 'string' ? m : m.key
        const modelName = typeof m === 'string' ? m : m.name
        const modelType = typeof m === 'string' ? 'text' : (m.type || 'text')
        const pKey = p.key || p.id
        models.push({
          label: `${p.name} / ${modelName}`,
          value: `${pKey}:${modelKey}`,
          provider: pKey,
          modelKey: modelKey,
          modelType: modelType
        })
      }
    }
    providerModels.value = models
    providerChannels.value = channels
  } catch (err) {
    console.error('加载模型失败', err)
  }
}

async function openModelConfig(): Promise<void> {
  modelConfigVisible.value = true
  modelConfigRefImages.value = {}
  // 加载模型列表和渠道列表
  if (providerModels.value.length === 0) {
    await loadProviderModels()
  }
  // 加载当前配置
  try {
    const proj = await window.api.getProject(projectId)
    if ((proj as Record<string, any>)?.model_config_json) {
      modelConfig.value = JSON.parse((proj as Record<string, any>).model_config_json)
    } else {
      modelConfig.value = {}
    }
  } catch (_err) {
    modelConfig.value = {}
  }

  // 兼容旧数据：shot_image 映射到 first_frame
  if (modelConfig.value.shot_image && !modelConfig.value.first_frame?.model) {
    modelConfig.value.first_frame = { ...modelConfig.value.shot_image }
  }
  // 如果项目配置为空，自动加载全局 model_routes 作为默认值
  try {
    const modelRoutesRaw = await window.api.getSetting('model_routes')
    if (modelRoutesRaw) {
      const modelRoutes = JSON.parse(modelRoutesRaw as string)
      for (const [key, route] of Object.entries(modelRoutes)) {
        if (!modelConfig.value[key]?.model && !modelConfig.value[key]?.channel) {
          if (!modelConfig.value[key]) modelConfig.value[key] = {}
          if ((route as any).model) modelConfig.value[key].model = (route as any).model
          if ((route as any).channel) modelConfig.value[key].channel = (route as any).channel
        }
      }
    }
  } catch (e) {
    // ignore
  }
  // 加载模板
  loadModelConfigTemplates()
}

async function loadModelConfigTemplates(): Promise<void> {
  try {
    const tabKey = modelConfigTabs[modelConfigTab.value].key
    const usageMap: Record<string, string> = {
      language_model: 'script_parse',
      script_rewrite: 'script_parse',
      character_image: 'character_image',
      scene_image: 'scene_image',
      prop_image: 'prop_image',
      first_frame: 'first_frame',
      last_frame: 'last_frame',
      video: 'video'
    }
    const usageKey = usageMap[tabKey] || undefined
    let list = (await window.api.getPromptTemplates(projectId, usageKey)) as any[]
    // 视频模板有多个子类(video_basic/first_frame/both_frames/grid)，合并加载
    if (tabKey === 'video') {
      for (const vu of ['video_basic', 'video_first_frame', 'video_both_frames', 'video_grid']) {
        const sub = await window.api.getPromptTemplates(projectId, vu) as any[]
        for (const t of sub) { if (!list.find((x: any) => x.id === t.id)) list.push(t) }
      }
    }
    // 首帧/尾帧兼容旧的 shot_image usage
    if (tabKey === 'first_frame' || tabKey === 'last_frame') {
      const legacyList = await window.api.getPromptTemplates(projectId, 'shot_image') as any[]
      // 合并去重
      const ids = new Set(list.map((t: any) => t.id))
      for (const t of legacyList) {
        if (!ids.has(t.id)) { list.push(t); ids.add(t.id) }
      }
    }
    modelConfigTemplates.value = list
  } catch (err) {
    console.error('加载模板失败', err)
    modelConfigTemplates.value = []
  }
}

async function handleModelConfigSave(): Promise<void> {
  try {
    await window.api.updateProject(projectId, { modelConfigJson: JSON.stringify(modelConfig.value) })

    // 同步到全局 model_routes（单向广播：模型配置为真相源）
    const sharedKeys = ['language_model', 'character_image', 'scene_image', 'prop_image', 'first_frame', 'last_frame', 'video']
    const routesUpdate: Record<string, { model: string; channel: string }> = {}
    for (const key of sharedKeys) {
      const cfg = modelConfig.value[key]
      if (cfg?.model || cfg?.channel) {
        routesUpdate[key] = {
          model: cfg.model || '',
          channel: cfg.channel || ''
        }
      }
    }
    const existingRoutesRaw = await window.api.getSetting('model_routes')
    const existingRoutes = existingRoutesRaw ? JSON.parse(existingRoutesRaw as string) : {}
    const mergedRoutes = { ...existingRoutes, ...routesUpdate }
    await window.api.setSetting('model_routes', JSON.stringify(mergedRoutes))

    ElMessage.success('模型配置已保存')
    modelConfigVisible.value = false
  } catch (err) {
    ElMessage.error('保存失败')
    console.error(err)
  }
}

function setModelConfigField(key: string, field: string, value: any): void {
  if (!modelConfig.value[key]) modelConfig.value[key] = {}
  modelConfig.value[key][field] = value
}

function handleModelConfigModelChange(tabKey: string, val: string): void {
  setModelConfigField(tabKey, 'model', val)
  const matched = providerModels.value.find((m) => m.value === val)
  if (matched?.provider) {
    setModelConfigField(tabKey, 'channel', matched.provider)
  }
}

const configTypeMap: Record<string, string> = {
  language_model: 'text',
  character_image: 'image',
  scene_image: 'image',
  prop_image: 'image',
  first_frame: 'image',
  last_frame: 'image',
  video: 'video'
}

const filteredConfigModels = computed(() => {
  const neededType = configTypeMap[modelConfigTabs[modelConfigTab.value]?.key]
  if (!neededType) return providerModels.value
  return providerModels.value.filter((m) => m.modelType === neededType)
})

const textProviderModels = computed(() => {
  return providerModels.value.filter((m) => m.modelType === 'text')
})

const filteredConfigChannels = computed(() => {
  const providers = new Set(filteredConfigModels.value.map((m) => m.provider))
  return providerChannels.value.filter((c) => providers.has(c.value))
})

function handleModelConfigChannelChange(tabKey: string, val: string): void {
  setModelConfigField(tabKey, 'channel', val)
  const firstModel = filteredConfigModels.value.find((m) => m.provider === val)
  if (firstModel) {
    setModelConfigField(tabKey, 'model', firstModel.value)
  } else {
    setModelConfigField(tabKey, 'model', '')
  }
}

const scriptCharCount = computed(() => parseScriptText.value.length)

onMounted(() => {
  store.resetResult()
  store.scriptText = ''
  loadProject().then(() => loadEpisodesData())
  loadModelName()
})

onUnmounted(() => {
  if (removeAIProgress) removeAIProgress()
  stopBroadcastPolling()
  if (broadcastAllDoneTimer.value) clearTimeout(broadcastAllDoneTimer.value)
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
        <div
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activeNav === item.key }"
          @click="activeNav = item.key"
        >
          {{ item.label }}
        </div>
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

              <!-- 模型配置按钮 -->
              <el-button
                text
                size="small"
                :icon="Tools"
                title="模型配置"
                class="toolbar-icon-btn"
                @click="openModelConfig"
              />
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

          <!-- 表格视图 -->
          <div v-if="viewMode === 'table'" class="episodes-body">
            <div v-if="episodesLoading" class="loading-mask">加载中...</div>
            <ShotFlowEditor
              v-else
              :project-data="projectData"
              :selected-shots="selectedShots"
              :editing-cell="editingCell"
              :edit-text="editText"
              view-mode="table"
              @update:selected-shots="(v: any) => selectedShots = v"
              @update:edit-text="(v: string) => editText = v"
              @start-edit="(shotId: string, field: string, currentValue: string) => startEdit(shotId, field, currentValue)"
              @save-edit="(shotId: string, field: string) => saveEdit(shotId, field)"
              @cancel-edit="cancelEdit"
              @move-up="handleMoveUp"
              @move-down="handleMoveDown"
              @delete-shot="handleDeleteShot"
              @show-detail="(type: string, data: any) => showDetail(type, data)"
              @batch-generate="(type: string) => handleBatchGenerate(type)"
              @remove-association="(shotId: string, type: string, assetId: string) => removeAssociation(shotId, type, assetId)"
              @add-association="(shotId: string, type: string) => addAssociationFromTable(shotId, type)"
              @generate-voice="(shotId: string) => handleGenerateVoice(shotId)"
            />

            <!-- 右侧面板 (AssetPanel 组件) -->
            <AssetPanel
              :project-id="projectId"
              :project-path="project?.path || ''"
              :project-data="projectData"
              :panel-mode="panelMode"
              :resident-tab="residentTab"
              :detail-type="detailType"
              :detail-data="detailData"
              :search-keyword="searchKeyword"
              @update:panel-mode="(v: 'resident' | 'detail') => panelMode = v"
              @update:resident-tab="(v: 'characters' | 'scenes' | 'props') => residentTab = v"
              @update:search-keyword="(v: string) => searchKeyword = v"
              @refresh-data="loadEpisodesData()"
              @show-detail="(type: string, data: any) => showDetail(type, data)"
              @generate-image="(payload: any) => handleGenerateImage(payload.type, payload.assetId || payload.shotId)"
              @generate-video="(payload: any) => { if (payload.shotId) { showDetail('video', projectData?.shots?.find((s:any) => s.id === payload.shotId)); nextTick(() => handleGenerateVideo()); } }"
              @voice-preset-changed="(characterId: string, preset: string) => { if (projectData) { const ch = projectData.characters?.find((c: any) => c.id === characterId); if (ch) ch.voice_preset = preset; for (const s of (projectData.shots || [])) { const sc = s.characters?.find((c: any) => c.id === characterId); if (sc) sc.voice_preset = preset; } } }"
            />
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
      @batch-cancel="handleCancelBatch"
      @update:batch-dialog-visible="(v) => batchDialogVisible = v"
      @update:batch-count="(v) => batchCount = v"
      @batch-submit="(mode: string) => handleBatchSubmit(mode as 'all' | 'missing')"
      @update:export-progress-visible="(v) => exportProgressVisible = v"
      @export-video="handleExport('视频')"
      @export-concat="handleVideoConcat"
      @export-pdf="handlePDFExport"
      @update:parse-dialog-visible="(v) => parseDialogVisible = v"
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
</template>


<style scoped src="./Editor.css"></style>
