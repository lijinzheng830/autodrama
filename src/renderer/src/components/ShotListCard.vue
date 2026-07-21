<script setup lang="ts">
/**
 * ShotListCard — 分镜剧情卡片列表
 * 负责卡片渲染、多选、全选切换
 * 内联编辑/删除/移动等操作通过 emits 委托给父组件 Editor.vue
 */
import { getCharColor } from '../utils/colorUtils'

const props = defineProps<{
  shots: Record<string, unknown>[]
  selectedShots: Set<string>
  editingCell: { shotId: string; field: string } | null
  editText: string
  isSelectAll: boolean
}>()

const emit = defineEmits<{
  (e: 'update:selectedShots', v: Set<string>): void
  (e: 'update:isSelectAll', v: boolean): void
  (e: 'start-edit', shotId: string, field: string, text: string): void
  (e: 'save-edit', shotId: string, field: string): void
  (e: 'cancel-edit'): void
  (e: 'update:editText', v: string): void
  (e: 'add-association', shotId: string, type: 'character' | 'scene' | 'prop'): void
  (e: 'remove-association', shotId: string, type: 'character' | 'scene' | 'prop', assetId: string): void
}>()

const toggleSelectAll = (val: boolean): void => {
  emit('update:isSelectAll', val)
  if (val) {
    emit('update:selectedShots', new Set((props.shots || []).map((s: any) => s.id)))
  } else {
    emit('update:selectedShots', new Set())
  }
}

const onShotClick = (shot: Record<string, unknown>, e: MouseEvent): void => {
  const shotId = shot.id as string
  if (e.ctrlKey || e.metaKey) {
    const s = new Set(props.selectedShots)
    if (s.has(shotId)) s.delete(shotId); else s.add(shotId)
    emit('update:selectedShots', s)
  } else {
    emit('update:selectedShots', new Set([shotId]))
  }
}
</script>

<template>
  <div class="shot-cards-column">
    <div class="shot-cards-header">
      <el-checkbox :model-value="isSelectAll" @change="toggleSelectAll" />
      <span class="shot-cards-count">{{ (shots || []).length }} 镜</span>
    </div>
    <div class="shot-cards-list">
      <div
        v-for="shot in (shots || [])"
        :key="(shot as any).id"
        class="shot-card"
        :class="{ selected: selectedShots.has((shot as any).id) }"
        @click="(e: MouseEvent) => onShotClick(shot, e)"
      >
        <div class="shot-card-top">
          <span class="shot-card-index">#{{ (shot as any).shot_index }}</span>
          <span class="shot-card-type">{{ (shot as any).shot_type || '-' }}</span>
          <span class="shot-card-dur">{{ (shot as any).duration_seconds ? Number((shot as any).duration_seconds).toFixed(1) + 's' : '1-2s' }}</span>
          <span class="shot-card-cam" v-if="(shot as any).camera_movement">{{ (shot as any).camera_movement }}</span>
        </div>
        <div class="shot-card-meta" v-if="((shot as any).characters?.length || (shot as any).scenes?.length || (shot as any).props?.length)">
          <span v-for="c in (shot as any).characters" :key="'c'+c.id" class="shot-card-tag" :style="{ color: getCharColor(c.name), background: getCharColor(c.name) + '25' }">{{ c.name }}<i class="tag-remove" @click.stop="emit('remove-association', (shot as any).id, 'character', c.id)">×</i></span>
          <span v-for="s in (shot as any).scenes" :key="'s'+s.id" class="shot-card-tag scene-tag">{{ s.name }}<i class="tag-remove" @click.stop="emit('remove-association', (shot as any).id, 'scene', s.id)">×</i></span>
          <span v-for="p in (shot as any).props" :key="'p'+p.id" class="shot-card-tag prop-tag">{{ p.name }}<i class="tag-remove" @click.stop="emit('remove-association', (shot as any).id, 'prop', p.id)">×</i></span>
        </div>
        <div class="shot-card-assoc-actions">
          <button class="assoc-add-btn" @click.stop="emit('add-association', (shot as any).id, 'character')" title="添加角色">+角</button>
          <button class="assoc-add-btn" @click.stop="emit('add-association', (shot as any).id, 'scene')" title="添加场景">+场</button>
          <button class="assoc-add-btn" @click.stop="emit('add-association', (shot as any).id, 'prop')" title="添加道具">+道</button>
        </div>
        <div class="shot-card-dialogue" v-if="((shot as any).dialogue || (shot as any).narration || (shot as any).inner_monologue)">
          {{ (shot as any).dialogue || (shot as any).narration || (shot as any).inner_monologue }}
        </div>
        <div
          class="shot-card-desc"
          @dblclick.stop="emit('start-edit', (shot as any).id, 'description', (shot as any).description_zh || (shot as any).description || '')"
        >
          <template v-if="editingCell?.shotId === (shot as any).id && editingCell?.field === 'description'">
            <el-input
              :model-value="editText"
              @update:model-value="(v: string) => emit('update:editText', v)"
              type="textarea"
              :rows="3"
              @blur="emit('save-edit', (shot as any).id, 'description')"
              @keydown.escape="emit('cancel-edit')"
            />
          </template>
          <template v-else>
            {{ (shot as any).description_zh || (shot as any).description || '(双击编辑)' }}
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shot-cards-column {
  width: 320px; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden;
}
.shot-cards-header {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 8px;
}
.shot-cards-count { font-size: 13px; color: #aaa; }
.shot-cards-list {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
}
.shot-card {
  padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 6px;
  border: 1px solid transparent; cursor: pointer; transition: all .15s;
}
.shot-card:hover { background: rgba(255,255,255,0.06); }
.shot-card.selected { border-color: #8b8fff; background: rgba(139,143,255,0.08); }
.shot-card-top {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
}
.shot-card-index { font-weight: 700; font-size: 14px; color: #8b8fff; min-width: 32px; }
.shot-card-type {
  font-size: 11px; background: rgba(139,143,255,0.15); color: #8b8fff;
  padding: 1px 6px; border-radius: 3px;
}
.shot-card-dur { font-size: 11px; color: #888; }
.shot-card-cam { font-size: 11px; color: #a78bfa; margin-left: 4px; white-space: nowrap; font-weight: 500; }
.shot-card-meta {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;
}
.shot-card-tag {
  font-size: 10px; padding: 1px 5px; border-radius: 3px; white-space: nowrap;
}
.scene-tag { background: rgba(52,211,153,0.15); color: #34d399; }
.prop-tag { background: rgba(251,146,60,0.15); color: #fb923c; }
.tag-remove {
  margin-left: 2px; cursor: pointer; font-style: normal; opacity: 0.5; font-size: 11px;
}
.tag-remove:hover { opacity: 1; color: #f87171; }
.shot-card-assoc-actions {
  display: flex; gap: 4px; margin-top: 4px;
}
.assoc-add-btn {
  font-size: 10px; padding: 1px 5px; border-radius: 3px; border: 1px dashed rgba(255,255,255,0.15);
  background: transparent; color: #666; cursor: pointer; transition: all .15s;
}
.assoc-add-btn:hover { border-color: rgba(139,143,255,0.5); color: #8b8fff; background: rgba(139,143,255,0.08); }
.shot-card-dialogue {
  font-size: 11px; color: #fbbf24; margin-bottom: 4px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.shot-card-desc {
  font-size: 12px; color: #ccc; line-height: 1.5; display: -webkit-box;
  -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.edit-cell { width: 100%; }
.edit-cell :deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(167, 139, 250, 0.3);
  color: #e5e7eb;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0;
}
</style>
