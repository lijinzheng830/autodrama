<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Setting, Plus, VideoPlay, DocumentAdd } from '@element-plus/icons-vue'
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
}

const project = ref<Project | null>(null)
const activeNav = ref('overview')
const currentModel = ref('')
const expandCharacters = ref(false)
const expandScenes = ref(false)

// 风格/比例选择
const selectedStyle = ref('')
const selectedAspectRatio = ref('16:9')

// 统计数据
const stats = ref({ characters: 0, scenes: 0, props: 0, chapters: 0, shots: 0 })
const hasData = computed(() => stats.value.chapters > 0)

// AI解析弹窗
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

const navItems = [
  { key: 'overview', label: '项目总览' },
  { key: 'characters', label: '角色管理' },
  { key: 'scenes', label: '场景管理' },
  { key: 'episodes', label: '剧集结构' }
]

// 13种预设风格
const stylePresets = [
  { name: '二次元动漫', prompt: 'Anime style, vibrant colors, detailed eyes, cel shading, clean line art, expressive characters, dynamic composition, high quality illustration', negative: 'photorealistic, 3d render, blurry, low quality, bad anatomy, deformed, ugly, duplicate, watermark, signature', color: '#ff6b9d' },
  { name: '写实摄影', prompt: 'Photorealistic, high detail, natural lighting, 8k uhd, cinematic shot, depth of field, professional photography, realistic textures, lifelike', negative: 'painting, illustration, cartoon, anime, 3d render, blurry, low quality, artificial, oversaturated', color: '#4ecdc4' },
  { name: '3D渲染', prompt: '3D render, octane render, blender, cinematic lighting, ray tracing, subsurface scattering, physically based rendering, high poly model, studio lighting', negative: '2d, flat, painting, sketch, hand drawn, low poly, blurry, low quality, cartoon', color: '#a78bfa' },
  { name: '水彩插画', prompt: 'Watercolor painting, soft edges, artistic, hand-painted, flowing colors, translucent layers, delicate brushwork, paper texture, dreamy atmosphere', negative: 'photorealistic, 3d render, sharp edges, digital art, oversaturated, blurry, low quality, dark, gloomy', color: '#67e8f9' },
  { name: '赛博朋克', prompt: 'Cyberpunk, neon lights, futuristic, dystopian city, holographic displays, rain-soaked streets, high tech low life, glowing accents, blade runner aesthetic', negative: 'medieval, natural landscape, pastel colors, soft lighting, cottagecore, blurry, low quality, boring, plain', color: '#f472b6' },
  { name: '中国水墨', prompt: 'Chinese ink wash painting, traditional art, brush strokes, ink splatter, monochrome, xuan paper texture, poetic composition, calligraphic lines, misty mountains', negative: 'colorful, photorealistic, 3d render, western style, oil painting, blurry, low quality, modern, digital', color: '#9ca3af' },
  { name: '像素复古', prompt: 'Pixel art, retro game style, 8-bit, 16-bit, dithering, limited color palette, crisp pixels, nostalgic, arcade aesthetic', negative: 'photorealistic, 3d render, smooth gradients, anti-aliasing, blurry, low quality, modern, realistic', color: '#fbbf24' },
  { name: '油画质感', prompt: 'Oil painting, rich textures, classical art, impasto, chiaroscuro, canvas texture, masterwork, museum quality, traditional techniques', negative: 'photorealistic, 3d render, digital art, flat, cartoon, anime, blurry, low quality, modern', color: '#f97316' },
  { name: '扁平插画', prompt: 'Flat illustration, minimal design, vector art, clean lines, solid colors, geometric shapes, modern UI style, simple and elegant', negative: 'photorealistic, 3d render, gradients, textures, shadows, realistic, blurry, low quality, cluttered, complex', color: '#34d399' },
  { name: '吉卜力', prompt: 'Studio Ghibli style, whimsical, hand-drawn, pastoral scenery, warm colors, soft clouds, detailed nature, Miyazaki aesthetic, enchanting', negative: 'photorealistic, 3d render, dark, gritty, cyberpunk, violent, blurry, low quality, modern urban, sterile', color: '#86efac' },
  { name: '美漫风格', prompt: 'American comic style, bold lines, dynamic poses, halftone, pop art, action-packed, inked outlines, vibrant primary colors, dramatic shading', negative: 'photorealistic, 3d render, anime, manga, soft colors, realistic proportions, blurry, low quality, muted', color: '#fb7185' },
  { name: '暗黑奇幻', prompt: 'Dark fantasy, gothic atmosphere, ominous, dramatic shadows, ancient ruins, mythical creatures, epic scale, moody lighting, tormented souls', negative: 'cheerful, bright colors, modern, cute, minimalist, photorealistic, blurry, low quality, mundane, everyday', color: '#7c3aed' },
  { name: '日系治愈', prompt: 'Japanese iyashikei, cozy, warm atmosphere, slice of life, soft lighting, gentle colors, peaceful scenery, comforting, slow living', negative: 'dark, violent, scary, intense, dramatic, photorealistic, 3d render, blurry, low quality, chaotic', color: '#fcd34d' }
]

const aspectRatios = [
  { label: '16:9 横屏', value: '16:9' },
  { label: '9:16 竖屏', value: '9:16' },
  { label: '1:1 方形', value: '1:1' }
]

async function loadProject() {
  try {
    const data = await window.api.getProject(projectId) as Project | null
    project.value = data
    if (data) {
      selectedStyle.value = data.style_name || ''
      selectedAspectRatio.value = data.aspect_ratio || '16:9'
      if (data.script_text) {
        store.scriptText = data.script_text
      }
    }
  } catch (err) {
    ElMessage.error('加载项目失败')
    console.error(err)
  }
}

async function loadStats() {
  try {
    const data = await window.api.getProjectData(projectId) as any
    if (data) {
      stats.value = {
        characters: data.characters?.length || 0,
        scenes: data.scenes?.length || 0,
        props: data.props?.length || 0,
        chapters: data.chapters?.length || 0,
        shots: data.shots?.length || 0
      }
    }
  } catch (err) {
    console.error('加载统计失败', err)
  }
}

async function loadExistingData() {
  try {
    const chapters = await window.api.getChapters(projectId) as any[]
    if (!chapters || chapters.length === 0) {
      return
    }

    const [characters, scenes, shotChars, shotScns] = await Promise.all([
      window.api.getCharacters(projectId),
      window.api.getScenes(projectId),
      window.api.getShotCharactersByProject(projectId),
      window.api.getShotScenesByProject(projectId)
    ]) as [any[], any[], any[], any[]]

    const shotsData: any = { chapters: [] }
    for (const chapter of chapters) {
      const shots = await window.api.getShots(chapter.id) as any[]
      const shotList = shots.map((s: any) => {
        const parts = (s.description || '').split('\n对白: ')
        return {
          shot_index: s.shot_index,
          description: parts[0],
          dialogue: parts[1] || '',
          first_frame_prompt: s.first_frame_prompt || '',
          last_frame_prompt: s.last_frame_prompt || '',
          video_prompt: s.video_prompt || ''
        }
      })
      shotsData.chapters.push({ title: chapter.title, shots: shotList })
    }

    const charMap = new Map<string, string[]>()
    for (const sc of shotChars) {
      if (!charMap.has(sc.shot_id)) charMap.set(sc.shot_id, [])
      charMap.get(sc.shot_id)!.push(sc.name)
    }
    const sceneMap = new Map<string, string>()
    for (const ss of shotScns) {
      if (!sceneMap.has(ss.shot_id)) sceneMap.set(ss.shot_id, ss.name)
    }

    const associations: any[] = []
    for (let ci = 0; ci < chapters.length; ci++) {
      const shots = await window.api.getShots(chapters[ci].id) as any[]
      for (const s of shots) {
        const charNames = charMap.get(s.id) || []
        const sceneName = sceneMap.get(s.id) || ''
        if (charNames.length > 0 || sceneName) {
          associations.push({
            chapter_index: ci,
            shot_index: s.shot_index,
            character_names: charNames,
            scene_name: sceneName
          })
        }
      }
    }

    const extractData = {
      characters: characters.map((c: any) => ({ name: c.name, description: c.description || '', prompt: '' })),
      scenes: scenes.map((s: any) => ({ name: s.name, description: s.description || '', prompt: '' }))
    }

    store.setResult({ shotsData, extractData, assocData: { associations } })
    for (let i = 0; i < store.progressSteps.length; i++) {
      store.updateProgressStep(i, 'done', store.progressSteps[i].message + ' 完成')
    }
  } catch (err) {
    console.error('加载已有数据失败', err)
  }
}

async function loadModelName() {
  try {
    const provider = await window.api.getSetting('provider')
    const model = await window.api.getSetting('model')
    const providers = await window.api.getProviders()
    const p = providers.find((pr: any) => pr.key === provider) as any
    const m = p?.models?.find((mo: any) => mo.key === model)
    currentModel.value = m?.name || model || '未配置'
  } catch (err) {
    currentModel.value = '未配置'
  }
}

// 风格/比例变更保存
async function handleStyleSelect(style: any) {
  selectedStyle.value = style.name
  await saveStyleToProject()
}

async function handleAspectRatioSelect(ratio: string) {
  selectedAspectRatio.value = ratio
  await saveStyleToProject()
}

async function saveStyleToProject() {
  if (!project.value) return
  try {
    const style = stylePresets.find(s => s.name === selectedStyle.value)
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

// AI解析弹窗
function openParseDialog(mode: 'full' | 'append') {
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

async function loadTemplates() {
  try {
    const list = await window.api.getPromptTemplates(projectId, 'shot_image') as any[]
    templates.value = list
    if (list.length > 0 && !selectedTemplate.value) {
      selectedTemplate.value = list[0].id
      templatePreview.value = list[0].content
    }
  } catch (err) {
    console.error('加载模板失败', err)
  }
}

function handleTemplateChange(templateId: string) {
  const t = templates.value.find((tm: any) => tm.id === templateId)
  templatePreview.value = t?.content || ''
}

async function loadParseModel() {
  try {
    const provider = await window.api.getSetting('provider')
    const model = await window.api.getSetting('model')
    const providers = await window.api.getProviders() as any[]
    const p = providers.find((pr: any) => pr.key === provider)
    const m = p?.models?.find((mo: any) => mo.key === model)
    selectedModel.value = m?.name || model || '未配置'
  } catch (err) {
    selectedModel.value = '未配置'
  }
}

async function handleParseSubmit() {
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
      parseProgressSteps.value[idx] = { ...parseProgressSteps.value[idx], status: data.status, message: data.message }
      for (let i = 0; i < idx; i++) {
        if (parseProgressSteps.value[i].status !== 'done') {
          parseProgressSteps.value[i] = { ...parseProgressSteps.value[i], status: 'done', message: parseProgressSteps.value[i].message + ' 完成' }
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
    const res = await window.api.autoProcess(
      projectId,
      parseScriptText.value.trim(),
      {
        promptTemplate: template?.content,
        aspectRatio: selectedAspectRatio.value,
        model: selectedModel.value !== '未配置' ? selectedModel.value : undefined,
        mode: parseMode.value
      }
    ) as {
      shotsData: any
      extractData: any
      assocData: any
    }
    store.setResult(res)
    ElMessage.success('生成完成！')
    parseDialogVisible.value = false
    activeNav.value = 'episodes'
    await loadStats()
  } catch (err: any) {
    console.error(err)
    if (!err.message?.includes('请')) {
      ElMessage.error(err.message || '生成失败，请重试')
    }
  } finally {
    parseGenerating.value = false
    if (removeAIProgress) {
      removeAIProgress()
      removeAIProgress = null
    }
  }
}

function handleSkipParse() {
  parseDialogVisible.value = false
}

function handleCustomStyle() {
  ElMessage.info('自定义风格功能后续版本开放')
}

function goHome() {
  router.push('/')
}

function goSettings() {
  router.push('/settings')
}

function handleContinue() {
  activeNav.value = 'episodes'
}

function countShots(data: any): number {
  if (!data?.chapters) return 0
  return data.chapters.reduce((sum: number, ch: any) => sum + (ch.shots?.length || 0), 0)
}

const scriptCharCount = computed(() => parseScriptText.value.length)

onMounted(() => {
  store.resetResult()
  store.scriptText = ''
  loadProject().then(() => loadExistingData())
  loadModelName()
  loadStats()
})

onUnmounted(() => {
  if (removeAIProgress) {
    removeAIProgress()
  }
})
</script>

<template>
  <div class="editor-layout">
    <!-- 顶部栏 -->
    <header class="editor-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" text class="back-btn" @click="goHome">
          返回首页
        </el-button>
        <span class="project-name">{{ project?.name || '加载中...' }}</span>
      </div>
      <div class="header-right">
        <span class="model-badge">
          <span class="model-dot" />
          {{ currentModel }}
        </span>
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

          <!-- 数据统计 -->
          <div v-if="hasData" class="stats-bar">
            <div class="stat-item">
              <span class="stat-number">{{ stats.characters }}</span>
              <span class="stat-label">角色</span>
            </div>
            <div class="stat-item">
              <span class="stat-number">{{ stats.scenes }}</span>
              <span class="stat-label">场景</span>
            </div>
            <div class="stat-item">
              <span class="stat-number">{{ stats.props }}</span>
              <span class="stat-label">道具</span>
            </div>
            <div class="stat-item">
              <span class="stat-number">{{ stats.chapters }}</span>
              <span class="stat-label">剧集</span>
            </div>
            <div class="stat-item">
              <span class="stat-number">{{ stats.shots }}</span>
              <span class="stat-label">分镜</span>
            </div>
          </div>

          <!-- 画面风格选择 -->
          <div class="section-block">
            <div class="section-header">
              <span class="section-title">画面风格</span>
              <el-button text size="small" :icon="Plus" @click="handleCustomStyle">
                自定义风格
              </el-button>
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
            </div>
          </div>

          <!-- 画面比例选择 -->
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
                <div class="ratio-icon" :class="r.value" />
                <span class="ratio-label">{{ r.label }}</span>
              </div>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="action-bar">
            <el-button
              type="primary"
              size="large"
              :icon="VideoPlay"
              @click="openParseDialog('full')"
            >
              AI解析剧本
            </el-button>
            <el-button
              size="large"
              :icon="DocumentAdd"
              @click="openParseDialog('append')"
            >
              追加解析
            </el-button>
          </div>

          <!-- 已有结果展示（保留兼容） -->
          <div v-if="store.showResult && store.resultData" class="result-panel">
            <h3 class="result-title">生成结果</h3>
            <div class="result-cards">
              <div class="result-card">
                <span class="result-number">{{ store.resultData.shotsData?.chapters?.length || 0 }}</span>
                <span class="result-label">章节</span>
              </div>
              <div class="result-card">
                <span class="result-number">{{ countShots(store.resultData.shotsData) }}</span>
                <span class="result-label">分镜</span>
              </div>
              <div class="result-card clickable" @click="expandCharacters = !expandCharacters">
                <span class="result-number">{{ store.resultData.extractData?.characters?.length || 0 }}</span>
                <span class="result-label">角色 {{ expandCharacters ? '▲' : '▼' }}</span>
              </div>
              <div class="result-card clickable" @click="expandScenes = !expandScenes">
                <span class="result-number">{{ store.resultData.extractData?.scenes?.length || 0 }}</span>
                <span class="result-label">场景 {{ expandScenes ? '▲' : '▼' }}</span>
              </div>
            </div>

            <div v-if="expandCharacters" class="detail-list">
              <div
                v-for="(c, i) in store.resultData.extractData?.characters || []"
                :key="i"
                class="detail-item"
              >
                <span class="detail-name">{{ c.name }}</span>
                <span class="detail-desc">{{ c.description }}</span>
              </div>
            </div>

            <div v-if="expandScenes" class="detail-list">
              <div
                v-for="(s, i) in store.resultData.extractData?.scenes || []"
                :key="i"
                class="detail-item"
              >
                <span class="detail-name">{{ s.name }}</span>
                <span class="detail-desc">{{ s.description }}</span>
              </div>
            </div>

            <div class="result-actions">
              <el-button type="primary" size="large" @click="handleContinue">
                查看剧集结构
              </el-button>
            </div>
          </div>
        </div>

        <!-- 其他页面 -->
        <div v-else class="content-panel placeholder">
          <el-empty description="该功能正在开发中..." />
        </div>
      </main>
    </div>

    <!-- AI解析弹窗 -->
    <el-dialog
      v-model="parseDialogVisible"
      :title="parseMode === 'full' ? 'AI解析剧本' : '追加解析剧本'"
      width="720px"
      :close-on-click-modal="false"
      :autofocus="false"
      class="dark-dialog parse-dialog"
    >
      <!-- Tab -->
      <div class="parse-tabs">
        <div class="parse-tab active">AI生成</div>
        <div class="parse-tab disabled" title="后续版本开放">手动切分</div>
      </div>

      <div class="parse-body">
        <!-- 剧本输入 -->
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

        <!-- 风格选择（与总览页同步） -->
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

        <!-- 比例选择 -->
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
              <div class="ratio-icon compact" :class="r.value" />
              <span class="ratio-label">{{ r.label }}</span>
            </div>
          </div>
        </div>

        <!-- 提示词模板 -->
        <div class="parse-section compact">
          <span class="parse-section-title">提示词模板</span>
          <el-select
            v-model="selectedTemplate"
            style="width: 100%"
            @change="handleTemplateChange"
            :disabled="parseGenerating"
          >
            <el-option
              v-for="t in templates"
              :key="t.id"
              :label="t.name"
              :value="t.id"
            />
          </el-select>
          <div v-if="templatePreview" class="template-preview">
            {{ templatePreview }}
          </div>
        </div>

        <!-- 模型选择 -->
        <div class="parse-section compact">
          <span class="parse-section-title">语言模型</span>
          <el-input v-model="selectedModel" disabled />
        </div>

        <!-- 进度 -->
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
        <el-button :disabled="parseGenerating" @click="handleSkipParse">
          暂时跳过
        </el-button>
        <el-button
          type="primary"
          :loading="parseGenerating"
          :disabled="parseGenerating"
          @click="handleParseSubmit"
        >
          一键生成分镜
        </el-button>
      </template>
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
  height: 56px;
  padding: 0 24px;
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
  font-size: 16px;
  font-weight: 600;
  color: #f3f4f6;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: #6b7280;
}

.model-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(167, 139, 250, 0.1);
  color: #c4b5fd;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
}

.model-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a78bfa;
}

.project-id {
  font-family: 'Menlo', 'Lucida Console', monospace;
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
  width: 200px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.02);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 16px 0;
  display: flex;
  flex-direction: column;
}

.nav-item {
  padding: 12px 20px;
  font-size: 14px;
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
  overflow-y: auto;
  padding: 32px 40px;
}

.content-panel {
  max-width: 960px;
}

.panel-title {
  font-size: 22px;
  font-weight: 700;
  color: #f3f4f6;
  margin: 0 0 24px 0;
}

/* 统计栏 */
.stats-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 28px;
}

.stat-item {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-number {
  font-size: 24px;
  font-weight: 700;
  color: #a78bfa;
}

.stat-label {
  font-size: 12px;
  color: #6b7280;
}

/* 区块 */
.section-block {
  margin-bottom: 28px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
  display: block;
  margin-bottom: 14px;
}

/* 风格网格 */
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
  color: #d1d5db;
  text-align: center;
}

.style-name.compact {
  font-size: 11px;
}

.style-card.active .style-name {
  color: #c4b5fd;
  font-weight: 600;
}

/* 比例选择 */
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
  width: 48px;
  height: 32px;
  border-radius: 4px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
}

.ratio-icon.compact {
  width: 36px;
  height: 24px;
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

/* 操作栏 */
.action-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}

/* 结果面板 */
.result-panel {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 24px;
}

.result-title {
  font-size: 16px;
  font-weight: 600;
  color: #f3f4f6;
  margin: 0 0 16px 0;
}

.result-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.result-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.result-card.clickable {
  cursor: pointer;
  transition: all 0.15s ease;
}

.result-card.clickable:hover {
  background: rgba(167, 139, 250, 0.08);
  border-color: rgba(167, 139, 250, 0.2);
}

.result-number {
  font-size: 24px;
  font-weight: 700;
  color: #a78bfa;
}

.result-label {
  font-size: 13px;
  color: #9ca3af;
}

.detail-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.detail-item {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-name {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
}

.detail-desc {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}

.result-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

/* 弹窗内样式 */
.parse-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 0;
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
  color: #4b5563;
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
  color: #6b7280;
}

.char-count.warning {
  color: #fbbf24;
}

.template-preview {
  font-size: 12px;
  color: #6b7280;
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
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .editor-sidebar {
    width: 160px;
  }

  .style-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .style-grid.compact {
    grid-template-columns: repeat(4, 1fr);
  }

  .stats-bar {
    flex-wrap: wrap;
  }

  .stat-item {
    min-width: 80px;
  }

  .result-cards {
    grid-template-columns: repeat(2, 1fr);
  }

  .editor-content {
    padding: 20px;
  }
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
  color: #6b7280;
}

.parse-dialog .el-textarea__inner:focus {
  border-color: rgba(167, 139, 250, 0.4);
}
</style>
