<script setup lang="ts">
import { ref, onMounted, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Setting, FolderOpened, Delete } from '@element-plus/icons-vue'

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
const loading = ref(false)

const form = reactive({
  projectName: ''
})

const baseProjectId = ref('')
const projectPath = ref('')

async function loadProjects(): Promise<void> {
  try {
    const list = (await window.api.getProjects()) as Project[]
    projects.value = list
  } catch (err) {
    ElMessage.error('加载项目列表失败')
    console.error(err)
  }
}

async function handleSelectDirectory(): Promise<void> {
  try {
    const result = await window.api.selectDirectory()
    if (result) {
      projectPath.value = result
    }
  } catch (err) {
    ElMessage.error('选择目录失败')
    console.error(err)
  }
}

async function handleCreate(): Promise<void> {
  if (!form.projectName.trim()) {
    ElMessage.warning('请输入项目名称')
    return
  }

  loading.value = true
  try {
    const newProject = (await window.api.createProject({
      name: form.projectName.trim(),
      styleName: '',
      stylePrompt: '',
      styleNegativePrompt: '',
      aspectRatio: '16:9',
      parentProjectId: baseProjectId.value || undefined,
      path: projectPath.value || undefined
    })) as Project
    ElMessage.success('项目创建成功')
    dialogVisible.value = false
    resetForm()
    await loadProjects()
    // 自动进入编辑器
    if (newProject?.id) {
      router.push(`/editor/${newProject.id}`)
    }
  } catch (err) {
    ElMessage.error('创建项目失败')
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function handleDelete(projectId: string, event: MouseEvent): Promise<void> {
  event.stopPropagation()
  try {
    await ElMessageBox.confirm(
      '确定删除该项目吗？项目数据将被永久删除，此操作不可撤销',
      '删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    await window.api.deleteProject(projectId)
    ElMessage.success('项目已删除')
    await loadProjects()
  } catch (err: any) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      ElMessage.error('删除失败')
      console.error(err)
    }
  }
}

function resetForm(): void {
  form.projectName = ''
  baseProjectId.value = ''
  projectPath.value = ''
}

function openProject(id: string): void {
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
      <div class="header-actions">
        <el-button text :icon="Setting" class="settings-btn" @click="router.push('/settings')">
          设置
        </el-button>
        <el-button type="primary" size="large" :icon="Plus" @click="dialogVisible = true">
          创建项目
        </el-button>
      </div>
    </header>

    <main class="home-main">
      <div v-if="projects.length === 0" class="empty-state">
        <el-empty description="暂无项目，点击上方按钮创建第一个项目">
          <el-button type="primary" :icon="Plus" @click="dialogVisible = true">创建项目</el-button>
        </el-empty>
      </div>

      <div v-else class="project-grid">
        <!-- 创建卡片 -->
        <div class="project-card create-card" @click="dialogVisible = true">
          <div class="create-card-content">
            <el-icon :size="32" class="create-icon"><Plus /></el-icon>
            <span class="create-text">新建项目</span>
          </div>
        </div>

        <!-- 项目卡片 -->
        <div v-for="p in projects" :key="p.id" class="project-card" @click="openProject(p.id)">
          <div class="project-card-header">
            <h3 class="project-name">{{ p.name }}</h3>
            <el-button
              text
              circle
              size="small"
              class="delete-btn"
              :icon="Delete"
              @click="handleDelete(p.id, $event)"
            />
          </div>
          <div class="project-meta">
            <span class="project-date">{{ formatDate(p.updated_at) }}</span>
          </div>
        </div>
      </div>
    </main>

    <el-dialog
      v-model="dialogVisible"
      title="创建新项目"
      width="560px"
      :close-on-click-modal="false"
      :autofocus="false"
      class="dark-dialog"
    >
      <div class="create-form">
        <div class="form-item">
          <label class="form-label">项目名称 <span class="required">*</span></label>
          <el-input ref="projectNameInput" v-model="form.projectName" placeholder="输入项目名称" />
        </div>

        <div class="form-item">
          <label class="form-label">项目目录</label>
          <el-input v-model="projectPath" placeholder="默认目录（自动创建）" readonly>
            <template #append>
              <el-button :icon="FolderOpened" @click="handleSelectDirectory" />
            </template>
          </el-input>
        </div>

        <div class="form-item">
          <label class="form-label">基于已有项目创建</label>
          <el-select
            v-model="baseProjectId"
            placeholder="不选则创建全新项目"
            clearable
            style="width: 100%"
          >
            <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
          <div class="form-hint">选择后将复制该项目的角色、场景和道具到新项目</div>
        </div>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loading" @click="handleCreate"> 创建 </el-button>
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-btn {
  color: #9ca3af;
  font-size: 14px;
}

.settings-btn:hover {
  color: #e5e7eb;
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
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
}

.project-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.project-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(167, 139, 250, 0.3);
  transform: translateY(-2px);
}

.create-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  border-style: dashed;
}

.create-card:hover {
  border-color: rgba(167, 139, 250, 0.5);
}

.create-card-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.create-icon {
  color: #9ca3af;
}

.create-text {
  color: #9ca3af;
  font-size: 14px;
  font-weight: 500;
}

.create-card:hover .create-icon,
.create-card:hover .create-text {
  color: #c4b5fd;
}

.project-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
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

.delete-btn {
  color: #6b7280;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.project-card:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  color: #ef4444;
}

.project-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}

.required {
  color: #ef4444;
}

.form-hint {
  font-size: 12px;
  color: #6b7280;
}

@media (max-width: 600px) {
  .home-header {
    padding: 16px 20px;
  }

  .home-main {
    padding: 20px;
  }

  .project-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }
}
</style>

<style>
.dark-dialog .el-dialog {
  background: #FFF8F0;
  border: 2px solid #000000;
  border-radius: 12px;
}

.dark-dialog .el-dialog__title {
  color: #000000;
  font-weight: 700;
  font-size: 18px;
}

.dark-dialog .el-dialog__header {
  border-bottom: 1px solid #000000;
  margin-right: 0;
  padding: 20px 24px;
}

.dark-dialog .el-dialog__body {
  padding: 24px;
  color: #000000;
  font-weight: 600;
}

.dark-dialog .el-dialog__body .form-label {
  font-weight: 700;
  color: #000000;
  font-size: 14px;
}

.dark-dialog .el-dialog__footer {
  border-top: 1px solid #000000;
  padding: 16px 24px;
}

.dark-dialog .el-input__wrapper {
  background: #FFF8F0;
  box-shadow: 0 0 0 2px #000000 inset;
}

.dark-dialog .el-input__inner {
  color: #000000;
  font-weight: 500;
}

.dark-dialog .el-input__inner::placeholder {
  color: #888888;
  font-weight: 400;
}

.dark-dialog .el-select .el-input__inner {
  color: #000000;
  font-weight: 500;
}

.dark-dialog .form-hint {
  font-size: 12px;
  color: #555555;
  font-weight: 500;
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
</style>
