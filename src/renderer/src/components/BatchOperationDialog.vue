<script setup lang="ts">
/**
 * BatchOperationDialog — 批量生成操作对话框
 * 负责资产生成/分镜生成的批量统计、次数控制、进度展示
 */
import { Minus, Plus } from '@element-plus/icons-vue'

defineProps<{
  batchDialogVisible: boolean
  batchType: string
  batchMode: 'asset' | 'shot'
  batchCount: number
  batchTotalAssets: number
  batchMissingCount: number
  batchProgress: Record<string, { current: number; total: number }>
  selectedShots: Set<string>
}>()

const emit = defineEmits<{
  (e: 'update:batchDialogVisible', v: boolean): void
  (e: 'update:batchCount', v: number): void
  (e: 'batch-submit', mode: 'all' | 'missing'): void
}>()
</script>

<template>
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
</style>
