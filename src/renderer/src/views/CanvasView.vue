<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{
  projectData: any
  projectId: string
}>()

const emit = defineEmits(['back-to-editor'])

// Canvas state
const elements = ref<any[]>([])
const selectedFlow = ref<string>('')

// Convert project data to canvas flow elements
function buildElements() {
  // projectData.chapters is an array, shots are linked by chapter_id
  const chapters = props.projectData?.chapters || []
  const allShots = props.projectData?.shots || []

  if (chapters.length === 0 && allShots.length === 0) return

  const nodes: any[] = []
  const edges: any[] = []
  let nodeY = 0

  for (const chapter of chapters) {
    const chapterShots = allShots.filter((s: any) => s.chapter_id === chapter.id)

    // Chapter header node
    nodes.push({
      id: `chapter-${chapter.id}`,
      type: 'default',
      position: { x: 0, y: nodeY },
      data: { label: chapter.title || `第${(chapter.chapter_index || 0) + 1}章` },
      style: { background: 'rgba(167,139,250,0.15)', border: '1px solid #a78bfa', color: '#c4b5fd', fontWeight: '600', width: 220, fontSize: '13px' }
    })
    nodeY += 70

    for (let si = 0; si < chapterShots.length; si++) {
      const shot = chapterShots[si]
      const shotNodeId = `shot-${shot.id}`
      const rowBaseY = nodeY

      // Shot description node
      nodes.push({
        id: shotNodeId,
        type: 'default',
        position: { x: 0, y: nodeY },
        data: { label: `#${shot.shot_index || si + 1} ${(shot.description || '分镜').substring(0, 30)}` },
        style: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)', color: '#e5e7eb', width: 220, fontSize: '11px' }
      })

      // Character nodes (right column)
      const chars = shot.characters || []
      let colY = rowBaseY
      chars.forEach((c: any) => {
        const cid = `char-${shot.id}-${c.id}`
        nodes.push({
          id: cid,
          type: 'default',
          position: { x: 260, y: colY },
          data: { label: `👤 ${c.name}` },
          style: { background: 'rgba(59,130,246,0.1)', border: '1px solid #3b82f6', color: '#93c5fd', width: 150, fontSize: '11px' }
        })
        edges.push({ id: `e-c-${cid}`, source: shotNodeId, target: cid, style: { stroke: 'rgba(59,130,246,0.3)' } })
        colY += 40
      })

      // Scene node
      const scenes = shot.scenes || []
      let sceneColY = rowBaseY
      scenes.forEach((sc: any) => {
        const sid = `scene-${shot.id}-${sc.id}`
        nodes.push({
          id: sid,
          type: 'default',
          position: { x: 450, y: sceneColY },
          data: { label: `🏠 ${sc.name}` },
          style: { background: 'rgba(16,185,129,0.1)', border: '1px solid #10b981', color: '#6ee7b7', width: 150, fontSize: '11px' }
        })
        edges.push({ id: `e-s-${sid}`, source: shotNodeId, target: sid, style: { stroke: 'rgba(16,185,129,0.3)' } })
        sceneColY += 40
      })

      // First frame prompt node
      if (shot.first_frame_prompt) {
        const ffid = `ff-${shot.id}`
        nodes.push({
          id: ffid,
          type: 'default',
          position: { x: 640, y: rowBaseY },
          data: { label: `首帧提示词` },
          style: { background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', color: '#fcd34d', width: 140, fontSize: '11px' }
        })
        edges.push({ id: `e-ff-${ffid}`, source: shotNodeId, target: ffid, style: { stroke: 'rgba(245,158,11,0.3)' } })

        if (shot.first_frame_image_path) {
          nodes.push({
            id: `ffr-${shot.id}`,
            type: 'default',
            position: { x: 640, y: rowBaseY + 50 },
            data: { label: '🖼 首帧图 ✓' },
            style: { background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#86efac', width: 140, fontSize: '11px' }
          })
          edges.push({ id: `e-ffr-${shot.id}`, source: ffid, target: `ffr-${shot.id}` })
        }
      }

      // Video prompt node
      if (shot.video_prompt) {
        const vid = `vid-${shot.id}`
        nodes.push({
          id: vid,
          type: 'default',
          position: { x: 820, y: rowBaseY },
          data: { label: `视频提示词` },
          style: { background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#fca5a5', width: 140, fontSize: '11px' }
        })
        edges.push({ id: `e-vid-${vid}`, source: shotNodeId, target: vid, style: { stroke: 'rgba(239,68,68,0.3)' } })

        if (shot.video_path) {
          nodes.push({
            id: `vidr-${shot.id}`,
            type: 'default',
            position: { x: 820, y: rowBaseY + 50 },
            data: { label: '🎬 视频 ✓' },
            style: { background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#86efac', width: 140, fontSize: '11px' }
          })
          edges.push({ id: `e-vidr-${shot.id}`, source: vid, target: `vidr-${shot.id}` })
        }
      }

      const hr = Math.max(80, Math.max(chars.length, scenes.length) * 40 + 10, (shot.first_frame_prompt ? 100 : 0), (shot.video_prompt ? 100 : 0))
      nodeY += hr + 16
    }
    nodeY += 30
  }

  elements.value = [...nodes, ...edges]
}

watch(() => props.projectData, buildElements, { immediate: true, deep: true })

const canvasNav = ref('shots')
const canvasPanelItems = [
  { key: 'characters', label: '角色', icon: '👤' },
  { key: 'scenes', label: '场景', icon: '🏠' },
  { key: 'props', label: '道具', icon: '🔧' },
  { key: 'shots', label: '分镜', icon: '🎬' },
  { key: 'library', label: '资产库', icon: '📁' }
]

const filteredShots = computed(() => {
  return props.projectData?.shots || []
})

function focusShot(shotId: string) {
  const nodeId = `shot-${shotId}`
  selectedFlow.value = nodeId
}
</script>

<template>
  <div class="canvas-layout">
    <!-- 左侧面板 -->
    <aside class="canvas-sidebar">
      <div
        v-for="item in canvasPanelItems"
        :key="item.key"
        class="canvas-nav-item"
        :class="{ active: canvasNav === item.key }"
        @click="canvasNav = item.key"
      >
        <span class="canvas-nav-icon">{{ item.icon }}</span>
        <span class="canvas-nav-label">{{ item.label }}</span>
      </div>
    </aside>

    <!-- 画布主体 -->
    <div class="canvas-main">
      <VueFlow
        v-model="elements"
        :default-viewport="{ x: 0, y: 0, zoom: 0.8 }"
        :min-zoom="0.2"
        :max-zoom="2"
        class="vue-flow-canvas"
      >
        <Background :gap="20" />
      </VueFlow>

      <!-- 底部工具栏 -->
      <div class="canvas-toolbar">
        <el-button size="small" @click="emit('back-to-editor')">返回编辑器</el-button>
        <span class="canvas-info">{{ elements.length }} 个节点</span>
      </div>
    </div>

    <!-- 右侧分镜面板 -->
    <aside v-if="canvasNav === 'shots'" class="canvas-right-panel">
      <div class="canvas-shot-list">
        <div v-for="chapter in projectData?.chapters || []" :key="chapter.id" class="canvas-chapter-group">
          <div class="canvas-chapter-title">{{ chapter.title || `第${chapter.chapter_index + 1}章` }}</div>
          <div
            v-for="shot in (chapter.shots || [])"
            :key="shot.id"
            class="canvas-shot-item"
            :class="{ active: selectedFlow === `shot-${shot.id}` }"
            @click="focusShot(shot.id)"
          >
            <span class="shot-num">#{{ shot.shot_index }}</span>
            <span class="shot-desc">{{ (shot.description || '').substring(0, 20) }}</span>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.canvas-layout {
  display: flex;
  width: 100%;
  height: 100%;
  background: #0f0f11;
}

.canvas-sidebar {
  width: 56px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.02);
  border-right: 1px solid rgba(255,255,255,0.06);
  display: flex;
  flex-direction: column;
  padding: 8px 0;
}

.canvas-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  cursor: pointer;
  color: #6b7280;
  transition: all 0.15s;
  border-left: 3px solid transparent;
}

.canvas-nav-item:hover,
.canvas-nav-item.active {
  color: #c4b5fd;
  background: rgba(167,139,250,0.1);
  border-left-color: #a78bfa;
}

.canvas-nav-icon { font-size: 18px; }
.canvas-nav-label { font-size: 10px; }

.canvas-main {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
}

.vue-flow-canvas {
  flex: 1;
  background: #0f0f11;
}

.canvas-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(255,255,255,0.03);
  border-top: 1px solid rgba(255,255,255,0.06);
}

.canvas-info {
  font-size: 11px;
  color: #6b7280;
}

.canvas-right-panel {
  width: 200px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.02);
  border-left: 1px solid rgba(255,255,255,0.06);
  overflow-y: auto;
}

.canvas-shot-list { padding: 8px; }

.canvas-chapter-title {
  font-size: 11px;
  font-weight: 600;
  color: #c4b5fd;
  padding: 6px 8px;
}

.canvas-shot-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 11px;
  color: #9ca3af;
}
.canvas-shot-item:hover,
.canvas-shot-item.active {
  background: rgba(255,255,255,0.05);
  color: #e5e7eb;
}
.shot-num { color: #a78bfa; font-weight: 600; }
.shot-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
