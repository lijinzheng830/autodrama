<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft,
  Setting,
  Plus,
  VideoPlay,
  DocumentAdd,
  ArrowUp,
  ArrowDown,
  Delete,
  Search,
  Back,
  Tools,
  Minus,
  Upload,
  Grid,
  Document,
  RefreshLeft,
  RefreshRight
  //   Clock,
  //   Download
} from '@element-plus/icons-vue'
import { useEditorStore } from '../stores/editor'

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
const allShotIds = computed(() => {
  const ids: string[] = []
  for (const shot of projectData.value?.shots || []) ids.push(shot.id)
  return ids
})
const isAllSelected = computed(
  () => allShotIds.value.length > 0 && allShotIds.value.every((id) => selectedShots.value.has(id))
)

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
const genRecordStatusFilter = ref<'all' | 'pending' | 'running' | 'completed' | 'failed'>('all')
const genRecordTypeFilter = ref<
  | 'all'
  | 'character_reference'
  | 'scene_reference'
  | 'prop_reference'
  | 'first_frame'
  | 'last_frame'
>('all')

function setGenRecordTab(tab: 'video' | 'image' | 'other'): void {
  genRecordTab.value = tab
  genRecordTypeFilter.value = 'all'
}

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

const modelConfigTabs = [
  { key: 'language_model', label: '语言模型' },
  { key: 'script_rewrite', label: '单分镜剧本改写' },
  { key: 'character_image', label: '角色生图模型' },
  { key: 'scene_image', label: '场景生图模型' },
  { key: 'prop_image', label: '道具生图模型' },
  { key: 'shot_image', label: '分镜图生图模型' },
  { key: 'video', label: '视频生成模型' }
]

function setModelConfigTab(idx: number): void {
  modelConfigTab.value = idx
  loadModelConfigTemplates()
}

// 生图控制（详情面板）
const genCount = ref(1)

// 批量操作弹窗
const batchDialogVisible = ref(false)
const batchType = ref('')
const batchMode = ref<'asset' | 'shot'>('shot')
const batchCount = ref(1)
const batchMissingCount = ref(0)
const batchTotalAssets = ref(0)

// 导出功能
const exportAssetMode = ref(false)
const exportAssetType = ref<'characters' | 'scenes' | 'props'>('characters')
const exportAssetIds = ref<Set<string>>(new Set())
const exportProgressVisible = ref(false)
const exportProgressCurrent = ref(0)
const exportProgressTotal = ref(0)
const exportProgressMsg = ref('')
const lastExportDir = ref('')

const batchTypeLabels: Record<string, string> = {
  人物: '批量生成角色定妆照',
  场景: '批量生成场景定妆照',
  道具: '批量生成道具定妆照',
  首帧: '批量生成首帧图',
  尾帧: '批量生成尾帧图',
  视频: '批量生成视频',
  批量: '批量生成'
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
      'Photorealistic, high detail, natural lighting, 8k uhd, cinematic shot, depth of field, professional photography, realistic textures, lifelike',
    negative:
      'painting, illustration, cartoon, anime, 3d render, blurry, low quality, artificial, oversaturated',
    color: '#4ecdc4'
  },
  {
    name: '3D渲染',
    prompt:
      '3D render, octane render, blender, cinematic lighting, ray tracing, subsurface scattering, physically based rendering, high poly model, studio lighting',
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
      'Cyberpunk, neon lights, futuristic, dystopian city, holographic displays, rain-soaked streets, high tech low life, glowing accents, blade runner aesthetic',
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
      'Dark fantasy, gothic atmosphere, ominous, dramatic shadows, ancient ruins, mythical creatures, epic scale, moody lighting, tormented souls',
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
  episodesLoading.value = true
  try {
    const data = await window.api.getProjectData(projectId)
    projectData.value = data
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

function openParseDialog(mode: 'full' | 'append'): void {
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
  loadParseModel()
  parseDialogVisible.value = true
}

async function loadTemplates(): Promise<void> {
  try {
    const list = (await window.api.getPromptTemplates(projectId, 'shot_image')) as any[]
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
    selectedModel.value = m?.name || model || '未配置'
  } catch (_err) {
    selectedModel.value = '未配置'
  }
}

async function handleParseSubmit(): Promise<void> {
  if (!parseScriptText.value.trim()) {
    ElMessage.warning('请输入剧本内容')
    return
  }
  try {
    const provider = await window.api.getSetting('provider')
    const apiKey = await window.api.getSetting(`api_key_${provider}`)
    if (!apiKey) {
      ElMessage.warning('请先配置 API Key')
      router.push('/settings')
      return
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
      model: selectedModel.value !== '未配置' ? selectedModel.value : undefined,
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

const groupedShots = computed(() => {
  if (!projectData.value) return []
  const result: any[] = []
  for (const chapter of projectData.value.chapters || []) {
    const shots = (projectData.value.shots || []).filter((s: any) => s.chapter_id === chapter.id)
    result.push({ chapter, shots })
  }
  return result
})

function toggleSelectAll(): void {
  if (isAllSelected.value) {
    selectedShots.value.clear()
  } else {
    for (const id of allShotIds.value) selectedShots.value.add(id)
  }
}

function toggleShotSelect(shotId: string): void {
  if (selectedShots.value.has(shotId)) selectedShots.value.delete(shotId)
  else selectedShots.value.add(shotId)
}

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
    if (field === 'description') update.description = editText.value
    else if (field === 'first_frame_prompt') update.first_frame_prompt = editText.value
    else if (field === 'last_frame_prompt') update.last_frame_prompt = editText.value
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

function getHighlightText(text: string, shot: any): any {
  if (!text) return ''
  const names = new Set<string>()
  for (const c of shot.characters || []) names.add(c.name)
  for (const s of shot.scenes || []) names.add(s.name)
  for (const p of shot.props || []) names.add(p.name)
  let html = text
  for (const name of names) {
    html = html.replaceAll(name, `<mark class="hl-asset">${name}</mark>`)
  }
  return html
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

  // 从模型配置读取默认模型和渠道
  let defaultModel: string | undefined = undefined
  let defaultChannel: string | undefined = undefined
  try {
    const proj = await window.api.getProject(projectId)
    const config = (proj as Record<string, any>)?.model_config_json
      ? JSON.parse((proj as Record<string, any>).model_config_json)
      : {}
    const purposeMap: Record<string, string> = {
      人物: 'character_image',
      场景: 'scene_image',
      道具: 'prop_image',
      首帧: 'shot_image',
      尾帧: 'shot_image',
      视频: 'video'
    }
    const purposeConfig = config[purposeMap[type]] || {}
    defaultModel = purposeConfig.model || undefined
    defaultChannel = purposeConfig.channel || undefined
  } catch {
    // ignore
  }

  if (batchMode.value === 'asset') {
    // 资产模式：遍历项目全部资产，真实调用生图服务
    const assetKey = type === '人物' ? 'characters' : type === '场景' ? 'scenes' : 'props'
    const assets = projectData.value?.[assetKey] || []
    const assetType = type === '人物' ? 'character' : type === '场景' ? 'scene' : 'prop'

    for (const asset of assets) {
      if (mode === 'missing' && asset.reference_image) continue
      try {
        await window.api.generateImage({
          projectId,
          type: assetType,
          assetId: asset.id,
          description: asset.description || asset.name || '',
          count: batchCount.value,
          model: defaultModel,
          channel: defaultChannel
        })
        createdCount++
      } catch (err: any) {
        console.error(`批量生成 ${asset.name} 失败:`, err)
        // 继续下一个，不中断
      }
    }
  } else {
    // 分镜模式：遍历选中的分镜
    const selectedShotIds = Array.from(selectedShots.value)
    const shots = projectData.value?.shots || []

    for (const shot of shots) {
      if (!selectedShotIds.includes(shot.id)) continue

      switch (type) {
        case '首帧': {
          if (mode === 'missing' && shot.first_frame_image_path) continue
          await window.api.createGenerationTask({
            projectId,
            shotId: shot.id,
            type: 'image',
            purpose: 'first_frame',
            model: defaultModel,
            inputParams: JSON.stringify({ count: batchCount.value })
          })
          createdCount++
          break
        }
        case '尾帧': {
          if (mode === 'missing' && shot.last_frame_image_path) continue
          await window.api.createGenerationTask({
            projectId,
            shotId: shot.id,
            type: 'image',
            purpose: 'last_frame',
            model: defaultModel,
            inputParams: JSON.stringify({ count: batchCount.value })
          })
          createdCount++
          break
        }
        case '视频': {
          if (mode === 'missing' && shot.video_path) continue
          await window.api.createGenerationTask({
            projectId,
            shotId: shot.id,
            type: 'video',
            purpose: 'video',
            model: defaultModel,
            inputParams: JSON.stringify({ count: batchCount.value })
          })
          createdCount++
          break
        }
      }
    }
  }

  if (batchMode.value === 'asset' && createdCount > 0) {
    ElMessage.success(`已成功生成 ${createdCount} 个资产的图片`)
    await loadEpisodesData()
  } else {
    ElMessage.success(`已创建 ${createdCount} 个生成任务`)
  }
  batchDialogVisible.value = false
}

// ===== 右侧面板 =====

async function showDetail(type: string, data: any): Promise<void> {
  panelMode.value = 'detail'
  detailType.value = type
  detailData.value = data
  genCount.value = 1
  assetImages.value = []
  if (['character', 'scene', 'prop'].includes(type) && data?.id) {
    await loadAssetImages(type, data.id)
  }
}

function backToResident(): void {
  panelMode.value = 'resident'
  detailData.value = null
}

const filteredAssets = computed(() => {
  const list = projectData.value?.[residentTab.value] || []
  if (!searchKeyword.value) return list
  return list.filter((a: any) => a.name?.includes(searchKeyword.value))
})

const usedCharacterIds = computed(() => {
  const ids = new Set<string>()
  for (const shot of projectData.value?.shots || []) {
    for (const c of shot.characters || []) ids.add(c.id)
  }
  return ids
})
const usedSceneIds = computed(() => {
  const ids = new Set<string>()
  for (const shot of projectData.value?.shots || []) {
    for (const s of shot.scenes || []) ids.add(s.id)
  }
  return ids
})
const usedPropIds = computed(() => {
  const ids = new Set<string>()
  for (const shot of projectData.value?.shots || []) {
    for (const p of shot.props || []) ids.add(p.id)
  }
  return ids
})

function isAssetUsed(assetId: string): any {
  if (residentTab.value === 'characters') return usedCharacterIds.value.has(assetId)
  if (residentTab.value === 'scenes') return usedSceneIds.value.has(assetId)
  return usedPropIds.value.has(assetId)
}

async function handleAssetNameChange(type: string, asset: any, newName: string): Promise<void> {
  if (!newName.trim() || newName === asset.name) return
  try {
    if (type === 'character') await window.api.updateCharacter(asset.id, { name: newName.trim() })
    else if (type === 'scene') await window.api.updateScene(asset.id, { name: newName.trim() })
    else if (type === 'prop') await window.api.updateProp(asset.id, { name: newName.trim() })
    await loadEpisodesData()
  } catch (err) {
    ElMessage.error('改名失败')
    console.error(err)
  }
}

async function handleAssetDescChange(type: string, asset: any, newDesc: string): Promise<void> {
  try {
    if (type === 'character') await window.api.updateCharacter(asset.id, { description: newDesc })
    else if (type === 'scene') await window.api.updateScene(asset.id, { description: newDesc })
    else if (type === 'prop') await window.api.updateProp(asset.id, { description: newDesc })
    await loadEpisodesData()
  } catch (err) {
    ElMessage.error('保存描述失败')
    console.error(err)
  }
}

async function handleSelectImage(type: string, asset: any): Promise<void> {
  if (!project.value?.path) return
  try {
    const imagePath = await window.api.selectImage(project.value.path)
    if (!imagePath) return
    if (type === 'character')
      await window.api.updateCharacter(asset.id, { referenceImage: imagePath })
    else if (type === 'scene') await window.api.updateScene(asset.id, { referenceImage: imagePath })
    else if (type === 'prop') await window.api.updateProp(asset.id, { referenceImage: imagePath })
    await loadEpisodesData()
    // 如果当前在详情面板，刷新详情数据
    if (detailData.value?.id === asset.id) {
      detailData.value = { ...detailData.value, reference_image: imagePath }
    }
  } catch (err) {
    ElMessage.error('上传图片失败')
    console.error(err)
  }
}

async function handleDeleteAsset(type: string, assetId: string): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除吗？', '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    if (type === 'character') await window.api.deleteCharacter(assetId)
    else if (type === 'scene') await window.api.deleteScene(assetId)
    else if (type === 'prop') await window.api.deleteProp(assetId)
    await loadEpisodesData()
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      ElMessage.error('删除失败')
      console.error(err)
    }
  }
}

async function handleCreateAsset(): Promise<void> {
  const tab = residentTab.value
  const label = tab === 'characters' ? '角色' : tab === 'scenes' ? '场景' : '道具'
  try {
    const { value } = await ElMessageBox.prompt(`请输入${label}名称`, `创建${label}`, {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S/,
      inputErrorMessage: '名称不能为空'
    })
    const name = value.trim()
    if (tab === 'characters') await window.api.createCharacter(projectId, { name })
    else if (tab === 'scenes') await window.api.createScene(projectId, { name })
    else if (tab === 'props') await window.api.createProp(projectId, { name })
    await loadEpisodesData()
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      console.error(err)
    }
  }
}

function handleImportAsset(): void {
  ElMessage.info('从其他项目导入功能后续版本开放')
}

// 生图loading状态
const genLoading = ref(false)

// 历史图片记录
const assetImages = ref<any[]>([])

async function loadAssetImages(type: string, assetId: string): Promise<void> {
  const assetType = type === 'character' ? 'character' : type === 'scene' ? 'scene' : 'prop'
  try {
    const images = await window.api.getAssetImages(assetType, assetId)
    assetImages.value = images || []
  } catch (err) {
    console.error('加载历史图片失败', err)
    assetImages.value = []
  }
}

async function handleSelectHistoryImage(type: string, assetId: string, imageId: string): Promise<void> {
  const assetType = type === 'character' ? 'character' : type === 'scene' ? 'scene' : 'prop'
  try {
    await window.api.selectAssetImage(assetType, assetId, imageId)
    await loadAssetImages(type, assetId)
    await loadEpisodesData()
    // 刷新详情数据
    const updatedAsset = projectData.value?.[
      type === 'character' ? 'characters' : type === 'scene' ? 'scenes' : 'props'
    ]?.find((a: any) => a.id === assetId)
    if (updatedAsset) {
      detailData.value = { ...detailData.value, reference_image: updatedAsset.reference_image }
    }
  } catch (err) {
    ElMessage.error('切换图片失败')
    console.error(err)
  }
}

// 生图按钮（MVP2真实服务）
async function handleGenerateImage(type: string, assetId?: string): Promise<void> {
  if (!assetId) return
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
  const purposeConfig = modelConfig[purposeMap[assetType]] || {}

  genLoading.value = true
  try {
    await window.api.generateImage({
      projectId,
      type: assetType,
      assetId,
      description: asset.description || asset.name || '',
      count: genCount.value,
      model: purposeConfig.model,
      channel: purposeConfig.channel
    })
    ElMessage.success('图片生成成功')
    // 刷新历史记录和资产数据
    await loadAssetImages(type, assetId)
    await loadEpisodesData()
    // 更新详情数据
    const updatedAsset = projectData.value?.[
      assetType === 'character' ? 'characters' : assetType === 'scene' ? 'scenes' : 'props'
    ]?.find((a: any) => a.id === assetId)
    if (updatedAsset) {
      detailData.value = { ...detailData.value, reference_image: updatedAsset.reference_image }
    }
    // 自动弹出生成记录弹窗
    genRecordTab.value = 'image'
    genRecordVisible.value = true
    await loadGenerationRecords()
  } catch (err: any) {
    ElMessage.error(err?.message || '图片生成失败')
    console.error(err)
  } finally {
    genLoading.value = false
  }
}

// 提示词编辑（首帧/尾帧详情）
async function handleShotPromptChange(shotId: string, field: string, value: string): Promise<void> {
  try {
    const update: any = {}
    update[field] = value
    await window.api.updateShot(shotId, update)
    await checkAndCreateAssociations(shotId, value)
    await loadEpisodesData()
  } catch (err) {
    ElMessage.error('保存失败')
    console.error(err)
  }
}

function goHome(): void {
  router.push('/')
}

function goSettings(): void {
  router.push('/settings')
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

function statusLabel(status: string): any {
  const map: Record<string, string> = {
    pending: '排队中',
    running: '生成中',
    completed: '已完成',
    failed: '失败'
  }
  return map[status] || status
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

function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const hour = d.getHours().toString().padStart(2, '0')
  const minute = d.getMinutes().toString().padStart(2, '0')
  return `${month}/${day} ${hour}:${minute}`
}

function formatWaitTime(record: any): string {
  if (record.status === 'pending' || record.status === 'completed' || record.status === 'failed')
    return '-'
  if (!record.started_at || !record.created_at) return '-'
  const ms = record.started_at - record.created_at
  if (ms < 0) return '-'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分${sec % 60}秒`
  const hr = Math.floor(min / 60)
  return `${hr}时${min % 60}分`
}

function getShotDesc(shotId: string | null): string {
  if (!shotId) return '项目全局'
  const shot = projectData.value?.shots?.find((s: any) => s.id === shotId)
  if (shot?.description) {
    const desc = shot.description.replace(/\n/g, ' ')
    return desc.length > 20 ? desc.slice(0, 20) + '…' : desc
  }
  return `分镜 ${shotId.slice(0, 6)}…`
}

const filteredRecords = computed(() => {
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  // Tab对应的purpose分组
  const tabPurposeMap: Record<string, string[]> = {
    video: ['video'],
    image: [
      'character_reference',
      'scene_reference',
      'prop_reference',
      'first_frame',
      'last_frame'
    ],
    other: ['voice']
  }
  const allowedPurposes = tabPurposeMap[genRecordTab.value] || []

  return genRecords.value.filter((r: any) => {
    // 时间过滤：最近7天
    if (!r.created_at || r.created_at < sevenDaysAgo) return false
    // Tab过滤
    if (!allowedPurposes.includes(r.purpose)) return false
    // 状态过滤
    if (genRecordStatusFilter.value !== 'all' && r.status !== genRecordStatusFilter.value)
      return false
    // 类型过滤（仅图片Tab）
    if (
      genRecordTab.value === 'image' &&
      genRecordTypeFilter.value !== 'all' &&
      r.purpose !== genRecordTypeFilter.value
    )
      return false
    return true
  })
})

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

function cancelAssetExport(): void {
  exportAssetMode.value = false
  exportAssetIds.value = new Set()
}

function toggleExportAsset(assetId: string): void {
  if (exportAssetIds.value.has(assetId)) {
    exportAssetIds.value.delete(assetId)
  } else {
    exportAssetIds.value.add(assetId)
  }
}

async function handleAssetExportConfirm(): Promise<void> {
  if (exportAssetIds.value.size === 0) {
    ElMessage.warning('请先选择要导出的项目')
    return
  }

  const assetType =
    exportAssetType.value === 'characters'
      ? 'characters'
      : exportAssetType.value === 'scenes'
        ? 'scenes'
        : 'props'
  const assets =
    projectData.value?.[assetType]?.filter(
      (a: any) => exportAssetIds.value.has(a.id) && a.reference_image
    ) || []
  const skipped = exportAssetIds.value.size - assets.length

  if (assets.length === 0) {
    ElMessage.warning('选中的资产均未生成图片，无需导出')
    return
  }

  const dir = await window.api.selectExportDirectory(lastExportDir.value || undefined)
  if (!dir) return
  lastExportDir.value = dir
  await window.api.setSetting('last_export_dir', dir)

  exportProgressVisible.value = true
  exportProgressTotal.value = assets.length
  exportProgressCurrent.value = 0
  exportProgressMsg.value = '正在导出...'

  const projectName = project.value?.name || 'project'
  const timestamp = Date.now()
  let successCount = 0

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    const ext = asset.reference_image.split('.').pop() || 'png'
    const destName = `${i + 1}_${projectName}_${timestamp}.${ext}`
    const destPath = `${dir}/${destName}`
    const ok = await window.api.copyExportFile(asset.reference_image, destPath)
    if (ok) successCount++
    exportProgressCurrent.value = i + 1
  }

  exportProgressVisible.value = false
  exportAssetMode.value = false
  exportAssetIds.value = new Set()

  let msg = `成功导出 ${successCount} 个文件到 ${dir}`
  if (skipped > 0) msg += `，${skipped} 个文件因未生成已跳过`
  if (successCount < assets.length) msg += `，${assets.length - successCount} 个复制失败`
  ElMessage.success(msg)
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

function toFileUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('file://')) return path
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path
  // Windows 路径 C:\Users\... → file:///C:/Users/...
  const normalized = path.replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`
  }
  return `file://${normalized}`
}

async function openModelConfig(): Promise<void> {
  modelConfigVisible.value = true
  // 加载模型列表和渠道列表
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
        const pKey = p.key || p.id
        models.push({
          label: `${p.name} / ${modelName}`,
          value: `${pKey}:${modelKey}`,
          provider: pKey,
          modelKey: modelKey
        })
      }
    }
    providerModels.value = models
    providerChannels.value = channels
  } catch (err) {
    console.error('加载模型失败', err)
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
      shot_image: 'shot_image',
      video: 'video'
    }
    const list = (await window.api.getPromptTemplates(
      projectId,
      usageMap[tabKey] || undefined
    )) as any[]
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
    const sharedKeys = ['language_model', 'character_image', 'scene_image', 'prop_image', 'video']
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

function getModelConfigField(key: string, field: string, defaultValue: any = ''): any {
  return modelConfig.value[key]?.[field] ?? defaultValue
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

function handleModelConfigChannelChange(tabKey: string, val: string): void {
  setModelConfigField(tabKey, 'channel', val)
  const firstModel = providerModels.value.find((m) => m.provider === val)
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
                disabled
                @click="viewMode = 'canvas'"
              >
                画布
              </el-button>
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
                    <el-dropdown-item @click="handleExport('视频')">视频导出</el-dropdown-item>
                    <el-dropdown-item @click="handleExport('场景')">场景导出</el-dropdown-item>
                    <el-dropdown-item @click="handleExport('角色')">角色导出</el-dropdown-item>
                    <el-dropdown-item @click="handleExport('道具')">道具导出</el-dropdown-item>
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
            <!-- 横向分镜列表 -->
            <div class="shot-table-wrapper">
              <div v-if="episodesLoading" class="loading-mask">加载中...</div>

              <div v-else class="shot-table">
                <!-- 表头 -->
                <div class="shot-table-header">
                  <div class="th col-num">
                    <el-checkbox :model-value="isAllSelected" @change="toggleSelectAll" />
                    <span>序号</span>
                  </div>
                  <div class="th col-script">剧本</div>
                  <div class="th col-chars">
                    出场人物
                    <el-button
                      text
                      size="small"
                      class="batch-btn"
                      @click="handleBatchGenerate('人物')"
                      >[批量生成]</el-button
                    >
                  </div>
                  <div class="th col-scenes">
                    场景
                    <el-button
                      text
                      size="small"
                      class="batch-btn"
                      @click="handleBatchGenerate('场景')"
                      >[批量生成]</el-button
                    >
                  </div>
                  <div class="th col-props">
                    道具
                    <el-button
                      text
                      size="small"
                      class="batch-btn"
                      @click="handleBatchGenerate('道具')"
                      >[批量生成]</el-button
                    >
                  </div>
                  <div class="th col-voice">配音</div>
                  <div class="th col-first">
                    首帧
                    <el-button
                      text
                      size="small"
                      class="batch-btn"
                      @click="handleBatchGenerate('首帧')"
                      >[批量生成]</el-button
                    >
                  </div>
                  <div class="th col-first-prompt">首帧提示词</div>
                  <div class="th col-last">
                    尾帧
                    <el-button
                      text
                      size="small"
                      class="batch-btn"
                      @click="handleBatchGenerate('尾帧')"
                      >[批量生成]</el-button
                    >
                  </div>
                  <div class="th col-last-prompt">尾帧提示词</div>
                  <div class="th col-video">
                    视频
                    <el-button
                      text
                      size="small"
                      class="batch-btn"
                      @click="handleBatchGenerate('视频')"
                      >[批量生成]</el-button
                    >
                  </div>
                  <div class="th col-op">操作</div>
                </div>

                <!-- 数据行 -->
                <div v-for="group in groupedShots" :key="group.chapter.id" class="chapter-group">
                  <!-- 章节标题行 -->
                  <div class="chapter-row">
                    {{ group.chapter.title || `第${group.chapter.chapter_index + 1}章` }}
                  </div>

                  <!-- 分镜行 -->
                  <div
                    v-for="(shot, idx) in group.shots"
                    :key="shot.id"
                    class="shot-row"
                    :data-shot-id="shot.id"
                    :class="{ selected: selectedShots.has(shot.id) }"
                  >
                    <!-- 序号 -->
                    <div class="td col-num">
                      <el-checkbox
                        :model-value="selectedShots.has(shot.id)"
                        @change="toggleShotSelect(shot.id)"
                      />
                      <span class="shot-index">{{ Number(idx) + 1 }}</span>
                    </div>

                    <!-- 剧本 -->
                    <div class="td col-script">
                      <div
                        v-if="
                          editingCell?.shotId === shot.id && editingCell?.field === 'description'
                        "
                        class="edit-cell"
                      >
                        <el-input
                          v-model="editText"
                          type="textarea"
                          :autosize="{ minRows: 3, maxRows: 12 }"
                          @blur="saveEdit(shot.id, 'description')"
                          @keydown.enter.prevent="saveEdit(shot.id, 'description')"
                          @keydown.esc.prevent="cancelEdit"
                        />
                      </div>
                      <div
                        v-else
                        class="cell-text"
                        @dblclick="startEdit(shot.id, 'description', shot.description || '')"
                        v-html="getHighlightText(shot.description, shot)"
                      />
                      <div class="tag-bar">
                        <span v-for="c in shot.characters" :key="c.id" class="tag tag-char">{{
                          c.name
                        }}</span>
                        <span v-for="s in shot.scenes" :key="s.id" class="tag tag-scene">{{
                          s.name
                        }}</span>
                        <span v-for="p in shot.props" :key="p.id" class="tag tag-prop">{{
                          p.name
                        }}</span>
                      </div>
                    </div>

                    <!-- 出场人物 -->
                    <div class="td col-chars">
                      <div class="thumb-grid">
                        <div
                          v-for="c in shot.characters"
                          :key="c.id"
                          class="thumb-cell"
                          @click="showDetail('character', c)"
                        >
                          <img
                            v-if="c.reference_image"
                            :src="toFileUrl(c.reference_image)"
                            class="thumb-img"
                          />
                          <div v-else class="thumb-placeholder">{{ c.name }}</div>
                        </div>
                        <div v-if="!shot.characters?.length" class="thumb-empty">-</div>
                      </div>
                    </div>

                    <!-- 场景 -->
                    <div class="td col-scenes">
                      <div class="thumb-grid">
                        <div
                          v-for="s in shot.scenes"
                          :key="s.id"
                          class="thumb-cell"
                          @click="showDetail('scene', s)"
                        >
                          <img
                            v-if="s.reference_image"
                            :src="toFileUrl(s.reference_image)"
                            class="thumb-img"
                          />
                          <div v-else class="thumb-placeholder">{{ s.name }}</div>
                        </div>
                        <div v-if="!shot.scenes?.length" class="thumb-empty">-</div>
                      </div>
                    </div>

                    <!-- 道具 -->
                    <div class="td col-props">
                      <div class="thumb-grid">
                        <div
                          v-for="p in shot.props"
                          :key="p.id"
                          class="thumb-cell"
                          @click="showDetail('prop', p)"
                        >
                          <img
                            v-if="p.reference_image"
                            :src="toFileUrl(p.reference_image)"
                            class="thumb-img"
                          />
                          <div v-else class="thumb-placeholder">{{ p.name }}</div>
                        </div>
                        <div v-if="!shot.props?.length" class="thumb-empty">-</div>
                      </div>
                    </div>

                    <!-- 配音 -->
                    <div class="td col-voice">
                      <el-button text size="small" @click="showDetail('voice', shot)"
                        >配音</el-button
                      >
                    </div>

                    <!-- 首帧 -->
                    <div class="td col-first">
                      <div class="media-cell" @click="showDetail('firstFrame', shot)">
                        <div v-if="shot.first_frame_image_path" class="media-preview">
                          <img :src="toFileUrl(shot.first_frame_image_path)" />
                        </div>
                        <div v-else class="media-placeholder">首帧</div>
                      </div>
                    </div>

                    <!-- 首帧提示词 -->
                    <div class="td col-first-prompt">
                      <div
                        v-if="
                          editingCell?.shotId === shot.id &&
                          editingCell?.field === 'first_frame_prompt'
                        "
                        class="edit-cell"
                      >
                        <el-input
                          v-model="editText"
                          type="textarea"
                          :autosize="{ minRows: 3, maxRows: 12 }"
                          @blur="saveEdit(shot.id, 'first_frame_prompt')"
                          @keydown.enter.prevent="saveEdit(shot.id, 'first_frame_prompt')"
                          @keydown.esc.prevent="cancelEdit"
                        />
                      </div>
                      <div
                        v-else
                        class="cell-text"
                        @dblclick="
                          startEdit(shot.id, 'first_frame_prompt', shot.first_frame_prompt || '')
                        "
                        v-html="getHighlightText(shot.first_frame_prompt, shot)"
                      />
                      <div class="tag-bar">
                        <span v-for="c in shot.characters" :key="c.id" class="tag tag-char">{{
                          c.name
                        }}</span>
                        <span v-for="s in shot.scenes" :key="s.id" class="tag tag-scene">{{
                          s.name
                        }}</span>
                        <span v-for="p in shot.props" :key="p.id" class="tag tag-prop">{{
                          p.name
                        }}</span>
                      </div>
                    </div>

                    <!-- 尾帧 -->
                    <div class="td col-last">
                      <div class="media-cell" @click="showDetail('lastFrame', shot)">
                        <div v-if="shot.last_frame_image_path" class="media-preview">
                          <img :src="toFileUrl(shot.last_frame_image_path)" />
                        </div>
                        <div v-else class="media-placeholder">尾帧</div>
                      </div>
                    </div>

                    <!-- 尾帧提示词 -->
                    <div class="td col-last-prompt">
                      <div
                        v-if="
                          editingCell?.shotId === shot.id &&
                          editingCell?.field === 'last_frame_prompt'
                        "
                        class="edit-cell"
                      >
                        <el-input
                          v-model="editText"
                          type="textarea"
                          :autosize="{ minRows: 3, maxRows: 12 }"
                          @blur="saveEdit(shot.id, 'last_frame_prompt')"
                          @keydown.enter.prevent="saveEdit(shot.id, 'last_frame_prompt')"
                          @keydown.esc.prevent="cancelEdit"
                        />
                      </div>
                      <div
                        v-else
                        class="cell-text"
                        @dblclick="
                          startEdit(shot.id, 'last_frame_prompt', shot.last_frame_prompt || '')
                        "
                        v-html="getHighlightText(shot.last_frame_prompt, shot)"
                      />
                      <div class="tag-bar">
                        <span v-for="c in shot.characters" :key="c.id" class="tag tag-char">{{
                          c.name
                        }}</span>
                        <span v-for="s in shot.scenes" :key="s.id" class="tag tag-scene">{{
                          s.name
                        }}</span>
                        <span v-for="p in shot.props" :key="p.id" class="tag tag-prop">{{
                          p.name
                        }}</span>
                      </div>
                    </div>

                    <!-- 视频 -->
                    <div class="td col-video">
                      <div class="media-cell" @click="showDetail('video', shot)">
                        <div v-if="shot.video_path" class="media-preview">
                          <video :src="shot.video_path" class="media-video" />
                        </div>
                        <div v-else class="media-placeholder">视频</div>
                      </div>
                    </div>

                    <!-- 操作 -->
                    <div class="td col-op">
                      <el-button text size="small" :icon="ArrowUp" @click="handleMoveUp(shot.id)" />
                      <el-button
                        text
                        size="small"
                        :icon="ArrowDown"
                        @click="handleMoveDown(shot.id)"
                      />
                      <el-button
                        text
                        size="small"
                        :icon="Delete"
                        class="delete-btn"
                        @click="handleDeleteShot(shot.id)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 右侧面板 -->
            <aside class="right-panel">
              <!-- 常驻状态 -->
              <div v-if="panelMode === 'resident'" class="panel-resident">
                <div class="panel-toolbar">
                  <el-button text :icon="Back" title="返回" disabled />
                  <el-button text :icon="Grid" title="前进" disabled />
                  <div class="panel-tabs">
                    <div
                      v-for="tab in [
                        { k: 'characters', l: '角色' },
                        { k: 'scenes', l: '场景' },
                        { k: 'props', l: '道具' }
                      ]"
                      :key="tab.k"
                      class="panel-tab"
                      :class="{ active: residentTab === tab.k }"
                      @click="residentTab = tab.k as any"
                    >
                      {{ tab.l }}
                    </div>
                  </div>
                </div>

                <div class="panel-search">
                  <template v-if="exportAssetMode">
                    <span class="export-mode-label">导出模式</span>
                    <el-button
                      type="primary"
                      size="small"
                      :disabled="exportAssetIds.size === 0"
                      @click="handleAssetExportConfirm"
                      >导出选中 ({{ exportAssetIds.size }})</el-button
                    >
                    <el-button text size="small" @click="cancelAssetExport">取消</el-button>
                  </template>
                  <template v-else>
                    <el-input
                      v-model="searchKeyword"
                      placeholder="搜索..."
                      :prefix-icon="Search"
                      size="small"
                    />
                    <el-button text size="small" @click="handleBatchGenerate('批量')"
                      >批量生成</el-button
                    >
                  </template>
                </div>

                <!-- 作品中 -->
                <div class="panel-section">
                  <div class="panel-section-title">
                    作品中 ({{ filteredAssets.length }}/{{
                      projectData?.[residentTab]?.length || 0
                    }})
                  </div>
                  <div class="asset-grid">
                    <div
                      v-for="asset in filteredAssets"
                      :key="asset.id"
                      class="asset-card"
                      :class="{
                        unused: !isAssetUsed(asset.id),
                        'export-selected': exportAssetMode && exportAssetIds.has(asset.id)
                      }"
                      @click="
                        exportAssetMode
                          ? toggleExportAsset(asset.id)
                          : showDetail(
                              residentTab === 'characters'
                                ? 'character'
                                : residentTab === 'scenes'
                                  ? 'scene'
                                  : 'prop',
                              asset
                            )
                      "
                    >
                      <img
                        v-if="asset.reference_image"
                        :src="toFileUrl(asset.reference_image)"
                        class="asset-img"
                      />
                      <div v-else class="asset-placeholder">{{ asset.name }}</div>
                      <div
                        v-if="exportAssetMode"
                        class="asset-checkbox"
                        @click.stop="toggleExportAsset(asset.id)"
                      >
                        <div
                          class="asset-check-indicator"
                          :class="{ checked: exportAssetIds.has(asset.id) }"
                        >
                          <span v-if="exportAssetIds.has(asset.id)">✓</span>
                        </div>
                      </div>
                      <el-button
                        v-else
                        text
                        circle
                        size="small"
                        class="asset-delete"
                        :icon="Delete"
                        @click.stop="
                          handleDeleteAsset(
                            residentTab === 'characters'
                              ? 'character'
                              : residentTab === 'scenes'
                                ? 'scene'
                                : 'prop',
                            asset.id
                          )
                        "
                      />
                    </div>
                  </div>
                </div>

                <!-- 全部可用 -->
                <div v-if="!exportAssetMode" class="panel-section">
                  <div class="panel-section-title">
                    全部可用 ({{ filteredAssets.filter((a: any) => isAssetUsed(a.id)).length }}/{{
                      filteredAssets.length
                    }})
                  </div>
                  <div class="asset-grid">
                    <div
                      v-for="asset in filteredAssets.filter((a: any) => isAssetUsed(a.id))"
                      :key="asset.id"
                      class="asset-card"
                      @click="
                        showDetail(
                          residentTab === 'characters'
                            ? 'character'
                            : residentTab === 'scenes'
                              ? 'scene'
                              : 'prop',
                          asset
                        )
                      "
                    >
                      <img
                        v-if="asset.reference_image"
                        :src="toFileUrl(asset.reference_image)"
                        class="asset-img"
                      />
                      <div v-else class="asset-placeholder">{{ asset.name }}</div>
                    </div>
                    <div
                      v-if="!filteredAssets.filter((a: any) => isAssetUsed(a.id)).length"
                      class="panel-empty"
                    >
                      暂无可用资产
                    </div>
                  </div>
                </div>

                <div v-if="!exportAssetMode" class="panel-footer">
                  <el-button :icon="Plus" @click="handleCreateAsset">创建</el-button>
                  <el-button text @click="handleImportAsset">从其他项目导入</el-button>
                </div>
              </div>

              <!-- 详情状态 -->
              <div v-else class="panel-detail">
                <div class="detail-toolbar">
                  <el-button text :icon="Back" @click="backToResident">返回</el-button>
                </div>

                <!-- 角色/场景/道具详情 -->
                <div v-if="['character', 'scene', 'prop'].includes(detailType)" class="detail-body">
                  <div class="detail-media">
                    <img
                      v-if="detailData?.reference_image"
                      :src="toFileUrl(detailData.reference_image)"
                      class="detail-img"
                    />
                    <div v-else class="detail-placeholder">{{ detailData?.name }}</div>
                    <div class="detail-upload">
                      <el-button
                        :icon="Upload"
                        size="small"
                        @click="handleSelectImage(detailType, detailData)"
                        >上传本地</el-button
                      >
                      <el-button text size="small" @click="ElMessage.info('资产库导入后续版本开放')"
                        >资产库导入</el-button
                      >
                    </div>
                  </div>
                  <div class="detail-fields">
                    <div class="detail-field">
                      <label>名称</label>
                      <el-input
                        :model-value="detailData?.name"
                        @blur="
                          (e: any) => handleAssetNameChange(detailType, detailData, e.target.value)
                        "
                      />
                    </div>
                    <div class="detail-field">
                      <label>描述</label>
                      <el-input
                        :model-value="detailData?.description"
                        type="textarea"
                        :rows="4"
                        @blur="
                          (e: any) => handleAssetDescChange(detailType, detailData, e.target.value)
                        "
                      />
                    </div>
                  </div>
                  <!-- 生图控制栏 -->
                  <div class="gen-control">
                    <div class="gen-control-row">
                      <el-button
                        text
                        :icon="Tools"
                        @click="ElMessage.info('模型选择后续版本开放')"
                      />
                      <span class="gen-label">生成张数</span>
                      <el-button text :icon="Minus" @click="genCount = Math.max(1, genCount - 1)" />
                      <el-input v-model.number="genCount" class="gen-count-input" />
                      <el-button text :icon="Plus" @click="genCount = Math.min(4, genCount + 1)" />
                    </div>
                    <el-button
                      type="primary"
                      class="gen-btn"
                      :loading="genLoading"
                      @click="handleGenerateImage(detailType, detailData?.id)"
                    >
                      AI生图
                    </el-button>
                  </div>
                  <div class="history-section">
                    <div class="history-title">历史记录</div>
                    <div v-if="assetImages.length === 0" class="history-empty">暂无生成记录</div>
                    <div v-else class="history-grid">
                      <div
                        v-for="img in assetImages"
                        :key="img.id"
                        class="history-item"
                        :class="{ selected: img.is_selected }"
                        @click="handleSelectHistoryImage(detailType, detailData?.id, img.id)"
                      >
                        <img :src="toFileUrl(img.image_path)" class="history-img" />
                        <div v-if="img.is_selected" class="history-selected-badge">✓</div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 首帧详情 -->
                <div v-else-if="detailType === 'firstFrame'" class="detail-body">
                  <div class="detail-media">
                    <div v-if="detailData?.first_frame_image_path" class="detail-placeholder">
                      <img :src="toFileUrl(detailData.first_frame_image_path)" class="detail-img" />
                    </div>
                    <div v-else class="detail-placeholder">首帧占位</div>
                  </div>
                  <div class="detail-fields">
                    <div class="detail-field">
                      <label>首帧提示词</label>
                      <el-input
                        :model-value="detailData?.first_frame_prompt"
                        type="textarea"
                        :rows="4"
                        @blur="
                          (e: any) =>
                            handleShotPromptChange(
                              detailData.id,
                              'first_frame_prompt',
                              e.target.value
                            )
                        "
                      />
                    </div>
                  </div>
                  <div class="gen-control">
                    <div class="gen-control-row">
                      <el-button
                        text
                        :icon="Tools"
                        @click="ElMessage.info('模型选择后续版本开放')"
                      />
                      <span class="gen-label">生成张数</span>
                      <el-button text :icon="Minus" @click="genCount = Math.max(1, genCount - 1)" />
                      <el-input v-model.number="genCount" class="gen-count-input" />
                      <el-button text :icon="Plus" @click="genCount++" />
                    </div>
                    <el-button
                      type="primary"
                      class="gen-btn"
                      @click="handleGenerateImage('firstFrame', detailData?.id)"
                    >
                      AI生图
                    </el-button>
                  </div>
                  <div class="history-section">
                    <div class="history-title">历史记录</div>
                    <div class="history-empty">暂无生成记录</div>
                  </div>
                </div>

                <!-- 尾帧详情 -->
                <div v-else-if="detailType === 'lastFrame'" class="detail-body">
                  <div class="detail-media">
                    <div v-if="detailData?.last_frame_image_path" class="detail-placeholder">
                      <img :src="toFileUrl(detailData.last_frame_image_path)" class="detail-img" />
                    </div>
                    <div v-else class="detail-placeholder">尾帧占位</div>
                  </div>
                  <div class="detail-fields">
                    <div class="detail-field">
                      <label>尾帧提示词</label>
                      <el-input
                        :model-value="detailData?.last_frame_prompt"
                        type="textarea"
                        :rows="4"
                        @blur="
                          (e: any) =>
                            handleShotPromptChange(
                              detailData.id,
                              'last_frame_prompt',
                              e.target.value
                            )
                        "
                      />
                    </div>
                  </div>
                  <div class="gen-control">
                    <div class="gen-control-row">
                      <el-button
                        text
                        :icon="Tools"
                        @click="ElMessage.info('模型选择后续版本开放')"
                      />
                      <span class="gen-label">生成张数</span>
                      <el-button text :icon="Minus" @click="genCount = Math.max(1, genCount - 1)" />
                      <el-input v-model.number="genCount" class="gen-count-input" />
                      <el-button text :icon="Plus" @click="genCount++" />
                    </div>
                    <el-button
                      type="primary"
                      class="gen-btn"
                      @click="handleGenerateImage('lastFrame', detailData?.id)"
                    >
                      AI生图
                    </el-button>
                  </div>
                  <div class="history-section">
                    <div class="history-title">历史记录</div>
                    <div class="history-empty">暂无生成记录</div>
                  </div>
                </div>

                <!-- 视频详情 -->
                <div v-else-if="detailType === 'video'" class="detail-body">
                  <div class="detail-media">
                    <div v-if="detailData?.video_path" class="detail-placeholder">
                      <video :src="detailData.video_path" class="detail-video" controls />
                    </div>
                    <div v-else class="detail-placeholder">视频占位</div>
                  </div>
                  <div class="gen-control">
                    <div class="gen-control-row">
                      <el-button
                        text
                        :icon="Tools"
                        @click="ElMessage.info('模型选择后续版本开放')"
                      />
                      <span class="gen-label">生成数量</span>
                      <el-button text :icon="Minus" @click="genCount = Math.max(1, genCount - 1)" />
                      <el-input v-model.number="genCount" class="gen-count-input" />
                      <el-button text :icon="Plus" @click="genCount++" />
                    </div>
                    <el-button
                      type="primary"
                      class="gen-btn"
                      @click="ElMessage.info('视频生成后续版本开放')"
                    >
                      AI生视频
                    </el-button>
                  </div>
                  <div class="history-section">
                    <div class="history-title">备选素材</div>
                    <div class="history-empty">暂无备选素材</div>
                  </div>
                  <div class="history-section">
                    <div class="history-title">历史记录</div>
                    <div class="history-empty">暂无生成记录</div>
                  </div>
                </div>

                <!-- 配音详情 -->
                <div v-else-if="detailType === 'voice'" class="detail-body">
                  <div class="detail-placeholder">配音功能开发中</div>
                </div>
              </div>
            </aside>
          </div>

          <!-- 画布视图 -->
          <div v-else class="canvas-view">
            <div class="canvas-placeholder">
              <el-icon :size="48" color="#4b5563"><Grid /></el-icon>
              <p>画布视图开发中，后续版本开放</p>
              <el-button type="primary" @click="viewMode = 'table'">返回编辑器</el-button>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- 生成记录弹窗 -->
    <el-dialog
      v-model="genRecordVisible"
      title="生成记录"
      width="860px"
      class="dark-dialog gen-record-dialog"
      :close-on-click-modal="true"
    >
      <div class="gen-record-body">
        <!-- Tab 切换 -->
        <div class="gen-record-tabs">
          <div
            class="gen-record-tab"
            :class="{ active: genRecordTab === 'video' }"
            @click="setGenRecordTab('video')"
          >
            视频
          </div>
          <div
            class="gen-record-tab"
            :class="{ active: genRecordTab === 'image' }"
            @click="setGenRecordTab('image')"
          >
            图片
          </div>
          <div
            class="gen-record-tab"
            :class="{ active: genRecordTab === 'other' }"
            @click="setGenRecordTab('other')"
          >
            其他
          </div>
        </div>

        <!-- 筛选栏 -->
        <div class="gen-record-filters">
          <div class="gen-record-status-filters">
            <span
              v-for="s in [
                { k: 'all', l: '全部' },
                { k: 'pending', l: '排队中' },
                { k: 'running', l: '生成中' },
                { k: 'completed', l: '完成' },
                { k: 'failed', l: '失败' }
              ]"
              :key="s.k"
              class="gen-record-filter-btn"
              :class="{ active: genRecordStatusFilter === s.k }"
              @click="genRecordStatusFilter = s.k as any"
              >{{ s.l }}</span
            >
          </div>
          <el-select
            v-if="genRecordTab === 'image'"
            v-model="genRecordTypeFilter"
            size="small"
            class="gen-record-type-select dark-select"
          >
            <el-option label="全部类型" value="all" />
            <el-option label="角色定妆照" value="character_reference" />
            <el-option label="场景图" value="scene_reference" />
            <el-option label="道具图" value="prop_reference" />
            <el-option label="首帧" value="first_frame" />
            <el-option label="尾帧" value="last_frame" />
          </el-select>
        </div>

        <!-- 表格区域 -->
        <div class="gen-record-table-wrap">
          <div v-if="!filteredRecords.length" class="gen-record-empty">暂无生成记录</div>
          <table v-else class="gen-record-table">
            <thead>
              <tr>
                <th class="col-num">编号</th>
                <th class="col-shot">所属分镜/素材</th>
                <th class="col-type">类型</th>
                <th class="col-model">模型</th>
                <th class="col-channel">渠道</th>
                <th class="col-time">创建时间</th>
                <th class="col-wait">等待时间</th>
                <th class="col-status">状态</th>
                <th class="col-action">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(r, idx) in filteredRecords"
                :key="r.id"
                class="gen-record-row"
                :class="{ failed: r.status === 'failed' }"
              >
                <td class="col-num">{{ idx + 1 }}</td>
                <td class="col-shot" :title="getShotDesc(r.shot_id)">
                  {{ getShotDesc(r.shot_id) }}
                </td>
                <td class="col-type">{{ purposeLabel(r.purpose) }}</td>
                <td class="col-model">{{ r.model || '-' }}</td>
                <td class="col-channel">{{ r.channel || '-' }}</td>
                <td class="col-time">{{ formatTime(r.created_at) }}</td>
                <td class="col-wait">{{ formatWaitTime(r) }}</td>
                <td class="col-status">
                  <span class="gen-record-status-tag" :class="r.status">
                    <template v-if="r.status === 'pending'">🔄</template>
                    <template v-if="r.status === 'running'">🔄</template>
                    <template v-if="r.status === 'completed'">✅</template>
                    <template v-if="r.status === 'failed'">❌</template>
                    {{ statusLabel(r.status) }}
                  </span>
                </td>
                <td class="col-action">
                  <el-button
                    v-if="r.status === 'failed'"
                    text
                    size="small"
                    type="primary"
                    @click="retryTask(r)"
                    >重试</el-button
                  >
                  <el-tooltip
                    v-if="r.error_message"
                    :content="r.error_message"
                    placement="top"
                    :show-after="200"
                  >
                    <el-button text size="small">详情</el-button>
                  </el-tooltip>
                  <span v-else-if="r.status !== 'failed'" class="action-placeholder">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <template #footer>
        <el-button @click="genRecordVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 导出进度弹窗 -->
    <el-dialog
      v-model="exportProgressVisible"
      title="正在导出"
      width="400px"
      class="dark-dialog export-progress-dialog"
      :close-on-click-modal="false"
      :show-close="false"
    >
      <div class="export-progress-body">
        <p class="export-progress-msg">{{ exportProgressMsg }}</p>
        <el-progress
          :percentage="Math.round((exportProgressCurrent / exportProgressTotal) * 100)"
          :stroke-width="10"
          class="export-progress-bar"
        />
        <p class="export-progress-count">{{ exportProgressCurrent }} / {{ exportProgressTotal }}</p>
      </div>
    </el-dialog>

    <!-- 模型配置弹窗 -->
    <el-dialog
      v-model="modelConfigVisible"
      title="模型配置"
      width="680px"
      class="dark-dialog model-config-dialog"
    >
      <div class="model-config-body">
        <!-- 顶部工具行 -->
        <div class="model-config-header">
          <el-button text size="small" @click="ElMessage.info('导入配置后续版本开放')"
            >导入配置</el-button
          >
          <el-button text size="small" @click="ElMessage.info('导出配置后续版本开放')"
            >导出配置</el-button
          >
          <div class="model-config-mode">
            <span class="mode-label">{{
              modelConfigMode === 'pro' ? '专业模式' : '新手模式'
            }}</span>
            <el-switch v-model="modelConfigMode" active-value="pro" inactive-value="novice" />
          </div>
        </div>

        <!-- 左侧Tab + 右侧内容 -->
        <div class="model-config-layout">
          <div class="model-config-tabs">
            <div
              v-for="(tab, idx) in modelConfigTabs"
              :key="tab.key"
              class="model-config-tab"
              :class="{ active: modelConfigTab === idx }"
              @click="setModelConfigTab(idx)"
            >
              {{ tab.label }}
            </div>
          </div>
          <div class="model-config-content">
            <div class="config-section">
              <div class="config-row">
                <label>当前模型</label>
                <el-select
                  :model-value="getModelConfigField(modelConfigTabs[modelConfigTab].key, 'model')"
                  size="small"
                  style="width: 240px"
                  @change="
                    (val: string) =>
                      handleModelConfigModelChange(modelConfigTabs[modelConfigTab].key, val)
                  "
                >
                  <el-option
                    v-for="m in providerModels"
                    :key="m.value"
                    :label="m.label"
                    :value="m.value"
                  />
                </el-select>
              </div>
              <div class="config-row">
                <label>渠道</label>
                <el-select
                  :model-value="getModelConfigField(modelConfigTabs[modelConfigTab].key, 'channel')"
                  size="small"
                  style="width: 240px"
                  @change="
                    (val: string) =>
                      handleModelConfigChannelChange(modelConfigTabs[modelConfigTab].key, val)
                  "
                >
                  <el-option
                    v-for="p in providerChannels"
                    :key="p.value"
                    :label="p.label"
                    :value="p.value"
                  />
                </el-select>
              </div>
              <div class="config-row">
                <label>分辨率</label>
                <el-input size="small" style="width: 240px" disabled placeholder="MVP1占位" />
              </div>
              <div class="config-row">
                <label>功能开关</label>
                <el-switch disabled />
              </div>
            </div>

            <!-- 模板区 -->
            <div class="config-template-section">
              <div class="config-template-tabs">
                <div class="config-template-tab active">指令模板</div>
                <div class="config-template-tab disabled">我的指令</div>
              </div>
              <div class="config-template-list">
                <div
                  v-for="t in modelConfigTemplates"
                  :key="t.id"
                  class="config-template-item"
                  :class="{
                    active:
                      getModelConfigField(modelConfigTabs[modelConfigTab].key, 'templateId') ===
                      t.id
                  }"
                  @click="
                    setModelConfigField(modelConfigTabs[modelConfigTab].key, 'templateId', t.id)
                  "
                >
                  {{ t.name }}
                </div>
                <div v-if="!modelConfigTemplates.length" class="config-template-empty">
                  暂无模板
                </div>
              </div>
              <div class="config-template-preview">
                <el-input
                  type="textarea"
                  :rows="6"
                  disabled
                  :model-value="
                    modelConfigTemplates.find(
                      (t: any) =>
                        t.id ===
                        getModelConfigField(modelConfigTabs[modelConfigTab].key, 'templateId')
                    )?.content || '请选择模板'
                  "
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="modelConfigVisible = false">取消</el-button>
        <el-button type="primary" @click="handleModelConfigSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- AI解析弹窗 -->
    <el-dialog
      v-model="parseDialogVisible"
      :title="parseMode === 'full' ? 'AI解析剧本' : '追加解析剧本'"
      width="720px"
      :close-on-click-modal="false"
      :autofocus="false"
      class="dark-dialog parse-dialog"
    >
      <div class="parse-tabs">
        <div class="parse-tab active">AI生成</div>
        <div class="parse-tab disabled" title="后续版本开放">手动切分</div>
      </div>
      <div class="parse-body">
        <div class="parse-section">
          <div class="parse-section-header">
            <span class="parse-section-title">剧本内容</span>
            <span class="char-count" :class="{ warning: scriptCharCount < 500 }">
              {{ scriptCharCount }} 字{{ scriptCharCount < 500 ? '（建议500字以上）' : '' }}
            </span>
          </div>
          <el-input
            v-model="parseScriptText"
            type="textarea"
            :rows="10"
            placeholder="在此粘贴剧本内容..."
            resize="none"
            :disabled="parseGenerating"
          />
        </div>
        <div class="parse-section compact">
          <span class="parse-section-title">画面风格</span>
          <div class="style-grid compact">
            <div
              v-for="s in stylePresets"
              :key="s.name"
              class="style-card compact"
              :class="{ active: selectedStyle === s.name }"
              @click="handleStyleSelect(s)"
            >
              <div class="style-preview compact" :style="{ background: s.color }" />
              <span class="style-name compact">{{ s.name }}</span>
            </div>
          </div>
        </div>
        <div class="parse-section compact">
          <span class="parse-section-title">画面比例</span>
          <div class="ratio-group compact">
            <div
              v-for="r in aspectRatios"
              :key="r.value"
              class="ratio-card compact"
              :class="{ active: selectedAspectRatio === r.value }"
              @click="handleAspectRatioSelect(r.value)"
            >
              <div class="ratio-icon compact" :class="'_' + r.value.replace(':', '_')" />
              <span class="ratio-label">{{ r.label }}</span>
            </div>
          </div>
        </div>
        <div class="parse-section compact">
          <span class="parse-section-title">提示词模板</span>
          <el-select
            v-model="selectedTemplate"
            style="width: 100%"
            :disabled="parseGenerating"
            @change="handleTemplateChange"
          >
            <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
          <div v-if="templatePreview" class="template-preview">{{ templatePreview }}</div>
        </div>
        <div class="parse-section compact">
          <span class="parse-section-title">语言模型</span>
          <el-input v-model="selectedModel" disabled />
        </div>
        <div v-if="parseGenerating" class="parse-progress">
          <div
            v-for="s in parseProgressSteps"
            :key="s.step"
            class="progress-item"
            :class="s.status"
          >
            <span class="progress-icon">
              <span v-if="s.status === 'done'">✅</span>
              <span v-else-if="s.status === 'running'" class="spin">🔄</span>
              <span v-else-if="s.status === 'error'">❌</span>
              <span v-else>⏳</span>
            </span>
            <span class="progress-text">步骤{{ s.step }}：{{ s.message }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="parseGenerating" @click="handleSkipParse">暂时跳过</el-button>
        <el-button
          type="primary"
          :loading="parseGenerating"
          :disabled="parseGenerating"
          @click="handleParseSubmit"
          >一键生成分镜</el-button
        >
      </template>
    </el-dialog>

    <!-- 批量操作弹窗 -->
    <el-dialog
      v-model="batchDialogVisible"
      :title="batchTypeLabels[batchType] || '批量生成'"
      width="480px"
      class="dark-dialog batch-dialog"
    >
      <div class="batch-body">
        <div class="batch-stat">
          <template v-if="batchMode === 'asset'">
            <span class="batch-stat-label">共</span>
            <span class="batch-stat-value">{{ batchTotalAssets }}</span>
            <span class="batch-stat-label"
              >个{{ batchType === '人物' ? '角色' : batchType === '场景' ? '场景' : '道具' }}</span
            >
          </template>
          <template v-else>
            <span class="batch-stat-label">已选中</span>
            <span class="batch-stat-value">{{ selectedShots.size }}</span>
            <span class="batch-stat-label">个分镜</span>
          </template>
        </div>
        <div class="batch-stat">
          <span class="batch-stat-label">其中</span>
          <span class="batch-stat-value" :class="{ zero: batchMissingCount === 0 }">{{
            batchMissingCount
          }}</span>
          <span class="batch-stat-label">个缺失</span>
        </div>

        <div class="batch-count-row">
          <span class="batch-count-label">生成次数</span>
          <div class="batch-count-control">
            <el-button
              text
              size="small"
              :icon="Minus"
              @click="batchCount = Math.max(1, batchCount - 1)"
            />
            <span class="batch-count-num">{{ batchCount }}</span>
            <el-button
              text
              size="small"
              :icon="Plus"
              @click="batchCount = Math.min(10, batchCount + 1)"
            />
          </div>
        </div>

        <div class="batch-actions">
          <el-button type="primary" @click="handleBatchSubmit('all')">全部生成</el-button>
          <el-button
            :disabled="batchMissingCount === 0"
            :class="{ 'batch-missing-disabled': batchMissingCount === 0 }"
            @click="handleBatchSubmit('missing')"
          >
            缺失生成
          </el-button>
        </div>

        <div class="batch-hint">批量执行任务前，请先调试效果至符合预期后再执行</div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.editor-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #0f0f11;
  color: #e0e0e0;
}

/* 顶部栏 */
.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 20px;
  background: rgba(255, 255, 255, 0.03);
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
  font-size: 14px;
  padding: 0;
}

.back-btn:hover {
  color: #e5e7eb;
}

.project-name {
  font-size: 15px;
  font-weight: 600;
  color: #f3f4f6;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #9ca3af;
}

.model-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(167, 139, 250, 0.1);
  color: #c4b5fd;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
}

.model-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a78bfa;
}

.settings-btn {
  color: #9ca3af;
  font-size: 16px;
  padding: 4px;
}

.settings-btn:hover {
  color: #e5e7eb;
}

/* 主体区域 */
.editor-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧导航栏 */
.editor-sidebar {
  width: 160px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.02);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 12px 0;
  display: flex;
  flex-direction: column;
}

.nav-item {
  padding: 10px 16px;
  font-size: 13px;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.15s ease;
  border-left: 3px solid transparent;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
}

.nav-item.active {
  background: rgba(167, 139, 250, 0.1);
  color: #c4b5fd;
  border-left-color: #a78bfa;
  font-weight: 500;
}

/* 中间内容区 */
.editor-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-panel {
  padding: 24px 32px;
  overflow-y: auto;
  max-width: 960px;
  margin: 0 auto;
}

.panel-title {
  font-size: 20px;
  font-weight: 700;
  color: #f3f4f6;
  margin: 0 0 20px 0;
}

/* 总览页 */
.section-block {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.style-grid.compact {
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.style-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: all 0.15s ease;
}

.style-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(167, 139, 250, 0.2);
}

.style-card.active {
  background: rgba(167, 139, 250, 0.15);
  border-color: #a78bfa;
  box-shadow: 0 0 12px rgba(167, 139, 250, 0.15);
}

.style-card.compact {
  padding: 10px 6px;
  gap: 6px;
}

.style-preview {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  opacity: 0.8;
}

.style-preview.compact {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.style-name {
  font-size: 13px;
  font-weight: 500;
  color: #e5e7eb;
  text-align: center;
}

.style-name.compact {
  font-size: 11px;
}

.style-card.active .style-name {
  color: #c4b5fd;
  font-weight: 600;
}

.ratio-group {
  display: flex;
  gap: 12px;
}

.ratio-group.compact {
  gap: 8px;
}

.ratio-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ratio-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(167, 139, 250, 0.2);
}

.ratio-card.active {
  background: rgba(167, 139, 250, 0.15);
  border-color: #a78bfa;
}

.ratio-card.compact {
  padding: 10px;
}

.ratio-icon {
  border-radius: 4px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
}

.ratio-icon._16_9 {
  width: 48px;
  height: 27px;
}

.ratio-icon._9_16 {
  width: 27px;
  height: 48px;
}

.ratio-icon._1_1 {
  width: 36px;
  height: 36px;
}

.ratio-icon._16_9.compact {
  width: 36px;
  height: 20px;
}

.ratio-icon._9_16.compact {
  width: 20px;
  height: 36px;
}

.ratio-icon._1_1.compact {
  width: 28px;
  height: 28px;
}

.ratio-label {
  font-size: 13px;
  color: #9ca3af;
}

.ratio-card.active .ratio-label {
  color: #c4b5fd;
  font-weight: 500;
}

.custom-style-card {
  position: relative;
}

.custom-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  color: #9ca3af;
}

.custom-tag {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 10px;
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.12);
  padding: 1px 5px;
  border-radius: 4px;
  line-height: 1;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 18px 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  transition: all 0.15s ease;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #c4b5fd;
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: #9ca3af;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(167, 139, 250, 0.2);
}

.action-icon {
  color: #a78bfa;
}

.action-name {
  font-size: 13px;
  font-weight: 500;
  color: #e5e7eb;
}

/* 剧集结构页 */
.episodes-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.episodes-toolbar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.toolbar-project-name {
  display: flex;
  align-items: center;
}

.project-name-text {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: background 0.15s;
}

.project-name-text:hover {
  background: rgba(255, 255, 255, 0.04);
}

.project-name-input :deep(.el-input__wrapper) {
  padding: 0 6px;
}

.project-name-input :deep(.el-input__inner) {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
}

.toolbar-tag {
  padding: 2px 10px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.style-tag {
  background: rgba(255, 255, 255, 0.08);
}

.era-tag {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.toolbar-icon-btn {
  color: #9ca3af;
  font-size: 16px;
  padding: 4px 6px;
}

.toolbar-icon-btn:hover {
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.04);
}

.toolbar-center {
  display: flex;
  align-items: center;
  gap: 4px;
}

.view-mode-btn {
  color: #9ca3af;
  font-size: 12px;
  padding: 5px 12px;
}

.view-mode-btn:hover {
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.04);
}

.view-mode-btn.active {
  color: #c4b5fd;
  background: rgba(167, 139, 250, 0.15);
  font-weight: 500;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  justify-content: flex-end;
}

/* Popover 暗色主题 */
.dark-popover {
  background: #1a1a20 !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4) !important;
}

.dark-popover .el-popover__title {
  color: #f3f4f6;
}

/* 风格选择 Popover */
.style-popover-body {
  padding: 8px;
}

.style-popover-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}

.style-popover-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  border-radius: 8px;
  border: 2px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: all 0.15s;
}

.style-popover-card:hover {
  background: rgba(255, 255, 255, 0.06);
}

.style-popover-card.active {
  border-color: rgba(167, 139, 250, 0.6);
}

.style-popover-preview {
  width: 80px;
  height: 60px;
  border-radius: 6px;
  opacity: 0.8;
}

.style-popover-name {
  font-size: 12px;
  color: #e5e7eb;
  text-align: center;
}

.style-popover-footer {
  display: flex;
  justify-content: center;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

/* 年代选择 Popover */
.era-popover-body {
  padding: 4px;
}

.era-popover-item {
  padding: 8px 12px;
  font-size: 13px;
  color: #e5e7eb;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.era-popover-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
}

.era-popover-item.active {
  background: rgba(167, 139, 250, 0.12);
  color: #c4b5fd;
  font-weight: 500;
}

.era-popover-custom {
  display: flex;
  gap: 8px;
  padding: 8px 0 0;
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

/* Dropdown 暗色主题 */
.dark-dropdown .el-dropdown-menu {
  background: #1a1a20;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.dark-dropdown .el-dropdown-menu__item {
  color: #e5e7eb;
}

.dark-dropdown .el-dropdown-menu__item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
}

/* 模型配置弹窗 */
.model-config-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.model-config-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.model-config-mode {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.mode-label {
  font-size: 12px;
  color: #9ca3af;
}

.model-config-layout {
  display: flex;
  gap: 16px;
  min-height: 360px;
}

.model-config-tabs {
  width: 140px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-config-tab {
  padding: 8px 12px;
  font-size: 12px;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.model-config-tab:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
}

.model-config-tab.active {
  background: rgba(167, 139, 250, 0.12);
  color: #c4b5fd;
  font-weight: 500;
}

.model-config-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-row label {
  width: 70px;
  font-size: 12px;
  color: #9ca3af;
  flex-shrink: 0;
}

.config-template-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 12px;
}

.config-template-tabs {
  display: flex;
  gap: 12px;
}

.config-template-tab {
  font-size: 12px;
  color: #9ca3af;
  cursor: pointer;
  padding-bottom: 4px;
  border-bottom: 2px solid transparent;
}

.config-template-tab.active {
  color: #c4b5fd;
  border-bottom-color: #a78bfa;
  font-weight: 500;
}

.config-template-tab.disabled {
  color: #9ca3af;
  cursor: not-allowed;
}

.config-template-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow-y: auto;
}

.config-template-item {
  padding: 6px 10px;
  font-size: 12px;
  color: #e5e7eb;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}

.config-template-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.config-template-item.active {
  background: rgba(167, 139, 250, 0.12);
  color: #c4b5fd;
}

.config-template-empty {
  font-size: 13px;
  color: #9ca3af;
  text-align: center;
  padding: 16px;
}

.config-template-preview :deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.03);
  color: #9ca3af;
}

.episodes-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 分镜列表 */
.shot-table-wrapper {
  flex: 1;
  overflow: auto;
  padding: 0;
}

.loading-mask {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #9ca3af;
}

.shot-table {
  min-width: 1400px;
}

.shot-table-header {
  display: flex;
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.shot-table-header .th {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 600;
  color: #9ca3af;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.shot-table-header .th:last-child {
  border-right: none;
}

.batch-btn {
  font-size: 11px;
  color: #60a5fa;
  padding: 0;
  margin-top: 2px;
}

.col-num {
  width: 70px;
}

.col-script {
  width: 240px;
}

.col-chars,
.col-scenes,
.col-props {
  width: 140px;
}

.col-voice {
  width: 70px;
}

.col-first,
.col-last,
.col-video {
  width: 90px;
}

.col-first-prompt,
.col-last-prompt {
  width: 200px;
}

.col-op {
  width: 110px;
}

/* 章节行 */
.chapter-row {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #c4b5fd;
  background: rgba(167, 139, 250, 0.12);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

/* 分镜行 */
.shot-row {
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  transition: background 0.15s;
}

.shot-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.shot-row.selected {
  background: rgba(167, 139, 250, 0.08);
}

.shot-row .td {
  padding: 10px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shot-row .td:last-child {
  border-right: none;
}

.shot-index {
  font-size: 13px;
  color: #9ca3af;
  margin-left: 4px;
}

.cell-text {
  font-size: 13px;
  color: #e5e7eb;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: text;
  min-height: 20px;
}

.cell-text :deep(.hl-asset) {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
  border-radius: 3px;
  padding: 0 3px;
}

.edit-cell {
  width: 100%;
}

.edit-cell :deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(167, 139, 250, 0.3);
  color: #e5e7eb;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0;
}

.tag-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
}

.tag-char {
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
}

.tag-scene {
  background: rgba(52, 211, 153, 0.15);
  color: #34d399;
}

.tag-prop {
  background: rgba(251, 191, 77, 0.15);
  color: #fbbf4d;
}

/* 缩略图网格 */
.thumb-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.thumb-cell {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.thumb-cell:hover {
  border-color: rgba(167, 139, 250, 0.3);
}

.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  font-size: 9px;
  color: #9ca3af;
  text-align: center;
  padding: 2px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.thumb-empty {
  font-size: 13px;
  color: #9ca3af;
}

/* 媒体单元格 */
.media-cell {
  width: 70px;
  height: 50px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.media-cell:hover {
  border-color: rgba(167, 139, 250, 0.3);
}

.media-placeholder {
  font-size: 12px;
  color: #9ca3af;
}

.media-preview img,
.media-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-video {
  width: 100%;
  height: 100%;
}

/* 操作列 */
.col-op {
  display: flex;
  align-items: center;
  gap: 2px;
}

.col-op .delete-btn:hover {
  color: #ef4444;
}

/* 右侧面板 */
.right-panel {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.01);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-resident,
.panel-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.panel-tabs {
  display: flex;
  gap: 2px;
  margin-left: auto;
}

.panel-tab {
  padding: 4px 10px;
  font-size: 12px;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
}

.panel-tab:hover {
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.04);
}

.panel-tab.active {
  color: #c4b5fd;
  background: rgba(167, 139, 250, 0.1);
  font-weight: 500;
}

.panel-search {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.panel-section {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
}

.panel-section-title {
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.asset-card {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.asset-card:hover {
  border-color: rgba(167, 139, 250, 0.3);
}

.asset-card.unused {
  opacity: 0.5;
}

.asset-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-placeholder {
  font-size: 11px;
  color: #9ca3af;
  text-align: center;
  padding: 4px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.asset-delete {
  position: absolute;
  top: 2px;
  right: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  color: #ef4444;
  background: rgba(0, 0, 0, 0.5);
}

.asset-card:hover .asset-delete {
  opacity: 1;
}

.panel-empty {
  font-size: 13px;
  color: #9ca3af;
  text-align: center;
  padding: 16px;
}

.panel-footer {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

/* 详情面板 */
.detail-toolbar {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-media {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-img {
  width: 100%;
  border-radius: 8px;
  object-fit: cover;
  max-height: 200px;
}

.detail-video {
  width: 100%;
  border-radius: 8px;
  max-height: 200px;
}

.detail-placeholder {
  width: 100%;
  height: 160px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #9ca3af;
}

.detail-upload {
  display: flex;
  gap: 8px;
}

.detail-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-field label {
  font-size: 12px;
  color: #9ca3af;
  margin-bottom: 4px;
  display: block;
}

.detail-field :deep(.el-input__wrapper),
.detail-field :deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.detail-field :deep(.el-input__inner),
.detail-field :deep(.el-textarea__inner) {
  color: #e5e7eb;
  font-size: 13px;
}

/* 生图控制栏 */
.gen-control {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.gen-control-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gen-label {
  font-size: 12px;
  color: #9ca3af;
  flex: 1;
}

.gen-count-input {
  width: 50px;
}

.gen-count-input :deep(.el-input__wrapper) {
  padding: 0 4px;
}

.gen-count-input :deep(.el-input__inner) {
  text-align: center;
}

.gen-btn {
  width: 100%;
}

.history-section {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 12px;
}

.history-title {
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  margin-bottom: 8px;
}

.history-empty {
  font-size: 13px;
  color: #9ca3af;
  text-align: center;
  padding: 16px;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.history-item {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.15s ease;
  aspect-ratio: 1;
}

.history-item:hover {
  border-color: rgba(167, 139, 250, 0.4);
}

.history-item.selected {
  border-color: #a78bfa;
}

.history-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-selected-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #a78bfa;
  color: #fff;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 弹窗 */
.parse-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.parse-tab {
  padding: 10px 20px;
  font-size: 14px;
  color: #9ca3af;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s ease;
}

.parse-tab.active {
  color: #a78bfa;
  border-bottom-color: #a78bfa;
  font-weight: 500;
}

.parse-tab.disabled {
  color: #9ca3af;
  cursor: not-allowed;
}

.parse-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.parse-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.parse-section.compact {
  gap: 8px;
}

.parse-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.parse-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
}

.char-count {
  font-size: 12px;
  color: #9ca3af;
}

.char-count.warning {
  color: #fbbf24;
}

.template-preview {
  font-size: 12px;
  color: #9ca3af;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 10px 12px;
  line-height: 1.5;
  max-height: 80px;
  overflow-y: auto;
}

.parse-progress {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.progress-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #9ca3af;
}

.progress-item.done {
  color: #86efac;
}

.progress-item.running {
  color: #a78bfa;
}

.progress-item.error {
  color: #f87171;
}

.progress-icon {
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}

.spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 画布视图 */
.canvas-view {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.canvas-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #9ca3af;
}

.canvas-placeholder p {
  font-size: 14px;
  margin: 0;
}

/* 生成记录弹窗 */
.gen-record-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gen-record-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 8px;
}

.gen-record-tab {
  padding: 6px 16px;
  font-size: 13px;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.gen-record-tab:hover {
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.04);
}

.gen-record-tab.active {
  color: #fff;
  background: rgba(167, 139, 250, 0.15);
  font-weight: 500;
}

.gen-record-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.gen-record-status-filters {
  display: flex;
  gap: 4px;
}

.gen-record-filter-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.gen-record-filter-btn:hover {
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.04);
}

.gen-record-filter-btn.active {
  color: #c4b5fd;
  background: rgba(167, 139, 250, 0.12);
  border-color: rgba(167, 139, 250, 0.25);
  font-weight: 500;
}

.gen-record-type-select {
  width: 120px;
}

.gen-record-table-wrap {
  max-height: 400px;
  overflow-y: auto;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.gen-record-empty {
  text-align: center;
  padding: 40px;
  font-size: 14px;
  color: #9ca3af;
}

.gen-record-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.gen-record-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.gen-record-table th {
  padding: 10px 8px;
  text-align: left;
  font-weight: 500;
  color: #9ca3af;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  white-space: nowrap;
}

.gen-record-table td {
  padding: 10px 8px;
  color: #d1d5db;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}

.gen-record-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.gen-record-row.failed:hover {
  background: rgba(239, 68, 68, 0.04);
}

.col-num {
  width: 40px;
  text-align: center;
}
.col-shot {
  min-width: 120px;
  max-width: 160px;
}
.col-type {
  width: 80px;
  white-space: nowrap;
}
.col-model {
  width: 80px;
}
.col-channel {
  width: 60px;
}
.col-time {
  width: 90px;
  white-space: nowrap;
}
.col-wait {
  width: 70px;
  text-align: center;
}
.col-status {
  width: 80px;
}
.col-action {
  width: 90px;
  text-align: center;
}

.col-shot {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gen-record-status-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 10px;
  font-weight: 500;
  white-space: nowrap;
}

.gen-record-status-tag.pending {
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
}

.gen-record-status-tag.running {
  background: rgba(96, 165, 250, 0.12);
  color: #60a5fa;
}

.gen-record-status-tag.completed {
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
}

.gen-record-status-tag.failed {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.action-placeholder {
  color: #6b7280;
  font-size: 12px;
}

/* 导出功能 */
.export-mode-label {
  font-size: 13px;
  color: #c4b5fd;
  font-weight: 500;
  margin-right: 8px;
}

.asset-checkbox {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
}

.asset-check-indicator {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #fff;
  transition: all 0.15s;
}

.asset-check-indicator.checked {
  background: #60a5fa;
  border-color: #60a5fa;
}

.asset-card.export-selected {
  outline: 2px solid #60a5fa;
  outline-offset: -2px;
}

.export-progress-body {
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.export-progress-msg {
  font-size: 14px;
  color: #e5e7eb;
  margin: 0;
}

.export-progress-count {
  font-size: 13px;
  color: #9ca3af;
  margin: 0;
}

.export-progress-bar {
  width: 100%;
}

.export-progress-bar .el-progress-bar__outer {
  background: rgba(255, 255, 255, 0.08);
}

.export-progress-bar .el-progress-bar__inner {
  background: #60a5fa;
}

.export-progress-bar .el-progress__text {
  color: #9ca3af;
}
</style>

<style>
.dark-dialog .el-dialog {
  background: #1a1a20;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
}

.dark-dialog .el-dialog__title {
  color: #f3f4f6;
  font-weight: 600;
}

.dark-dialog .el-dialog__header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-right: 0;
  padding: 20px 24px;
}

.dark-dialog .el-dialog__body {
  padding: 24px;
}

.dark-dialog .el-dialog__footer {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 16px 24px;
}

.dark-dialog .el-input__wrapper,
.dark-dialog .el-textarea__inner {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.dark-dialog .el-input__inner,
.dark-dialog .el-textarea__inner {
  color: #e5e7eb;
}

.dark-dialog .el-input__inner::placeholder,
.dark-dialog .el-textarea__inner::placeholder {
  color: #9ca3af;
}

.dark-dialog .el-select .el-input__wrapper {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.dark-dialog .el-select-dropdown {
  background: #1a1a20;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.dark-dialog .el-select-dropdown__item {
  color: #e5e7eb;
}

.dark-dialog .el-select-dropdown__item.hover,
.dark-dialog .el-select-dropdown__item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.dark-dialog .el-select-dropdown__item.selected {
  color: #a78bfa;
}

.parse-dialog .el-textarea__inner {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: none;
  color: #e5e7eb;
  font-size: 14px;
  line-height: 1.7;
  padding: 12px 16px;
}

.parse-dialog .el-textarea__inner::placeholder {
  color: #9ca3af;
}

.parse-dialog .el-textarea__inner:focus {
  border-color: rgba(167, 139, 250, 0.4);
}

/* 批量操作弹窗 */
.batch-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.batch-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #9ca3af;
}

.batch-stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #c4b5fd;
}

.batch-stat-value.zero {
  color: #9ca3af;
}

.batch-count-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.batch-count-label {
  font-size: 13px;
  color: #e5e7eb;
}

.batch-count-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

.batch-count-num {
  font-size: 16px;
  font-weight: 600;
  color: #e5e7eb;
  min-width: 24px;
  text-align: center;
}

.batch-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding-top: 4px;
}

.batch-missing-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.batch-hint {
  font-size: 11px;
  color: #9ca3af;
  text-align: center;
  padding-top: 4px;
}
</style>
