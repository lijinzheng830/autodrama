<script setup lang="ts">
import { ref, onMounted, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

const router = useRouter()

interface Project {
  id: string
  name: string
  style_name: string
  aspect_ratio: string
  created_at: number
  updated_at: number
}

const projects = ref<Project[]>([])
const dialogVisible = ref(false)
const selectedStyle = ref('')
const selectedAspectRatio = ref('16:9')
const loading = ref(false)

const form = reactive({
  projectName: ''
})

const stylePresets = [
  { name: '二次元动漫', prompt: 'Anime style, vibrant colors, detailed eyes, cel shading, clean line art, expressive characters, dynamic composition, high quality illustration', negative: 'photorealistic, 3d render, blurry, low quality, bad anatomy, deformed, ugly, duplicate, watermark, signature' },
  { name: '写实摄影', prompt: 'Photorealistic, high detail, natural lighting, 8k uhd, cinematic shot, depth of field, professional photography, realistic textures, lifelike', negative: 'painting, illustration, cartoon, anime, 3d render, blurry, low quality, artificial, oversaturated' },
  { name: '3D渲染', prompt: '3D render, octane render, blender, cinematic lighting, ray tracing, subsurface scattering, physically based rendering, high poly model, studio lighting', negative: '2d, flat, painting, sketch, hand drawn, low poly, blurry, low quality, cartoon' },
  { name: '水彩插画', prompt: 'Watercolor painting, soft edges, artistic, hand-painted, flowing colors, translucent layers, delicate brushwork, paper texture, dreamy atmosphere', negative: 'photorealistic, 3d render, sharp edges, digital art, oversaturated, blurry, low quality, dark, gloomy' },
  { name: '赛博朋克', prompt: 'Cyberpunk, neon lights, futuristic, dystopian city, holographic displays, rain-soaked streets, high tech low life, glowing accents, blade runner aesthetic', negative: 'medieval, natural landscape, pastel colors, soft lighting, cottagecore, blurry, low quality, boring, plain' },
  { name: '中国水墨', prompt: 'Chinese ink wash painting, traditional art, brush strokes, ink splatter, monochrome, xuan paper texture, poetic composition, calligraphic lines, misty mountains', negative: 'colorful, photorealistic, 3d render, western style, oil painting, blurry, low quality, modern, digital' },
  { name: '像素复古', prompt: 'Pixel art, retro game style, 8-bit, 16-bit, dithering, limited color palette, crisp pixels, nostalgic, arcade aesthetic', negative: 'photorealistic, 3d render, smooth gradients, anti-aliasing, blurry, low quality, modern, realistic' },
  { name: '油画质感', prompt: 'Oil painting, rich textures, classical art, impasto, chiaroscuro, canvas texture, masterwork, museum quality, traditional techniques', negative: 'photorealistic, 3d render, digital art, flat, cartoon, anime, blurry, low quality, modern' },
  { name: '扁平插画', prompt: 'Flat illustration, minimal design, vector art, clean lines, solid colors, geometric shapes, modern UI style, simple and elegant', negative: 'photorealistic, 3d render, gradients, textures, shadows, realistic, blurry, low quality, cluttered, complex' },
  { name: '吉卜力', prompt: 'Studio Ghibli style, whimsical, hand-drawn, pastoral scenery, warm colors, soft clouds, detailed nature, Miyazaki aesthetic, enchanting', negative: 'photorealistic, 3d render, dark, gritty, cyberpunk, violent, blurry, low quality, modern urban, sterile' },
  { name: '美漫风格', prompt: 'American comic style, bold lines, dynamic poses, halftone, pop art, action-packed, inked outlines, vibrant primary colors, dramatic shading', negative: 'photorealistic, 3d render, anime, manga, soft colors, realistic proportions, blurry, low quality, muted' },
  { name: '暗黑奇幻', prompt: 'Dark fantasy, gothic atmosphere, ominous, dramatic shadows, ancient ruins, mythical creatures, epic scale, moody lighting, tormented souls', negative: 'cheerful, bright colors, modern, cute, minimalist, photorealistic, blurry, low quality, mundane, everyday' },
  { name: '日系治愈', prompt: 'Japanese iyashikei, cozy, warm atmosphere, slice of life, soft lighting, gentle colors, peaceful scenery, comforting, slow living', negative: 'dark, violent, scary, intense, dramatic, photorealistic, 3d render, blurry, low quality, chaotic' },
  { name: '潮流插画', prompt: 'Trendy illustration, street art, graffiti, bold colors, urban culture, hip hop aesthetic, dynamic typography, contemporary design, eye-catching', negative: 'photorealistic, 3d render, classical, traditional, muted colors, boring, blurry, low quality, corporate, sterile' },
  { name: '复古港风', prompt: 'Retro Hong Kong style, 1980s, film grain, neon signs, nostalgic street scenes, warm tungsten lighting, cinematic color grading, vintage fashion', negative: 'modern, futuristic, clean, minimalist, photorealistic, 3d render, cold lighting, blurry, low quality, digital perfect' }
]

const aspectRatios = [
  { label: '16:9 横屏', value: '16:9' },
  { label: '9:16 竖屏', value: '9:16' },
  { label: '1:1 方形', value: '1:1' }
]

async function loadProjects() {
  try {
    const list = await window.api.getProjects() as Project[]
    projects.value = list
  } catch (err) {
    ElMessage.error('加载项目列表失败')
    console.error(err)
  }
}

async function handleCreate() {
  if (!form.projectName.trim()) {
    ElMessage.warning('请输入项目名称')
    return
  }
  if (!selectedStyle.value) {
    ElMessage.warning('请选择风格')
    return
  }

  const style = stylePresets.find(s => s.name === selectedStyle.value)
  if (!style) return

  loading.value = true
  try {
    await window.api.createProject({
      name: form.projectName.trim(),
      styleName: style.name,
      stylePrompt: style.prompt,
      styleNegativePrompt: style.negative,
      aspectRatio: selectedAspectRatio.value
    })
    ElMessage.success('项目创建成功')
    dialogVisible.value = false
    resetForm()
    await loadProjects()
  } catch (err) {
    ElMessage.error('创建项目失败')
    console.error(err)
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.projectName = ''
  selectedStyle.value = ''
  selectedAspectRatio.value = '16:9'
}

function openProject(id: string) {
  router.push(`/editor/${id}`)
}

const projectNameInput = ref<InstanceType<typeof import('element-plus').ElInput> | null>(null)

watch(dialogVisible, (val) => {
  if (val) {
    setTimeout(() => {
      projectNameInput.value?.focus()
    }, 500)
  }
})

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN')
}

onMounted(() => {
  loadProjects()
})
</script>

<template>
  <div class="home-container">
    <header class="home-header">
      <h1 class="title">
        <span class="gradient-text">AutoDrama</span>
        <span class="subtitle"> - AI漫剧制作</span>
      </h1>
      <el-button type="primary" size="large" :icon="Plus" @click="dialogVisible = true">
        创建项目
      </el-button>
    </header>

    <main class="home-main">
      <div v-if="projects.length === 0" class="empty-state">
        <el-empty description="暂无项目，点击上方按钮创建第一个项目">
          <el-button type="primary" :icon="Plus" @click="dialogVisible = true">创建项目</el-button>
        </el-empty>
      </div>

      <div v-else class="project-grid">
        <div
          v-for="p in projects"
          :key="p.id"
          class="project-card"
          @click="openProject(p.id)"
        >
          <div class="project-card-header">
            <h3 class="project-name">{{ p.name }}</h3>
            <el-tag size="small" type="info">{{ p.style_name }}</el-tag>
          </div>
          <div class="project-meta">
            <span class="aspect-ratio">{{ p.aspect_ratio }}</span>
            <span class="project-date">{{ formatDate(p.updated_at) }}</span>
          </div>
        </div>
      </div>
    </main>

    <el-dialog
      v-model="dialogVisible"
      title="创建新项目"
      width="700px"
      :close-on-click-modal="false"
      :autofocus="false"
      class="dark-dialog"
    >
      <div class="create-form">
        <div class="form-item">
          <label class="form-label">项目名称</label>
          <el-input
            ref="projectNameInput"
            v-model="form.projectName"
            placeholder="输入项目名称"
          />
        </div>

        <div class="form-item">
          <label class="form-label">画面比例</label>
          <el-radio-group v-model="selectedAspectRatio" size="large">
            <el-radio-button v-for="ar in aspectRatios" :key="ar.value" :label="ar.value">
              {{ ar.label }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <div class="form-item">
          <label class="form-label">风格选择</label>
          <div class="style-grid">
            <div
              v-for="s in stylePresets"
              :key="s.name"
              class="style-card"
              :class="{ active: selectedStyle === s.name }"
              @click="selectedStyle = s.name"
            >
              <span class="style-name">{{ s.name }}</span>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loading" @click="handleCreate">
          确认创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.home-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #0f0f11 0%, #1a1a20 100%);
}

.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 40px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}

.gradient-text {
  background: linear-gradient(90deg, #a78bfa, #60a5fa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  color: #9ca3af;
  font-weight: 500;
}

.home-main {
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.project-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.project-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(167, 139, 250, 0.3);
  transform: translateY(-2px);
}

.project-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.project-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f3f4f6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.project-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
}

.aspect-ratio {
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-label {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.style-card {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
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

.style-name {
  font-size: 13px;
  font-weight: 500;
  color: #d1d5db;
}

.style-card.active .style-name {
  color: #c4b5fd;
  font-weight: 600;
}

@media (max-width: 600px) {
  .style-grid {
    grid-template-columns: repeat(3, 1fr);
  }

  .home-header {
    padding: 16px 20px;
  }

  .home-main {
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

.dark-dialog .el-input__wrapper {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.dark-dialog .el-input__inner {
  color: #e5e7eb;
}

.dark-dialog .el-input__inner::placeholder {
  color: #9ca3af;
}

.dark-dialog .el-radio-button__inner {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.1);
  color: #9ca3af;
}

.dark-dialog .el-radio-button__original-radio:checked + .el-radio-button__inner {
  background: rgba(96, 165, 250, 0.2);
  border-color: #60a5fa;
  color: #60a5fa;
  box-shadow: -1px 0 0 0 #60a5fa;
}
</style>
