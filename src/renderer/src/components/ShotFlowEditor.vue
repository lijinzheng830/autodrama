<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUp, ArrowDown, Delete, VideoPlay } from '@element-plus/icons-vue'

const props = defineProps<{
  projectData: any; selectedShots: Set<string>
  editingCell: { shotId: string; field: string } | null; editText: string
  viewMode: 'table' | 'canvas'
}>()

const emit = defineEmits<{
  (e: 'update:selectedShots', val: Set<string>): void
  (e: 'update:editingCell', val: { shotId: string; field: string } | null): void
  (e: 'update:editText', val: string): void
  (e: 'start-edit', shotId: string, field: string, currentValue: string): void
  (e: 'save-edit', shotId: string, field: string): void
  (e: 'cancel-edit'): void
  (e: 'move-up', shotId: string): void; (e: 'move-down', shotId: string): void
  (e: 'delete-shot', shotId: string): void
  (e: 'show-detail', type: string, data: any): void
  (e: 'batch-generate', type: string): void
  (e: 'remove-association', shotId: string, type: string, assetId: string): void
  (e: 'add-association', shotId: string, type: string): void
}>()

const groupedShots = computed(() => {
  const chapters = props.projectData?.chapters || []
  const shots = props.projectData?.shots || []
  return chapters.map((ch: any) => ({ chapter: ch, shots: shots.filter((s: any) => s.chapter_id === ch.id) }))
})

function toggleShotSelect(id: string) {
  const next = new Set(props.selectedShots)
  if (next.has(id)) next.delete(id); else next.add(id)
  emit('update:selectedShots', next)
}
function toFileUrl(p: string): string { return p ? 'file://' + p.replace(/\\/g, '/') : '' }
</script>

<template>
  <div class="storyboard">
    <div v-for="group in groupedShots" :key="group.chapter.id" class="chapter-section">
      <div class="chapter-title">{{ group.chapter.title || '第' + (group.chapter.chapter_index + 1) + '章' }}</div>
      <div class="storyboard-grid">
        <div v-for="shot in group.shots" :key="shot.id" class="storyboard-cell"
          :class="{ selected: props.selectedShots.has(shot.id) }" @click="toggleShotSelect(shot.id)">
          <span class="cell-index">{{ shot.shot_index }}</span>
          <div class="cell-image" @dblclick.stop="shot.video_path ? emit('show-detail','video',shot) : emit('show-detail','storyboard',shot)">
            <img v-if="shot.poster_image_path" :src="toFileUrl(shot.poster_image_path)" />
            <video v-else-if="shot.video_path" :src="toFileUrl(shot.video_path)" preload="metadata" />
            <div v-else class="cell-image-empty"><el-icon :size="20"><VideoPlay /></el-icon></div>
          </div>
          <div class="cell-body">
            <p class="cell-desc" @dblclick.stop="emit('start-edit', shot.id, 'description', shot.description_zh || shot.description || '')">
              {{ (shot.description_zh || shot.description || '双击编辑').slice(0, 120) }}{{ (shot.description_zh || shot.description || '').length > 120 ? '…' : '' }}
            </p>
            <div v-if="shot.dialogue" class="cell-dialogue">
              {{ shot.dialogue.slice(0, 80) }}{{ shot.dialogue.length > 80 ? '…' : '' }}
            </div>
            <div class="cell-tags">
              <span v-for="c in (shot.characters||[])" :key="c.id" class="tag-char" @click.stop="emit('show-detail','character',c)" @contextmenu.prevent.stop="emit('remove-association',shot.id,'character',c.id)">{{ c.name }}<i class="tag-x">×</i></span>
              <span v-for="s in (shot.scenes||[])" :key="s.id" class="tag-scene" @click.stop="emit('show-detail','scene',s)" @contextmenu.prevent.stop="emit('remove-association',shot.id,'scene',s.id)">{{ s.name }}<i class="tag-x">×</i></span>
              <span v-for="p in (shot.props||[])" :key="p.id" class="tag-prop" @click.stop="emit('show-detail','prop',p)" @contextmenu.prevent.stop="emit('remove-association',shot.id,'prop',p.id)">{{ p.name }}<i class="tag-x">×</i></span>
              <span class="tag-add" @click.stop="emit('add-association',shot.id,'character')">+</span>
            </div>
          </div>
          <div class="cell-actions">
            <el-button size="small" :icon="VideoPlay" type="primary" text @click.stop="emit('show-detail','video',shot)" />
            <el-button size="small" :icon="ArrowUp" text @click.stop="emit('move-up',shot.id)" />
            <el-button size="small" :icon="ArrowDown" text @click.stop="emit('move-down',shot.id)" />
            <el-button size="small" :icon="Delete" text type="danger" @click.stop="emit('delete-shot',shot.id)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.storyboard { padding: 16px; overflow-y: auto; height: 100%; }
.chapter-section { margin-bottom: 24px; }
.chapter-title { font-size: 14px; font-weight: 600; color: #8b8fff; margin-bottom: 12px; padding-left: 4px; }
.storyboard-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.storyboard-cell:hover { border-color: rgba(91,106,240,0.3); background: #1a1a22; }
.storyboard-cell.selected { border-color: #5b6af0; background: rgba(91,106,240,0.08); }
.cell-index {
  position: absolute; top: 6px; left: 8px; z-index: 2;
  font-size: 11px; font-weight: 700; color: #ededef;
  background: rgba(0,0,0,0.6); padding: 1px 6px; border-radius: 3px;
}
.cell-image { width: 100%; aspect-ratio: 16/9; background: #0d0d10; }
.cell-image img, .cell-image video { width: 100%; height: 100%; object-fit: cover; }
.cell-image-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.15); }
.cell-body { padding: 10px; }
.cell-desc { font-size: 12px; color: #9ca3af; margin: 0 0 6px; line-height: 1.4; cursor: text; }
.cell-dialogue { font-size: 12px; color: #5b6af0; margin-bottom: 6px; border-left: 2px solid rgba(91,106,240,0.4); padding-left: 8px; }
.cell-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.tag-char { font-size: 10px; background: rgba(91,106,240,0.12); color: #8b8fff; padding: 1px 6px; border-radius: 3px; cursor: pointer; }
.tag-scene { font-size: 10px; background: rgba(16,185,129,0.12); color: #6ee7b7; padding: 1px 6px; border-radius: 3px; }
.tag-prop { font-size: 10px; background: rgba(245,158,11,0.12); color: #fbbf24; padding: 1px 6px; border-radius: 3px; }
.tag-x { font-style: normal; margin-left: 3px; opacity: 0.4; font-size: 11px; cursor: pointer; }
.tag-x:hover { opacity: 1; color: #f56c6c; }
.tag-add { font-size: 10px; background: rgba(255,255,255,0.06); color: #888; padding: 1px 6px; border-radius: 3px; cursor: pointer; border: 1px dashed rgba(255,255,255,0.15); }
.tag-add:hover { background: rgba(255,255,255,0.12); color: #ccc; }
.cell-actions { display: flex; justify-content: flex-end; gap: 2px; padding: 6px 8px; border-top: 1px solid rgba(255,255,255,0.04); }
</style>
