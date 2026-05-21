<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Setting } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id as string

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
}

interface ProgressItem {
  step: number
  status: 'running' | 'done' | 'error' | 'waiting'
  message: string
}

interface ResultData {
  shotsData: any
  extractData: any
  assocData: any
}

const project = ref<Project | null>(null)
const activeNav = ref('overview')
const scriptText = ref('')
const generating = ref(false)
const currentModel = ref('')

// 进度
const progressSteps = ref<ProgressItem[]>([
  { step: 1, status: 'waiting', message: '分析剧本、拆分镜头' },
  { step: 2, status: 'waiting', message: '提取角色和场景' },
  { step: 3, status: 'waiting', message: '关联角色和场景到分镜' },
  { step: 4, status: 'waiting', message: '保存项目' }
])

// 结果
const showResult = ref(false)
const resultData = ref<ResultData | null>(null)
const expandCharacters = ref(false)
const expandScenes = ref(false)

let removeAIProgress: (() => void) | null = null

const navItems = [
  { key: 'overview', label: '项目总览' },
  { key: 'characters', label: '角色管理' },
  { key: 'scenes', label: '场景管理' },
  { key: 'episodes', label: '剧集结构' }
]

async function loadProject() {
  try {
    const data = await window.api.getProject(projectId) as Project | null
    project.value = data
  } catch (err) {
    ElMessage.error('加载项目失败')
    console.error(err)
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

function goHome() {
  router.push('/')
}

function goSettings() {
  router.push('/settings')
}

function resetProgress() {
  progressSteps.value = [
    { step: 1, status: 'waiting', message: '分析剧本、拆分镜头' },
    { step: 2, status: 'waiting', message: '提取角色和场景' },
    { step: 3, status: 'waiting', message: '关联角色和场景到分镜' },
    { step: 4, status: 'waiting', message: '保存项目' }
  ]
}

async function handleGenerate() {
  if (!scriptText.value.trim()) {
    ElMessage.warning('请输入剧本内容')
    return
  }

  // 检查 API Key
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

  generating.value = true
  showResult.value = false
  resultData.value = null
  resetProgress()

  // 监听进度
  removeAIProgress = window.api.onAIProgress((data: any) => {
    if (data.step >= 1 && data.step <= 4) {
      const idx = data.step - 1
      progressSteps.value[idx].status = data.status
      progressSteps.value[idx].message = data.message
      // 前面步骤标记为完成
      for (let i = 0; i < idx; i++) {
        if (progressSteps.value[i].status !== 'error') {
          progressSteps.value[i].status = 'done'
        }
      }
    }
    if (data.status === 'error') {
      generating.value = false
      ElMessage.error(data.message || '生成失败')
    }
  })

  try {
    const res = await window.api.autoProcess(projectId, scriptText.value.trim()) as ResultData
    resultData.value = res
    showResult.value = true
    ElMessage.success('生成完成！')
  } catch (err: any) {
    console.error(err)
    if (!err.message?.includes('请')) {
      ElMessage.error(err.message || '生成失败，请重试')
    }
  } finally {
    generating.value = false
    if (removeAIProgress) {
      removeAIProgress()
      removeAIProgress = null
    }
  }
}

function handleRegenerate() {
  showResult.value = false
  resultData.value = null
  handleGenerate()
}

function handleContinue() {
  // 跳转到剧集结构页
  activeNav.value = 'episodes'
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN')
}

function countShots(data: any): number {
  if (!data?.chapters) return 0
  return data.chapters.reduce((sum: number, ch: any) => sum + (ch.shots?.length || 0), 0)
}

onMounted(() => {
  loadProject()
  loadModelName()
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
          <div class="info-cards">
            <div class="info-card">
              <span class="info-label">画面风格</span>
              <span class="info-value">{{ project?.style_name || '-' }}</span>
            </div>
            <div class="info-card">
              <span class="info-label">画面比例</span>
              <span class="info-value">{{ project?.aspect_ratio || '-' }}</span>
            </div>
            <div class="info-card">
              <span class="info-label">创建时间</span>
              <span class="info-value">{{ project ? formatDate(project.created_at) : '-' }}</span>
            </div>
          </div>

          <!-- 剧本输入 -->
          <div v-if="!showResult" class="script-section">
            <label class="section-label">剧本内容</label>
            <el-input
              v-model="scriptText"
              type="textarea"
              :rows="12"
              placeholder="在此输入剧本内容..."
              resize="none"
              class="script-textarea"
              :disabled="generating"
            />
          </div>

          <!-- 进度面板 -->
          <div v-if="generating" class="progress-panel">
            <h3 class="progress-title">生成进度</h3>
            <div class="progress-list">
              <div
                v-for="s in progressSteps"
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

          <!-- 结果面板 -->
          <div v-if="showResult && resultData" class="result-panel">
            <h3 class="result-title">生成完成</h3>
            <div class="result-cards">
              <div class="result-card">
                <span class="result-number">{{ resultData.shotsData?.chapters?.length || 0 }}</span>
                <span class="result-label">章节</span>
              </div>
              <div class="result-card">
                <span class="result-number">{{ countShots(resultData.shotsData) }}</span>
                <span class="result-label">分镜</span>
              </div>
              <div class="result-card clickable" @click="expandCharacters = !expandCharacters">
                <span class="result-number">{{ resultData.extractData?.characters?.length || 0 }}</span>
                <span class="result-label">角色 {{ expandCharacters ? '▲' : '▼' }}</span>
              </div>
              <div class="result-card clickable" @click="expandScenes = !expandScenes">
                <span class="result-number">{{ resultData.extractData?.scenes?.length || 0 }}</span>
                <span class="result-label">场景 {{ expandScenes ? '▲' : '▼' }}</span>
              </div>
            </div>

            <!-- 角色列表 -->
            <div v-if="expandCharacters" class="detail-list">
              <div
                v-for="(c, i) in resultData.extractData?.characters || []"
                :key="i"
                class="detail-item"
              >
                <span class="detail-name">{{ c.name }}</span>
                <span class="detail-desc">{{ c.description }}</span>
              </div>
            </div>

            <!-- 场景列表 -->
            <div v-if="expandScenes" class="detail-list">
              <div
                v-for="(s, i) in resultData.extractData?.scenes || []"
                :key="i"
                class="detail-item"
              >
                <span class="detail-name">{{ s.name }}</span>
                <span class="detail-desc">{{ s.description }}</span>
              </div>
            </div>

            <div class="result-actions">
              <el-button size="large" @click="handleRegenerate">重新生成</el-button>
              <el-button type="primary" size="large" @click="handleContinue">
                确认，继续
              </el-button>
            </div>
          </div>

          <!-- 操作栏 -->
          <div v-if="!generating && !showResult" class="action-bar">
            <el-button
              type="primary"
              size="large"
              :loading="generating"
              @click="handleGenerate"
            >
              开始生成
            </el-button>
          </div>
        </div>

        <!-- 其他页面 -->
        <div v-else class="content-panel placeholder">
          <el-empty description="该功能正在开发中..." />
        </div>
      </main>
    </div>
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

.info-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 32px;
}

.info-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.info-value {
  font-size: 15px;
  color: #f3f4f6;
  font-weight: 600;
}

.script-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
}

.section-label {
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
}

.script-textarea :deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: none;
  color: #e5e7eb;
  font-size: 14px;
  line-height: 1.7;
  padding: 12px 16px;
}

.script-textarea :deep(.el-textarea__inner::placeholder) {
  color: #6b7280;
}

.script-textarea :deep(.el-textarea__inner:focus) {
  border-color: rgba(167, 139, 250, 0.4);
}

/* 进度面板 */
.progress-panel {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
}

.progress-title {
  font-size: 16px;
  font-weight: 600;
  color: #f3f4f6;
  margin: 0 0 16px 0;
}

.progress-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #9ca3af;
  transition: color 0.2s;
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

/* 结果面板 */
.result-panel {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
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

.action-bar {
  display: flex;
  justify-content: flex-end;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

@media (max-width: 768px) {
  .editor-sidebar {
    width: 160px;
  }

  .info-cards {
    grid-template-columns: 1fr;
  }

  .result-cards {
    grid-template-columns: repeat(2, 1fr);
  }

  .editor-content {
    padding: 20px;
  }
}
</style>
