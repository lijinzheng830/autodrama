<script setup lang="ts">
import { ref, reactive, h, defineComponent } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const props = defineProps<{ projectData: any; projectId: string }>()
const emit = defineEmits<{ (e: 'back-to-editor'): void }>()

const genMsg = ref('')
const genLoading = ref(false)

// Update connected image result node after generation
function refreshConnectedImage(sourceNodeId: string, imgPath: string) {
  setTimeout(() => {
    const imgNode = elements.value.find((el: any) =>
      el.type === 'image' && elements.value.some((edge: any) => edge.source === sourceNodeId && edge.target === el.id)
    )
    if (imgNode && imgPath) {
      imgNode.data.status = 'done'
      imgNode.data.imgSrc = `file:///${imgPath.replace(/\\/g, '/')}`
      elements.value = [...elements.value] // trigger reactivity
    }
  }, 2000)
}

// ===== Custom Nodes =====
const AssetNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    const doGen = async (e: Event) => { e.stopPropagation(); if(genLoading.value)return; genLoading.value=true; genMsg.value='生成中...'
      try { await (window as any).api?.generateImage({projectId:p.data.projectId,type:p.data.assetType,assetId:p.data.assetId,description:p.data.assetDesc||p.data.label,count:1}); p.data.status='done'; genMsg.value='完成!' }
      catch(err:any){ genMsg.value='失败:'+(err?.message||'') } finally { genLoading.value=false; setTimeout(()=>genMsg.value='',3000) } }
    return () => h('div',{class:`nm-node${p.data.status==='done'?' completed':''}`,style:{borderColor:'#3b82f6',background:'rgba(59,130,246,0.08)'}},[
      h('div',{class:'nm-header',style:{color:'#60a5fa'}},p.data.label),
      h('div',{class:'nm-desc'},p.data.desc||''),
      p.data.status==='done'
        ? h('div',{class:'nm-actions'},[h('span',{class:'nm-status done'},'✓'),h('button',{class:'nm-gen-btn small',style:'border-color:#3b82f6;color:#60a5fa',onClick:doGen},'🔄')])
        : h('button',{class:'nm-gen-btn',style:'border-color:#3b82f6;color:#60a5fa',onClick:doGen},'⚡ 生图')
    ])
  }
})

const FrameNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    const doGen = async (e: Event) => { e.stopPropagation(); if(genLoading.value)return; genLoading.value=true; genMsg.value=`生成${p.data.frameType==='first'?'首帧':'尾帧'}中...`
      try { await (window as any).api?.generateShotImage({projectId:p.data.projectId,shotId:p.data.shotId,frameType:p.data.frameType||'first',count:1}); p.data.status='done'; genMsg.value='完成!' }
      catch(err:any){ genMsg.value='失败:'+(err?.message||'') } finally { genLoading.value=false; setTimeout(()=>genMsg.value='',3000) } }
    return () => h('div',{class:`nm-node frame-node${p.data.status==='done'?' completed':''}`,style:{borderColor:'#f59e0b',background:'rgba(245,158,11,0.08)'}},[
      h('div',{class:'nm-header',style:{color:'#fcd34d'}},p.data.label),
      h('div',{class:'nm-desc'},(p.data.desc||'').substring(0,30)),
      p.data.status==='done'
        ? h('div',{class:'nm-actions'},[h('span',{class:'nm-status done'},'✓'),h('button',{class:'nm-gen-btn small',style:'border-color:#f59e0b;color:#fcd34d',onClick:doGen},'🔄')])
        : h('button',{class:'nm-gen-btn',style:'border-color:#f59e0b;color:#fcd34d',onClick:doGen},'⚡ 生图')
    ])
  }
})

const VideoNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    const doGen = async (e: Event) => { e.stopPropagation(); if(genLoading.value)return; genLoading.value=true; genMsg.value='提交视频任务...'
      try { await (window as any).api?.generateVideo({projectId:p.data.projectId,shotId:p.data.shotId}); genMsg.value='已提交' }
      catch(err:any){ genMsg.value='失败:'+(err?.message||'') } finally { genLoading.value=false; setTimeout(()=>genMsg.value='',3000) } }
    return () => h('div',{class:`nm-node video-node${p.data.status==='done'?' completed':''}`,style:{borderColor:'#ef4444',background:'rgba(239,68,68,0.08)'}},[
      h('div',{class:'nm-header',style:{color:'#fca5a5'}},p.data.label),
      h('div',{class:'nm-desc'},(p.data.desc||'').substring(0,30)),
      p.data.status==='done'
        ? h('div',{class:'nm-actions'},[h('span',{class:'nm-status done'},'✓'),h('button',{class:'nm-gen-btn small',style:'border-color:#ef4444;color:#fca5a5',onClick:doGen},'🔄')])
        : h('button',{class:'nm-gen-btn',style:'border-color:#ef4444;color:#fca5a5',onClick:doGen},'⚡ 生视频')
    ])
  }
})

const imgPreview = reactive({ show: false, src: '' })
function showImgPreview(src: string) { if(!src)return; imgPreview.show=true; imgPreview.src=src }
function hideImgPreview() { imgPreview.show=false; imgPreview.src='' }

const ImageNode = defineComponent({
  props: ['data'],
  setup(p: any) {
    const onDblClick = () => { if(p.data.imgSrc) showImgPreview(p.data.imgSrc) }
    return () => h('div',{class:`nm-node img-node${p.data.status==='done'?' completed':''}`,style:{borderColor:'#22c55e',background:'rgba(34,197,94,0.05)'},onDblclick:onDblClick},[
      h('div',{class:'nm-header',style:{color:'#86efac'}},p.data.label),
      p.data.status==='done'&&p.data.imgSrc?h('img',{class:'nm-img',src:p.data.imgSrc,style:'width:100%;max-height:100px;object-fit:contain;border-radius:4px;margin-top:4px;cursor:pointer'},''):h('div',{class:'nm-desc'},p.data.desc||'待生成'),
      p.data.status==='done'?h('div',{class:'nm-status done'},'✓'):null
    ])
  }
})

const SimpleNode = (color: string, bgColor: string, labelColor: string) => defineComponent({
  props: ['data'],
  setup(p: any) { return () => h('div',{class:'nm-node',style:{borderColor:color,background:bgColor}},[
    h('div',{class:'nm-header',style:{color:labelColor}},p.data.label),
    p.data.desc?h('div',{class:'nm-desc'},p.data.desc):null,
    p.data.status==='done'?h('div',{class:'nm-status done'},'✓'):null
  ])}
})

const nodeTypes: any = {
  'shot': SimpleNode('#a78bfa','rgba(167,139,250,0.08)','#c4b5fd'),
  'asset': AssetNode, 'frame': FrameNode, 'video': VideoNode, 'image': ImageNode,
  'note': SimpleNode('#6b7280','rgba(107,114,128,0.08)','#9ca3af')
}

// ===== State =====
const elements = ref<any[]>([])
const nodesToAdd: any[] = []; const edgesToAdd: any[] = []
const selectedNodeId = ref(''); let nodeCounter = 0; const nextId = () => `n${++nodeCounter}_${Date.now()}`
let pendingX = 100; let pendingY = 100

// ===== Context Menu =====
const ctxMenu = reactive({ show: false, x: 0, y: 0 })
function onPaneContextMenu(e: MouseEvent) { e.preventDefault(); ctxMenu.show=true; ctxMenu.x=e.clientX; ctxMenu.y=e.clientY }
function hideCtxMenu() { ctxMenu.show=false }
function onPaneClick() { selectedNodeId.value=''; hideCtxMenu() }
function onNodeClick({ node }: any) { selectedNodeId.value=node.id }

function addNode(type: string) {
  const labels: Record<string,string>={shot:'分镜',asset:'资产',frame:'帧生图',video:'视频',image:'图片',note:'备注'}
  const id=nextId()
  nodesToAdd.push({id,type,position:{x:pendingX,y:pendingY},data:{label:labels[type]||type,desc:'',status:''}})
  pendingX+=220; if(pendingX>800){pendingX=100;pendingY+=150}
  applyPendingNodes()
  hideCtxMenu()
}

function applyPendingNodes() { if(!nodesToAdd.length)return; elements.value=[...elements.value,...nodesToAdd]; nodesToAdd.length=0 }

// ===== One-click shot node group =====
function addShotNode(shot: any) {
  const baseX=100, baseY=pendingY, shotNodeId=nextId()
  const col1X=300, col1rX=500, col2X=680, col3X=880, col4X=1080, col4rX=1280

  // Shot node
  nodesToAdd.push({id:shotNodeId,type:'shot',position:{x:baseX,y:baseY},data:{label:`#${shot.shot_index} ${(shot.description||'').substring(0,25)}`,desc:'分镜',status:''}})

  let yOff=0; const imgResultIds: string[]=[]
  // Characters
  for(const c of (shot.characters||[])) {
    const nid=nextId(); nodesToAdd.push({id:nid,type:'asset',position:{x:col1X,y:baseY+yOff},data:{label:`角色:${c.name}`,desc:c.description?.substring(0,25)||'',status:c.reference_image?'done':'',projectId:props.projectId,assetId:c.id,assetType:'character',assetDesc:c.description||c.name}})
    edgesToAdd.push({id:`e-${nid}`,source:shotNodeId,target:nid,style:{stroke:'rgba(59,130,246,0.3)',strokeWidth:1.5}})
    const rid=nextId(); nodesToAdd.push({id:rid,type:'image',position:{x:col1rX,y:baseY+yOff},data:{label:`${c.name}照`,desc:'',status:c.reference_image?'done':'',imgSrc:c.reference_image?`file:///${c.reference_image.replace(/\\/g,'/')}`:''}})
    edgesToAdd.push({id:`e-i-${rid}`,source:nid,target:rid,style:{stroke:'rgba(59,130,246,0.15)'}})
    imgResultIds.push(rid); yOff+=75
  }
  // Scenes
  for(const s of (shot.scenes||[])) {
    const nid=nextId(); nodesToAdd.push({id:nid,type:'asset',position:{x:col1X,y:baseY+yOff},data:{label:`场景:${s.name}`,desc:s.description?.substring(0,25)||'',status:s.reference_image?'done':'',projectId:props.projectId,assetId:s.id,assetType:'scene',assetDesc:s.description||s.name}})
    edgesToAdd.push({id:`e-${nid}`,source:shotNodeId,target:nid,style:{stroke:'rgba(16,185,129,0.3)',strokeWidth:1.5}})
    const rid=nextId(); nodesToAdd.push({id:rid,type:'image',position:{x:col1rX,y:baseY+yOff},data:{label:`${s.name}图`,desc:'',status:s.reference_image?'done':'',imgSrc:s.reference_image?`file:///${s.reference_image.replace(/\\/g,'/')}`:''}})
    edgesToAdd.push({id:`e-i-${rid}`,source:nid,target:rid,style:{stroke:'rgba(16,185,129,0.15)'}})
    imgResultIds.push(rid); yOff+=75
  }
  // Props
  for(const p of (shot.props||[])) {
    const nid=nextId(); nodesToAdd.push({id:nid,type:'asset',position:{x:col1X,y:baseY+yOff},data:{label:`道具:${p.name}`,desc:p.description?.substring(0,25)||'',status:p.reference_image?'done':'',projectId:props.projectId,assetId:p.id,assetType:'prop',assetDesc:p.description||p.name}})
    edgesToAdd.push({id:`e-${nid}`,source:shotNodeId,target:nid,style:{stroke:'rgba(139,92,246,0.3)',strokeWidth:1.5}})
    const rid=nextId(); nodesToAdd.push({id:rid,type:'image',position:{x:col1rX,y:baseY+yOff},data:{label:`${p.name}图`,desc:'',status:p.reference_image?'done':'',imgSrc:p.reference_image?`file:///${p.reference_image.replace(/\\/g,'/')}`:''}})
    edgesToAdd.push({id:`e-i-${rid}`,source:nid,target:rid,style:{stroke:'rgba(139,92,246,0.15)'}})
    imgResultIds.push(rid); yOff+=75
  }
  const col1H=Math.max(yOff,75)

  // Frames start centered relative to asset column
  const frameStartY=baseY + Math.max(0, (col1H - ((shot.first_frame_prompt?80:0)+(shot.last_frame_prompt?80:0))) / 2)
  let fyOff=0
  if(shot.first_frame_prompt){
    const nid=nextId(); nodesToAdd.push({id:nid,type:'frame',position:{x:col2X,y:frameStartY+fyOff},data:{label:'首帧生图',desc:(shot.first_frame_prompt||'').substring(0,30),status:shot.first_frame_image_path?'done':'',projectId:props.projectId,shotId:shot.id,frameType:'first'}})
    edgesToAdd.push({id:`e-${nid}`,source:shotNodeId,target:nid,style:{stroke:'rgba(245,158,11,0.3)',strokeWidth:1.5}})
    const rid=nextId(); nodesToAdd.push({id:rid,type:'image',position:{x:col3X,y:frameStartY+fyOff},data:{label:'首帧图',desc:'',status:shot.first_frame_image_path?'done':'',imgSrc:shot.first_frame_image_path?`file:///${shot.first_frame_image_path.replace(/\\/g,'/')}`:''}})
    edgesToAdd.push({id:`e-i-${rid}`,source:nid,target:rid,style:{stroke:'rgba(245,158,11,0.15)'}})
    imgResultIds.push(rid); fyOff+=80
  }
  if(shot.last_frame_prompt){
    const nid=nextId(); nodesToAdd.push({id:nid,type:'frame',position:{x:col2X,y:frameStartY+fyOff},data:{label:'尾帧生图',desc:(shot.last_frame_prompt||'').substring(0,30),status:shot.last_frame_image_path?'done':'',projectId:props.projectId,shotId:shot.id,frameType:'last'}})
    edgesToAdd.push({id:`e-${nid}`,source:shotNodeId,target:nid,style:{stroke:'rgba(245,158,11,0.3)',strokeWidth:1.5}})
    const rid=nextId(); nodesToAdd.push({id:rid,type:'image',position:{x:col3X,y:frameStartY+fyOff},data:{label:'尾帧图',desc:'',status:shot.last_frame_image_path?'done':'',imgSrc:shot.last_frame_image_path?`file:///${shot.last_frame_image_path.replace(/\\/g,'/')}`:''}})
    edgesToAdd.push({id:`e-i-${rid}`,source:nid,target:rid,style:{stroke:'rgba(245,158,11,0.15)'}})
    imgResultIds.push(rid); fyOff+=80
  }
  const col2H=fyOff

  // Video centered in row
  const rowH=Math.max(col1H,col2H,80)
  const videoY=baseY + (rowH - 80) / 2
  if(shot.video_prompt){
    const vnid=nextId(); nodesToAdd.push({id:vnid,type:'video',position:{x:col4X,y:videoY},data:{label:'视频生成',desc:(shot.video_prompt||'').substring(0,30),status:shot.video_path?'done':'',projectId:props.projectId,shotId:shot.id}})
    edgesToAdd.push({id:`e-${vnid}`,source:shotNodeId,target:vnid,style:{stroke:'rgba(239,68,68,0.3)',strokeWidth:1.5}})
    const vrid=nextId(); nodesToAdd.push({id:vrid,type:'image',position:{x:col4rX,y:videoY},data:{label:'视频',desc:'',status:shot.video_path?'done':'',imgSrc:''}})
    edgesToAdd.push({id:`e-i-${vrid}`,source:vnid,target:vrid,style:{stroke:'rgba(239,68,68,0.15)'}})
    // Reference links: all image results → video gen
    for(const rid of imgResultIds){ edgesToAdd.push({id:`ref-${rid}`,source:rid,target:vnid,style:{stroke:'rgba(239,68,68,0.12)',strokeWidth:1,strokeDasharray:'3,3'}}) }
  }

  pendingY+=Math.max(col1H,col2H,80)+50
  applyPendingNodes()
  setTimeout(()=>{elements.value=[...elements.value,...edgesToAdd];edgesToAdd.length=0},50)
}

// ===== Delete =====
function deleteSelected() { if(!selectedNodeId.value)return; elements.value=elements.value.filter((el:any)=>el.id!==selectedNodeId.value&&el.source!==selectedNodeId.value&&el.target!==selectedNodeId.value); selectedNodeId.value='' }
function onKeydown(e: KeyboardEvent) { if(e.key==='Delete'||e.key==='Backspace')deleteSelected() }

// ===== Sidebar =====
const canvasNav=ref('shots')
const sidebarItems=[{key:'characters',label:'角色',icon:'👤'},{key:'scenes',label:'场景',icon:'🏠'},{key:'props',label:'道具',icon:'🔧'},{key:'shots',label:'分镜',icon:'🎬'},{key:'library',label:'资产库',icon:'📁'}]
const quickAddTypes=[{type:'shot',label:'分镜',color:'#a78bfa'},{type:'asset',label:'资产',color:'#3b82f6'},{type:'frame',label:'帧',color:'#f59e0b'},{type:'video',label:'视频',color:'#ef4444'},{type:'image',label:'图片',color:'#22c55e'},{type:'note',label:'备注',color:'#6b7280'}]
</script>

<template>
  <div class="canvas-layout" @keydown="onKeydown" tabindex="0">
    <aside class="canvas-sidebar">
      <div v-for="item in sidebarItems" :key="item.key" class="canvas-nav-item" :class="{ active: canvasNav === item.key }" @click="canvasNav = item.key">
        <span class="canvas-nav-icon">{{ item.icon }}</span><span class="canvas-nav-label">{{ item.label }}</span>
      </div>
    </aside>
    <div class="canvas-main">
      <div class="canvas-quickbar">
        <span class="quickbar-label">添加：</span>
        <button v-for="qt in quickAddTypes" :key="qt.type" class="quickbar-btn" :style="{ borderColor: qt.color, color: qt.color }" @click="addNode(qt.type)">+{{ qt.label }}</button>
        <span v-if="selectedNodeId" class="quickbar-sep">|</span>
        <button v-if="selectedNodeId" class="quickbar-btn" style="border-color:#ef4444;color:#ef4444" @click="deleteSelected">🗑 删除</button>
      </div>
      <VueFlow v-model="elements" :default-viewport="{x:0,y:0,zoom:0.7}" :min-zoom="0.1" :max-zoom="3" :node-types="nodeTypes" :connect-on-click="false" class="vue-flow-canvas" @pane-context-menu="onPaneContextMenu" @pane-click="onPaneClick" @node-click="onNodeClick">
        <Background :gap="20" />
      </VueFlow>
      <Teleport to="body">
        <div v-if="ctxMenu.show" class="canvas-ctxmenu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
          <div class="ctxmenu-item" @click="addNode('shot')">🎬 分镜</div>
          <div class="ctxmenu-item" @click="addNode('asset')">👤 资产</div>
          <div class="ctxmenu-item" @click="addNode('frame')">🖼 帧生图</div>
          <div class="ctxmenu-item" @click="addNode('video')">🎥 视频</div>
          <div class="ctxmenu-item" @click="addNode('image')">🖼 图片</div>
          <div class="ctxmenu-item" @click="addNode('note')">📝 备注</div>
        </div>
      </Teleport>
      <div class="canvas-toolbar">
        <el-button size="small" @click="emit('back-to-editor')">返回编辑器</el-button>
        <span v-if="genMsg" class="canvas-gen-msg">{{ genMsg }}</span>
        <span class="canvas-legend"><span class="leg" style="border-left-color:#a78bfa">分镜</span><span class="leg" style="border-left-color:#3b82f6">资产</span><span class="leg" style="border-left-color:#f59e0b">帧</span><span class="leg" style="border-left-color:#ef4444">视频</span><span class="leg" style="border-left-color:#22c55e">图片</span></span>
        <span class="canvas-info">{{ elements.length }} 元素 | 右键添加 | Delete删除 | 双击图片放大</span>
      </div>

      <!-- Image fullscreen preview -->
      <Teleport to="body">
        <div v-if="imgPreview.show" class="canvas-img-overlay" @click="hideImgPreview">
          <img :src="imgPreview.src" class="canvas-img-full" @click.stop />
          <button class="canvas-img-close" @click="hideImgPreview">✕</button>
        </div>
      </Teleport>
    </div>
    <aside v-if="canvasNav === 'shots'" class="canvas-right-panel">
      <div class="canvas-shot-list">
        <div v-for="chapter in projectData?.chapters || []" :key="chapter.id">
          <div class="canvas-chapter-title">{{ chapter.title || `第${(chapter.chapter_index||0)+1}章` }}</div>
          <div v-for="shot in (projectData?.shots||[]).filter((s:any)=>s.chapter_id===chapter.id)" :key="shot.id" class="canvas-shot-item" @click="addShotNode(shot)">
            <span class="shot-num">#{{ shot.shot_index }}</span><span class="shot-desc">{{ (shot.description||'').substring(0,18) }}</span><span class="shot-add">+</span>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style>
.nm-node { border-radius:6px; padding:6px 8px; font-size:10px; min-width:140px; border:1.5px solid; display:flex; flex-direction:column; gap:2px; }
.nm-header { font-weight:600; font-size:11px; }
.nm-desc { font-size:9px; color:#9ca3af; max-height:22px; overflow:hidden; }
.nm-status { font-size:11px; margin-top:2px; }
.nm-status.done { color:#22c55e; font-weight:700; }
.nm-gen-btn { margin-top:4px; padding:2px 6px; font-size:9px; background:rgba(0,0,0,0.2); border:1px solid; border-radius:3px; cursor:pointer; width:100%; }
.nm-gen-btn:hover { opacity:0.8; }
.nm-gen-btn.small { width:auto; padding:1px 4px; font-size:11px; margin:0; }
.nm-actions { display:flex; align-items:center; gap:4px; margin-top:4px; }
.asset-node.completed, .frame-node.completed, .video-node.completed, .img-node.completed { border-color:#22c55e!important; }
.nm-img { display:block; }
.canvas-ctxmenu { position:fixed; z-index:10000; background:#1f1f28; border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:4px; min-width:160px; box-shadow:0 8px 24px rgba(0,0,0,0.5); }
.ctxmenu-item { padding:8px 12px; font-size:12px; color:#e5e7eb; cursor:pointer; border-radius:4px; }
.ctxmenu-item:hover { background:rgba(167,139,250,0.15); color:#c4b5fd; }
.canvas-img-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.9); z-index:10001; display:flex; align-items:center; justify-content:center; }
.canvas-img-full { max-width:90vw; max-height:90vh; object-fit:contain; }
.canvas-img-close { position:fixed; top:16px; right:16px; z-index:10002; background:rgba(255,255,255,0.15); border:none; color:#fff; font-size:20px; width:40px; height:40px; border-radius:50%; cursor:pointer; }
.canvas-img-close:hover { background:rgba(255,255,255,0.3); }
</style>

<style scoped>
.canvas-layout { display:flex; width:100%; height:100%; background:#0f0f11; outline:none; }
.canvas-sidebar { width:56px; flex-shrink:0; background:rgba(255,255,255,0.02); border-right:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; padding:8px 0; }
.canvas-nav-item { display:flex; flex-direction:column; align-items:center; gap:2px; padding:10px 4px; cursor:pointer; color:#6b7280; transition:all 0.15s; border-left:3px solid transparent; }
.canvas-nav-item:hover,.canvas-nav-item.active { color:#c4b5fd; background:rgba(167,139,250,0.1); border-left-color:#a78bfa; }
.canvas-nav-icon { font-size:18px; } .canvas-nav-label { font-size:10px; }
.canvas-main { flex:1; position:relative; display:flex; flex-direction:column; }
.canvas-quickbar { display:flex; align-items:center; gap:6px; padding:6px 12px; background:rgba(255,255,255,0.02); border-bottom:1px solid rgba(255,255,255,0.06); flex-wrap:wrap; }
.quickbar-label { font-size:11px; color:#6b7280; }
.quickbar-btn { font-size:10px; padding:2px 8px; background:transparent; border:1px solid; border-radius:4px; cursor:pointer; }
.quickbar-btn:hover { opacity:0.8; }
.quickbar-sep { color:#374151; font-size:12px; }
.vue-flow-canvas { flex:1; background:#0f0f11; }
.canvas-toolbar { display:flex; align-items:center; justify-content:space-between; padding:6px 12px; background:rgba(255,255,255,0.03); border-top:1px solid rgba(255,255,255,0.06); }
.canvas-legend { display:flex; gap:12px; font-size:10px; }
.leg { padding:1px 6px; border-radius:3px; color:#9ca3af; border-left:3px solid; }
.canvas-info { font-size:10px; color:#6b7280; }
.canvas-gen-msg { font-size:11px; color:#fcd34d; background:rgba(245,158,11,0.1); padding:2px 10px; border-radius:4px; }
.canvas-right-panel { width:200px; flex-shrink:0; background:rgba(255,255,255,0.02); border-left:1px solid rgba(255,255,255,0.06); overflow-y:auto; }
.canvas-shot-list { padding:8px; }
.canvas-chapter-title { font-size:11px; font-weight:600; color:#c4b5fd; padding:6px 8px; }
.canvas-shot-item { display:flex; align-items:center; gap:6px; padding:5px 8px; cursor:pointer; border-radius:4px; font-size:11px; color:#9ca3af; }
.canvas-shot-item:hover,.canvas-shot-item.active { background:rgba(255,255,255,0.05); color:#e5e7eb; }
.shot-num { color:#a78bfa; font-weight:600; flex-shrink:0; } .shot-desc { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.shot-add { color:#22c55e; font-weight:700; font-size:14px; flex-shrink:0; opacity:0; transition:opacity 0.15s; }
.canvas-shot-item:hover .shot-add { opacity:1; }
</style>
