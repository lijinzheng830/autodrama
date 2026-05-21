<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'

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

const project = ref<Project | null>(null)
const activeNav = ref('overview')
const scriptText = ref('')
const generating = ref(false)

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

function goHome() {
  router.push('/')
}

function handleGenerate() {
  if (!scriptText.value.trim()) {
    ElMessage.warning('请输入剧本内容')
    return
  }
  generating.value = true
  setTimeout(() => {
    generating.value = false
    ElMessage.success('生成任务已提交')
  }, 1500)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN')
}

onMounted(() => {
  loadProject()
})
</script>

<template>
  <div class="editor-layout">
    <!-- 顶部栏 -->
    <header class="editor-header">
      <div class="header-left">
        <el-button
          :icon="ArrowLeft"
          text
          class="back-btn"
          @click="goHome"
        >
          返回首页
        </el-button>
        <span class="project-name">{{ project?.name || '加载中...' }}</span>
      </div>
      <div class="header-right">
        <span class="project-id">ID: {{ projectId }}</span>
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

          <div class="script-section">
            <label class="section-label">剧本内容</label>
            <el-input
              v-model="scriptText"
              type="textarea"
              :rows="12"
              placeholder="在此输入剧本内容..."
              resize="none"
              class="script-textarea"
            />
          </div>

          <div class="action-bar">
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
  font-size: 12px;
  color: #6b7280;
  font-family: 'Menlo', 'Lucida Console', monospace;
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

  .editor-content {
    padding: 20px;
  }
}
</style>
