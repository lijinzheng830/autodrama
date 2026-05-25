<script setup lang="ts">
import { ref, reactive, h, defineComponent, nextTick, computed } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{ projectData: any; projectId: string }>()
const emit = defineEmits<{ (e: 'back-to-editor'): void }>()

// ===== Custom Nodes with action buttons =====
const genMsg = ref('')
const genLoading = ref(false)

const AssetNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    const doGen = async (e: Event) => {
      e.stopPropagation()
      if (genLoading.value) return
      genLoading.value = true; genMsg.value = '生成中...'
      try {
        const win = (window as any)
        if (!p.data.assetId || !p.data.assetType) { genMsg.value = '缺少资产信息'; return }
        await win.api?.generateImage({ projectId: p.data.projectId, type: p.data.assetType, assetId: p.data.assetId, description: p.data.assetDesc || p.data.label || '', count: 1 })
        genMsg.value = '生成完成!'
        p.data.status = 'done'
        p.data.completed = true
      } catch (err: any) { genMsg.value = '失败: ' + (err?.message || '')
      } finally { genLoading.value = false; setTimeout(() => { genMsg.value = '' }, 3000) }
    }
    return () => h('div', { class: `nm-node asset-node${p.data.status==='done'?' completed':''}`, style: { borderColor: '#3b82f6', background: 'rgba(59,130,246,0.08)' } }, [
      h('div', { class: 'nm-header', style: { color: '#60a5fa' } }, p.data.label),
      p.data.desc ? h('div', { class: 'nm-desc' }, p.data.desc) : null,
      p.data.status === 'done'
        ? h('div', { class: 'nm-status done' }, '✓')
        : h('button', { class: 'nm-gen-btn', style: 'border-color:#3b82f6;color:#60a5fa', onClick: doGen }, '⚡ 生图')
    ])
  }
})

const VideoNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    const doGen = async (e: Event) => {
      e.stopPropagation()
      if (genLoading.value) return
      genLoading.value = true; genMsg.value = '提交视频任务...'
      try {
        const win = (window as any)
        if (!p.data.shotId) { genMsg.value = '缺少分镜ID'; return }
        await win.api?.generateVideo({ projectId: p.data.projectId, shotId: p.data.shotId })
        genMsg.value = '视频任务已提交'
      } catch (err: any) { genMsg.value = '失败: ' + (err?.message || '')
      } finally { genLoading.value = false; setTimeout(() => { genMsg.value = '' }, 3000) }
    }
    return () => h('div', { class: `nm-node video-node${p.data.status==='done'?' completed':''}`, style: { borderColor: '#ef4444', background: 'rgba(239,68,68,0.08)' } }, [
      h('div', { class: 'nm-header', style: { color: '#fca5a5' } }, p.data.label),
      p.data.desc ? h('div', { class: 'nm-desc' }, p.data.desc) : null,
      p.data.status === 'done'
        ? h('div', { class: 'nm-status done' }, '✓')
        : h('button', { class: 'nm-gen-btn', style: 'border-color:#ef4444;color:#fca5a5', onClick: doGen }, '⚡ 生视频')
    ])
  }
})

const SimpleNode = (color: string, bgColor: string, labelColor: string) => defineComponent({
  props: ['data'],
  setup(p: any) {
    return () => h('div', { class: 'nm-node', style: { borderColor: color, background: bgColor } }, [
      h('div', { class: 'nm-header', style: { color: labelColor } }, p.data.label),
      p.data.desc ? h('div', { class: 'nm-desc' }, p.data.desc) : null,
      p.data.status === 'done' ? h('div', { class: 'nm-status done' }, '✓') : null
    ])
  }
})

const nodeTypes = {
  'shot': SimpleNode('#a78bfa', 'rgba(167,139,250,0.08)', '#c4b5fd'),
  'asset': AssetNode,
  'frame': SimpleNode('#f59e0b', 'rgba(245,158,11,0.08)', '#fcd34d'),
  'video': VideoNode,
  'note': SimpleNode('#6b7280', 'rgba(107,114,128,0.08)', '#9ca3af')
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
const edgesToAdd: any[] = []

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

function addShotNode(shot: any) {
  const baseX = 100
  const baseY = pendingY
  const shotId = nextId()
  const sid = shot.id

  // --- Row 0: Shot node ---
  nodesToAdd.push({
    id: shotId, type: 'shot',
    position: { x: baseX, y: baseY },
    data: { label: `#${shot.shot_index} ${(shot.description||'').substring(0,25)}`, desc: '分镜', status: '' }
  })

  let yOff = 0
  const col1X = 300
  const col2X = 520
  const col3X = 740
  const col4X = 960

  // --- Column 1: Characters/Scenes/Props ---
  const chars = shot.characters || []
  for (const c of chars) {
    const nid = nextId()
    nodesToAdd.push({ id: nid, type: 'asset', position: { x: col1X, y: baseY + yOff }, data: { label: `角色: ${c.name}`, desc: c.description?.substring(0,25)||'生图', status: c.reference_image ? 'done' : '', projectId: props.projectId, assetId: c.id, assetType: 'character', assetDesc: c.description || c.name } })
    edgesToAdd.push({ id: `e-s-${nid}`, source: shotId, target: nid, style: { stroke: 'rgba(59,130,246,0.3)', strokeWidth: 1 }, animated: false })
    yOff += 70
  }
  for (const s of shot.scenes || []) {
    const nid = nextId()
    nodesToAdd.push({ id: nid, type: 'asset', position: { x: col1X, y: baseY + yOff }, data: { label: `场景: ${s.name}`, desc: s.description?.substring(0,25)||'生图', status: s.reference_image ? 'done' : '', projectId: props.projectId, assetId: s.id, assetType: 'scene', assetDesc: s.description || s.name } })
    edgesToAdd.push({ id: `e-s-${nid}`, source: shotId, target: nid, style: { stroke: 'rgba(16,185,129,0.3)', strokeWidth: 1 }, animated: false })
    yOff += 70
  }
  for (const p of shot.props || []) {
    const nid = nextId()
    nodesToAdd.push({ id: nid, type: 'asset', position: { x: col1X, y: baseY + yOff }, data: { label: `道具: ${p.name}`, desc: p.description?.substring(0,25)||'生图', status: p.reference_image ? 'done' : '', projectId: props.projectId, assetId: p.id, assetType: 'prop', assetDesc: p.description || p.name } })
    edgesToAdd.push({ id: `e-s-${nid}`, source: shotId, target: nid, style: { stroke: 'rgba(139,92,246,0.3)', strokeWidth: 1 }, animated: false })
    yOff += 70
  }
  const col1H = yOff

  // --- Column 2: First/Last Frame prompts ---
  let fyOff = 0
  if (shot.first_frame_prompt) {
    const nid = nextId()
    nodesToAdd.push({ id: nid, type: 'frame', position: { x: col2X, y: baseY + fyOff }, data: { label: '首帧提示词', desc: (shot.first_frame_prompt||'').substring(0,25), status: '' } })
    edgesToAdd.push({ id: `e-ff-${nid}`, source: shotId, target: nid, style: { stroke: 'rgba(245,158,11,0.3)', strokeWidth: 1, animated: false } })
    const rid = nextId()
    nodesToAdd.push({ id: rid, type: 'note', position: { x: col3X, y: baseY + fyOff }, data: { label: '首帧图', desc: '', status: shot.first_frame_image_path ? 'done' : '' } })
    edgesToAdd.push({ id: `e-ffr-${rid}`, source: nid, target: rid, style: { stroke: 'rgba(245,158,11,0.2)', strokeWidth: 1, animated: false } })
    fyOff += 80
  }
  if (shot.last_frame_prompt) {
    const nid = nextId()
    nodesToAdd.push({ id: nid, type: 'frame', position: { x: col2X, y: baseY + fyOff }, data: { label: '尾帧提示词', desc: (shot.last_frame_prompt||'').substring(0,25), status: '' } })
    edgesToAdd.push({ id: `e-lf-${nid}`, source: shotId, target: nid, style: { stroke: 'rgba(245,158,11,0.3)', strokeWidth: 1, animated: false } })
    const rid = nextId()
    nodesToAdd.push({ id: rid, type: 'note', position: { x: col3X, y: baseY + fyOff }, data: { label: '尾帧图', desc: '', status: shot.last_frame_image_path ? 'done' : '' } })
    edgesToAdd.push({ id: `e-lfr-${rid}`, source: nid, target: rid, style: { stroke: 'rgba(245,158,11,0.2)', strokeWidth: 1, animated: false } })
    fyOff += 80
  }
  const col2H = fyOff

  // --- Column 4: Video ---
  if (shot.video_prompt) {
    const nid = nextId()
    nodesToAdd.push({ id: nid, type: 'video', position: { x: col4X, y: baseY }, data: { label: '视频生成', desc: (shot.video_prompt||'').substring(0,25), status: shot.video_path ? 'done' : '', projectId: props.projectId, shotId: shot.id } })
    edgesToAdd.push({ id: `e-vid-${nid}`, source: shotId, target: nid, style: { stroke: 'rgba(239,68,68,0.3)', strokeWidth: 1, animated: false } })
    const rid = nextId()
    nodesToAdd.push({ id: rid, type: 'note', position: { x: col4X + 200, y: baseY }, data: { label: '视频', desc: '', status: shot.video_path ? 'done' : '' } })
    edgesToAdd.push({ id: `e-vidr-${rid}`, source: nid, target: rid, style: { stroke: 'rgba(239,68,68,0.2)', strokeWidth: 1, animated: false } })
  }

  const maxH = Math.max(col1H, col2H, 80)
  pendingY += maxH + 40
  applyPendingNodes()

  // Apply edges after a tick (nodes must exist first)
  setTimeout(() => {
    elements.value = [...elements.value, ...edgesToAdd]
    edgesToAdd.length = 0
  }, 50)
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
        <span v-if="genMsg" class="canvas-gen-msg">{{ genMsg }}</span>
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
          <div v-for="shot in (projectData?.shots||[]).filter((s:any)=>s.chapter_id===chapter.id)" :key="shot.id" class="canvas-shot-item" @click="addShotNode(shot)">
            <span class="shot-num">#{{ shot.shot_index }}</span>
            <span class="shot-desc">{{ (shot.description||'').substring(0,18) }}</span>
            <span class="shot-add">+</span>
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
.nm-status.done { color: #22c55e; font-weight: 700; }
.nm-gen-btn { margin-top: 4px; padding: 2px 8px; font-size: 10px; background: rgba(0,0,0,0.2); border: 1px solid; border-radius: 4px; cursor: pointer; width: 100%; }
.nm-gen-btn:hover { opacity: 0.8; }
.asset-node.completed { border-color: #22c55e !important; }
.video-node.completed { border-color: #22c55e !important; }
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
.shot-num { color: #a78bfa; font-weight: 600; flex-shrink: 0; } .shot-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.shot-add { color: #22c55e; font-weight: 700; font-size: 14px; flex-shrink: 0; opacity: 0; transition: opacity 0.15s; }
.canvas-shot-item:hover .shot-add { opacity: 1; }
</style>
