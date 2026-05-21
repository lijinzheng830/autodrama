<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, View, Hide } from '@element-plus/icons-vue'

const router = useRouter()

interface ModelConfig {
  key: string
  name: string
  type: 'text' | 'image' | 'video'
  free: boolean
}

interface ProviderConfig {
  key: string
  name: string
  baseURL: string
  models: ModelConfig[]
  implemented: boolean
}

const providers = ref<ProviderConfig[]>([])
const selectedProvider = ref('')
const selectedModel = ref('')
const apiKey = ref('')
const apiKeyVisible = ref(false)
const loading = ref(false)
const saving = ref(false)

function goBack() {
  router.back()
}

const currentProvider = computed(() =>
  providers.value.find(p => p.key === selectedProvider.value)
)

const availableModels = computed(() => {
  const p = currentProvider.value
  return p ? p.models : []
})

async function loadProviders() {
  try {
    providers.value = await window.api.getProviders() as ProviderConfig[]
  } catch (err) {
    console.error(err)
  }
}

async function loadSettings() {
  loading.value = true
  try {
    const [provider, model, key] = await Promise.all([
      window.api.getSetting('provider'),
      window.api.getSetting('model'),
      window.api.getSetting('api_key_qwen')
    ])
    selectedProvider.value = provider || 'qwen'
    selectedModel.value = model || 'qwen3.6-flash'
    apiKey.value = key || ''
  } catch (err) {
    ElMessage.error('加载设置失败')
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!selectedProvider.value) {
    ElMessage.warning('请选择供应商')
    return
  }
  if (!selectedModel.value) {
    ElMessage.warning('请选择模型')
    return
  }

  saving.value = true
  try {
    await Promise.all([
      window.api.setSetting('provider', selectedProvider.value),
      window.api.setSetting('model', selectedModel.value),
      window.api.setSetting(`api_key_${selectedProvider.value}`, apiKey.value.trim())
    ])
    ElMessage.success('设置已保存')
  } catch (err) {
    ElMessage.error('保存设置失败')
    console.error(err)
  } finally {
    saving.value = false
  }
}

watch(selectedProvider, (newVal) => {
  const p = providers.value.find(pr => pr.key === newVal)
  if (p && p.models.length > 0) {
    // 如果当前选中模型不在新供应商的模型列表中，则重置为第一个
    if (!p.models.find(m => m.key === selectedModel.value)) {
      selectedModel.value = p.models[0].key
    }
  }
  // 加载对应供应商的API Key
  if (newVal) {
    window.api.getSetting(`api_key_${newVal}`).then((key) => {
      apiKey.value = key || ''
    })
  }
})

onMounted(() => {
  loadProviders().then(() => loadSettings())
})
</script>

<template>
  <div class="settings-layout">
    <header class="settings-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" text class="back-btn" @click="goBack">
          返回
        </el-button>
        <span class="page-title">设置</span>
      </div>
    </header>

    <main class="settings-content">
      <div v-if="loading" class="loading-wrap">
        <el-skeleton :rows="6" animated />
      </div>

      <div v-else class="settings-form">
        <h2 class="section-title">AI 模型配置</h2>

        <div class="form-group">
          <label class="form-label">AI 供应商</label>
          <el-select v-model="selectedProvider" class="form-select" popper-class="dark-select">
            <el-option
              v-for="p in providers"
              :key="p.key"
              :label="p.name + (p.implemented ? '' : '（即将支持）')"
              :value="p.key"
              :disabled="!p.implemented"
            />
          </el-select>
          <p class="form-hint">未实现的供应商暂时不可用</p>
        </div>

        <div class="form-group">
          <label class="form-label">模型</label>
          <el-select v-model="selectedModel" class="form-select" popper-class="dark-select">
            <el-option
              v-for="m in availableModels"
              :key="m.key"
              :label="m.name + (m.free ? '（免费）' : '（付费）')"
              :value="m.key"
            />
          </el-select>
        </div>

        <div class="form-group">
          <label class="form-label">API Key</label>
          <el-input
            v-model="apiKey"
            :type="apiKeyVisible ? 'text' : 'password'"
            placeholder="请输入 API Key"
            class="form-input"
          >
            <template #suffix>
              <el-button
                text
                :icon="apiKeyVisible ? Hide : View"
                class="eye-btn"
                @click="apiKeyVisible = !apiKeyVisible"
              />
            </template>
          </el-input>
          <p class="form-hint">
            API Key 仅保存在本地数据库中，不会上传到任何服务器
          </p>
        </div>

        <div class="form-actions">
          <el-button type="primary" size="large" :loading="saving" @click="handleSave">
            保存设置
          </el-button>
        </div>
      </div>
    </main>
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

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #f3f4f6;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px;
}

.loading-wrap {
  max-width: 600px;
}

.settings-form {
  max-width: 560px;
}

.section-title {
  font-size: 20px;
  font-weight: 700;
  color: #f3f4f6;
  margin: 0 0 28px 0;
}

.form-group {
  margin-bottom: 24px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #e5e7eb;
  margin-bottom: 8px;
}

.form-select {
  width: 100%;
}

.form-input {
  width: 100%;
}

.form-input :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.form-input :deep(.el-input__inner) {
  color: #e5e7eb;
}

.form-input :deep(.el-input__inner::placeholder) {
  color: #6b7280;
}

.eye-btn {
  color: #9ca3af;
  padding: 4px;
}

.eye-btn:hover {
  color: #e5e7eb;
}

.form-hint {
  font-size: 12px;
  color: #6b7280;
  margin: 6px 0 0 0;
}

.form-actions {
  margin-top: 32px;
}
</style>

<style>
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

.dark-select .el-select-dropdown__item.is-disabled {
  color: #4b5563;
}
</style>
