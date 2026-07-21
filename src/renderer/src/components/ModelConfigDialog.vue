<script setup lang="ts">
/**
 * ModelConfigDialog — 模型配置对话框
 * 负责 6 个 Tab 的模型选择（语言/改写/角色/场景/道具/视频）
 */
import { computed } from 'vue'

const props = defineProps<{
  modelConfigVisible: boolean
  modelConfigTab: number
  modelConfig: Record<string, Record<string, string>>
  providerModels: Array<{ value: string; label: string; modelType?: string }>
}>()

const emit = defineEmits<{
  (e: 'update:modelConfigVisible', v: boolean): void
  (e: 'update:modelConfigTab', v: number): void
  (e: 'model-config-model-change', tabKey: string, val: string): void
  (e: 'model-config-save'): void
}>()

const configTabs = [
  { key: 'language_model', label: '语言模型' },
  { key: 'script_rewrite', label: '单分镜剧本改写' },
  { key: 'character_image', label: '角色生图模型' },
  { key: 'scene_image', label: '场景生图模型' },
  { key: 'prop_image', label: '道具生图模型' },
  { key: 'video', label: '视频生成模型' },
]

const activeConfigTabKey = computed(() => configTabs[props.modelConfigTab]?.key || '')

const configTabModels = computed(() => {
  const key = activeConfigTabKey.value
  if (key === 'language_model' || key === 'script_rewrite') return props.providerModels
  if (key === 'video') return props.providerModels.filter((m) => m.modelType === 'video')
  return props.providerModels.filter((m) => m.modelType !== 'text')
})
</script>

<template>
  <el-dialog :model-value="modelConfigVisible" @update:model-value="(v: boolean) => emit('update:modelConfigVisible', v)" title="模型配置" width="600px">
    <el-tabs :model-value="modelConfigTab" @update:model-value="(v: number) => emit('update:modelConfigTab', v)">
      <el-tab-pane v-for="(tab, idx) in configTabs" :key="tab.key" :label="tab.label" :name="idx" />
    </el-tabs>
    <div class="config-fields">
      <label>模型</label>
      <el-select :model-value="modelConfig[activeConfigTabKey]?.model || ''" @update:model-value="(v: string) => { emit('model-config-model-change', activeConfigTabKey, v) }" size="small" style="width:100%">
        <el-option v-for="m in configTabModels" :key="m.value" :label="m.label" :value="m.value" />
      </el-select>
    </div>
    <template #footer>
      <el-button @click="emit('model-config-save')">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.config-fields { display: flex; flex-direction: column; gap: 16px; margin-top: 12px; }
.config-fields label { font-size: 13px; color: #999; }
</style>
