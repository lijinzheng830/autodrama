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
  if (!props.projectData?.chapters) return

  const nodes: any[] = []
  const edges: any[] = []
  let nodeY = 0

  for (const chapter of props.projectData.chapters || []) {
    const chapterShots = props.projectData.shots?.filter((s: any) => {
      return props.projectData.chapters.find((c: any) =>
        c.shots?.some((cs: any) => cs.id === s.id))?.id === chapter.id
    }) || []

    // Chapter header node
    const chapterNodeId = `chapter-${chapter.id}`
    nodes.push({
      id: chapterNodeId,
      type: 'default',
      position: { x: 0, y: nodeY },
      data: { label: chapter.title || `第${chapter.chapter_index + 1}章` },
      style: { background: 'rgba(167,139,250,0.15)', border: '1px solid #a78bfa', color: '#c4b5fd', fontWeight: '600', width: 200, fontSize: '13px' }
    })
    nodeY += 60

    // Shot nodes
    for (let si = 0; si < (chapter.shots?.length || 0); si++) {
      const shot = chapter.shots[si]
      const shotX = 0
      const shotNodeId = `shot-${shot.id}`

      nodes.push({
        id: shotNodeId,
        type: 'default',
        position: { x: shotX, y: nodeY },
        data: {
          label: `#${si + 1} ${(shot.description || '').substring(0, 30)}...`
        },
        style: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#e5e7eb', width: 200, fontSize: '11px' }
      })

      // Character nodes next to shot
      const chars = shot.characters || []
      chars.forEach((c: any, ci: number) => {
        const charNodeId = `char-${c.id}-${shot.id}`
        const charX = shotX + 250 + ci * 180
        nodes.push({
          id: charNodeId,
          type: 'default',
          position: { x: charX, y: nodeY },
          data: { label: `角色: ${c.name}` },
          style: { background: 'rgba(59,130,246,0.1)', border: '1px solid #3b82f6', color: '#93c5fd', width: 150, fontSize: '11px' }
        })
        edges.push({
          id: `edge-${shotNodeId}-${charNodeId}`,
          source: shotNodeId,
          target: charNodeId,
          style: { stroke: 'rgba(59,130,246,0.3)' }
        })

        // Character image result node
        if (c.reference_image) {
          const resultNodeId = `char-result-${c.id}-${shot.id}`
          nodes.push({
            id: resultNodeId,
            type: 'default',
            position: { x: charX, y: nodeY + 80 },
            data: { label: '定妆照 ✓' },
            style: { background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#86efac', width: 150, fontSize: '11px' }
          })
          edges.push({
            id: `edge-${charNodeId}-${resultNodeId}`,
            source: charNodeId,
            target: resultNodeId
          })
        }
      })

      // Scene node
      const scene = shot.scenes?.[0]
      if (scene) {
        const sceneNodeId = `scene-${scene.id}-${shot.id}`
        const sceneX = shotX + 250 + (chars.length || 0) * 180 + 30
        nodes.push({
          id: sceneNodeId,
          type: 'default',
          position: { x: sceneX, y: nodeY },
          data: { label: `场景: ${scene.name}` },
          style: { background: 'rgba(16,185,129,0.1)', border: '1px solid #10b981', color: '#6ee7b7', width: 150, fontSize: '11px' }
        })
        edges.push({
          id: `edge-${shotNodeId}-${sceneNodeId}`,
          source: shotNodeId,
          target: sceneNodeId
        })
      }

      // First frame node
      if (shot.first_frame_prompt) {
        const ffNodeId = `ff-${shot.id}`
        const ffX = shotX + 250
        const ffY = nodeY + (chars.length > 0 ? 160 : 0)
        nodes.push({
          id: ffNodeId,
          type: 'default',
          position: { x: ffX, y: ffY },
          data: {
            label: `首帧: ${(shot.first_frame_prompt || '').substring(0, 25)}...`
          },
          style: { background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', color: '#fcd34d', width: 200, fontSize: '10px' }
        })
        edges.push({
          id: `edge-${shotNodeId}-${ffNodeId}`,
          source: shotNodeId,
          target: ffNodeId
        })

        // FF result
        if (shot.first_frame_image_path) {
          const ffResultId = `ff-result-${shot.id}`
          nodes.push({
            id: ffResultId,
            type: 'default',
            position: { x: ffX, y: ffY + 80 },
            data: { label: '首帧图 ✓' },
            style: { background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#86efac', width: 200, fontSize: '11px' }
          })
          edges.push({ id: `edge-${ffNodeId}-${ffResultId}`, source: ffNodeId, target: ffResultId })
        }
      }

      // Video node
      if (shot.video_prompt) {
        const videoNodeId = `video-${shot.id}`
        const hasFF = !!shot.first_frame_prompt
        const vX = shotX + 500
        const vY = nodeY + (hasFF ? 80 : 0)
        nodes.push({
          id: videoNodeId,
          type: 'default',
          position: { x: vX, y: vY },
          data: { label: `视频: ${(shot.video_prompt || '').substring(0, 25)}...` },
          style: { background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#fca5a5', width: 200, fontSize: '10px' }
        })
        edges.push({
          id: `edge-${shotNodeId}-${videoNodeId}`,
          source: shotNodeId,
          target: videoNodeId
        })
        if (shot.video_path) {
          const vResultId = `video-result-${shot.id}`
          nodes.push({
            id: vResultId,
            type: 'default',
            position: { x: vX, y: vY + 80 },
            data: { label: '视频 ✓' },
            style: { background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#86efac', width: 200, fontSize: '11px' }
          })
          edges.push({ id: `edge-${videoNodeId}-${vResultId}`, source: videoNodeId, target: vResultId })
        }
      }

      const rowHeight = Math.max(160, (chars.length || 0) * 100)
      nodeY += rowHeight + 20
    }
    nodeY += 40
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
