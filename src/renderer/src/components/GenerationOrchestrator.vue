<script setup lang="ts">
/**
 * GenerationOrchestrator — 生成编排组件
 * 负责：AI 解析对话框 + 模型配置对话框 + 生成记录对话框 + 导出进度 + 批量生成对话框
 */
import { computed } from 'vue'
import { Minus, Plus } from '@element-plus/icons-vue'

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
  parseDialogVisible: boolean; parseMode: 'full' | 'append'; parseScriptText: string
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
  (e: 'gen-record-reload'): void; (e: 'gen-record-retry', record: any): void
  // AI 解析
  (e: 'update:parseDialogVisible', v: boolean): void; (e: 'update:parseScriptText', v: string): void
  (e: 'update:selectedTemplate', v: string): void; (e: 'update:selectedModel', v: string): void
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

// 模型配置 8 个 Tab（与 Editor.vue modelConfigTabs 一致）
const configTabs = [
  { key: 'language_model', label: '语言模型' },
  { key: 'script_rewrite', label: '单分镜剧本改写' },
  { key: 'character_image', label: '角色生图模型' },
  { key: 'scene_image', label: '场景生图模型' },
  { key: 'prop_image', label: '道具生图模型' },
  { key: 'first_frame', label: '首帧生图模型' },
  { key: 'last_frame', label: '尾帧生图模型' },
  { key: 'video', label: '视频生成模型' },
]

const activeConfigTabKey = computed(() => configTabs[props.modelConfigTab]?.key || '')

// ===== 辅助函数 =====
const purposeLabels: Record<string, string> = {
  character_reference: '角色定妆照', scene_reference: '场景图', prop_reference: '道具图',
  first_frame: '首帧', last_frame: '尾帧', video: '视频', voice: '配音'
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
    image: ['character_reference', 'scene_reference', 'prop_reference', 'first_frame', 'last_frame'],
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
          <el-option label="首帧" value="first_frame" />
          <el-option label="尾帧" value="last_frame" />
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
                <span v-else-if="r.status !== 'failed'" class="action-placeholder">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <template #footer><el-button @click="emit('update:genRecordVisible', false)">关闭</el-button></template>
  </el-dialog>

  <!-- ====== AI 解析弹窗 ====== -->
  <el-dialog
    :model-value="parseDialogVisible" @update:model-value="(v: boolean) => emit('update:parseDialogVisible', v)"
    :title="parseMode === 'full' ? 'AI解析剧本' : '追加解析剧本'"
    width="720px" :close-on-click-modal="false" :autofocus="false" class="dark-dialog parse-dialog"
  >
    <div class="parse-tabs">
      <div class="parse-tab active">AI生成</div>
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
          <div v-for="s in stylePresets" :key="s.name" class="style-card compact"
            :class="{ active: selectedStyle === s.name }" @click="emit('show-message', 'info', '请先返回项目总览选择风格')">
            <div class="style-preview compact" :style="{ background: s.color }" />
            <span class="style-name compact">{{ s.name }}</span>
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
          <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id" />
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
        <div v-for="s in parseProgressSteps" :key="s.step" class="progress-item" :class="s.status">
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
      <el-button :disabled="parseGenerating" @click="emit('parse-skip')">暂时跳过</el-button>
      <el-button type="primary" :loading="parseGenerating" :disabled="parseGenerating" @click="emit('parse-submit', parseMode, parseScriptText, selectedTemplate, selectedModel)">
        一键生成分镜</el-button>
    </template>
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
      <el-button @click="emit('model-config-save')">保存</el-button>
    </template>
  </el-dialog>

  <!-- ====== 导出进度弹窗 ====== -->
  <el-dialog :model-value="exportProgressVisible" @update:model-value="(v: boolean) => emit('update:exportProgressVisible', v)"
    title="正在导出" width="400px" class="dark-dialog export-progress-dialog" :close-on-click-modal="false" :show-close="false">
    <div class="export-progress-body">
      <p class="export-progress-msg">{{ exportProgressMsg }}</p>
      <el-progress :percentage="Math.round((exportProgressCurrent / Math.max(1, exportProgressTotal)) * 100)" :stroke-width="10" class="export-progress-bar" />
      <p class="export-progress-count">{{ exportProgressCurrent }} / {{ exportProgressTotal }}</p>
    </div>
  </el-dialog>

  <!-- ====== 批量操作弹窗 ====== -->
  <el-dialog
    :model-value="batchDialogVisible" @update:model-value="(v: boolean) => emit('update:batchDialogVisible', v)"
    :title="batchType === '人物' ? '批量生成角色' : batchType === '场景' ? '批量生成场景' : batchType === '道具' ? '批量生成道具' : '批量生成'"
    width="480px" class="dark-dialog batch-dialog"
  >
    <div class="batch-body">
      <div class="batch-stat">
        <template v-if="batchMode === 'asset'">
          <span class="batch-stat-label">共</span>
          <span class="batch-stat-value">{{ batchTotalAssets }}</span>
          <span class="batch-stat-label">个{{ batchType === '人物' ? '角色' : batchType === '场景' ? '场景' : '道具' }}</span>
        </template>
        <template v-else>
          <span class="batch-stat-label">已选中</span>
          <span class="batch-stat-value">{{ selectedShots?.size || 0 }}</span>
          <span class="batch-stat-label">个分镜</span>
        </template>
      </div>
      <div class="batch-stat">
        <span class="batch-stat-label">其中</span>
        <span class="batch-stat-value" :class="{ zero: batchMissingCount === 0 }">{{ batchMissingCount }}</span>
        <span class="batch-stat-label">个缺失</span>
      </div>
      <div class="batch-count-row">
        <span class="batch-count-label">生成次数</span>
        <div class="batch-count-control">
          <el-button text size="small" :icon="Minus" @click="emit('update:batchCount', Math.max(1, batchCount - 1))" />
          <span class="batch-count-num">{{ batchCount }}</span>
          <el-button text size="small" :icon="Plus" @click="emit('update:batchCount', Math.min(10, batchCount + 1))" />
        </div>
      </div>
      <div class="batch-actions">
        <el-button type="primary" @click="emit('batch-submit', 'all')">全部生成</el-button>
        <el-button :disabled="batchMissingCount === 0" :class="{ 'batch-missing-disabled': batchMissingCount === 0 }" @click="emit('batch-submit', 'missing')">缺失生成</el-button>
      </div>
      <div v-if="Object.keys(batchProgress).length > 0" class="batch-progress">
        <el-progress :percentage="Math.round((Object.values(batchProgress)[0]?.current || 0) / Math.max(1, (Object.values(batchProgress)[0]?.total || 0)) * 100)" :stroke-width="8" class="batch-progress-bar" />
        <span class="batch-progress-text">{{ Object.values(batchProgress)[0]?.current || 0 }} / {{ Object.values(batchProgress)[0]?.total || 0 }}</span>
      </div>
      <div class="batch-hint">批量执行任务前，请先调试效果至符合预期后再执行</div>
    </div>
  </el-dialog>
</template>

<style scoped>
.record-filters { display: flex; gap: 8px; margin-bottom: 12px; }
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
.parse-controls { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
.parse-progress { margin-top: 16px; }
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
.step-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; color: #ccc; }
.step-dot { width: 8px; height: 8px; border-radius: 50%; background: #666; }
.step-dot.running { background: #409eff; animation: pulse 1.5s infinite; }
.step-dot.done { background: #67c23a; }
.step-dot.error { background: #f56c6c; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
/* ===== 模型配置 ===== */
.model-config-body { display: flex; flex-direction: column; gap: 12px; }
.model-config-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.model-config-mode { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.mode-label { font-size: 12px; color: #999; }
.model-config-layout { display: flex; gap: 16px; }
.model-config-tabs { display: flex; flex-direction: column; gap: 2px; min-width: 140px; }
.model-config-tab { padding: 8px 12px; font-size: 13px; color: #9ca3af; cursor: pointer; border-radius: 6px; transition: all .2s; }
.model-config-tab:hover { color: #e5e7eb; background: rgba(255,255,255,.04); }
.model-config-tab.active { color: #fff; background: rgba(167,139,250,.15); font-weight: 500; }
.model-config-content { flex: 1; display: flex; flex-direction: column; gap: 16px; }
.config-section { display: flex; flex-direction: column; gap: 8px; }
.config-section-title { font-size: 13px; color: #999; font-weight: 500; }
.config-row { display: flex; align-items: center; gap: 12px; }
.config-row label { font-size: 13px; color: #999; width: 70px; flex-shrink: 0; }
.ref-image-area { margin-top: 4px; }
.ref-image-placeholder { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px; border: 1px dashed #444; border-radius: 8px; cursor: pointer; color: #666; }
.ref-image-placeholder:hover { border-color: #409eff; color: #409eff; }
.ref-image-preview { position: relative; }
.ref-image-preview img { width: 100%; max-height: 160px; object-fit: contain; border-radius: 4px; }
.ref-image-remove { position: absolute; top: 4px; right: 4px; }
.config-template-section { display: flex; flex-direction: column; gap: 8px; }
.config-template-tabs { display: flex; gap: 4px; }
.config-template-tab { padding: 4px 12px; font-size: 12px; color: #9ca3af; cursor: pointer; border-radius: 4px; }
.config-template-tab.active { color: #fff; background: rgba(167,139,250,.15); }
.config-template-list { max-height: 120px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 4px; }
.config-template-item { padding: 4px 10px; font-size: 12px; color: #9ca3af; cursor: pointer; border-radius: 4px; border: 1px solid transparent; }
.config-template-item:hover { border-color: #409eff; }
.config-template-item.active { color: #fff; background: rgba(64,158,255,.15); border-color: #409eff; }
.config-template-empty { color: #666; font-size: 12px; }
.config-template-preview { margin-top: 4px; }
.config-fields { display: flex; flex-direction: column; gap: 16px; margin-top: 12px; }
.config-fields label { font-size: 13px; color: #999; }
/* ===== 批量生成 ===== */
.batch-body { display: flex; flex-direction: column; gap: 12px; }
.batch-stat { font-size: 14px; }
.batch-stat-label { color: #999; }
.batch-stat-value { color: #e0a040; font-size: 20px; font-weight: 600; margin: 0 4px; }
.batch-stat-value.zero { color: #67c23a; }
.batch-count-row { display: flex; align-items: center; gap: 12px; }
.batch-count-label { color: #999; font-size: 13px; }
.batch-count-control { display: flex; align-items: center; gap: 8px; }
.batch-count-num { font-size: 18px; font-weight: 600; min-width: 24px; text-align: center; }
.batch-actions { display: flex; gap: 12px; margin-top: 4px; }
.batch-missing-disabled { opacity: .4; }
.batch-progress { display: flex; align-items: center; gap: 12px; }
.batch-progress-bar { flex: 1; }
.batch-progress-text { font-size: 12px; color: #999; }
.batch-hint { font-size: 12px; color: #666; margin-top: 8px; }

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
