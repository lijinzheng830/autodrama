<script setup lang="ts">
/**
 * ShotFlowEditor — 分镜表格编辑器 (Phase 1.4 完整迁移)
 * 替换 Editor.vue 第 2852-3205 行的原生表格，保持全部 13 列 + 内联编辑 + 缩略图 + 批量生成
 */
import { computed } from 'vue'
import { ArrowUp, ArrowDown, Delete, Plus, VideoPlay } from '@element-plus/icons-vue'

const props = defineProps<{
  projectData: any
  selectedShots: Set<string>
  editingCell: { shotId: string; field: string } | null
  editText: string
  viewMode: 'table' | 'canvas'
}>()

const emit = defineEmits<{
  (e: 'update:selectedShots', val: Set<string>): void
  (e: 'update:editingCell', val: { shotId: string; field: string } | null): void
  (e: 'update:editText', val: string): void
  (e: 'start-edit', shotId: string, field: string, currentValue: string): void
  (e: 'save-edit', shotId: string, field: string): void
  (e: 'cancel-edit'): void
  (e: 'move-up', shotId: string): void
  (e: 'move-down', shotId: string): void
  (e: 'delete-shot', shotId: string): void
  (e: 'show-detail', type: string, data: any): void
  (e: 'batch-generate', type: string): void
  (e: 'remove-association', shotId: string, type: string, assetId: string): void
  (e: 'add-association', shotId: string, type: string): void
  (e: 'generate-voice', shotId: string): void
}>()

// Grouped shots by chapter
const groupedShots = computed(() => {
  const chapters = props.projectData?.chapters || []
  const shots = props.projectData?.shots || []
  return chapters.map((ch: any) => ({
    chapter: ch,
    shots: shots.filter((s: any) => s.chapter_id === ch.id)
  }))
})

const allShotIds = computed(() => {
  const ids: string[] = []
  for (const shot of props.projectData?.shots || []) ids.push(shot.id)
  return ids
})

const isAllSelected = computed(() =>
  allShotIds.value.length > 0 && allShotIds.value.every((id) => props.selectedShots.has(id))
)

function toggleSelectAll(): void {
  if (isAllSelected.value) { emit('update:selectedShots', new Set()) }
  else { emit('update:selectedShots', new Set(allShotIds.value)) }
}

function toggleShotSelect(shotId: string): void {
  const next = new Set(props.selectedShots)
  if (next.has(shotId)) next.delete(shotId)
  else next.add(shotId)
  emit('update:selectedShots', next)
}

function toFileUrl(p: string): string {
  if (!p) return ''
  return 'file://' + p.replace(/\\/g, '/')
}
</script>

<template>
  <div v-if="viewMode === 'table'" class="shot-table">
    <!-- 表头 -->
    <div class="shot-table-header">
      <div class="th col-num">
        <el-checkbox :model-value="isAllSelected" @change="toggleSelectAll" />
        <span>序号</span>
      </div>
      <div class="th col-script">剧本</div>
      <div class="th col-chars">
        出场人物
        <el-button text size="small" class="batch-btn" @click="emit('batch-generate', '人物')">[批量生成]</el-button>
      </div>
      <div class="th col-scenes">
        场景
        <el-button text size="small" class="batch-btn" @click="emit('batch-generate', '场景')">[批量生成]</el-button>
      </div>
      <div class="th col-props">
        道具
        <el-button text size="small" class="batch-btn" @click="emit('batch-generate', '道具')">[批量生成]</el-button>
      </div>
      <div class="th col-voice">配音</div>
      <div class="th col-first">
        首帧
        <el-button text size="small" class="batch-btn" @click="emit('batch-generate', '首帧')">[批量生成]</el-button>
      </div>
      <div class="th col-first-prompt">首帧提示词</div>
      <div class="th col-last">
        尾帧
        <el-button text size="small" class="batch-btn" @click="emit('batch-generate', '尾帧')">[批量生成]</el-button>
      </div>
      <div class="th col-last-prompt">尾帧提示词</div>
      <div class="th col-video">
        视频
        <el-button text size="small" class="batch-btn" @click="emit('batch-generate', '视频')">[批量生成]</el-button>
      </div>
      <div class="th col-video-prompt">视频提示词</div>
      <div class="th col-op">操作</div>
    </div>

    <!-- 数据行 -->
    <div v-for="group in groupedShots" :key="group.chapter.id" class="chapter-group">
      <div class="chapter-row">
        {{ group.chapter.title || `第${group.chapter.chapter_index + 1}章` }}
      </div>

      <div
        v-for="(shot, idx) in group.shots"
        :key="shot.id"
        class="shot-row"
        :class="{ selected: selectedShots.has(shot.id) }"
      >
        <!-- 序号 -->
        <div class="td col-num">
          <el-checkbox :model-value="selectedShots.has(shot.id)" @change="toggleShotSelect(shot.id)" />
          <span class="shot-index">{{ Number(idx) + 1 }}</span>
        </div>

        <!-- 剧本 (description + dialogue + narration + 标签) -->
        <div class="td col-script">
          <div v-if="editingCell?.shotId === shot.id && editingCell?.field === 'description'" class="edit-cell">
            <el-input :model-value="props.editText || ''" type="textarea" :autosize="{ minRows: 3, maxRows: 12 }"
              @update:model-value="(v: string) => emit('update:editText', v)"
              @blur="emit('save-edit', shot.id, 'description')"
              @keydown.enter.prevent="emit('save-edit', shot.id, 'description')"
              @keydown.esc.prevent="emit('cancel-edit')" />
          </div>
          <div v-else class="cell-text" @dblclick="emit('start-edit', shot.id, 'description', shot.description_zh || shot.description || '')">
            <span v-if="shot.description_zh || shot.description">{{ (shot.description_zh || shot.description || '').slice(0, 100) }}</span>
            <span v-else class="cell-empty">双击编辑</span>
          </div>
          <div v-if="shot.dialogue" class="dialogue-line">💬 {{ shot.dialogue.slice(0, 60) }}</div>
          <div v-if="shot.narration" class="narration-line">📢 {{ shot.narration.slice(0, 60) }}</div>
          <div class="tag-bar">
            <span v-for="c in shot.characters" :key="c.id" class="tag tag-char">{{ c.name }}</span>
            <span v-for="s in shot.scenes" :key="s.id" class="tag tag-scene">{{ s.name }}</span>
            <span v-for="p in shot.props" :key="p.id" class="tag tag-prop">{{ p.name }}</span>
          </div>
        </div>

        <!-- 出场人物 -->
        <div class="td col-chars">
          <div class="thumb-grid">
            <div v-for="c in shot.characters" :key="c.id" class="thumb-cell" :class="{ 'no-anchor': !c.skin_images }" @click="emit('show-detail', 'character', c)">
              <img v-if="c.reference_image" :src="toFileUrl(c.reference_image)" class="thumb-img" />
              <div v-else class="thumb-placeholder">{{ c.name }}</div>
              <span class="anchor-dot-mini" :class="c.skin_images ? 'has' : 'missing'" :title="c.skin_images ? '锚点就绪' : '缺少多角度锚点'"></span>
              <el-button class="thumb-remove" size="small" circle :icon="Delete" @click.stop="emit('remove-association', shot.id, 'character', c.id)" />
            </div>
            <div v-if="!shot.characters?.length" class="thumb-empty">-</div>
            <el-button class="thumb-add" size="small" circle :icon="Plus" @click.stop="emit('add-association', shot.id, 'character')" title="添加角色" />
          </div>
        </div>

        <!-- 场景 -->
        <div class="td col-scenes">
          <div class="thumb-grid">
            <div v-for="s in shot.scenes" :key="s.id" class="thumb-cell" @click="emit('show-detail', 'scene', s)">
              <img v-if="s.reference_image" :src="toFileUrl(s.reference_image)" class="thumb-img" />
              <div v-else class="thumb-placeholder">{{ s.name }}</div>
              <el-button class="thumb-remove" size="small" circle :icon="Delete" @click.stop="emit('remove-association', shot.id, 'scene', s.id)" />
            </div>
            <div v-if="!shot.scenes?.length" class="thumb-empty">-</div>
            <el-button class="thumb-add" size="small" circle :icon="Plus" @click.stop="emit('add-association', shot.id, 'scene')" title="添加场景" />
          </div>
        </div>

        <!-- 道具 -->
        <div class="td col-props">
          <div class="thumb-grid">
            <div v-for="p in shot.props" :key="p.id" class="thumb-cell" @click="emit('show-detail', 'prop', p)">
              <img v-if="p.reference_image" :src="toFileUrl(p.reference_image)" class="thumb-img" />
              <div v-else class="thumb-placeholder">{{ p.name }}</div>
              <el-button class="thumb-remove" size="small" circle :icon="Delete" @click.stop="emit('remove-association', shot.id, 'prop', p.id)" />
            </div>
            <div v-if="!shot.props?.length" class="thumb-empty">-</div>
            <el-button class="thumb-add" size="small" circle :icon="Plus" @click.stop="emit('add-association', shot.id, 'prop')" title="添加道具" />
          </div>
        </div>

        <!-- 配音 -->
        <div class="td col-voice">
          <span v-if="shot.voice_path" style="color:#67c23a;font-size:14px">✅</span>
          <el-button v-else text size="small" @click="emit('generate-voice', shot.id)">🎙️ 配音</el-button>
        </div>

        <!-- 首帧 -->
        <div class="td col-first">
          <div class="media-cell" @click="emit('show-detail', 'firstFrame', shot)">
            <div v-if="shot.first_frame_image_path" class="media-preview">
              <img :src="toFileUrl(shot.first_frame_image_path)" />
            </div>
            <div v-else class="media-placeholder">首帧</div>
          </div>
        </div>

        <!-- 首帧提示词 -->
        <div class="td col-first-prompt">
          <div v-if="editingCell?.shotId === shot.id && editingCell?.field === 'first_frame_prompt'" class="edit-cell">
            <el-input :model-value="props.editText || ''" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }"
              @update:model-value="(v: string) => emit('update:editText', v)"
              @blur="emit('save-edit', shot.id, 'first_frame_prompt')"
              @keydown.enter.prevent="emit('save-edit', shot.id, 'first_frame_prompt')"
              @keydown.esc.prevent="emit('cancel-edit')" />
          </div>
          <div v-else class="cell-text" @dblclick="emit('start-edit', shot.id, 'first_frame_prompt', shot.first_frame_prompt_zh || shot.first_frame_prompt || '')">
            {{ (shot.first_frame_prompt_zh || shot.first_frame_prompt || '-').slice(0, 80) }}
          </div>
        </div>

        <!-- 尾帧 -->
        <div class="td col-last">
          <div class="media-cell" @click="emit('show-detail', 'lastFrame', shot)">
            <div v-if="shot.last_frame_image_path" class="media-preview">
              <img :src="toFileUrl(shot.last_frame_image_path)" />
            </div>
            <div v-else class="media-placeholder">尾帧</div>
          </div>
        </div>

        <!-- 尾帧提示词 -->
        <div class="td col-last-prompt">
          <div v-if="editingCell?.shotId === shot.id && editingCell?.field === 'last_frame_prompt'" class="edit-cell">
            <el-input :model-value="props.editText || ''" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }"
              @update:model-value="(v: string) => emit('update:editText', v)"
              @blur="emit('save-edit', shot.id, 'last_frame_prompt')"
              @keydown.enter.prevent="emit('save-edit', shot.id, 'last_frame_prompt')"
              @keydown.esc.prevent="emit('cancel-edit')" />
          </div>
          <div v-else class="cell-text" @dblclick="emit('start-edit', shot.id, 'last_frame_prompt', shot.last_frame_prompt_zh || shot.last_frame_prompt || '')">
            {{ (shot.last_frame_prompt_zh || shot.last_frame_prompt || '-').slice(0, 80) }}
          </div>
        </div>

        <!-- 视频 -->
        <div class="td col-video">
          <div class="media-cell" @click="emit('show-detail', 'video', shot)">
            <div v-if="shot.video_path" class="media-preview">
              <video :src="toFileUrl(shot.video_path)" class="thumb-img" preload="metadata" />
              <el-icon :size="12" class="video-play-overlay"><VideoPlay /></el-icon>
            </div>
            <div v-else class="media-placeholder"></div>
          </div>
        </div>

        <!-- 视频提示词 -->
        <div class="td col-video-prompt">
          <div v-if="editingCell?.shotId === shot.id && editingCell?.field === 'video_prompt'" class="edit-cell">
            <el-input :model-value="props.editText || ''" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }"
              @update:model-value="(v: string) => emit('update:editText', v)"
              @blur="emit('save-edit', shot.id, 'video_prompt')"
              @keydown.enter.prevent="emit('save-edit', shot.id, 'video_prompt')"
              @keydown.esc.prevent="emit('cancel-edit')" />
          </div>
          <div v-else class="cell-text" @dblclick="emit('start-edit', shot.id, 'video_prompt', shot.video_prompt_zh || shot.video_prompt || '')">
            {{ (shot.video_prompt_zh || shot.video_prompt || '-').slice(0, 80) }}
          </div>
        </div>

        <!-- 操作 -->
        <div class="td col-op">
          <el-button size="small" :icon="ArrowUp" circle @click="emit('move-up', shot.id)" />
          <el-button size="small" :icon="ArrowDown" circle @click="emit('move-down', shot.id)" />
          <el-button size="small" :icon="Delete" circle type="danger" @click="emit('delete-shot', shot.id)" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shot-table { display: flex; flex-direction: column; height: 100%; overflow: auto; font-size: 12px; width: 100%; }
.shot-table-header { display: flex; background: #252545; color: #aaa; position: sticky; top: 0; z-index: 2; width: 100%; }
.th { padding: 8px 4px; border-right: 1px solid #2a2a3e; display: flex; align-items: center; justify-content: center; gap: 4px; overflow: hidden; text-align: center; }
.chapter-group { width: 100%; }
.chapter-row { background: #1e1e38; color: #409eff; font-weight: 600; padding: 8px 12px; font-size: 13px; }
.shot-row { display: flex; border-bottom: 1px solid #2a2a3e; }
.shot-row:hover { background: #252540; }
.shot-row.selected { background: #2a2a50; }
.td { padding: 6px 4px; border-right: 1px solid #1e1e30; color: #ccc; display: flex; flex-direction: column; gap: 4px; }
/* Column widths */
/* 固定列 */
.col-num { width: 70px; flex-shrink: 0; }
.col-props { width: 90px; flex-shrink: 0; }
.col-voice { width: 60px; flex-shrink: 0; }
.col-op { width: 36px; flex-shrink: 0; flex-direction: column; align-items: center; justify-content: space-evenly; opacity: .3; transition: opacity .2s; }
.shot-row:hover .col-op { opacity: 1; }
.col-op .el-button { transform: scale(.7); margin: 0; padding: 0; }
.col-op .el-button:first-child { margin-left: 0; }
.col-op { width: 36px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: space-evenly; opacity: .3; transition: opacity .2s; }
/* 等比放大列 */
.col-script { flex: 3; min-width: 180px; }
.col-chars, .col-scenes { flex: 1.2; min-width: 100px; }
.col-first, .col-last, .col-video { flex: 1; min-width: 90px; }
.col-first-prompt, .col-last-prompt { flex: 1.8; min-width: 130px; }
.col-video-prompt { flex: 2; min-width: 140px; }
/* Cell styling */
.cell-text { cursor: text; word-break: break-word; line-height: 1.4; }
.cell-text:hover { background: #303060; border-radius: 2px; }
.cell-empty { color: #666; font-style: italic; }
.dialogue-line { color: #e0a040; font-size: 11px; margin-top: 2px; }
.narration-line { color: #a0c0e0; font-size: 11px; margin-top: 1px; }
.edit-cell { background: #303060; border-radius: 4px; padding: 2px; }
.tag-bar { display: flex; flex-wrap: wrap; gap: 2px; }
.tag { font-size: 10px; padding: 1px 4px; border-radius: 3px; }
.tag-char { background: #3a2040; color: #e0a0e0; }
.tag-scene { background: #203040; color: #a0c0e0; }
.tag-prop { background: #304020; color: #a0e0a0; }
.thumb-grid { display: flex; flex-wrap: wrap; gap: 2px; }
.thumb-cell { cursor: pointer; width: 36px; height: 36px; border-radius: 4px; overflow: hidden; }
.thumb-cell:hover { outline: 2px solid #409eff; }
.thumb-img { width: 100%; height: 100%; object-fit: cover; }
.thumb-placeholder { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: #1a1a3e; color: #888; font-size: 10px; border-radius: 4px; }
.thumb-empty { color: #666; font-size: 12px; padding: 4px; }
.media-cell { cursor: pointer; width: 60px; height: 40px; border-radius: 4px; overflow: hidden; background: #1a1a3e; display: flex; align-items: center; justify-content: center; }
.media-cell:hover { outline: 2px solid #409eff; }
.media-preview img { width: 100%; height: 100%; object-fit: cover; }
.media-placeholder { color: #666; font-size: 11px; display: flex; align-items: center; justify-content: center; height: 100%; }
.media-preview { position: relative; }
.video-play-overlay { position: absolute; bottom: 2px; right: 2px; border-radius: 50%; padding: 1px; color: #fff; background: #67c23a; }
.batch-btn { color: #e0a040 !important; font-size: 11px; }
.shot-index { font-size: 13px; font-weight: 600; color: #aaa; }
/* 锚点状态迷你指示器 */
.thumb-cell { position: relative; }
.anchor-dot-mini { position: absolute; bottom: 2px; right: 2px; width: 8px; height: 8px; border-radius: 50%; border: 1px solid #000; }
.anchor-dot-mini.has { background: #67c23a; }
.anchor-dot-mini.missing { background: #f56c6c; animation: blink-warn 2s infinite; }
@keyframes blink-warn { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.thumb-cell.no-anchor { outline: 1px solid #f56c6c55; border-radius: 4px; }
.thumb-remove { position: absolute; top: -6px; right: -6px; opacity: 0; transition: opacity .2s; width: 18px; height: 18px; min-height: 18px; background: #e03a3a; border-color: #e03a3a; color: #fff; }
.thumb-cell:hover .thumb-remove { opacity: 1; }
.thumb-add { width: 22px; height: 22px; min-height: 22px; opacity: .6; transition: all .2s; border: 1px dashed #666; color: #409eff; background: #1a1a3e; }
.thumb-add:hover { opacity: 1; border-color: #409eff; background: #252545; }
</style>
