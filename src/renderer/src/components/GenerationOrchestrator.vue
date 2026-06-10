<script setup lang="ts">
/**
 * GenerationOrchestrator — 生成编排组件
 * 负责：AI 解析对话框 + 模型配置对话框 + 生成记录对话框 + 导出进度 + 批量生成对话框
 */
import { computed } from 'vue'

const props = defineProps<{
  projectId: string
  projectData: any
  stylePresets: any[]
  aspectRatios: any[]
  providerModels: any[]
  providerChannels: any[]
  templates: any[]
  textProviderModels: any[]
  genRecordVisible: boolean
  genRecords: any[]
  genRecordTab: 'video' | 'image' | 'other'
  genRecordStatusFilter: string
  genRecordTypeFilter: string
  parseDialogVisible: boolean
  parseMode: 'full' | 'append'
  parseScriptText: string
  selectedTemplate: string
  selectedModel: string
  parseGenerating: boolean
  parseProgressSteps: any[]
  modelConfigVisible: boolean
  modelConfigTab: number
  modelConfig: Record<string, any>
  modelConfigTemplates: any[]
  modelConfigRefImages: Record<string, string>
  exportProgressVisible: boolean
  exportProgressCurrent: number
  exportProgressTotal: number
  exportProgressMsg: string
  batchDialogVisible: boolean
  batchType: string
  batchMode: 'asset' | 'shot'
  batchCount: number
  batchTotalAssets: number
  batchMissingCount: number
  batchProgress: Record<string, { current: number; total: number }>
  batchCancelled: boolean
}>()

const emit = defineEmits<{
  (e: 'update:genRecordVisible', val: boolean): void
  (e: 'update:genRecordTab', val: 'video' | 'image' | 'other'): void
  (e: 'update:genRecordStatusFilter', val: string): void
  (e: 'update:genRecordTypeFilter', val: string): void
  (e: 'update:parseDialogVisible', val: boolean): void
  (e: 'update:parseScriptText', val: string): void
  (e: 'update:selectedTemplate', val: string): void
  (e: 'update:selectedModel', val: string): void
  (e: 'update:modelConfigVisible', val: boolean): void
  (e: 'update:modelConfigTab', val: number): void
  (e: 'update:modelConfig', val: Record<string, any>): void
  (e: 'update:modelConfigRefImages', val: Record<string, string>): void
  (e: 'update:exportProgressVisible', val: boolean): void
  (e: 'update:batchDialogVisible', val: boolean): void
  (e: 'update:batchCount', val: number): void
  (e: 'refresh-data'): void
  (e: 'run-parse', script: string, options: any): void
  (e: 'save-model-config', config: Record<string, any>): void
  (e: 'retry-task', record: any): void
  (e: 'cancel-batch'): void
  (e: 'start-batch', type: string, mode: string): void
  (e: 'show-message', type: string, msg: string): void
}>()

// Config tab keys
const configTabs = [
  { key: 'script_parse', label: '剧本解析' },
  { key: 'character_image', label: '角色生图' },
  { key: 'scene_image', label: '场景生图' },
  { key: 'prop_image', label: '道具生图' },
  { key: 'first_frame', label: '首帧' },
  { key: 'last_frame', label: '尾帧' },
  { key: 'video', label: '视频' },
]

const activeConfigTabKey = computed(() => configTabs[props.modelConfigTab]?.key || '')

// Filtered generation records
const filteredRecords = computed(() => {
  let records = props.genRecords
  if (props.genRecordStatusFilter !== 'all') {
    records = records.filter((r: any) => r.status === props.genRecordStatusFilter)
  }
  if (props.genRecordTypeFilter !== 'all') {
    records = records.filter((r: any) => r.purpose === props.genRecordTypeFilter)
  }
  return records
})

// Helper formatters
function statusLabel(s: string): string {
  const map: Record<string, string> = { pending: '等待中', running: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消' }
  return map[s] || s
}
function purposeLabel(p: string): string {
  const map: Record<string, string> = { character_reference: '角色定妆', scene_reference: '场景图', prop_reference: '道具图', first_frame: '首帧', last_frame: '尾帧', video: '视频' }
  return map[p] || p
}
</script>

<template>
  <!-- Generated records dialog -->
  <el-dialog :model-value="genRecordVisible" @update:model-value="(v: boolean) => emit('update:genRecordVisible', v)" title="生成记录" width="800px">
    <el-tabs :model-value="genRecordTab" @update:model-value="(v: string) => emit('update:genRecordTab', v as any)">
      <el-tab-pane label="视频" name="video" />
      <el-tab-pane label="图片" name="image" />
      <el-tab-pane label="其他" name="other" />
    </el-tabs>
    <div class="record-filters">
      <el-select :model-value="genRecordStatusFilter" @update:model-value="(v: string) => emit('update:genRecordStatusFilter', v)" size="small" style="width:100px">
        <el-option label="全部" value="all" />
        <el-option label="等待中" value="pending" />
        <el-option label="生成中" value="running" />
        <el-option label="已完成" value="completed" />
        <el-option label="失败" value="failed" />
      </el-select>
      <el-select :model-value="genRecordTypeFilter" @update:model-value="(v: string) => emit('update:genRecordTypeFilter', v)" size="small" style="width:120px" v-if="genRecordTab === 'image'">
        <el-option label="全部" value="all" />
        <el-option label="角色定妆" value="character_reference" />
        <el-option label="场景图" value="scene_reference" />
        <el-option label="道具图" value="prop_reference" />
        <el-option label="首帧" value="first_frame" />
        <el-option label="尾帧" value="last_frame" />
      </el-select>
    </div>
    <el-table :data="filteredRecords" size="small" max-height="400">
      <el-table-column prop="purpose" label="类型" width="100" :formatter="(_r: any, _c: any, v: string) => purposeLabel(v)" />
      <el-table-column prop="status" label="状态" width="80">
        <template #default="{ row }">{{ statusLabel(row.status) }}</template>
      </el-table-column>
      <el-table-column prop="model" label="模型" width="150" />
      <el-table-column prop="created_at" label="时间" width="160" />
      <el-table-column prop="error_message" label="错误" min-width="150" show-overflow-tooltip />
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button v-if="row.status === 'failed'" size="small" @click="emit('retry-task', row)">重试</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>

  <!-- AI Parse dialog -->
  <el-dialog :model-value="parseDialogVisible" @update:model-value="(v: boolean) => emit('update:parseDialogVisible', v)" title="AI 剧本解析" width="700px">
    <el-input :model-value="parseScriptText" @update:model-value="(v: string) => emit('update:parseScriptText', v)" type="textarea" :rows="10" placeholder="粘贴剧本内容..." />
    <div class="parse-controls">
      <el-select :model-value="selectedTemplate" @update:model-value="(v: string) => emit('update:selectedTemplate', v)" placeholder="选择模板" size="small" style="width:200px">
        <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id" />
      </el-select>
      <el-select :model-value="selectedModel" @update:model-value="(v: string) => emit('update:selectedModel', v)" placeholder="选择模型" size="small" style="width:200px">
        <el-option v-for="m in textProviderModels" :key="m.key || m.id" :label="m.name || m.key" :value="m.key || m.id" />
      </el-select>
      <el-button type="primary" :loading="parseGenerating" @click="emit('run-parse', parseScriptText, { mode: parseMode, template: selectedTemplate, model: selectedModel })">
        {{ parseMode === 'append' ? '追加解析' : '开始解析' }}
      </el-button>
    </div>
    <div v-if="parseProgressSteps.length > 0" class="parse-progress">
      <div v-for="step in parseProgressSteps" :key="step.step" class="step-item">
        <span :class="['step-dot', step.status]"></span>
        <span>{{ step.message }}</span>
      </div>
    </div>
  </el-dialog>

  <!-- Model config dialog -->
  <el-dialog :model-value="modelConfigVisible" @update:model-value="(v: boolean) => emit('update:modelConfigVisible', v)" title="模型配置" width="600px">
    <el-tabs :model-value="modelConfigTab" @update:model-value="(v: number) => emit('update:modelConfigTab', v)">
      <el-tab-pane v-for="(tab, idx) in configTabs" :key="tab.key" :label="tab.label" :name="idx" />
    </el-tabs>
    <div class="config-fields">
      <label>模型</label>
      <el-select :model-value="modelConfig[activeConfigTabKey]?.model || ''" @update:model-value="(v: string) => { const cfg = { ...modelConfig }; cfg[activeConfigTabKey] = { ...cfg[activeConfigTabKey], model: v }; emit('update:modelConfig', cfg) }" size="small" style="width:100%">
        <el-option v-for="m in providerModels" :key="m.key || m.id" :label="m.name || m.key" :value="`${m.channel || m.provider}:${m.key || m.id}`" />
      </el-select>
    </div>
    <template #footer>
      <el-button @click="emit('save-model-config', modelConfig)">保存</el-button>
    </template>
  </el-dialog>

  <!-- Export progress dialog -->
  <el-dialog :model-value="exportProgressVisible" @update:model-value="(v: boolean) => emit('update:exportProgressVisible', v)" title="导出中" width="400px" :close-on-click-modal="false">
    <el-progress :percentage="exportProgressTotal > 0 ? Math.round((exportProgressCurrent / exportProgressTotal) * 100) : 0" />
    <p style="color:#999;margin-top:8px">{{ exportProgressMsg }}</p>
  </el-dialog>

  <!-- Batch dialog -->
  <el-dialog :model-value="batchDialogVisible" @update:model-value="(v: boolean) => emit('update:batchDialogVisible', v)" title="批量生成" width="500px">
    <div class="batch-stats">
      <p>类型：{{ batchType }}</p>
      <p>总计：{{ batchTotalAssets }} 项，缺失 {{ batchMissingCount }} 项</p>
      <el-input-number :model-value="batchCount" @update:model-value="(v: number) => emit('update:batchCount', v)" :min="1" :max="4" />
    </div>
    <div v-if="Object.keys(batchProgress).length > 0" class="batch-progress-list">
      <div v-for="(progress, key) in batchProgress" :key="key">
        <span>{{ key }}</span>
        <el-progress :percentage="progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0" />
      </div>
    </div>
    <template #footer>
      <el-button @click="emit('cancel-batch')" :disabled="batchCancelled">取消</el-button>
      <el-button type="primary" @click="emit('start-batch', batchType, batchMode)">开始生成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.record-filters { display: flex; gap: 8px; margin-bottom: 12px; }
.parse-controls { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
.parse-progress { margin-top: 16px; }
.step-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; color: #ccc; }
.step-dot { width: 8px; height: 8px; border-radius: 50%; background: #666; }
.step-dot.running { background: #409eff; animation: pulse 1.5s infinite; }
.step-dot.done { background: #67c23a; }
.step-dot.error { background: #f56c6c; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.config-fields { display: flex; flex-direction: column; gap: 16px; margin-top: 12px; }
.config-fields label { font-size: 13px; color: #999; }
.batch-stats { display: flex; flex-direction: column; gap: 8px; }
.batch-progress-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
</style>
