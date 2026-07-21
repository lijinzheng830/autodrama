<script setup lang="ts">
/**
 * AiParseDialog — AI 解析剧本对话框
 * 负责剧本粘贴、风格/比例/模板/模型选择、解析进度展示
 */
defineProps<{
  parseDialogVisible: boolean
  parseMode: 'full' | 'append'
  parseEngine: 'standard' | 'seedance'
  parseScriptText: string
  selectedTemplate: string
  templatePreview: string
  selectedModel: string
  parseGenerating: boolean
  parseProgressSteps: Record<string, unknown>[]
  templates: Record<string, unknown>[]
  stylePresets: Record<string, unknown>[]
  aspectRatios: Array<{ label: string; value: string }>
  selectedStyle: string
  selectedAspectRatio: string
  textProviderModels: Array<{ label: string; value: string }>
  scriptCharCount: number
}>()

const emit = defineEmits<{
  (e: 'update:parseDialogVisible', v: boolean): void
  (e: 'update:parseScriptText', v: string): void
  (e: 'update:selectedTemplate', v: string): void
  (e: 'update:selectedModel', v: string): void
  (e: 'update:parseEngine', v: 'standard' | 'seedance'): void
  (e: 'parse-submit', mode: 'full' | 'append', script: string, templateId: string, model: string): void
  (e: 'parse-skip'): void
  (e: 'parse-template-change', id: string): void
  (e: 'show-message', type: 'success' | 'error' | 'warning' | 'info', msg: string): void
}>()
</script>

<template>
  <!-- ====== AI 解析弹窗 ====== -->
  <el-dialog
    :model-value="parseDialogVisible" @update:model-value="(v: boolean) => emit('update:parseDialogVisible', v)"
    :title="parseMode === 'full' ? 'AI解析剧本' : '追加解析剧本'"
    width="720px" :close-on-click-modal="false" :autofocus="false" class="dark-dialog parse-dialog"
  >
    <div class="parse-tabs">
      <div class="parse-tab" :class="{ active: parseEngine === 'standard' }" @click="emit('update:parseEngine', 'standard')">标准模式</div>
      <div class="parse-tab" :class="{ active: parseEngine === 'seedance' }" @click="emit('update:parseEngine', 'seedance')">Seedance 九宫格</div>
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
        <el-input :model-value="parseScriptText" @update:model-value="(v: string) => emit('update:parseScriptText', v)"
          type="textarea" :rows="10" placeholder="在此粘贴剧本内容..." resize="none" :disabled="parseGenerating" />
      </div>
      <div class="parse-section compact">
        <span class="parse-section-title">画面风格</span>
        <div class="style-grid compact">
          <div v-for="s in stylePresets" :key="(s as any).name" class="style-card compact"
            :class="{ active: selectedStyle === (s as any).name }" @click="emit('show-message', 'info', '请先返回项目总览选择风格')">
            <div class="style-preview compact" :style="{ background: (s as any).color }" />
            <span class="style-name compact">{{ (s as any).name }}</span>
          </div>
        </div>
      </div>
      <div class="parse-section compact">
        <span class="parse-section-title">画面比例</span>
        <div class="ratio-group compact">
          <div v-for="r in aspectRatios" :key="r.value" class="ratio-card compact"
            :class="{ active: selectedAspectRatio === r.value }" @click="emit('show-message', 'info', '请先返回项目总览选择比例')">
            <div class="ratio-icon compact" :class="'_' + r.value.replace(':', '_')" />
            <span class="ratio-label">{{ r.label }}</span>
          </div>
        </div>
      </div>
      <div class="parse-section compact">
        <span class="parse-section-title">提示词模板</span>
        <el-select :model-value="selectedTemplate" @update:model-value="(v: string) => emit('update:selectedTemplate', v)"
          style="width:100%" :disabled="parseGenerating" @change="(v: string) => emit('parse-template-change', v)">
          <el-option v-for="t in templates" :key="(t as any).id" :label="(t as any).name" :value="(t as any).id" />
        </el-select>
        <div v-if="templatePreview" class="template-preview">{{ templatePreview }}</div>
      </div>
      <div class="parse-section compact">
        <span class="parse-section-title">语言模型</span>
        <el-select :model-value="selectedModel" @update:model-value="(v: string) => emit('update:selectedModel', v)"
          style="width:100%" :disabled="parseGenerating" :teleported="false" placeholder="请选择语言模型">
          <el-option v-for="m in textProviderModels" :key="m.value" :label="m.label" :value="m.value" />
        </el-select>
      </div>
      <div v-if="parseGenerating" class="parse-progress">
        <div v-for="s in parseProgressSteps" :key="(s as any).step" class="progress-item" :class="(s as any).status">
          <span class="progress-icon">
            <span v-if="(s as any).status === 'done'">✅</span>
            <span v-else-if="(s as any).status === 'running'" class="spin">🔄</span>
            <span v-else-if="(s as any).status === 'error'">❌</span>
            <span v-else>⏳</span>
          </span>
          <span class="progress-text">步骤{{ (s as any).step }}：{{ (s as any).message }}</span>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button :disabled="parseGenerating" @click="emit('parse-skip')">暂时跳过</el-button>
      <el-button type="primary" :loading="parseGenerating" :disabled="parseGenerating" @click="emit('parse-submit', parseMode, parseScriptText, selectedTemplate, selectedModel)">
        一键生成分镜</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ===== 解析对话框 ===== */
.parse-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.parse-tab { padding: 6px 16px; font-size: 13px; color: #9ca3af; cursor: pointer; border-radius: 6px; transition: all .2s; }
.parse-tab.active { color: #fff; background: rgba(167,139,250,.15); font-weight: 500; }
.parse-tab.disabled { color: #555; cursor: not-allowed; }
.parse-body { display: flex; flex-direction: column; gap: 12px; }
.parse-section { display: flex; flex-direction: column; gap: 8px; }
.parse-section.compact { gap: 6px; }
.parse-section-header { display: flex; align-items: center; justify-content: space-between; }
.parse-section-title { font-size: 13px; color: #999; font-weight: 500; }
.char-count { font-size: 12px; color: #9ca3af; }
.char-count.warning { color: #f59e0b; }
.template-preview { max-height: 120px; overflow-y: auto; margin-top: 8px; padding: 10px; background: rgba(255,255,255,.03); border-radius: 4px; font-size: 12px; color: #9ca3af; white-space: pre-wrap; }
.style-grid.compact { display: flex; gap: 6px; overflow-x: auto; }
.style-card.compact { cursor: pointer; border-radius: 6px; padding: 6px; text-align: center; min-width: 64px; border: 1px solid transparent; }
.style-card.compact.active { border-color: #a78bfa; }
.style-preview.compact { width: 48px; height: 48px; border-radius: 4px; margin: 0 auto 2px; }
.style-name.compact { font-size: 10px; color: #9ca3af; }
.ratio-group.compact { display: flex; gap: 6px; }
.ratio-card.compact { cursor: pointer; border-radius: 6px; padding: 6px; text-align: center; min-width: 64px; border: 1px solid transparent; }
.ratio-card.compact.active { border-color: #a78bfa; }
.ratio-icon.compact { width: 48px; height: 32px; background: rgba(255,255,255,.06); border-radius: 4px; margin: 0 auto 2px; }
.ratio-label { font-size: 11px; color: #9ca3af; }
.progress-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; color: #ccc; }
.progress-item.done { color: #67c23a; }
.progress-item.running { color: #409eff; }
.progress-item.error { color: #f56c6c; }
.progress-icon { font-size: 16px; width: 24px; text-align: center; }
.progress-text { flex: 1; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.spin { display: inline-block; animation: spin 2s linear infinite; }
</style>
