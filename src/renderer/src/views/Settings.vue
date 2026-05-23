<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft,
  Plus,
  Edit,
  Delete,
  Download,
  Upload,
  Monitor,
  Setting,
  DocumentCopy,
  InfoFilled
} from '@element-plus/icons-vue'

interface ProviderItem {
  id: string
  name?: string
  key?: string
  baseURL?: string
  apiKey?: string
  models?: any[]
}

interface PromptTemplate {
  id: string
  name: string
  usage: string
  content: string
  is_default: number | boolean
  project_id?: string
}

const router = useRouter()

// 导航
const navItems = [
  { key: 'providers', label: 'API供应商 & 插件', icon: Setting },
  { key: 'templates', label: '提示词模板', icon: DocumentCopy },
  { key: 'routes', label: '模型路由 & 默认', icon: Monitor },
  { key: 'about', label: '关于', icon: InfoFilled }
]
const activeNav = ref('providers')

function goBack(): void {
  router.back()
}

// ===== Providers =====
const providers = ref<ProviderItem[]>([])
const providerDialogVisible = ref(false)
const providerDialogMode = ref<'add' | 'edit'>('add')
const providerEditId = ref('')
const providerForm = ref({ name: '', baseURL: '', apiKey: '', models: [] as Array<{ name: string; type: string }> })

async function loadProviders(): Promise<void> {
  try {
    providers.value = await window.api.getProviders()
  } catch (_err: any) {
    console.error(_err)
  }
}

function openAddProvider(): void {
  providerDialogMode.value = 'add'
  providerEditId.value = ''
  providerForm.value = { name: '', baseURL: '', apiKey: '', models: [] }
  providerDialogVisible.value = true
}

function openEditProvider(p: ProviderItem): void {
  providerDialogMode.value = 'edit'
  providerEditId.value = p.id
  providerForm.value = {
    name: p.name || '',
    baseURL: p.baseURL || '',
    apiKey: p.apiKey || '',
    models: Array.isArray(p.models) ? p.models.map((m: any) => typeof m === 'string' ? { name: m, type: 'text' } : { name: m.name || m.key || '', type: m.type || 'text' }) : []
  }
  providerDialogVisible.value = true
}

function extractKeyFromBaseURL(baseURL: string): string {
  try {
    const url = new URL(baseURL)
    let hostname = url.hostname
    // 去掉常见前缀
    hostname = hostname.replace(/^api\./, '').replace(/^www\./, '').replace(/^openai\./, '')
    // 取第一段（品牌名通常在第一段）
    const firstPart = hostname.split('.')[0]
    return firstPart || 'custom'
  } catch {
    return 'custom'
  }
}

function generateUniqueKey(baseKey: string, existingKeys: string[]): string {
  if (!existingKeys.includes(baseKey)) return baseKey
  let suffix = 2
  while (existingKeys.includes(`${baseKey}_${suffix}`)) {
    suffix++
  }
  return `${baseKey}_${suffix}`
}

function addProviderModel(): void {
  providerForm.value.models.push({ name: '', type: 'text' })
}

function removeProviderModel(idx: number): void {
  providerForm.value.models.splice(idx, 1)
}

async function saveProvider(): Promise<void> {
  const { name, baseURL, apiKey, models } = providerForm.value
  if (!name || !baseURL) {
    ElMessage.warning('请填写名称和baseURL')
    return
  }

  // 自动从baseURL提取标识
  const extractedKey = extractKeyFromBaseURL(baseURL)
  const allProviders = await window.api.getProviders()
  const existingKeys = allProviders
    .filter((p: any) => p.id !== providerEditId.value)
    .map((p: any) => p.key)
    .filter(Boolean) as string[]
  const key = generateUniqueKey(extractedKey, existingKeys)

  const modelList = models
    .filter((m) => m.name.trim())
    .map((m) => ({ key: m.name.trim(), name: m.name.trim(), type: m.type, free: false }))
  const data = { name, key, baseURL, apiKey, models: modelList as any }
  try {
    if (providerDialogMode.value === 'add') {
      await window.api.addProvider(data)
      ElMessage.success('添加成功')
    } else {
      await window.api.updateProvider(providerEditId.value, data)
      ElMessage.success('更新成功')
    }
    providerDialogVisible.value = false
    await loadProviders()
    localStorage.setItem('providers_dirty', '1')
  } catch (_err: any) {
    ElMessage.error((_err instanceof Error ? _err.message : '操作失败') || '操作失败')
  }
}

async function handleDeleteProvider(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除该供应商？', '确认删除', { type: 'warning' })
    await window.api.deleteProvider(id)
    ElMessage.success('删除成功')
    await loadProviders()
    localStorage.setItem('providers_dirty', '1')
  } catch {
    // cancel
  }
}

// ===== Templates =====
const templateTab = ref<'official' | 'custom'>('official')
const templates = ref<any[]>([])
const officialTemplates = ref<any[]>([])
const systemPrompt = ref('')
const templateDialogVisible = ref(false)
const templateDialogMode = ref<'add' | 'edit'>('add')
const templateEditId = ref('')
const templateForm = ref({ name: '', usage: 'script_parse', content: '' })

const usageOptions = [
  { label: '剧本解析', value: 'script_parse' },
  { label: '角色生图', value: 'character_image' },
  { label: '场景生图', value: 'scene_image' },
  { label: '道具生图', value: 'prop_image' },
  { label: '首帧', value: 'first_frame' },
  { label: '尾帧', value: 'last_frame' },
  { label: '视频', value: 'video' }
]

async function loadTemplates(): Promise<void> {
  try {
    const all = (await window.api.getPromptTemplates('')) as any[]
    templates.value = all.filter((t: any) => !t.is_default && !t.is_default)
    officialTemplates.value = all.filter(
      (t: PromptTemplate) => t.is_default === 1 || t.is_default === true
    )
  } catch (_err: any) {
    console.error(_err)
  }
}

async function loadSystemPrompt(): Promise<void> {
  try {
    systemPrompt.value = await window.api.getSystemPrompt()
  } catch (_err: any) {
    console.error(_err)
  }
}

async function saveSystemPrompt(): Promise<void> {
  try {
    await window.api.setSystemPrompt(systemPrompt.value)
    ElMessage.success('系统预设已保存')
  } catch (_err: any) {
    ElMessage.error('保存失败')
  }
}

function openAddTemplate(): void {
  templateDialogMode.value = 'add'
  templateEditId.value = ''
  templateForm.value = { name: '', usage: 'script_parse', content: '' }
  templateDialogVisible.value = true
}

function openEditTemplate(t: any): void {
  templateDialogMode.value = 'edit'
  templateEditId.value = t.id
  templateForm.value = {
    name: t.name || '',
    usage: t.usage || 'script_parse',
    content: t.content || ''
  }
  templateDialogVisible.value = true
}

async function saveTemplate(): Promise<void> {
  const { name, usage, content } = templateForm.value
  if (!name || !content) {
    ElMessage.warning('请填写名称和内容')
    return
  }
  try {
    if (templateDialogMode.value === 'add') {
      await window.api.savePromptTemplate('', { usage, name, content })
      ElMessage.success('创建成功')
    } else {
      await window.api.updatePromptTemplate(templateEditId.value, { name, usage, content })
      ElMessage.success('更新成功')
    }
    templateDialogVisible.value = false
    await loadTemplates()
  } catch (_err: any) {
    ElMessage.error((_err instanceof Error ? _err.message : '操作失败') || '操作失败')
  }
}

async function handleDeleteTemplate(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除该模板？', '确认删除', { type: 'warning' })
    await window.api.deletePromptTemplate(id)
    ElMessage.success('删除成功')
    await loadTemplates()
  } catch {
    // cancel
  }
}

async function cloneTemplate(t: any): Promise<void> {
  try {
    await window.api.savePromptTemplate('', {
      usage: t.usage,
      name: t.name + '（复制）',
      content: t.content
    })
    ElMessage.success('已另存为我的模板')
    await loadTemplates()
    templateTab.value = 'custom'
  } catch (_err: any) {
    ElMessage.error((_err instanceof Error ? _err.message : '操作失败') || '操作失败')
  }
}

// Config export / import
async function handleExportConfig(): Promise<void> {
  try {
    const modelRoutes = (await window.api.getSetting('model_routes')) || '{}'
    const data = {
      systemPrompt: systemPrompt.value,
      templates: templates.value,
      modelRoutes: JSON.parse(modelRoutes)
    }
    const cipher = await window.api.exportConfig(data)
    const filePath = await window.api.showSaveDialog({
      title: '导出配置',
      defaultPath: 'config.autodrama-config',
      filters: [{ name: 'AutoDrama配置', extensions: ['autodrama-config'] }]
    })
    if (!filePath) return
    const ok = await window.api.configWriteFile(filePath, cipher)
    if (ok) ElMessage.success(`配置已导出到 ${filePath}`)
    else ElMessage.error('写入文件失败')
  } catch (_err: any) {
    ElMessage.error('导出失败')
    console.error(_err)
  }
}

async function handleImportConfig(): Promise<void> {
  try {
    const filePath = await window.api.showOpenDialog({
      title: '导入配置',
      filters: [{ name: 'AutoDrama配置', extensions: ['autodrama-config'] }]
    })
    if (!filePath) return
    const cipher = await window.api.configReadFile(filePath)
    if (!cipher) {
      ElMessage.error('读取配置文件失败')
      return
    }
    const res = await window.api.importConfig(cipher)
    if (!res.success) {
      ElMessage.error(res.error || '配置文件无效')
      return
    }
    // Merge
    const data = res.data as Record<string, any>
    if (data.systemPrompt) {
      systemPrompt.value = data.systemPrompt
      await window.api.setSystemPrompt(data.systemPrompt)
    }
    if (data.modelRoutes) {
      await window.api.setSetting('model_routes', JSON.stringify(data.modelRoutes))
    }
    if (Array.isArray(data.templates)) {
      // 先加载现有模板列表用于匹配同名
      const existing = (await window.api.getPromptTemplates('')) as any[]
      const existingMap = new Map<string, any>()
      for (const t of existing) {
        if (!t.is_default && t.name) existingMap.set(t.name, t)
      }
      for (const t of data.templates) {
        const match = existingMap.get(t.name)
        if (match) {
          // 同名覆盖
          await window.api.updatePromptTemplate(match.id, {
            usage: t.usage,
            name: t.name,
            content: t.content
          })
        } else {
          // 新增
          await window.api.savePromptTemplate('', {
            usage: t.usage,
            name: t.name,
            content: t.content
          })
        }
      }
    }
    ElMessage.success('配置导入成功')
    await loadTemplates()
    await loadModelRoutes()
  } catch (_err: any) {
    ElMessage.error('导入失败')
    console.error(_err)
  }
}

// ===== Model Routes =====
const routePurposes = [
  { key: 'language_model', label: '剧本解析 & 提示词推理' },
  { key: 'character_image', label: '角色定妆照' },
  { key: 'scene_image', label: '场景图' },
  { key: 'prop_image', label: '道具图' },
  { key: 'first_frame', label: '首帧' },
  { key: 'last_frame', label: '尾帧' },
  { key: 'video', label: '视频' }
]
const modelRoutes = ref<Record<string, { model: string; channel: string }>>({})

async function loadModelRoutes(): Promise<void> {
  try {
    const raw = await window.api.getSetting('model_routes')
    modelRoutes.value = raw ? JSON.parse(raw) : {}
  } catch {
    modelRoutes.value = {}
  }
}

async function saveModelRoutes(): Promise<void> {
  try {
    await window.api.setSetting('model_routes', JSON.stringify(modelRoutes.value))
    ElMessage.success('模型路由已保存')
  } catch (_err: any) {
    ElMessage.error('保存失败')
  }
}

const routeTypeMap: Record<string, string> = {
  language_model: 'text',
  character_image: 'image',
  scene_image: 'image',
  prop_image: 'image',
  first_frame: 'image',
  last_frame: 'image',
  video: 'video'
}

function getRouteModelOptions(purposeKey: string): string[] {
  const neededType = routeTypeMap[purposeKey]
  const list: string[] = []
  for (const p of providers.value) {
    if (Array.isArray(p.models)) {
      for (const m of p.models) {
        const modelType = typeof m === 'string' ? 'text' : (m.type || 'text')
        if (neededType && modelType !== neededType) continue
        const name = typeof m === 'string' ? m : (m.name || m.key || '')
        if (name) list.push(name)
      }
    }
  }
  return [...new Set(list)]
}

function getRouteChannelOptions(purposeKey: string): { label: string; value: string }[] {
  const neededType = routeTypeMap[purposeKey]
  if (!neededType) {
    return providers.value
      .map((p) => ({ label: p.name || '', value: p.key || p.id }))
      .filter((p) => p.value)
  }
  const providersWithType = new Set<string>()
  for (const p of providers.value) {
    if (Array.isArray(p.models)) {
      for (const m of p.models) {
        const modelType = typeof m === 'string' ? 'text' : (m.type || 'text')
        if (modelType === neededType) {
          providersWithType.add(p.key || p.id)
        }
      }
    }
  }
  return providers.value
    .map((p) => ({ label: p.name || '', value: p.key || p.id }))
    .filter((p) => p.value && providersWithType.has(p.value))
}

function getRouteModel(key: string): string {
  return modelRoutes.value[key]?.model || ''
}

function setRouteModel(key: string, val: string): void {
  if (!modelRoutes.value[key]) modelRoutes.value[key] = { model: '', channel: '' }
  modelRoutes.value[key].model = val
  // 自动匹配渠道：根据模型名反查供应商key
  for (const p of providers.value) {
    if (Array.isArray(p.models)) {
      for (const m of p.models) {
        const modelKey = typeof m === 'string' ? m : m.key
        if (modelKey === val) {
          modelRoutes.value[key].channel = p.key || p.id || ''
          return
        }
      }
    }
  }
}

function getRouteChannel(key: string): string {
  return modelRoutes.value[key]?.channel || ''
}

function setRouteChannel(key: string, val: string): void {
  if (!modelRoutes.value[key]) modelRoutes.value[key] = { model: '', channel: '' }
  modelRoutes.value[key].channel = val

  // 自动匹配该渠道下的第一个模型
  if (val) {
    const provider = providers.value.find((p) => (p.key || p.id) === val)
    if (provider && Array.isArray(provider.models) && provider.models.length > 0) {
      const firstModel = provider.models[0]
      const modelName = typeof firstModel === 'string' ? firstModel : (firstModel.name || firstModel.key || '')
      modelRoutes.value[key].model = modelName
    } else {
      modelRoutes.value[key].model = ''
    }
  } else {
    modelRoutes.value[key].model = ''
  }
}

// ===== About =====
const appVersion = ref('')
const electronVersion = ref('')
const nodeVersion = ref('')
const chromeVersion = ref('')

onMounted(async () => {
  loadProviders()
  loadTemplates()
  loadSystemPrompt()
  loadModelRoutes()
  try {
    appVersion.value = await window.api.getVersion()
    const versions = await window.api.getVersions()
    electronVersion.value = versions.electron || ''
    nodeVersion.value = versions.node || ''
    chromeVersion.value = versions.chrome || ''
  } catch {
    // ignore
  }
})
</script>

<template>
  <div class="settings-layout">
    <header class="settings-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" text class="back-btn" @click="goBack">返回</el-button>
        <span class="page-title">设置</span>
      </div>
    </header>

    <div class="settings-body">
      <!-- 左侧导航 -->
      <aside class="settings-nav">
        <div
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activeNav === item.key }"
          @click="activeNav = item.key"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
          <span class="nav-label">{{ item.label }}</span>
        </div>
      </aside>

      <!-- 右侧内容 -->
      <main class="settings-content">
        <!-- API供应商 & 插件 -->
        <div v-if="activeNav === 'providers'" class="settings-panel">
          <div class="panel-header">
            <h2 class="panel-title">API供应商 & 插件</h2>
            <el-button type="primary" size="small" :icon="Plus" @click="openAddProvider"
              >添加供应商</el-button
            >
          </div>
          <div class="panel-body">
            <table class="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>标识</th>
                  <th>baseURL</th>
                  <th>模型数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in providers" :key="p.id">
                  <td>{{ p.name }}</td>
                  <td>{{ p.key }}</td>
                  <td>{{ p.baseURL }}</td>
                  <td>{{ Array.isArray(p.models) ? p.models.length : 0 }}</td>
                  <td>
                    <el-button text size="small" :icon="Edit" @click="openEditProvider(p)"
                      >编辑</el-button
                    >
                    <el-button text size="small" :icon="Delete" @click="handleDeleteProvider(p.id)"
                      >删除</el-button
                    >
                  </td>
                </tr>
                <tr v-if="!providers.length">
                  <td colspan="5" class="table-empty">暂无供应商，点击上方按钮添加</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 提示词模板 -->
        <div v-if="activeNav === 'templates'" class="settings-panel">
          <!-- 系统预设 -->
          <div class="system-prompt-section">
            <div class="section-header">
              <h3 class="section-title">AI系统预设</h3>
              <el-button type="primary" size="small" @click="saveSystemPrompt">保存</el-button>
            </div>
            <el-input
              v-model="systemPrompt"
              type="textarea"
              :rows="6"
              placeholder="输入AI系统预设（system prompt）..."
              resize="none"
            />
          </div>

          <!-- 导出导入 -->
          <div class="config-actions">
            <el-button text size="small" :icon="Download" @click="handleExportConfig"
              >导出配置</el-button
            >
            <el-button text size="small" :icon="Upload" @click="handleImportConfig"
              >导入配置</el-button
            >
          </div>

          <!-- 模板Tab -->
          <div class="template-tabs">
            <div
              class="template-tab"
              :class="{ active: templateTab === 'official' }"
              @click="templateTab = 'official'"
            >
              官方模板
            </div>
            <div
              class="template-tab"
              :class="{ active: templateTab === 'custom' }"
              @click="templateTab = 'custom'"
            >
              我的模板
            </div>
          </div>

          <div class="panel-body">
            <!-- 官方模板 -->
            <div v-if="templateTab === 'official'">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>分类</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="t in officialTemplates" :key="t.id">
                    <td>{{ t.name }}</td>
                    <td>{{ usageOptions.find((u) => u.value === t.usage)?.label || t.usage }}</td>
                    <td>
                      <el-button text size="small" :icon="DocumentCopy" @click="cloneTemplate(t)"
                        >另存为我的模板</el-button
                      >
                    </td>
                  </tr>
                  <tr v-if="!officialTemplates.length">
                    <td colspan="3" class="table-empty">暂无官方模板</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 我的模板 -->
            <div v-if="templateTab === 'custom'">
              <div class="panel-toolbar">
                <el-button type="primary" size="small" :icon="Plus" @click="openAddTemplate"
                  >新建模板</el-button
                >
              </div>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>分类</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="t in templates.filter((x: PromptTemplate) => !x.is_default)"
                    :key="t.id"
                  >
                    <td>{{ t.name }}</td>
                    <td>{{ usageOptions.find((u) => u.value === t.usage)?.label || t.usage }}</td>
                    <td>
                      <el-button text size="small" :icon="Edit" @click="openEditTemplate(t)"
                        >编辑</el-button
                      >
                      <el-button
                        text
                        size="small"
                        :icon="Delete"
                        @click="handleDeleteTemplate(t.id)"
                        >删除</el-button
                      >
                    </td>
                  </tr>
                  <tr v-if="!templates.filter((x: PromptTemplate) => !x.is_default).length">
                    <td colspan="3" class="table-empty">暂无自定义模板</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 模型路由 & 默认 -->
        <div v-if="activeNav === 'routes'" class="settings-panel">
          <div class="panel-header">
            <h2 class="panel-title">模型路由 & 默认</h2>
            <el-button type="primary" size="small" @click="saveModelRoutes">保存</el-button>
          </div>
          <div class="panel-body">
            <table class="data-table route-table">
              <thead>
                <tr>
                  <th>用途</th>
                  <th>模型</th>
                  <th>渠道</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rp in routePurposes" :key="rp.key">
                  <td>{{ rp.label }}</td>
                  <td>
                    <el-select
                      :model-value="getRouteModel(rp.key)"
                      size="small"
                      class="dark-select"
                      placeholder="选择模型"
                      @update:model-value="(val: string) => setRouteModel(rp.key, val)"
                    >
                      <el-option label="未设置" value="" />
                      <el-option v-for="m in getRouteModelOptions(rp.key)" :key="m" :label="m" :value="m" />
                    </el-select>
                  </td>
                  <td>
                    <el-select
                      :model-value="getRouteChannel(rp.key)"
                      size="small"
                      class="dark-select"
                      placeholder="选择渠道"
                      @update:model-value="(val: string) => setRouteChannel(rp.key, val)"
                    >
                      <el-option label="未设置" value="" />
                      <el-option v-for="c in getRouteChannelOptions(rp.key)" :key="c.value" :label="c.label" :value="c.value" />
                    </el-select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 关于 -->
        <div v-if="activeNav === 'about'" class="settings-panel">
          <div class="about-section">
            <div class="about-logo">
              <img src="/icon.png" alt="AutoDrama" class="about-icon" />
              <h2 class="about-title">AutoDrama</h2>
              <p class="about-version">版本 {{ appVersion }}</p>
            </div>
            <div class="about-info">
              <div class="about-row">
                <span class="about-label">Electron</span>
                <span class="about-value">{{ electronVersion }}</span>
              </div>
              <div class="about-row">
                <span class="about-label">Node.js</span>
                <span class="about-value">{{ nodeVersion }}</span>
              </div>
              <div class="about-row">
                <span class="about-label">Chrome</span>
                <span class="about-value">{{ chromeVersion }}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- 供应商弹窗 -->
    <el-dialog
      v-model="providerDialogVisible"
      :title="providerDialogMode === 'add' ? '添加供应商' : '编辑供应商'"
      width="480px"
      class="dark-dialog"
    >
      <div class="dialog-form">
        <div class="form-row">
          <label class="form-label">名称</label>
          <el-input v-model="providerForm.name" placeholder="如：OpenAI" />
        </div>
        <div class="form-row">
          <label class="form-label">baseURL</label>
          <el-input v-model="providerForm.baseURL" placeholder="如：https://api.openai.com/v1" />
        </div>
        <div class="form-row">
          <label class="form-label">API Key</label>
          <el-input
            v-model="providerForm.apiKey"
            type="password"
            placeholder="可选"
            show-password
          />
        </div>
        <div class="form-row">
          <label class="form-label">模型列表</label>
          <div style="flex:1">
            <div v-for="(m, idx) in providerForm.models" :key="idx" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
              <el-input v-model="m.name" placeholder="模型名" style="flex:1" />
              <el-select v-model="m.type" style="width:120px">
                <el-option label="语言模型" value="text" />
                <el-option label="提示词模型" value="prompt" />
                <el-option label="生图模型" value="image" />
                <el-option label="视频模型" value="video" />
              </el-select>
              <el-button text size="small" @click="removeProviderModel(idx)">删除</el-button>
            </div>
            <el-button text size="small" @click="addProviderModel">+ 添加模型</el-button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="providerDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveProvider">保存</el-button>
      </template>
    </el-dialog>

    <!-- 模板弹窗 -->
    <el-dialog
      v-model="templateDialogVisible"
      :title="templateDialogMode === 'add' ? '新建模板' : '编辑模板'"
      width="560px"
      class="dark-dialog"
    >
      <div class="dialog-form">
        <div class="form-row">
          <label class="form-label">模板名称</label>
          <el-input v-model="templateForm.name" placeholder="输入模板名称" />
        </div>
        <div class="form-row">
          <label class="form-label">分类</label>
          <el-select v-model="templateForm.usage" class="dark-select" placeholder="选择分类">
            <el-option
              v-for="opt in usageOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div class="form-row">
          <label class="form-label">模板内容</label>
          <el-input
            v-model="templateForm.content"
            type="textarea"
            :rows="10"
            placeholder="输入模板内容..."
            resize="none"
          />
        </div>
      </div>
      <template #footer>
        <el-button @click="templateDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveTemplate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.settings-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #0f0f11;
  color: #e0e0e0;
}

.settings-header {
  display: flex;
  align-items: center;
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

.page-title {
  font-size: 15px;
  font-weight: 600;
  color: #f3f4f6;
}

.settings-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.settings-nav {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 12px 0;
  background: rgba(255, 255, 255, 0.01);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  margin: 0 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #9ca3af;
  transition: all 0.2s;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
}

.nav-item.active {
  background: rgba(167, 139, 250, 0.12);
  color: #c4b5fd;
  font-weight: 500;
}

.nav-icon {
  font-size: 16px;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.settings-panel {
  max-width: 800px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #f3f4f6;
  margin: 0;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th {
  padding: 10px 12px;
  text-align: left;
  font-weight: 500;
  color: #9ca3af;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.data-table td {
  padding: 10px 12px;
  color: #d1d5db;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.data-table tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.table-empty {
  text-align: center;
  color: #6b7280;
  padding: 32px;
}

/* System Prompt */
.system-prompt-section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
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
  margin: 0;
}

/* Config Actions */
.config-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

/* Template Tabs */
.template-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 8px;
}

.template-tab {
  padding: 6px 14px;
  font-size: 13px;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.template-tab:hover {
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.04);
}

.template-tab.active {
  color: #fff;
  background: rgba(167, 139, 250, 0.15);
  font-weight: 500;
}

/* Dialog Form */
.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: #d1d5db;
}

/* About */
.about-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 40px 0;
}

.about-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.about-icon {
  width: 64px;
  height: 64px;
  border-radius: 14px;
}

.about-title {
  font-size: 20px;
  font-weight: 700;
  color: #f3f4f6;
  margin: 0;
}

.about-version {
  font-size: 13px;
  color: #9ca3af;
  margin: 0;
}

.about-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 280px;
}

.about-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.about-label {
  color: #9ca3af;
}

.about-value {
  color: #d1d5db;
  font-family: monospace;
}

/* Route Table */
.route-table .dark-select {
  width: 180px;
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
  padding: 16px 20px;
}

.dark-dialog .el-dialog__body {
  padding: 20px;
}

.dark-dialog .el-dialog__footer {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding: 12px 20px;
}

.dark-select .el-select-dropdown__list {
  background: #1a1a20;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.dark-select.el-popper {
  background: #1a1a20;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.dark-select .el-select-dropdown__item {
  color: #d1d5db;
}

.dark-select .el-select-dropdown__item.hover,
.dark-select .el-select-dropdown__item:hover {
  background: rgba(167, 139, 250, 0.1);
}

.dark-select .el-select-dropdown__item.selected {
  color: #a78bfa;
  font-weight: 600;
}

.dark-select .el-input__wrapper {
  background: rgba(255, 255, 255, 0.04) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset !important;
}

.dark-select .el-input__inner {
  color: #e5e7eb !important;
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
</style>
