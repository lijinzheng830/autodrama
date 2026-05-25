<script setup lang="ts">
import { ref, reactive, h, defineComponent, nextTick, computed } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{ projectData: any; projectId: string }>()
const emit = defineEmits<{ (e: 'back-to-editor'): void }>()

// ===== Custom Nodes (simple display) =====
const createNode = (header: string, color: string, bgColor: string) => defineComponent({
  props: ['data'],
  setup(p: any) {
    return () => h('div', {
      class: 'nm-node',
      style: { borderColor: color, background: bgColor }
    }, [
      h('div', { class: 'nm-header', style: { color } }, p.data.label || header),
      p.data.desc ? h('div', { class: 'nm-desc' }, p.data.desc) : null,
      p.data.status ? h('div', { class: 'nm-status', style: { color: p.data.status === 'done' ? '#22c55e' : '#6b7280' } }, p.data.status === 'done' ? '✓' : '○') : null
    ])
  }
})

const nodeTypes = {
  'shot': createNode('分镜', '#a78bfa', 'rgba(167,139,250,0.08)'),
  'asset': createNode('资产', '#3b82f6', 'rgba(59,130,246,0.08)'),
  'frame': createNode('帧生图', '#f59e0b', 'rgba(245,158,11,0.08)'),
  'video': createNode('视频', '#ef4444', 'rgba(239,68,68,0.08)'),
  'note': createNode('备注', '#6b7280', 'rgba(107,114,128,0.08)')
}

// ===== Canvas state =====
const elements = ref<any[]>([])
const selectedNodeId = ref('')
let nodeCounter = 0
const nextId = () => `n${++nodeCounter}_${Date.now()}`

// ===== Right-click menu =====
const ctxMenu = reactive({ show: false, x: 0, y: 0 })

function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  ctxMenu.show = true
  ctxMenu.x = event.clientX
  ctxMenu.y = event.clientY
}

function hideCtxMenu() { ctxMenu.show = false }

function addNode(type: string) {
  const labels: Record<string, string> = { shot: '分镜', asset: '资产', frame: '帧生图', video: '视频', note: '备注' }
  const id = nextId()

  // Convert screen coords to flow coords
  const flowEl = document.querySelector('.vue-flow-canvas')
  const rect = flowEl?.getBoundingClientRect()
  const x = rect ? ctxMenu.x - rect.left - 80 : 100
  const y = rect ? ctxMenu.y - rect.top - 20 : 100

  nodesToAdd.push({
    id, type,
    position: { x: Math.max(0, x), y: Math.max(0, y) },
    data: { label: labels[type] || type, desc: '', status: '' }
  })
  applyPendingNodes()
  hideCtxMenu()
}

// For converting screen coords
let pendingX = 100
let pendingY = 100

function addNodeSimple(type: string) {
  const labels: Record<string, string> = { shot: '分镜', asset: '资产', frame: '帧生图', video: '视频', note: '备注' }
  const id = nextId()
  nodesToAdd.push({
    id, type,
    position: { x: pendingX, y: pendingY },
    data: { label: labels[type], desc: '', status: '' }
  })
  pendingX += 220
  if (pendingX > 800) { pendingX = 100; pendingY += 150 }
  applyPendingNodes()
}

const nodesToAdd: any[] = []

function applyPendingNodes() {
  if (nodesToAdd.length === 0) return
  elements.value = [...elements.value, ...nodesToAdd]
  nodesToAdd.length = 0
}

// ===== Connect nodes =====
let connectFrom: string | null = null

function onConnect(params: any) {
  const { source, target } = params
  elements.value.push({
    id: `e-${source}-${target}`,
    source, target,
    style: { stroke: 'rgba(167,139,250,0.4)', strokeWidth: 1.5 },
    animated: true
  })
}

// ===== Quick-add from project data =====
function quickAddFromProject() {
  if (!props.projectData?.shots) return
  pendingX = 100; pendingY = 100; nodeCounter = 0
  for (const shot of props.projectData.shots || []) {
    addNodeSimple('shot')
    const last = elements.value[elements.value.length - 1]
    if (last) last.data = { label: `#${shot.shot_index} ${(shot.description||'').substring(0,20)}`, desc: '', status: shot.video_path ? 'done' : '' }
  }
}

// ===== Node click/drag handlers =====
function onNodeClick({ node }: any) {
  selectedNodeId.value = node.id
}

function onPaneClick() {
  selectedNodeId.value = ''
  hideCtxMenu()
}

// ===== Delete node =====
function deleteSelected() {
  if (!selectedNodeId.value) return
  elements.value = elements.value.filter((el: any) => {
    if (el.id === selectedNodeId.value) return false
    if (el.source === selectedNodeId.value || el.target === selectedNodeId.value) return false
    return true
  })
  selectedNodeId.value = ''
}

// ===== Keyboard shortcuts =====
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelected()
  }
}

// ===== Sidebar =====
const canvasNav = ref('shots')
const sidebarItems = [
  { key: 'characters', label: '角色', icon: '👤' },
  { key: 'scenes', label: '场景', icon: '🏠' },
  { key: 'props', label: '道具', icon: '🔧' },
  { key: 'shots', label: '分镜', icon: '🎬' },
  { key: 'library', label: '资产库', icon: '📁' }
]

// ===== Quick-add bar =====
const quickAddTypes = [
  { type: 'shot', label: '分镜', color: '#a78bfa' },
  { type: 'asset', label: '资产', color: '#3b82f6' },
  { type: 'frame', label: '帧', color: '#f59e0b' },
  { type: 'video', label: '视频', color: '#ef4444' },
  { type: 'note', label: '备注', color: '#6b7280' }
]
</script>

<template>
  <div class="canvas-layout" @keydown="onKeydown" tabindex="0">
    <aside class="canvas-sidebar">
      <div v-for="item in sidebarItems" :key="item.key" class="canvas-nav-item" :class="{ active: canvasNav === item.key }" @click="canvasNav = item.key">
        <span class="canvas-nav-icon">{{ item.icon }}</span>
        <span class="canvas-nav-label">{{ item.label }}</span>
      </div>
    </aside>

    <div class="canvas-main">
      <!-- Quick add bar -->
      <div class="canvas-quickbar">
        <span class="quickbar-label">添加节点：</span>
        <button v-for="qt in quickAddTypes" :key="qt.type" class="quickbar-btn" :style="{ borderColor: qt.color, color: qt.color }" @click="addNodeSimple(qt.type)">+ {{ qt.label }}</button>
        <span class="quickbar-sep">|</span>
        <button class="quickbar-btn" style="border-color:#a78bfa;color:#a78bfa" @click="quickAddFromProject">+ 从项目导入</button>
        <span class="quickbar-sep">|</span>
        <button v-if="selectedNodeId" class="quickbar-btn" style="border-color:#ef4444;color:#ef4444" @click="deleteSelected">🗑 删除选中</button>
      </div>

      <!-- Canvas -->
      <VueFlow
        v-model="elements"
        :default-viewport="{ x: 0, y: 0, zoom: 0.8 }"
        :min-zoom="0.1" :max-zoom="3"
        :node-types="nodeTypes"
        :connect-on-click="false"
        class="vue-flow-canvas"
        @pane-context-menu="onPaneContextMenu"
        @pane-click="onPaneClick"
        @node-click="onNodeClick"
        @connect="onConnect"
      >
        <Background :gap="20" />
      </VueFlow>

      <!-- Context menu -->
      <Teleport to="body">
        <div v-if="ctxMenu.show" class="canvas-ctxmenu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
          <div class="ctxmenu-item" @click="addNode('shot')">🎬 添加分镜节点</div>
          <div class="ctxmenu-item" @click="addNode('asset')">👤 添加资产节点</div>
          <div class="ctxmenu-item" @click="addNode('frame')">🖼 添加帧生图节点</div>
          <div class="ctxmenu-item" @click="addNode('video')">🎥 添加视频节点</div>
          <div class="ctxmenu-item" @click="addNode('note')">📝 添加备注</div>
        </div>
      </Teleport>

      <!-- Toolbar -->
      <div class="canvas-toolbar">
        <el-button size="small" @click="emit('back-to-editor')">返回编辑器</el-button>
        <span class="canvas-legend">
          <span class="leg" style="border-left-color:#a78bfa">分镜</span>
          <span class="leg" style="border-left-color:#3b82f6">资产</span>
          <span class="leg" style="border-left-color:#f59e0b">帧</span>
          <span class="leg" style="border-left-color:#ef4444">视频</span>
          <span class="leg" style="border-left-color:#6b7280">备注</span>
        </span>
        <span class="canvas-info">{{ elements.length }} 个元素 | 右键添加节点 | 选中后Delete删除 | 拖拽端口连线</span>
      </div>
    </div>

    <aside v-if="canvasNav === 'shots'" class="canvas-right-panel">
      <div class="canvas-shot-list">
        <div v-for="chapter in projectData?.chapters || []" :key="chapter.id">
          <div class="canvas-chapter-title">{{ chapter.title || `第${(chapter.chapter_index||0)+1}章` }}</div>
          <div v-for="shot in (projectData?.shots||[]).filter((s:any)=>s.chapter_id===chapter.id)" :key="shot.id" class="canvas-shot-item">
            <span class="shot-num">#{{ shot.shot_index }}</span>
            <span class="shot-desc">{{ (shot.description||'').substring(0,18) }}</span>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style>
.nm-node { border-radius: 6px; padding: 8px 10px; font-size: 11px; min-width: 150px; border: 1.5px solid; display: flex; flex-direction: column; gap: 3px; }
.nm-header { font-weight: 600; font-size: 12px; }
.nm-desc { font-size: 10px; color: #9ca3af; max-height: 24px; overflow: hidden; }
.nm-status { font-size: 11px; margin-top: 2px; }
.canvas-ctxmenu { position: fixed; z-index: 10000; background: #1f1f28; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 4px; min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
.ctxmenu-item { padding: 8px 12px; font-size: 12px; color: #e5e7eb; cursor: pointer; border-radius: 4px; }
.ctxmenu-item:hover { background: rgba(167,139,250,0.15); color: #c4b5fd; }
</style>

<style scoped>
.canvas-layout { display: flex; width: 100%; height: 100%; background: #0f0f11; outline: none; }
.canvas-sidebar { width: 56px; flex-shrink: 0; background: rgba(255,255,255,0.02); border-right: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; padding: 8px 0; }
.canvas-nav-item { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px; cursor: pointer; color: #6b7280; transition: all 0.15s; border-left: 3px solid transparent; }
.canvas-nav-item:hover, .canvas-nav-item.active { color: #c4b5fd; background: rgba(167,139,250,0.1); border-left-color: #a78bfa; }
.canvas-nav-icon { font-size: 18px; } .canvas-nav-label { font-size: 10px; }
.canvas-main { flex: 1; position: relative; display: flex; flex-direction: column; }
.canvas-quickbar { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; }
.quickbar-label { font-size: 11px; color: #6b7280; }
.quickbar-btn { font-size: 10px; padding: 2px 8px; background: transparent; border: 1px solid; border-radius: 4px; cursor: pointer; }
.quickbar-btn:hover { opacity: 0.8; }
.quickbar-sep { color: #374151; font-size: 12px; }
.vue-flow-canvas { flex: 1; background: #0f0f11; }
.canvas-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: rgba(255,255,255,0.03); border-top: 1px solid rgba(255,255,255,0.06); }
.canvas-legend { display: flex; gap: 12px; font-size: 10px; }
.leg { padding: 1px 6px; border-radius: 3px; color: #9ca3af; border-left: 3px solid; }
.canvas-info { font-size: 10px; color: #6b7280; }
.canvas-right-panel { width: 200px; flex-shrink: 0; background: rgba(255,255,255,0.02); border-left: 1px solid rgba(255,255,255,0.06); overflow-y: auto; }
.canvas-shot-list { padding: 8px; }
.canvas-chapter-title { font-size: 11px; font-weight: 600; color: #c4b5fd; padding: 6px 8px; }
.canvas-shot-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; border-radius: 4px; font-size: 11px; color: #9ca3af; }
.shot-num { color: #a78bfa; font-weight: 600; flex-shrink: 0; } .shot-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
