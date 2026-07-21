<script setup lang="ts">
/**
 * GenerationOrchestrator — 生成编排组件
 * 负责：AI 解析对话框 + 模型配置对话框 + 生成记录对话框 + 导出进度 + 批量生成对话框
 */
import { computed } from 'vue'
import AiParseDialog from './AiParseDialog.vue'
import BatchOperationDialog from './BatchOperationDialog.vue'
import ModelConfigDialog from './ModelConfigDialog.vue'

// ===== Props：父组件 (Editor.vue) 单向注入 =====
const props = defineProps<{
  projectId: string
  projectData: any
  // 共享数据
  stylePresets: any[]
  aspectRatios: any[]
  selectedStyle: string
  selectedAspectRatio: string
  selectedShots: Set<string>
  // 模型列表 (AI解析 + 模型配置共享)
  providerModels: any[]
  providerChannels: any[]
  textProviderModels: any[]
  // 生成记录对话框
  genRecordVisible: boolean; genRecords: any[]
  genRecordTab: string; genRecordStatusFilter: string; genRecordTypeFilter: string
  // AI 解析对话框
  parseDialogVisible: boolean; parseMode: 'full' | 'append'; parseEngine: 'standard' | 'seedance'; parseScriptText: string
  selectedTemplate: string; templatePreview: string; selectedModel: string
  parseGenerating: boolean; parseProgressSteps: any[]
  templates: any[]
  // 模型配置对话框
  modelConfigVisible: boolean; modelConfigTab: number; modelConfigMode: string
  modelConfig: Record<string, any>; modelConfigTemplates: any[]
  modelConfigRefImages: Record<string, string>
  modelConfigTemplateTab: string
  // 导出进度
  exportProgressVisible: boolean; exportProgressCurrent: number
  exportProgressTotal: number; exportProgressMsg: string
  // 批量生成
  batchDialogVisible: boolean; batchType: string; batchMode: 'asset' | 'shot'
  batchCount: number; batchTotalAssets: number; batchMissingCount: number
  batchProgress: Record<string, { current: number; total: number }>; batchCancelled: boolean
  // 嵌套需要用
  filteredConfigModels: any[]; filteredConfigChannels: any[]
  scriptCharCount: number
}>()

// ===== Emits：子组件 → 父组件 =====
const emit = defineEmits<{
  // 通用
  (e: 'show-message', type: 'success' | 'error' | 'warning' | 'info', msg: string): void
  (e: 'refresh-data'): void
  // 生成记录
  (e: 'update:genRecordVisible', v: boolean): void; (e: 'update:genRecordTab', v: string): void
  (e: 'update:genRecordStatusFilter', v: string): void; (e: 'update:genRecordTypeFilter', v: string): void
  (e: 'gen-record-reload'): void; (e: 'gen-record-retry', record: any): void; (e: 'gen-record-delete', taskId: string): void
  // AI 解析
  (e: 'update:parseDialogVisible', v: boolean): void; (e: 'update:parseScriptText', v: string): void
  (e: 'update:selectedTemplate', v: string): void; (e: 'update:selectedModel', v: string): void
  (e: 'update:parseEngine', v: 'standard' | 'seedance'): void
  (e: 'parse-load-templates'): void; (e: 'parse-template-change', id: string): void
  (e: 'parse-submit', mode: 'full' | 'append', script: string, templateId: string, model: string): void
  (e: 'parse-skip'): void
  // 模型配置
  (e: 'update:modelConfigVisible', v: boolean): void; (e: 'update:modelConfigTab', v: number): void
  (e: 'update:modelConfig', config: Record<string, any>): void
  (e: 'update:modelConfigRefImages', v: Record<string, string>): void
  (e: 'model-config-save'): void; (e: 'model-config-load-templates'): void
  (e: 'model-config-select-ref-image'): void; (e: 'model-config-remove-ref-image'): void
  (e: 'model-config-model-change', tabKey: string, val: string): void
  (e: 'model-config-channel-change', tabKey: string, val: string): void
  (e: 'model-config-set-field', key: string, field: string, value: any): void
  // 导出
  (e: 'update:exportProgressVisible', v: boolean): void
  (e: 'export-video'): void; (e: 'export-concat'): void; (e: 'export-pdf'): void
  // 批量生成
  (e: 'update:batchDialogVisible', v: boolean): void; (e: 'update:batchCount', v: number): void
  (e: 'batch-scan', type: string, mode: 'asset' | 'shot'): void
  (e: 'batch-submit', mode: 'all' | 'missing'): void; (e: 'batch-cancel'): void
}>()

// ===== 辅助函数 =====
const purposeLabels: Record<string, string> = {
  character_reference: '角色定妆照', scene_reference: '场景图', prop_reference: '道具图',
  grid_storyboard: '故事板', video: '视频', voice: '配音'
}
function statusLabel(s: string): string {
  const map: Record<string, string> = { pending: '排队中', running: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消' }
  return map[s] || s
}
function purposeLabel(p: string): string { return purposeLabels[p] || p }
function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function formatWaitTime(r: any): string {
  if (r.status === 'pending' || r.status === 'completed' || r.status === 'failed') return '-'
  if (!r.started_at || !r.created_at) return '-'
  const ms = r.started_at - r.created_at; if (ms < 0) return '-'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分${sec % 60}秒`
  return `${Math.floor(min / 60)}时${min % 60}分`
}
function getShotDesc(shotId: string | null): string {
  if (!shotId) return '项目全局'
  const shot = props.projectData?.shots?.find((s: any) => s.id === shotId)
  if (shot?.description) {
    const desc = shot.description.replace(/\n/g, ' ')
    return desc.length > 20 ? desc.slice(0, 20) + '…' : desc
  }
  return `分镜 ${shotId.slice(0, 6)}…`
}

// 过滤计算
const filteredRecords = computed(() => {
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  const tabPurposeMap: Record<string, string[]> = {
    video: ['video'],
    image: ['character_reference', 'scene_reference', 'prop_reference', 'grid_storyboard'],
    other: ['voice']
  }
  const allowedPurposes = tabPurposeMap[props.genRecordTab] || []
  return props.genRecords.filter((r: any) => {
    if (!r.created_at || r.created_at < sevenDaysAgo) return false
    if (!allowedPurposes.includes(r.purpose)) return false
    if (props.genRecordStatusFilter !== 'all' && r.status !== props.genRecordStatusFilter) return false
    if (props.genRecordTab === 'image' && props.genRecordTypeFilter !== 'all' && r.purpose !== props.genRecordTypeFilter) return false
    return true
  })
})
</script>

<template>
  <!-- ====== 生成记录弹窗 ====== -->
  <el-dialog
    :model-value="genRecordVisible"
    @update:model-value="(v: boolean) => emit('update:genRecordVisible', v)"
    title="生成记录" width="860px" class="dark-dialog gen-record-dialog" :close-on-click-modal="true"
  >
    <div class="gen-record-body">
      <div class="gen-record-tabs">
        <div class="gen-record-tab" :class="{ active: genRecordTab === 'video' }" @click="emit('update:genRecordTab', 'video')">视频</div>
        <div class="gen-record-tab" :class="{ active: genRecordTab === 'image' }" @click="emit('update:genRecordTab', 'image')">图片</div>
        <div class="gen-record-tab" :class="{ active: genRecordTab === 'other' }" @click="emit('update:genRecordTab', 'other')">其他</div>
        <div class="gen-record-tab-spacer" />
        <el-button size="small" type="danger" class="gen-record-stop-btn"
          :disabled="!genRecords.some((r: any) => ['pending', 'running'].includes(r.status))"
          @click="emit('batch-cancel')">全部停止</el-button>
      </div>
      <div class="gen-record-filters">
        <div class="gen-record-status-filters">
          <span v-for="s in [{k:'all',l:'全部'},{k:'pending',l:'排队中'},{k:'running',l:'生成中'},{k:'completed',l:'完成'},{k:'failed',l:'失败'},{k:'cancelled',l:'已取消'}]" :key="s.k"
            class="gen-record-filter-btn" :class="{ active: genRecordStatusFilter === s.k }"
            @click="emit('update:genRecordStatusFilter', s.k)">{{ s.l }}</span>
        </div>
        <el-select v-if="genRecordTab === 'image'" :model-value="genRecordTypeFilter"
          @update:model-value="(v: string) => emit('update:genRecordTypeFilter', v)" size="small" class="gen-record-type-select dark-select">
          <el-option label="全部类型" value="all" />
          <el-option label="角色定妆照" value="character_reference" />
          <el-option label="场景图" value="scene_reference" />
          <el-option label="道具图" value="prop_reference" />
        </el-select>
      </div>
      <div class="gen-record-table-wrap">
        <div v-if="!filteredRecords.length" class="gen-record-empty">暂无生成记录</div>
        <table v-else class="gen-record-table">
          <thead><tr>
            <th class="col-num">编号</th><th class="col-shot">所属分镜/素材</th><th class="col-type">类型</th>
            <th class="col-model">模型</th><th class="col-channel">渠道</th><th class="col-time">创建时间</th>
            <th class="col-wait">等待时间</th><th class="col-status">状态</th><th class="col-action">操作</th>
          </tr></thead>
          <tbody>
            <tr v-for="(r, idx) in filteredRecords" :key="r.id" class="gen-record-row" :class="{ failed: r.status === 'failed' }">
              <td class="col-num">{{ idx + 1 }}</td>
              <td class="col-shot" :title="getShotDesc(r.shot_id)">{{ getShotDesc(r.shot_id) }}</td>
              <td class="col-type">{{ purposeLabel(r.purpose) }}</td>
              <td class="col-model">{{ r.model || '-' }}</td>
              <td class="col-channel">{{ r.channel || '-' }}</td>
              <td class="col-time">{{ formatTime(r.created_at) }}</td>
              <td class="col-wait">{{ formatWaitTime(r) }}</td>
              <td class="col-status">
                <span class="gen-record-status-tag" :class="r.status">
                  <template v-if="r.status === 'pending' || r.status === 'running'">🔄</template>
                  <template v-if="r.status === 'completed'">✅</template>
                  <template v-if="r.status === 'failed'">❌</template>
                  <template v-if="r.status === 'cancelled'">⛔</template>
                  {{ statusLabel(r.status) }}
                </span>
              </td>
              <td class="col-action">
                <el-button v-if="r.status === 'failed'" text size="small" type="primary" @click="emit('gen-record-retry', r)">重试</el-button>
                <el-tooltip v-if="r.error_message" :content="r.error_message" placement="top" :show-after="200">
                  <el-button text size="small">详情</el-button>
                </el-tooltip>
                <el-button text size="small" type="danger" @click="emit('gen-record-delete', r.id)">删除</el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <template #footer><el-button @click="emit('update:genRecordVisible', false)">关闭</el-button></template>
  </el-dialog>

  <AiParseDialog
    :parse-dialog-visible="parseDialogVisible"
    :parse-mode="parseMode"
    :parse-engine="parseEngine"
    :parse-script-text="parseScriptText"
    :selected-template="selectedTemplate"
    :template-preview="templatePreview"
    :selected-model="selectedModel"
    :parse-generating="parseGenerating"
    :parse-progress-steps="parseProgressSteps"
    :templates="templates"
    :style-presets="stylePresets"
    :aspect-ratios="aspectRatios"
    :selected-style="selectedStyle"
    :selected-aspect-ratio="selectedAspectRatio"
    :text-provider-models="textProviderModels"
    :script-char-count="scriptCharCount"
    @update:parse-dialog-visible="(v: boolean) => emit('update:parseDialogVisible', v)"
    @update:parse-script-text="(v: string) => emit('update:parseScriptText', v)"
    @update:selected-template="(v: string) => emit('update:selectedTemplate', v)"
    @update:selected-model="(v: string) => emit('update:selectedModel', v)"
    @parse-submit="(mode: 'full' | 'append', script: string, templateId: string, model: string) => emit('parse-submit', mode, script, templateId, model)"
    @update:parse-engine="(v: 'standard' | 'seedance') => emit('update:parseEngine', v)"
    @parse-skip="emit('parse-skip')"
    @parse-template-change="(id: string) => emit('parse-template-change', id)"
    @show-message="(type: 'success' | 'error' | 'warning' | 'info', msg: string) => emit('show-message', type, msg)"
  />

  <ModelConfigDialog
    :model-config-visible="modelConfigVisible"
    :model-config-tab="modelConfigTab"
    :model-config="modelConfig"
    :provider-models="providerModels"
    @update:model-config-visible="(v: boolean) => emit('update:modelConfigVisible', v)"
    @update:model-config-tab="(v: number) => emit('update:modelConfigTab', v)"
    @model-config-model-change="(tabKey: string, val: string) => emit('model-config-model-change', tabKey, val)"
    @model-config-save="emit('model-config-save')"
  />

  <!-- ====== 导出进度弹窗 ====== -->
  <el-dialog :model-value="exportProgressVisible" @update:model-value="(v: boolean) => emit('update:exportProgressVisible', v)"
    title="正在导出" width="400px" class="dark-dialog export-progress-dialog" :close-on-click-modal="false" :show-close="false">
    <div class="export-progress-body">
      <p class="export-progress-msg">{{ exportProgressMsg }}</p>
      <el-progress :percentage="Math.round((exportProgressCurrent / Math.max(1, exportProgressTotal)) * 100)" :stroke-width="10" class="export-progress-bar" />
      <p class="export-progress-count">{{ exportProgressCurrent }} / {{ exportProgressTotal }}</p>
    </div>
  </el-dialog>

  <BatchOperationDialog
    :batch-dialog-visible="batchDialogVisible"
    :batch-type="batchType"
    :batch-mode="batchMode"
    :batch-count="batchCount"
    :batch-total-assets="batchTotalAssets"
    :batch-missing-count="batchMissingCount"
    :batch-progress="batchProgress"
    :selected-shots="selectedShots"
    @update:batch-dialog-visible="(v: boolean) => emit('update:batchDialogVisible', v)"
    @update:batch-count="(v: number) => emit('update:batchCount', v)"
    @batch-submit="(mode: 'all' | 'missing') => emit('batch-submit', mode)"
  />
</template>

<style scoped>
.record-filters { display: flex; gap: 8px; margin-bottom: 12px; }
/* ===== 模型配置样式 → 已迁移至 ModelConfigDialog.vue ===== */


/* ===== 生成记录 ===== */
.gen-record-body { display: flex; flex-direction: column; gap: 12px; }
.gen-record-tabs { display: flex; gap: 4px; border-bottom: 1px solid rgba(255,255,255,.06); padding-bottom: 8px; align-items: center; }
.gen-record-tab-spacer { flex: 1; }
.gen-record-stop-btn { font-size: 12px; padding: 5px 12px; }
.gen-record-tab { padding: 6px 16px; font-size: 13px; color: #9ca3af; cursor: pointer; border-radius: 6px; transition: all .2s; }
.gen-record-tab:hover { color: #e5e7eb; background: rgba(255,255,255,.04); }
.gen-record-tab.active { color: #fff; background: rgba(167,139,250,.15); font-weight: 500; }
.gen-record-filters { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gen-record-status-filters { display: flex; gap: 4px; }
.gen-record-filter-btn { padding: 4px 12px; font-size: 12px; color: #9ca3af; cursor: pointer; border-radius: 4px; transition: all .2s; }
.gen-record-filter-btn:hover { color: #e5e7eb; background: rgba(255,255,255,.06); }
.gen-record-filter-btn.active { color: #fff; background: rgba(167,139,250,.2); }
.gen-record-type-select { width: 140px; }
.gen-record-table-wrap { max-height: 360px; overflow-y: auto; }
.gen-record-empty { text-align: center; padding: 40px 0; color: #666; font-size: 14px; }
.gen-record-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.gen-record-table thead { position: sticky; top: 0; z-index: 1; }
.gen-record-table th { background: #252545; color: #aaa; padding: 8px 6px; text-align: left; border-bottom: 1px solid #2a2a3e; }
.gen-record-table td { padding: 6px; border-bottom: 1px solid #1e1e30; color: #ccc; }
.gen-record-row:hover { background: #252540; }
.gen-record-row.failed:hover { background: #3a2020; }
.gen-record-status-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
.gen-record-status-tag.pending { color: #e0a040; }
.gen-record-status-tag.running { color: #409eff; }
.gen-record-status-tag.completed { color: #67c23a; }
.gen-record-status-tag.failed { color: #f56c6c; }
.gen-record-status-tag.cancelled { color: #999; }
.action-placeholder { color: #666; }

/* ===== 导出进度 ===== */
.export-progress-body { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px 0; }
.export-progress-msg { color: #ccc; font-size: 14px; }
.export-progress-count { color: #666; font-size: 12px; }
.export-progress-bar { width: 100%; }
.export-progress-bar .el-progress-bar__outer { background: #1a1a3e; }
.export-progress-bar .el-progress-bar__inner { background: linear-gradient(90deg, #409eff, #67c23a); }
.export-progress-bar .el-progress__text { color: #ccc !important; }
</style>
