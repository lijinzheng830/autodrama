<script setup lang="ts">
import { ref, watch, h, defineComponent } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{
  projectData: any
  projectId: string
}>()

const emit = defineEmits<{
  (e: 'back-to-editor'): void
  (e: 'focus-shot', shotId: string): void
  (e: 'generate-video', shotId: string): void
}>()

function handleVideoGenerate(shotId: string) {
  emit('generate-video', shotId)
}

// ===== Custom Nodes using h() render functions =====
const AssetGenNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    return () => h('div', {
      class: `cnode cnode-asset${p.data.completed ? ' completed' : ''}`
    }, [
      h('div', { class: 'cnode-header' }, p.data.label),
      p.data.prompt ? h('div', { class: 'cnode-prompt' }, p.data.prompt) : null,
      h('div', { class: 'cnode-status' }, p.data.completed ? '✓ 已生成' : '○ 待生成')
    ])
  }
})

const FrameGenNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    return () => h('div', {
      class: `cnode cnode-frame${p.data.completed ? ' completed' : ''}`
    }, [
      h('div', { class: 'cnode-header' }, p.data.label),
      p.data.prompt ? h('div', { class: 'cnode-prompt' }, p.data.prompt) : null,
      h('div', { class: 'cnode-status' }, p.data.completed ? '✓ 已生成' : '○ 待生成')
    ])
  }
})

const ResultNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    return () => h('div', {
      class: `cnode cnode-result${p.data.completed ? ' completed' : ''}`
    }, [
      h('div', { class: 'cnode-header' }, p.data.label),
      p.data.completed && p.data.thumbSrc
        ? h('img', { class: 'cnode-result-img', src: p.data.thumbSrc, style: 'width:60px;height:40px;object-fit:cover;border-radius:4px;margin-top:2px' })
        : h('div', { class: 'cnode-thumb' }, p.data.completed ? '📁' : '⬚')
    ])
  }
})

const VideoGenNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    return () => h('div', {
      class: `cnode cnode-video${p.data.completed ? ' completed' : ''}`
    }, [
      h('div', { class: 'cnode-header' }, p.data.label),
      p.data.prompt ? h('div', { class: 'cnode-prompt' }, p.data.prompt) : null,
      h('div', { class: 'cnode-status' }, p.data.completed ? '✓ 已生成' : '○ 待生成'),
      !p.data.completed && p.data.onGenerate ? h('button', {
        class: 'cnode-gen-btn',
        onClick: (e: Event) => { e.stopPropagation(); p.data.onGenerate(p.data.shotId) }
      }, '⚡ 生视频') : null
    ])
  }
})

const nodeTypes = {
  'asset-gen': AssetGenNode,
  'frame-gen': FrameGenNode,
  'result': ResultNode,
  'video-gen': VideoGenNode
}

// ===== State =====
const elements = ref<any[]>([])
const selectedFlow = ref<string>('')

// Column layout constants
const COL_X = {
  shot: 0,
  asset: 220,
  assetResult: 420,
  frame: 620,
  frameResult: 820,
  video: 1020,
  videoResult: 1220
}
const COL_W = { main: 200, asset: 180, result: 120 }
const ROW_H = { header: 40, asset: 96, result: 50, gap: 20 }

function buildElements() {
  const chapters = props.projectData?.chapters || []
  const allShots = props.projectData?.shots || []
  if (!chapters.length && !allShots.length) return

  const nodes: any[] = []
  const edges: any[] = []
  let y = 0

  for (const chapter of chapters) {
    const chapterShots = allShots.filter((s: any) => s.chapter_id === chapter.id)
    if (!chapterShots.length) continue

    // Chapter header
    nodes.push({
      id: `ch-${chapter.id}`, type: 'default',
      position: { x: 0, y },
      data: { label: chapter.title || `第${(chapter.chapter_index || 0) + 1}章` },
      style: { background: 'rgba(167,139,250,0.15)', border: '1px solid #a78bfa', color: '#c4b5fd', fontWeight: '700', width: '100%', minWidth: 1400, fontSize: '14px', borderRadius: '6px' }
    })
    y += ROW_H.header + 8

    for (let si = 0; si < chapterShots.length; si++) {
      const shot = chapterShots[si]
      const shotId = shot.id
      const baseY = y
      let maxRowY = baseY

      // ---- 1. Shot node ----
      const shotNodeId = `shot-${shotId}`
      nodes.push({
        id: shotNodeId, type: 'default',
        position: { x: COL_X.shot, y },
        data: { label: `#${shot.shot_index || si + 1} ${(shot.description || '').substring(0, 25)}` },
        style: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.2)', color: '#f3f4f6', width: COL_W.main, fontSize: '11px', padding: '8px', minHeight: 50 }
      })

      // ---- 2. Asset gen nodes (角色/场景/道具) ----
      const chars = shot.characters || []
      const scenes = shot.scenes || []
      const props = shot.props || []
      let assetY = baseY

      // Character gen nodes
      for (const c of chars) {
        const nid = `char-${shotId}-${c.id}`
        nodes.push({
          id: nid, type: 'asset-gen',
          position: { x: COL_X.asset, y: assetY },
          data: { label: `角色: ${c.name}`, prompt: (c.description || '').substring(0, 30), model: '', completed: !!c.reference_image }
        })
        edges.push({ id: `e-sc-${nid}`, source: shotNodeId, target: nid, style: { stroke: 'rgba(59,130,246,0.4)', strokeWidth: 1.5 } })

        // Character result node
        const rnid = `char-r-${shotId}-${c.id}`
        nodes.push({
          id: rnid, type: 'result',
          position: { x: COL_X.assetResult, y: assetY + 8 },
          data: { label: '定妆照', completed: !!c.reference_image, thumbSrc: c.reference_image ? `file:///${c.reference_image.replace(/\\/g, '/')}` : '' }
        })
        edges.push({ id: `e-cr-${rnid}`, source: nid, target: rnid, style: { stroke: 'rgba(59,130,246,0.2)' } })

        // Edge from result to frame gen
        if (shot.first_frame_prompt) {
          edges.push({ id: `e-crf-${rnid}`, source: rnid, target: `ff-${shotId}`, style: { stroke: 'rgba(245,158,11,0.2)', strokeDasharray: '4,4' } })
        }

        assetY += ROW_H.asset + 4
      }

      // Scene gen node
      if (scenes.length > 0 && scenes[0]) {
        const sc = scenes[0]
        const snid = `scene-${shotId}-${sc.id}`
        nodes.push({
          id: snid, type: 'asset-gen',
          position: { x: COL_X.asset, y: assetY },
          data: { label: `场景: ${sc.name}`, prompt: (sc.description || '').substring(0, 30), completed: !!sc.reference_image }
        })
        edges.push({ id: `e-ss-${snid}`, source: shotNodeId, target: snid, style: { stroke: 'rgba(16,185,129,0.4)', strokeWidth: 1.5 } })
        const rnid = `scene-r-${shotId}-${sc.id}`
        nodes.push({ id: rnid, type: 'result', position: { x: COL_X.assetResult, y: assetY + 8 }, data: { label: '场景图', completed: !!sc.reference_image, thumbSrc: sc.reference_image ? `file:///${sc.reference_image.replace(/\\/g, '/')}` : '' } })
        edges.push({ id: `e-sr-${rnid}`, source: snid, target: rnid, style: { stroke: 'rgba(16,185,129,0.2)' } })
        if (shot.first_frame_prompt) { edges.push({ id: `e-srf-${rnid}`, source: rnid, target: `ff-${shotId}`, style: { stroke: 'rgba(245,158,11,0.2)', strokeDasharray: '4,4' } }) }
        assetY += ROW_H.asset + 4
      }

      // Prop gen nodes
      for (const p of props) {
        const pnid = `prop-${shotId}-${p.id}`
        nodes.push({ id: pnid, type: 'asset-gen', position: { x: COL_X.asset, y: assetY }, data: { label: `道具: ${p.name}`, prompt: (p.description || '').substring(0, 30), completed: !!p.reference_image } })
        edges.push({ id: `e-sp-${pnid}`, source: shotNodeId, target: pnid, style: { stroke: 'rgba(139,92,246,0.4)', strokeWidth: 1.5 } })
        const rnid = `prop-r-${shotId}-${p.id}`
        nodes.push({ id: rnid, type: 'result', position: { x: COL_X.assetResult, y: assetY + 8 }, data: { label: '道具图', completed: !!p.reference_image, thumbSrc: p.reference_image ? `file:///${p.reference_image.replace(/\\/g, '/')}` : '' } })
        edges.push({ id: `e-pr-${rnid}`, source: pnid, target: rnid, style: { stroke: 'rgba(139,92,246,0.2)' } })
        if (shot.first_frame_prompt) { edges.push({ id: `e-prf-${rnid}`, source: rnid, target: `ff-${shotId}`, style: { stroke: 'rgba(245,158,11,0.2)', strokeDasharray: '4,4' } }) }
        assetY += ROW_H.asset + 4
      }

      maxRowY = Math.max(maxRowY, assetY)

      // ---- 3. Frame gen nodes (首帧/尾帧) ----
      let frameY = baseY
      if (shot.first_frame_prompt) {
        const ffid = `ff-${shotId}`
        nodes.push({
          id: ffid, type: 'frame-gen',
          position: { x: COL_X.frame, y: frameY },
          data: { label: '首帧生图', prompt: (shot.first_frame_prompt || '').substring(0, 40), completed: !!shot.first_frame_image_path }
        })
        edges.push({ id: `e-fff-${ffid}`, source: shotNodeId, target: ffid, style: { stroke: 'rgba(245,158,11,0.4)', strokeWidth: 1.5 } })

        // Frame result
        const ffrid = `ff-r-${shotId}`
        nodes.push({
          id: ffrid, type: 'result',
          position: { x: COL_X.frameResult, y: frameY + 8 },
          data: { label: '首帧图', completed: !!shot.first_frame_image_path, thumbSrc: shot.first_frame_image_path ? `file:///${shot.first_frame_image_path.replace(/\\/g, '/')}` : '' }
        })
        edges.push({ id: `e-ffr-${ffrid}`, source: ffid, target: ffrid, style: { stroke: 'rgba(245,158,11,0.2)' } })

        // Edge to video gen
        if (shot.video_prompt) {
          edges.push({ id: `e-fv-${ffrid}`, source: ffrid, target: `vid-${shotId}`, style: { stroke: 'rgba(239,68,68,0.2)', strokeDasharray: '4,4' } })
        }

        frameY += ROW_H.asset + 4
      }

      if (shot.last_frame_prompt) {
        const lfid = `lf-${shotId}`
        nodes.push({
          id: lfid, type: 'frame-gen',
          position: { x: COL_X.frame, y: frameY },
          data: { label: '尾帧生图', prompt: (shot.last_frame_prompt || '').substring(0, 40), completed: !!shot.last_frame_image_path }
        })
        edges.push({ id: `e-lff-${lfid}`, source: shotNodeId, target: lfid, style: { stroke: 'rgba(245,158,11,0.4)', strokeWidth: 1.5 } })
        const lfrid = `lf-r-${shotId}`
        nodes.push({ id: lfrid, type: 'result', position: { x: COL_X.frameResult, y: frameY + 8 }, data: { label: '尾帧图', completed: !!shot.last_frame_image_path, thumbSrc: shot.last_frame_image_path ? `file:///${shot.last_frame_image_path.replace(/\\/g, '/')}` : '' } })
        edges.push({ id: `e-lfr-${lfrid}`, source: lfid, target: lfrid, style: { stroke: 'rgba(245,158,11,0.2)' } })
        if (shot.video_prompt) { edges.push({ id: `e-lv-${lfrid}`, source: lfrid, target: `vid-${shotId}`, style: { stroke: 'rgba(239,68,68,0.2)', strokeDasharray: '4,4' } }) }
        frameY += ROW_H.asset + 4
      }

      maxRowY = Math.max(maxRowY, frameY)

      // ---- 4. Video gen node ----
      if (shot.video_prompt) {
        const vid = `vid-${shotId}`
        nodes.push({
          id: vid, type: 'video-gen',
          position: { x: COL_X.video, y: baseY + 8 },
          data: { label: '视频生成', prompt: (shot.video_prompt || '').substring(0, 40), completed: !!shot.video_path, shotId, onGenerate: handleVideoGenerate }
        })
        edges.push({ id: `e-vv-${vid}`, source: shotNodeId, target: vid, style: { stroke: 'rgba(239,68,68,0.4)', strokeWidth: 1.5 } })

        const vrid = `vid-r-${shotId}`
        nodes.push({
          id: vrid, type: 'result',
          position: { x: COL_X.videoResult, y: baseY + 16 },
          data: { label: '视频', completed: !!shot.video_path, thumbSrc: shot.video_path ? `file:///${shot.video_path.replace(/\\/g, '/')}` : '' }
        })
        edges.push({ id: `e-vr-${vrid}`, source: vid, target: vrid, style: { stroke: 'rgba(239,68,68,0.2)' } })

        maxRowY = Math.max(maxRowY, baseY + ROW_H.asset + 10)
      }

      y = maxRowY + ROW_H.gap
    }
    y += 20
  }

  elements.value = [...nodes, ...edges]
}

watch(() => props.projectData?.shots?.length, () => { if (props.projectData) buildElements() }, { immediate: true })

// ===== Side Panel =====
const canvasNav = ref('shots')
const canvasPanelItems = [
  { key: 'characters', label: '角色', icon: '👤' },
  { key: 'scenes', label: '场景', icon: '🏠' },
  { key: 'props', label: '道具', icon: '🔧' },
  { key: 'shots', label: '分镜', icon: '🎬' },
  { key: 'library', label: '资产库', icon: '📁' }
]

function focusShot(shotId: string) {
  selectedFlow.value = shotId
  emit('focus-shot', shotId)
}
</script>

<template>
  <div class="canvas-layout">
    <aside class="canvas-sidebar">
      <div v-for="item in canvasPanelItems" :key="item.key" class="canvas-nav-item" :class="{ active: canvasNav === item.key }" @click="canvasNav = item.key">
        <span class="canvas-nav-icon">{{ item.icon }}</span>
        <span class="canvas-nav-label">{{ item.label }}</span>
      </div>
    </aside>

    <div class="canvas-main">
      <VueFlow v-model="elements" :default-viewport="{ x: 0, y: 0, zoom: 0.7 }" :min-zoom="0.15" :max-zoom="2" :node-types="nodeTypes" class="vue-flow-canvas" :fit-view-on-init="true">
        <Background :gap="24" />
      </VueFlow>

      <div class="canvas-toolbar">
        <el-button size="small" @click="emit('back-to-editor')">返回编辑器</el-button>
        <span class="canvas-legend">
          <span class="leg leg-asset">资产生图</span>
          <span class="leg leg-frame">帧生图</span>
          <span class="leg leg-video">视频生成</span>
          <span class="leg leg-result">结果</span>
        </span>
        <span class="canvas-info">{{ elements.length }} 个元素</span>
      </div>
    </div>

    <aside v-if="canvasNav === 'shots'" class="canvas-right-panel">
      <div class="canvas-shot-list">
        <div v-for="chapter in projectData?.chapters || []" :key="chapter.id">
          <div class="canvas-chapter-title">{{ chapter.title || `第${(chapter.chapter_index||0)+1}章` }}</div>
          <div v-for="shot in (projectData?.shots||[]).filter((s:any)=>s.chapter_id===chapter.id)" :key="shot.id" class="canvas-shot-item" :class="{ active: selectedFlow === shot.id }" @click="focusShot(shot.id)">
            <span class="shot-num">#{{ shot.shot_index }}</span>
            <span class="shot-desc">{{ (shot.description||'').substring(0,18) }}</span>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style>
/* Custom node styles (not scoped for VueFlow) */
.cnode { border-radius: 6px; padding: 6px 8px; font-size: 10px; min-width: 160px; min-height: 60px; display: flex; flex-direction: column; gap: 2px; border: 1px solid rgba(255,255,255,0.1); }
.cnode-header { font-weight: 600; font-size: 11px; color: #e5e7eb; }
.cnode-prompt { font-size: 9px; color: #6b7280; max-height: 28px; overflow: hidden; }
.cnode-model { font-size: 9px; color: #4b5563; }
.cnode-status { font-size: 9px; margin-top: 2px; color: #6b7280; }
.cnode.completed .cnode-status { color: #22c55e; }

.cnode-asset { background: rgba(30,30,40,0.95); border-color: rgba(59,130,246,0.3); }
.cnode-asset.completed { border-color: #22c55e; }
.cnode-frame { background: rgba(30,30,40,0.95); border-color: rgba(245,158,11,0.3); }
.cnode-frame.completed { border-color: #22c55e; }
.cnode-video { background: rgba(30,30,40,0.95); border-color: rgba(239,68,68,0.3); }
.cnode-video.completed { border-color: #22c55e; }
.cnode-result { background: rgba(30,30,40,0.95); border-color: rgba(34,197,94,0.3); min-width: 100px; min-height: 44px; align-items: center; }
.cnode-result.completed { border-color: #22c55e; background: rgba(34,197,94,0.05); }
.cnode-thumb { font-size: 18px; }
.cnode-gen-btn { margin-top: 4px; padding: 2px 8px; font-size: 10px; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.4); color: #fca5a5; border-radius: 4px; cursor: pointer; width: 100%; }
.cnode-gen-btn:hover { background: rgba(239,68,68,0.3); }
</style>

<style scoped>
.canvas-layout { display: flex; width: 100%; height: 100%; background: #0f0f11; }
.canvas-sidebar { width: 56px; flex-shrink: 0; background: rgba(255,255,255,0.02); border-right: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; padding: 8px 0; }
.canvas-nav-item { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px; cursor: pointer; color: #6b7280; transition: all 0.15s; border-left: 3px solid transparent; }
.canvas-nav-item:hover, .canvas-nav-item.active { color: #c4b5fd; background: rgba(167,139,250,0.1); border-left-color: #a78bfa; }
.canvas-nav-icon { font-size: 18px; } .canvas-nav-label { font-size: 10px; }
.canvas-main { flex: 1; position: relative; display: flex; flex-direction: column; }
.vue-flow-canvas { flex: 1; background: #0f0f11; }
.canvas-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: rgba(255,255,255,0.03); border-top: 1px solid rgba(255,255,255,0.06); }
.canvas-legend { display: flex; gap: 12px; font-size: 10px; }
.leg { padding: 1px 6px; border-radius: 3px; color: #9ca3af; }
.leg-asset { border-left: 3px solid #3b82f6; }
.leg-frame { border-left: 3px solid #f59e0b; }
.leg-video { border-left: 3px solid #ef4444; }
.leg-result { border-left: 3px solid #22c55e; }
.canvas-info { font-size: 10px; color: #6b7280; }
.canvas-right-panel { width: 200px; flex-shrink: 0; background: rgba(255,255,255,0.02); border-left: 1px solid rgba(255,255,255,0.06); overflow-y: auto; }
.canvas-shot-list { padding: 8px; }
.canvas-chapter-title { font-size: 11px; font-weight: 600; color: #c4b5fd; padding: 6px 8px; }
.canvas-shot-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; border-radius: 4px; font-size: 11px; color: #9ca3af; }
.canvas-shot-item:hover, .canvas-shot-item.active { background: rgba(255,255,255,0.05); color: #e5e7eb; }
.shot-num { color: #a78bfa; font-weight: 600; flex-shrink: 0; }
.shot-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
