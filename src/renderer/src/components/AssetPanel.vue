<script setup lang="ts">
/**
 * AssetPanel — 右侧面板
 * 资产管理 + 首帧/尾帧/视频详情 + 多角度锚点 + 全屏预览
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, Back, ArrowLeft, ArrowRight, Upload, Setting, Delete, Download, Plus, VideoPlay } from '@element-plus/icons-vue'

const props = defineProps<{
  projectId: string; projectPath: string; projectData: any
  panelMode: 'resident' | 'detail'; residentTab: 'characters' | 'scenes' | 'props'
  detailType: string; detailData: any; searchKeyword: string
  generatingVideo?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:panelMode', v: 'resident' | 'detail'): void
  (e: 'update:residentTab', v: 'characters' | 'scenes' | 'props'): void
  (e: 'update:searchKeyword', v: string): void
  (e: 'refresh-data'): void
  (e: 'show-detail', type: string, data: any): void
  (e: 'generate-image', payload: any): void
  (e: 'generate-video', payload: any): void
  (e: 'voice-preset-changed', characterId: string, preset: string): void
}>()

const assetImages = ref<any[]>([])
const assetVideos = ref<any[]>([])
const merging = ref(false)
const multiAngleAnchors = ref<Record<string, string> | null>(null)
const missingAngles = computed(() => {
  if (!multiAngleAnchors.value) return []
  return [{k:'front',l:'正面(0°)'},{k:'three_quarter',l:'半侧面(45°)'},{k:'side',l:'侧面(90°)'},{k:'back',l:'背面(180°)'}].filter(a => !multiAngleAnchors.value![a.k])
})

async function loadMultiAngle(id: string): Promise<void> {
  try { const a = await (window as any).api.getMultiAngle(id); multiAngleAnchors.value = a || {} }
  catch { multiAngleAnchors.value = {} }
}

const editAssetName = ref(''), editAssetDesc = ref('')
const editFirstFramePrompt = ref(''), editLastFramePrompt = ref(''), editVideoPrompt = ref('')
const genCount = ref(1), generatingAngle = ref<string | null>(null)
const _saving = ref(false) // 防重复保存
const voicePresets = ref<Array<{ key: string; name: string; label: string }>>([])

async function handleGenerateAngle(angle: string): Promise<void> {
  if (!props.detailData?.id || generatingAngle.value) return
  generatingAngle.value = angle
  try { await (window as any).api.generateAngle(props.detailData.id, angle); await loadMultiAngle(props.detailData.id); emit('refresh-data') }
  catch (e: any) { ElMessage.error(e?.message || `生成${angle}角度失败`) }
  finally { generatingAngle.value = null }
}

async function loadAssetImages(at: string, aid: string): Promise<void> {
  try { assetImages.value = await (window as any).api.getAssetImages(at, aid) || [] } catch { assetImages.value = [] }
}
async function loadShotImages(sid: string, ft: 'first' | 'last'): Promise<void> {
  try { assetImages.value = await (window as any).api.getShotImages(sid, ft) || [] } catch { assetImages.value = [] }
}
async function loadShotVideos(sid: string): Promise<void> {
  try { assetVideos.value = await (window as any).api.getShotVideos(sid) || [] } catch { assetVideos.value = [] }
}

function hasChinese(text: string): boolean { return /[一-鿿]/.test(text) }

async function handleShotPromptSave(): Promise<void> {
  if (!props.detailData?.id || _saving.value) return
  _saving.value = true
  const isFirst = props.detailType === 'firstFrame'
  const f = isFirst ? 'first_frame_prompt' : 'last_frame_prompt'
  const fz = isFirst ? 'first_frame_prompt_zh' : 'last_frame_prompt_zh'
  const v = isFirst ? editFirstFramePrompt.value : editLastFramePrompt.value
  try {
    // 中文 → 翻译为英文供 API 使用
    if (hasChinese(v)) {
      const en = await (window as any).api.translateToEnglish(v)
      console.log('[翻译] 中文:', v.slice(0, 60))
      console.log('[翻译] 英文:', en.slice(0, 120))
      await (window as any).api.updateShot(props.detailData.id, { [f]: en, [fz]: v })
      if (props.detailData) { props.detailData[f] = en; props.detailData[fz] = v }
      ElMessage.success('已翻译并保存')
    } else {
      await (window as any).api.updateShot(props.detailData.id, { [f]: v, [fz]: v })
      if (props.detailData) { props.detailData[f] = v; props.detailData[fz] = v }
      ElMessage.success('已保存')
    }
  } catch (e: any) { ElMessage.error('保存失败: ' + (e?.message || '')) }
  finally { _saving.value = false }
}
async function handleVideoPromptSave(): Promise<void> {
  if (!props.detailData?.id || _saving.value) return
  _saving.value = true
  const v = editVideoPrompt.value
  try {
    const en = hasChinese(v) ? await (window as any).api.translateToEnglish(v) : v
    await (window as any).api.updateShot(props.detailData.id, { video_prompt: en, video_prompt_zh: v })
    if (props.detailData) { props.detailData.video_prompt = en; props.detailData.video_prompt_zh = v }
    ElMessage.success(hasChinese(v) ? '已翻译并保存' : '已保存')
  } catch {} finally { _saving.value = false }
}
async function onSelectShotImg(sid: string, ft: 'first' | 'last', iid: string): Promise<void> {
  await (window as any).api.selectShotImage(sid, ft, iid)
  await loadShotImages(sid, ft)
  const selected = assetImages.value.find((i: any) => i.is_selected)
  if (selected && props.detailData) {
    const key = ft === 'first' ? 'first_frame_image_path' : 'last_frame_image_path'
    props.detailData[key] = selected.image_path
  }
}
async function onDeleteShotImg(sid: string, iid: string): Promise<void> {
  await (window as any).api.deleteShotImage(sid, iid)
  const ft = props.detailType === 'firstFrame' ? 'first' : 'last'
  await loadShotImages(sid, ft)
  // 更新主图预览
  const key = ft === 'first' ? 'first_frame_image_path' : 'last_frame_image_path'
  if (assetImages.value.length === 0) {
    if (props.detailData) props.detailData[key] = ''
  } else {
    const selected = assetImages.value.find((i: any) => i.is_selected)
    if (props.detailData) props.detailData[key] = selected?.image_path || assetImages.value[0]?.image_path || ''
  }
}
async function onSelectVideo(sid: string, vid: string): Promise<void> {
  await (window as any).api.selectShotVideo(sid, vid)
  await loadShotVideos(sid)
  const selected = assetVideos.value.find((v: any) => v.is_selected)
  if (props.detailData) props.detailData.video_path = selected?.video_path || ''
}
async function onDeleteVideo(sid: string, vid: string): Promise<void> {
  await (window as any).api.deleteShotVideo(sid, vid)
  await loadShotVideos(sid)
  const selected = assetVideos.value.find((v: any) => v.is_selected)
  if (props.detailData) props.detailData.video_path = selected?.video_path || ''
}

async function handleMergeAudio(): Promise<void> {
  const sid = props.detailData?.id
  if (!sid) return
  merging.value = true
  try {
    const mergedPath = await (window as any).api.mergeVideoWithAudio(sid)
    if (props.detailData) props.detailData.video_path = mergedPath
    await loadShotVideos(sid)
    ElMessage.success('配音已合成')
  } catch (err: any) {
    ElMessage.error(err?.message || '合成失败')
  } finally {
    merging.value = false
  }
}

watch(() => props.detailData, (data) => {
  if (!data) { multiAngleAnchors.value = null; return }
  editAssetName.value = data?.name || ''; editAssetDesc.value = data?.description_zh || data?.description || ''
  editFirstFramePrompt.value = data?.first_frame_prompt_zh || data?.first_frame_prompt || ''
  editLastFramePrompt.value = data?.last_frame_prompt_zh || data?.last_frame_prompt || ''
  editVideoPrompt.value = data?.video_prompt_zh || data?.video_prompt || ''
  if (props.detailType === 'character' && data?.id) { loadMultiAngle(data.id); loadAssetImages('character', data.id) }
  else if (props.detailType === 'scene' && data?.id) { loadAssetImages('scene', data.id); multiAngleAnchors.value = null }
  else if (props.detailType === 'prop' && data?.id) { loadAssetImages('prop', data.id); multiAngleAnchors.value = null }
  else multiAngleAnchors.value = null
  if ((props.detailType === 'firstFrame' || props.detailType === 'lastFrame') && data?.id) loadShotImages(data.id, props.detailType === 'firstFrame' ? 'first' : 'last')
  if (props.detailType === 'video' && data?.id) loadShotVideos(data.id)
}, { immediate: true })

const fsVisible = ref(false), fsSrc = ref(''), fsList = ref<string[]>([]), fsIdx = ref(0), fsIsVideo = ref(false)
function openFS(src: string, list?: string[], isV?: boolean, e?: MouseEvent): void {
  if (!src) return
  e?.stopPropagation(); e?.preventDefault()
  fsSrc.value = src; fsIsVideo.value = !!isV; fsVisible.value = true
  if (list?.length) { fsList.value = list; fsIdx.value = Math.max(0, list.indexOf(src)) }
  else { fsList.value = [src]; fsIdx.value = 0 }
}
function closeFS(): void { fsVisible.value = false; fsSrc.value = ''; fsList.value = [] }
function fsPrev(): void { if (fsList.value.length < 2) return; fsIdx.value = fsIdx.value <= 0 ? fsList.value.length - 1 : fsIdx.value - 1; fsSrc.value = fsList.value[fsIdx.value] }
function fsNext(): void { if (fsList.value.length < 2) return; fsIdx.value = fsIdx.value >= fsList.value.length - 1 ? 0 : fsIdx.value + 1; fsSrc.value = fsList.value[fsIdx.value] }
function fsKey(e: KeyboardEvent): void { if (e.key === 'Escape') closeFS(); else if (e.key === 'ArrowLeft') fsPrev(); else if (e.key === 'ArrowRight') fsNext() }
function fsDownload(): void { const a = document.createElement('a'); a.href = fsSrc.value; a.download = fsSrc.value.split('/').pop() || 'img.png'; a.click() }
async function fsDelete(): Promise<void> {
  const img = assetImages.value.find((i: any) => i.image_path === assetImages.value[fsIdx.value]?.image_path)
  if (!img) return
  try {
    if (['character', 'scene', 'prop'].includes(props.detailType)) {
      await (window as any).api.deleteAssetImage(props.detailType, props.detailData?.id, img.id)
      await loadAssetImages(props.detailType, props.detailData?.id)
    } else if (props.detailType === 'firstFrame' || props.detailType === 'lastFrame') {
      await (window as any).api.deleteShotImage(props.detailData?.id, img.id)
      await loadShotImages(props.detailData?.id, props.detailType === 'firstFrame' ? 'first' : 'last')
    }
    // 更新列表+主图
    const paths = assetImages.value.map((i: any) => i.image_path)
    if (paths.length === 0) {
      if (props.detailType === 'firstFrame' && props.detailData) props.detailData.first_frame_image_path = ''
      else if (props.detailType === 'lastFrame' && props.detailData) props.detailData.last_frame_image_path = ''
      else if (props.detailData) props.detailData.reference_image = ''
      return closeFS()
    }
    fsList.value = paths
    fsIdx.value = Math.min(fsIdx.value, paths.length - 1)
    fsSrc.value = fsList.value[fsIdx.value]
  } catch { /* ignore */ }
}
onMounted(async () => {
  window.addEventListener('keydown', fsKey)
  try { voicePresets.value = await window.api.listVoicePresets() } catch { /* keep defaults */ }
})
onUnmounted(() => window.removeEventListener('keydown', fsKey))
function toFileUrl(p: string): string { return p ? 'file://' + p.replace(/\\/g, '/') : '' }

const filteredAssets = computed(() => {
  const list = props.projectData?.[props.residentTab] || []
  return props.searchKeyword ? list.filter((a: any) => a.name?.includes(props.searchKeyword)) : list
})
function backToResident(): void { emit('update:panelMode', 'resident') }
async function onAssetNameChange(t: string, a: any, n: string): Promise<void> {
  if (!n.trim() || n === a.name) return
  try {
    if (t === 'character') await (window as any).api.updateCharacter(a.id, { name: n.trim() })
    else if (t === 'scene') await (window as any).api.updateScene(a.id, { name: n.trim() })
    else await (window as any).api.updateProp(a.id, { name: n.trim() })
    if (a) a.name = n.trim(); editAssetName.value = n.trim()
    ElMessage.success('已保存')
  } catch { ElMessage.error('改名失败') }
}
async function onVoicePresetChange(characterId: string, preset: string): Promise<void> {
  try {
    await (window as any).api.updateCharacter(characterId, { voicePreset: preset })
    if (props.detailData) props.detailData.voice_preset = preset
    emit('voice-preset-changed', characterId, preset)
    ElMessage.success(preset ? '发音人已设置' : '已取消配音')
  } catch { ElMessage.error('设置失败') }
}

async function onAssetDescChange(t: string, a: any, d: string): Promise<void> {
  try {
    const isCn = hasChinese(d)
    const en = isCn ? await (window as any).api.translateToEnglish(d) : d
    const update = { description: en, description_zh: d }
    if (t === 'character') await (window as any).api.updateCharacter(a.id, update)
    else if (t === 'scene') await (window as any).api.updateScene(a.id, update)
    else await (window as any).api.updateProp(a.id, update)
    if (a) { a.description = en; a.description_zh = d }
    editAssetDesc.value = d
    ElMessage.success(isCn ? '已翻译并保存' : '已保存')
  } catch { ElMessage.error('保存失败') }
}
async function onDeleteAsset(t: string, aid: string): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除吗？', '删除确认', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' })
    if (t === 'character') await (window as any).api.deleteCharacter(aid)
    else if (t === 'scene') await (window as any).api.deleteScene(aid)
    else if (t === 'prop') await (window as any).api.deleteProp(aid)
    emit('update:panelMode', 'resident'); emit('refresh-data')
  } catch (e: any) { if (e !== 'cancel' && e?.message !== 'cancel') ElMessage.error('删除失败') }
}

async function onSelectImg(t: string, a: any): Promise<void> {
  if (!props.projectPath) return
  try {
    const p = await (window as any).api.selectImage(props.projectPath); if (!p) return
    if (t === 'character') await (window as any).api.updateCharacter(a.id, { referenceImage: p })
    else if (t === 'scene') await (window as any).api.updateScene(a.id, { referenceImage: p })
    else await (window as any).api.updateProp(a.id, { referenceImage: p })
    emit('refresh-data')
  } catch { ElMessage.error('上传失败') }
}
async function onCreateAsset(): Promise<void> {
  const tab = props.residentTab; const label = tab === 'characters' ? '角色' : tab === 'scenes' ? '场景' : '道具'
  try {
    const { value } = await ElMessageBox.prompt(`请输入${label}名称`, `创建${label}`, { confirmButtonText: '创建', cancelButtonText: '取消', inputPattern: /\S/, inputErrorMessage: '名称不能为空' })
    if (tab === 'characters') await (window as any).api.createCharacter(props.projectId, { name: value.trim() })
    else if (tab === 'scenes') await (window as any).api.createScene(props.projectId, { name: value.trim() })
    else await (window as any).api.createProp(props.projectId, { name: value.trim() })
    emit('refresh-data')
  } catch (e: any) { if (e !== 'cancel' && e?.message !== 'cancel') console.error(e) }
}
async function onSelectHImg(at: string, aid: string, iid: string): Promise<void> {
  await (window as any).api.selectAssetImage(at, aid, iid)
  await loadAssetImages(at, aid)
  const selected = assetImages.value.find((i: any) => i.is_selected)
  if (selected && props.detailData) props.detailData.reference_image = selected.image_path
}
async function onDeleteHImg(at: string, aid: string, iid: string): Promise<void> {
  await (window as any).api.deleteAssetImage(at, aid, iid)
  await loadAssetImages(at, aid)
  // 更新主图
  if (assetImages.value.length === 0) {
    if (props.detailData) props.detailData.reference_image = ''
  } else {
    const selected = assetImages.value.find((i: any) => i.is_selected)
    if (props.detailData) props.detailData.reference_image = selected?.image_path || assetImages.value[0]?.image_path || ''
  }
}
</script>

<template>
  <div v-if="fsVisible" class="fullscreen-overlay" @click.self="closeFS">
    <div class="fullscreen-toolbar"><span>{{ fsIdx + 1 }} / {{ fsList.length }}</span><el-button circle :icon="Download" @click="fsDownload" /><el-button circle :icon="Delete" @click="fsDelete" /><el-button circle :icon="Close" @click="closeFS" /></div>
    <el-button class="fullscreen-nav fullscreen-prev" circle :icon="ArrowLeft" @click.stop="fsPrev" v-if="fsList.length > 1" />
    <el-button class="fullscreen-nav fullscreen-next" circle :icon="ArrowRight" @click.stop="fsNext" v-if="fsList.length > 1" />
    <video v-if="fsIsVideo" :src="fsSrc" class="fullscreen-media" controls autoplay />
    <img v-else :src="fsSrc" class="fullscreen-media" />
  </div>
  <aside class="right-panel">
    <div v-if="panelMode === 'resident'" class="resident-panel">
      <el-tabs :model-value="residentTab" @update:model-value="(v: string) => emit('update:residentTab', v as any)">
        <el-tab-pane label="角色" name="characters" /><el-tab-pane label="场景" name="scenes" /><el-tab-pane label="道具" name="props" />
      </el-tabs>
      <div class="asset-search"><el-input :model-value="searchKeyword" @update:model-value="(v: string) => emit('update:searchKeyword', v)" placeholder="搜索..." clearable /></div>
      <div class="asset-grid">
        <div v-for="a in filteredAssets" :key="a.id" class="asset-card" @click="emit('show-detail', residentTab.slice(0, -1), a)">
          <img v-if="a.reference_image" :src="toFileUrl(a.reference_image)" class="asset-thumb" /><div v-else class="asset-thumb-placeholder"><el-icon><Plus /></el-icon></div>
          <span class="asset-name">{{ a.name }}</span>
          <el-button class="asset-delete-btn" size="small" :icon="Delete" circle @click.stop="onDeleteAsset(residentTab.slice(0, -1), a.id)" />
        </div>
      </div>
      <div class="asset-footer"><el-button :icon="Plus" size="small" @click="onCreateAsset">创建</el-button></div>
    </div>

    <div v-else class="detail-panel">
      <div class="detail-header"><el-button :icon="Back" size="small" text @click="backToResident">返回</el-button><span class="detail-title">{{ detailData?.name || '详情' }}</span><el-button v-if="['character','scene','prop'].includes(String(detailType))" :icon="Delete" size="small" type="danger" text @click="onDeleteAsset(String(detailType), detailData?.id)" style="margin-left:auto">删除</el-button></div>

      <div v-if="['character','scene','prop'].includes(String(detailType))" class="detail-body">
        <div class="detail-image-section">
          <img v-if="detailData?.reference_image" :src="toFileUrl(detailData.reference_image)" class="detail-main-image" @dblclick.stop="openFS(toFileUrl(detailData.reference_image), undefined, false, $event)" />
          <div v-else class="detail-image-empty"><el-icon><Upload /></el-icon><span>暂无参考图</span></div>
          <el-button size="small" :icon="Upload" @click="onSelectImg(String(detailType), detailData)" style="margin-top:8px">上传图片</el-button>
        </div>
        <div class="detail-field"><label>名称</label><el-input :model-value="editAssetName" @update:model-value="(v: string) => editAssetName = v" @blur="onAssetNameChange(String(detailType), detailData, editAssetName)" /></div>
        <div class="detail-field"><label>描述</label><el-input :model-value="editAssetDesc" @update:model-value="(v: string) => editAssetDesc = v" @blur="onAssetDescChange(String(detailType), detailData, editAssetDesc)" type="textarea" :rows="3" /></div>
        <div v-if="String(detailType) === 'character'" class="detail-field">
          <label>发音人</label>
          <el-select :model-value="detailData?.voice_preset || ''" @update:model-value="(v: string) => onVoicePresetChange(detailData?.id, v)" size="small" style="width:100%">
            <el-option label="不配音" value="" />
            <el-option v-for="vp in voicePresets" :key="vp.key" :label="vp.label" :value="vp.key" />
          </el-select>
        </div>
        <div v-if="String(detailType) === 'character' && multiAngleAnchors" class="anchor-status">
          <div class="anchor-title">多角度锚点</div>
          <div class="anchor-grid">
            <div v-for="a in [{k:'front',l:'正面'},{k:'three_quarter',l:'半侧面45°'},{k:'side',l:'侧面90°'},{k:'back',l:'背面'}]" :key="a.k" class="anchor-dot" :class="{ ok: multiAngleAnchors[a.k], missing: !multiAngleAnchors[a.k] }">
              <span class="anchor-label">{{ a.l }}</span><span class="anchor-icon">{{ multiAngleAnchors[a.k] ? '✓' : '✗' }}</span>
            </div>
          </div>
          <div v-if="missingAngles.length > 0" class="anchor-warning">⚠ 缺失 {{ missingAngles.length }} 个角度锚点<div class="anchor-gen-grid"><el-button v-for="a in missingAngles" :key="a.k" size="small" type="warning" :loading="generatingAngle === a.k" @click="handleGenerateAngle(a.k)">生成{{ a.l }}</el-button></div></div>
          <div v-else class="anchor-ok">✓ 全部锚点就绪</div>
        </div>
        <div class="detail-generate"><el-input-number v-model="genCount" :min="1" :max="4" size="small" /><el-button type="primary" :icon="Setting" size="small" @click="emit('generate-image', { type: String(detailType), assetId: detailData.id, count: genCount })">生成</el-button></div>
        <div v-if="assetImages.length > 0" class="history-grid"><div v-for="img in assetImages" :key="img.id" class="history-item" :class="{ selected: img.is_selected }" @click="onSelectHImg(String(detailType), detailData.id, img.id)" @dblclick.stop="openFS(toFileUrl(img.image_path), assetImages.map((i:any) => toFileUrl(i.image_path)))"><img :src="toFileUrl(img.image_path)" /><el-button class="history-delete" size="small" circle :icon="Delete" @click.stop="onDeleteHImg(String(detailType), detailData.id, img.id)" /></div></div>
      </div>

      <div v-if="String(detailType) === 'firstFrame' || String(detailType) === 'lastFrame'" class="detail-body">
        <div class="detail-image-section">
          <img v-if="detailData?.first_frame_image_path && String(detailType) === 'firstFrame'" :src="toFileUrl(detailData.first_frame_image_path)" class="detail-main-image" @dblclick.stop="openFS(toFileUrl(detailData.first_frame_image_path), undefined, false, $event)" />
          <img v-else-if="detailData?.last_frame_image_path && String(detailType) === 'lastFrame'" :src="toFileUrl(detailData.last_frame_image_path)" class="detail-main-image" @dblclick.stop="openFS(toFileUrl(detailData.last_frame_image_path), undefined, false, $event)" />
          <div v-else class="detail-image-empty"><el-icon><Upload /></el-icon><span>暂无图片</span></div>
        </div>
        <div class="detail-field"><label>提示词</label><el-input :model-value="String(detailType) === 'firstFrame' ? editFirstFramePrompt : editLastFramePrompt" @update:model-value="(v: string) => String(detailType) === 'firstFrame' ? editFirstFramePrompt = v : editLastFramePrompt = v" @blur="handleShotPromptSave" type="textarea" :rows="4" /></div>
        <div class="detail-generate"><el-input-number v-model="genCount" :min="1" :max="4" size="small" /><el-button type="primary" :icon="Setting" size="small" @click="emit('generate-image', { type: String(detailType) === 'firstFrame' ? 'firstFrame' : 'lastFrame', shotId: detailData?.id, count: genCount })">生成</el-button></div>
        <div v-if="assetImages.length > 0" class="history-grid"><div v-for="img in assetImages" :key="img.id" class="history-item" :class="{ selected: img.is_selected }" @click="onSelectShotImg(detailData?.id, String(detailType) === 'firstFrame' ? 'first' : 'last', img.id)" @dblclick.stop="openFS(toFileUrl(img.image_path), assetImages.map((i:any) => toFileUrl(i.image_path)))"><img :src="toFileUrl(img.image_path)" /><el-button class="history-delete" size="small" circle :icon="Delete" @click.stop="onDeleteShotImg(detailData?.id, img.id)" /></div></div>
      </div>

      <div v-if="String(detailType) === 'video'" class="detail-body">
        <div class="detail-image-section"><video v-if="detailData?.video_path" :src="toFileUrl(detailData.video_path)" class="detail-main-image" controls controlslist="nofullscreen" @dblclick.stop.prevent="openFS(toFileUrl(detailData.video_path), undefined, true, $event)" /><div v-else class="detail-image-empty"><el-icon><VideoPlay /></el-icon><span>暂无视频</span></div></div>
        <div class="detail-field"><label>视频提示词</label><el-input :model-value="editVideoPrompt" @update:model-value="(v: string) => editVideoPrompt = v" @blur="handleVideoPromptSave" type="textarea" :rows="4" /></div>
        <div class="detail-generate"><el-button type="primary" :icon="VideoPlay" size="small" :loading="props.generatingVideo" @click="emit('generate-video', { shotId: detailData?.id, projectId })">生成视频</el-button><el-button v-if="detailData?.video_path && detailData?.voice_path" type="success" size="small" :loading="merging" @click="handleMergeAudio">合成配音</el-button></div>
        <div v-if="assetVideos.length > 0" class="history-grid"><div v-for="v in assetVideos" :key="v.id" class="history-item" :class="{ selected: v.is_selected }" @click="onSelectVideo(detailData?.id, v.id)"><video :src="toFileUrl(v.video_path)" /><el-button class="history-delete" size="small" circle :icon="Delete" @click.stop="onDeleteVideo(detailData?.id, v.id)" /></div></div>
      </div>

      <div v-if="String(detailType) === 'voice'" class="detail-body"><div class="detail-placeholder">配音功能开发中</div></div>
    </div>
  </aside>
</template>

<style scoped>
.right-panel{width:340px;background:#1a1a2e;border-left:1px solid #2a2a3e;display:flex;flex-direction:column;overflow-y:auto}
.resident-panel{padding:8px}.asset-search{margin:8px 0}
.asset-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.asset-card{background:#252545;border-radius:8px;padding:6px;cursor:pointer;text-align:center}
.asset-card:hover{background:#303060}
.asset-thumb{width:100%;aspect-ratio:1;object-fit:cover;border-radius:4px}
.asset-thumb-placeholder{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:#1a1a3e;border-radius:4px;color:#666;font-size:24px}
.asset-name{display:block;font-size:12px;margin-top:4px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.asset-delete-btn{position:absolute;top:2px;right:2px;opacity:0;transition:opacity .2s;width:20px;height:20px;min-height:20px;background:#e03a3a;border-color:#e03a3a;color:#fff}
.asset-card{position:relative}
.asset-card:hover .asset-delete-btn{opacity:.9}
.asset-footer{display:flex;gap:8px;margin-top:12px}
.detail-panel{padding:8px}
.detail-header{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.detail-title{font-size:16px;font-weight:600;color:#eee}
.detail-body{display:flex;flex-direction:column;gap:12px}
.detail-image-section{text-align:center}
.detail-main-image{width:100%;max-height:200px;object-fit:contain;border-radius:8px;cursor:pointer;background:#111}
.detail-image-empty{width:100%;height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1a1a3e;border-radius:8px;color:#666;gap:8px}
.detail-placeholder{color:#666;text-align:center;padding:40px 0;font-size:14px}
.detail-field label{display:block;font-size:12px;color:#999;margin-bottom:4px}
.detail-generate{display:flex;gap:8px;align-items:center}
.history-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.history-item{position:relative;cursor:pointer;border:2px solid transparent;border-radius:6px;overflow:hidden}
.history-item.selected{border-color:#409eff}
.history-item img,.history-item video{width:100%;aspect-ratio:16/9;object-fit:cover}
.history-item video{pointer-events:none}
.history-delete{position:absolute;top:2px;right:2px;opacity:0;width:18px;height:18px;min-height:18px;background:#e03a3a;border-color:#e03a3a;color:#fff}
.history-item:hover .history-delete{opacity:.9}
.anchor-status{background:#1e1e38;border-radius:8px;padding:10px}
.anchor-title{font-size:12px;color:#999;margin-bottom:8px}
.anchor-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.anchor-dot{display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-radius:4px;font-size:11px}
.anchor-dot.ok{background:#1a3a1a;color:#67c23a}
.anchor-dot.missing{background:#3a1a1a;color:#f56c6c}
.anchor-label{flex:1}.anchor-icon{font-weight:bold}
.anchor-warning{margin-top:6px;padding:6px 8px;background:#3a2a0a;color:#e0a040;border-radius:4px;font-size:11px}
.anchor-gen-grid{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.anchor-ok{margin-top:6px;padding:6px 8px;background:#1a3a1a;color:#67c23a;border-radius:4px;font-size:11px}
.fullscreen-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center}
.fullscreen-toolbar{position:absolute;top:16px;right:16px;display:flex;gap:8px;align-items:center;z-index:10;color:#fff}
.fullscreen-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:10}
.fullscreen-prev{left:20px}.fullscreen-next{right:20px}
.fullscreen-media{max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px}
</style>
