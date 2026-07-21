/**
 * useTopToolbar — 工具栏逻辑 composable
 * 负责：生成记录、播报条、导出、配音、模型配置、风格/年代选择
 * 所有状态通过 refs 参数注入，保持 Editor.vue 对状态的完全控制
 */
import { computed, type Ref } from 'vue'
import { ElMessage } from 'element-plus'

// ===== 类型 =====

interface Project {
  id: string; name: string; path: string
  style_name: string; style_prompt: string; era?: string
  aspect_ratio?: string; model_config_json?: string
}

interface ProjectData {
  shots?: any[]; characters?: any[]; scenes?: any[]; props?: any[]; chapters?: any[]
}

interface GenRecord { id: string; project_id: string; shot_id: string; type: string; purpose: string; status: string; model?: string; channel?: string; created_at: number; started_at?: number; error_message?: string; input_params?: string }

interface BroadcastItem { label: string; current: number; total: number }

interface ModelOption { label: string; value: string; provider: string; modelKey: string; modelType: string }

export interface TopToolbarRefs {
  projectId: string
  project: Ref<Project | null>
  projectData: Ref<ProjectData | null>
  selectedShots: Ref<Set<string>>
  selectedStyle: Ref<string>
  viewMode: Ref<string>

  genRecordVisible: Ref<boolean>
  genRecords: Ref<GenRecord[]>
  genRecordTab: Ref<string>
  genRecordStatusFilter: Ref<string>
  genRecordTypeFilter: Ref<string>

  broadcastItems: Ref<BroadcastItem[]>
  broadcastTimer: Ref<number | null>
  broadcastAllDone: Ref<boolean>
  broadcastAllDoneTimer: Ref<number | null>
  batchCancelled: Ref<boolean>

  exportProgressVisible: Ref<boolean>
  exportProgressCurrent: Ref<number>
  exportProgressTotal: Ref<number>
  exportProgressMsg: Ref<string>
  lastExportDir: Ref<string>

  stylePopoverVisible: Ref<boolean>
  eraPopoverVisible: Ref<boolean>
  customEra: Ref<string>

  editingProjectName: Ref<boolean>
  projectNameEdit: Ref<string>

  modelConfigVisible: Ref<boolean>
  modelConfigTab: Ref<number>
  modelConfigMode: Ref<string>
  modelConfig: Ref<Record<string, any>>
  modelConfigRefImages: Ref<Record<string, string>>
  modelConfigTemplates: Ref<any[]>
  providerModels: Ref<ModelOption[]>
  providerChannels: Ref<ModelOption[]>
  parseScriptText: Ref<string>

  // 回调
  saveStyleToProject: () => void
  loadProject: () => Promise<void>
  loadEpisodesData: () => Promise<void>
}

// ===== 常量 =====

const purposeLabels: Record<string, string> = {
  character_reference: '角色定妆照', scene_reference: '场景图', prop_reference: '道具图',
  video: '视频', voice: '配音'
}

const modelConfigTabs = [
  { key: 'language_model', label: '语言模型' },
  { key: 'script_rewrite', label: '单分镜剧本改写' },
  { key: 'character_image', label: '角色生图模型' },
  { key: 'scene_image', label: '场景生图模型' },
  { key: 'prop_image', label: '道具生图模型' },
  { key: 'video', label: '视频生成模型' }
]

const configTypeMap: Record<string, string> = {
  language_model: 'text', character_image: 'image', scene_image: 'image',
  prop_image: 'image', video: 'video'
}

// ===== Composable =====

export function useTopToolbar(refs: TopToolbarRefs) {
  // ===== 工具函数 =====
  function purposeLabel(purpose: string): string { return purposeLabels[purpose] || purpose }

  // ===== 生成记录 =====
  async function openGenRecord(): Promise<void> {
    refs.genRecordVisible.value = true
    await loadGenerationRecords()
  }

  async function loadGenerationRecords(): Promise<void> {
    try {
      refs.genRecords.value = await (window as any).api.getGenerationTasks(refs.projectId)
    } catch (err) {
      ElMessage.error('加载生成记录失败')
      console.error(err)
    }
  }

  // ===== 播报条轮询 =====
  async function pollBroadcast(): Promise<void> {
    try {
      const records = (await (window as any).api.getGenerationTasks(refs.projectId)) as any[]
      const active = records.filter((r: any) => ['pending', 'running'].includes(r.status))
      if (active.length === 0 && refs.broadcastItems.value.length > 0) {
        stopBroadcastPolling()
        refs.broadcastAllDone.value = true
        refs.broadcastAllDoneTimer.value = window.setTimeout(() => { refs.broadcastAllDone.value = false }, 3000)
        refs.broadcastItems.value = []
        return
      }
      const grouped: Record<string, { current: number; total: number }> = {}
      for (const r of active) {
        const label = purposeLabel(r.purpose)
        if (!grouped[label]) grouped[label] = { current: 0, total: 0 }
        grouped[label].total++
        if (r.status === 'running') grouped[label].current++
      }
      refs.broadcastItems.value = Object.entries(grouped).map(([label, data]) => ({ label, ...data }))
    } catch (err) { console.error('播报条轮询失败:', err) }
  }

  function startBroadcastPolling(): void {
    if (refs.broadcastTimer.value) clearInterval(refs.broadcastTimer.value)
    refs.broadcastAllDone.value = false
    if (refs.broadcastAllDoneTimer.value) { clearTimeout(refs.broadcastAllDoneTimer.value); refs.broadcastAllDoneTimer.value = null }
    void pollBroadcast()
    refs.broadcastTimer.value = window.setInterval(() => { void pollBroadcast() }, 2000)
  }

  function stopBroadcastPolling(): void {
    if (refs.broadcastTimer.value) { clearInterval(refs.broadcastTimer.value); refs.broadcastTimer.value = null }
  }

  // ===== 全部停止 =====
  async function handleCancelBatch(): Promise<void> {
    try {
      await (window as any).api.cancelGenerationTasks(refs.projectId)
      refs.batchCancelled.value = true
      ElMessage.info('已取消剩余任务')
      await loadGenerationRecords()
    } catch (err) { ElMessage.error('取消失败'); console.error(err) }
  }

  // ===== 记录操作 =====
  async function retryTask(record: any): Promise<void> {
    try {
      await (window as any).api.createGenerationTask({
        projectId: record.project_id, shotId: record.shot_id,
        type: record.type || 'image', purpose: record.purpose,
        model: record.model, inputParams: record.input_params
      })
      ElMessage.success('已创建重试任务')
      await loadGenerationRecords()
    } catch (err) { ElMessage.error('重试失败'); console.error(err) }
  }

  async function deleteGenRecord(taskId: string): Promise<void> {
    try {
      await (window as any).api.deleteGenerationTask(taskId)
      ElMessage.success('已删除')
      await loadGenerationRecords()
    } catch (err) { ElMessage.error('删除失败'); console.error(err) }
  }

  function handleUndo(): void { ElMessage.info('撤销功能后续版本开放') }
  function handleRedo(): void { ElMessage.info('重做功能后续版本开放') }

  // ===== 导出 =====
  function startAssetExport(_type: 'characters' | 'scenes' | 'props'): void {
    // 需要 Editor.vue 中的 exportAssetMode/exportAssetType/residentTab/panelMode refs
    // 暂时通过 (window as any) 方式兼容，或由 Editor.vue 自行实现
    ElMessage.info('请使用侧边栏资产面板导出')
  }

  function handleExport(type: string): void {
    if (type === '视频') { handleVideoExport() }
    else if (type === '角色') { startAssetExport('characters') }
    else if (type === '场景') { startAssetExport('scenes') }
    else if (type === '道具') { startAssetExport('props') }
  }

  async function handleVideoExport(): Promise<void> {
    if (refs.selectedShots.value.size === 0) { ElMessage.warning('请先勾选要导出的分镜'); return }
    const shots = refs.projectData.value?.shots?.filter((s: any) => refs.selectedShots.value.has(s.id) && s.video_path) || []
    const skipped = refs.selectedShots.value.size - shots.length
    if (shots.length === 0) { ElMessage.warning('勾选的分镜均未生成视频，无需导出'); return }

    const dir = await (window as any).api.selectExportDirectory(refs.lastExportDir.value || undefined)
    if (!dir) return
    refs.lastExportDir.value = dir
    await (window as any).api.setSetting('last_export_dir', dir)

    refs.exportProgressVisible.value = true
    refs.exportProgressTotal.value = shots.length
    refs.exportProgressCurrent.value = 0
    refs.exportProgressMsg.value = '正在导出视频...'

    const projectName = refs.project.value?.name || 'project'
    const timestamp = Date.now()
    let successCount = 0
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]
      const ext = shot.video_path.split('.').pop() || 'mp4'
      const destName = `${i + 1}_${projectName}_${timestamp}.${ext}`
      const ok = await (window as any).api.copyExportFile(shot.video_path, `${dir}/${destName}`)
      if (ok) successCount++
      refs.exportProgressCurrent.value = i + 1
    }
    refs.exportProgressVisible.value = false

    let msg = `成功导出 ${successCount} 个视频到 ${dir}`
    if (skipped > 0) msg += `，${skipped} 个分镜因未生成视频已跳过`
    if (successCount < shots.length) msg += `，${shots.length - successCount} 个复制失败`
    ElMessage.success(msg)
  }

  async function handleVideoConcat(): Promise<void> {
    if (refs.selectedShots.value.size === 0) { ElMessage.warning('请先勾选要合成的分镜'); return }
    const shots = refs.projectData.value?.shots || []
    const orderedShots = shots
      .filter((s: any) => refs.selectedShots.value.has(s.id) && s.video_path)
      .sort((a: any, b: any) => {
        const ai = (a.chapter_id || '') + '_' + String(a.shot_index).padStart(5, '0')
        const bi = (b.chapter_id || '') + '_' + String(b.shot_index).padStart(5, '0')
        return ai.localeCompare(bi)
      })
    const shotIds = orderedShots.map((s: any) => s.id)
    const skipped = refs.selectedShots.value.size - shotIds.length
    if (shotIds.length < 2) { ElMessage.warning('至少需要 2 个分镜才能合成导出'); return }

    try {
      refs.exportProgressVisible.value = true
      refs.exportProgressMsg.value = `正在合成 ${shotIds.length} 个分镜视频...`
      const projectName = refs.project.value?.name || 'project'
      const outputName = `${projectName}_合成_${Date.now()}.mp4`
      const result = await (window as any).api.concatVideos(refs.projectId, shotIds, outputName)
      refs.exportProgressVisible.value = false
      let msg = `视频合成完成！已导出到 ${result.outputPath}（${result.shotCount} 个分镜）`
      if (skipped > 0) msg += `，${skipped} 个分镜因未生成视频已跳过`
      ElMessage.success(msg)
    } catch (err: any) { refs.exportProgressVisible.value = false; ElMessage.error(err?.message || '视频合成失败') }
  }

  // ===== 配音 =====
  async function handleGenerateVoice(shotId: string): Promise<void> {
    const shot = refs.projectData.value?.shots?.find((s: any) => s.id === shotId)
    const dialogue = shot?.dialogue?.trim() || ''
    const innerMonologue = (shot as any)?.inner_monologue?.trim() || ''
    const narration = shot?.narration?.trim() || ''
    let text: string; let voicePreset: string

    if (narration) {
      text = narration
      const nb = refs.projectData.value?.characters?.find((c: any) => c.name === '旁白')
      voicePreset = nb?.voice_preset || 'narrator'
    } else if (innerMonologue) {
      text = innerMonologue
      const m = innerMonologue.match(/^([^：:]+)\s*的内心独白[：:]/)
      if (m) {
        const char = refs.projectData.value?.characters?.find((c: any) => c.name === m[1])
        voicePreset = char?.voice_preset || 'female-inner'
      } else { voicePreset = 'female-inner' }
    } else if (dialogue) {
      text = dialogue
      const m = dialogue.match(/^([^：:]+)[：:]/)
      if (m) {
        const char = refs.projectData.value?.characters?.find((c: any) => c.name === m[1])
        if (!char?.voice_preset) { ElMessage.warning(`请先为角色"${m[1]}"设置发音人`); return }
        voicePreset = char.voice_preset
      } else {
        const charIds = shot.characters?.map((c: any) => c.id) || []
        const firstChar = refs.projectData.value?.characters?.find((c: any) => charIds.includes(c.id) && c.voice_preset)
        voicePreset = firstChar?.voice_preset || 'female'
      }
    } else { ElMessage.warning('该分镜没有对白、内心独白或旁白'); return }

    try {
      const audioPath = await (window as any).api.generateVoice({ projectId: refs.projectId, shotId, text, voicePreset })
      shot.voice_path = audioPath
      ElMessage.success('配音已生成')
    } catch (err: any) { ElMessage.error(err?.message || '配音生成失败') }
  }

  async function handleBatchGenerateVoices(): Promise<void> {
    if (refs.selectedShots.value.size === 0) { ElMessage.warning('请先勾选分镜'); return }
    const shots = refs.projectData.value?.shots || []
    const inputs: Array<{ projectId: string; shotId: string; text: string; voicePreset: string }> = []

    for (const shot of shots) {
      if (!refs.selectedShots.value.has(shot.id)) continue
      const d2 = shot.dialogue?.trim() || ''
      const i2 = (shot as any).inner_monologue?.trim() || ''
      const n2 = shot.narration?.trim() || ''
      let t2: string; let vp2: string

      if (n2) {
        t2 = n2
        const nb2 = refs.projectData.value?.characters?.find((c: any) => c.name === '旁白')
        vp2 = nb2?.voice_preset || 'narrator'
      } else if (i2) {
        t2 = i2
        const m2 = i2.match(/^([^：:]+)\s*的内心独白[：:]/)
        if (m2) { const c2 = refs.projectData.value?.characters?.find((c: any) => c.name === m2[1]); vp2 = c2?.voice_preset || 'female-inner' }
        else { vp2 = 'female-inner' }
      } else if (d2) {
        t2 = d2
        const m2 = d2.match(/^([^：:]+)[：:]/)
        if (m2) {
          const c2 = refs.projectData.value?.characters?.find((c: any) => c.name === m2[1])
          if (!c2?.voice_preset) continue
          vp2 = c2.voice_preset
        } else {
          const cids2 = shot.characters?.map((c: any) => c.id) || []
          const fc2 = refs.projectData.value?.characters?.find((c: any) => cids2.includes(c.id) && c.voice_preset)
          if (!fc2?.voice_preset) continue
          vp2 = fc2.voice_preset
        }
      } else { continue }
      inputs.push({ projectId: refs.projectId, shotId: shot.id, text: t2, voicePreset: vp2 })
    }

    if (inputs.length === 0) { ElMessage.warning('勾选的分镜中没有可配音的'); return }
    try {
      const result = await (window as any).api.batchGenerateVoices(inputs)
      const count = Object.keys(result).length
      for (const [sid, audioPath] of Object.entries(result)) {
        const shot = shots.find((s: any) => s.id === sid)
        if (shot) shot.voice_path = audioPath
      }
      ElMessage.success(`成功生成 ${count}/${inputs.length} 个配音`)
    } catch (err: any) { ElMessage.error(err?.message || '批量配音失败') }
  }

  async function handlePDFExport(): Promise<void> {
    try {
      const shotIds = refs.selectedShots.value.size > 0 ? Array.from(refs.selectedShots.value) : undefined
      ElMessage.info('正在生成分镜表 PDF...')
      const outputPath = await (window as any).api.exportStoryboardPDF({ projectId: refs.projectId, shotIds, includeImages: true })
      ElMessage.success(`分镜表已导出到: ${outputPath}`)
    } catch (err: any) { ElMessage.error(err?.message || 'PDF 导出失败') }
  }

  // ===== 项目名称编辑 =====
  async function startEditProjectName(): Promise<void> {
    if (!refs.project.value) return
    refs.projectNameEdit.value = refs.project.value.name
    refs.editingProjectName.value = true
  }

  async function saveProjectName(): Promise<void> {
    if (!refs.project.value || !refs.projectNameEdit.value.trim()) { refs.editingProjectName.value = false; return }
    if (refs.projectNameEdit.value.trim() === refs.project.value.name) { refs.editingProjectName.value = false; return }
    try {
      await (window as any).api.updateProject(refs.projectId, { name: refs.projectNameEdit.value.trim() })
      await refs.loadProject()
      ElMessage.success('项目名称已更新')
    } catch (err) { ElMessage.error('保存失败'); console.error(err) }
    refs.editingProjectName.value = false
  }

  // ===== 风格/年代选择 =====
  function handleStyleSelectFromToolbar(style: any): void {
    refs.selectedStyle.value = style.name
    refs.saveStyleToProject()
    refs.stylePopoverVisible.value = false
  }

  function handleEraSelect(era: string): void {
    const newEra = refs.project.value?.era === era ? '' : era
    ;(window as any).api.updateProject(refs.projectId, { era: newEra })
      .then(() => { refs.loadProject(); ElMessage.success(newEra ? `年代已设置为：${newEra}` : '年代已清空') })
      .catch((err: any) => { ElMessage.error('保存失败'); console.error(err) })
    refs.eraPopoverVisible.value = false
  }

  function handleCustomEraSubmit(): void {
    if (!refs.customEra.value.trim()) return
    ;(window as any).api.updateProject(refs.projectId, { era: refs.customEra.value.trim() })
      .then(() => { refs.loadProject(); refs.eraPopoverVisible.value = false; refs.customEra.value = '' })
      .catch((err: any) => { ElMessage.error('保存失败'); console.error(err) })
  }

  // ===== 模型配置 =====
  async function loadProviderModels(): Promise<void> {
    try {
      const providers = await (window as any).api.getProviders()
      const models: any[] = []; const channels: any[] = []
      for (const p of providers as Record<string, any>[]) {
        channels.push({ label: p.name, value: p.key || p.id })
        for (const m of (p as Record<string, any>).models || []) {
          const modelKey = typeof m === 'string' ? m : m.key
          const modelName = typeof m === 'string' ? m : m.name
          const modelType = typeof m === 'string' ? 'text' : (m.type || 'text')
          models.push({ label: `${p.name} / ${modelName}`, value: `${p.key || p.id}:${modelKey}`, provider: p.key || p.id, modelKey, modelType })
        }
      }
      refs.providerModels.value = models
      refs.providerChannels.value = channels
    } catch (err) { console.error('加载模型失败', err) }
  }

  async function openModelConfig(): Promise<void> {
    refs.modelConfigVisible.value = true
    refs.modelConfigRefImages.value = {}
    await loadProviderModels()
    try {
      const proj = await (window as any).api.getProject(refs.projectId)
      if ((proj as Record<string, any>)?.model_config_json) {
        refs.modelConfig.value = JSON.parse((proj as Record<string, any>).model_config_json)
      } else { refs.modelConfig.value = {} }
    } catch (_err) { refs.modelConfig.value = {} }
    try {
      const modelRoutesRaw = await (window as any).api.getSetting('model_routes')
      if (modelRoutesRaw) {
        const modelRoutes = JSON.parse(modelRoutesRaw as string)
        for (const [key, route] of Object.entries(modelRoutes)) {
          if (!refs.modelConfig.value[key]?.model && !refs.modelConfig.value[key]?.channel) {
            if (!refs.modelConfig.value[key]) refs.modelConfig.value[key] = {}
            if ((route as any).model) refs.modelConfig.value[key].model = (route as any).model
            if ((route as any).channel) refs.modelConfig.value[key].channel = (route as any).channel
          }
        }
      }
    } catch (e) { /* ignore */ }
    loadModelConfigTemplates()
  }

  async function loadModelConfigTemplates(): Promise<void> {
    try {
      const tabKey = modelConfigTabs[refs.modelConfigTab.value].key
      const usageMap: Record<string, string> = {
        language_model: 'script_parse', script_rewrite: 'script_parse',
        character_image: 'character_image', scene_image: 'scene_image',
        prop_image: 'prop_image', video: 'video'
      }
      const usageKey = usageMap[tabKey] || undefined
      let list = (await (window as any).api.getPromptTemplates(refs.projectId, usageKey)) as any[]
      if (tabKey === 'video') {
        for (const vu of ['video_basic', 'video_both_frames', 'video_grid']) {
          const sub = await (window as any).api.getPromptTemplates(refs.projectId, vu) as any[]
          for (const t of sub) { if (!list.find((x: any) => x.id === t.id)) list.push(t) }
        }
      }
      refs.modelConfigTemplates.value = list
    } catch (err) { console.error('加载模板失败', err); refs.modelConfigTemplates.value = [] }
  }

  function setModelConfigTab(idx: number): void {
    refs.modelConfigTab.value = idx
    loadModelConfigTemplates()
  }

  async function handleModelConfigSave(): Promise<void> {
    try {
      await (window as any).api.updateProject(refs.projectId, { modelConfigJson: JSON.stringify(refs.modelConfig.value) })
      const sharedKeys = ['language_model', 'character_image', 'scene_image', 'prop_image', 'video']
      const routesUpdate: Record<string, { model: string; channel: string }> = {}
      for (const key of sharedKeys) {
        const cfg = refs.modelConfig.value[key]
        if (cfg?.model || cfg?.channel) { routesUpdate[key] = { model: cfg.model || '', channel: cfg.channel || '' } }
      }
      const existingRoutesRaw = await (window as any).api.getSetting('model_routes')
      const existingRoutes = existingRoutesRaw ? JSON.parse(existingRoutesRaw as string) : {}
      const mergedRoutes = { ...existingRoutes, ...routesUpdate }
      await (window as any).api.setSetting('model_routes', JSON.stringify(mergedRoutes))
      ElMessage.success('模型配置已保存')
      refs.modelConfigVisible.value = false
    } catch (err) { ElMessage.error('保存失败'); console.error(err) }
  }

  function setModelConfigField(key: string, field: string, value: any): void {
    if (!refs.modelConfig.value[key]) refs.modelConfig.value[key] = {}
    refs.modelConfig.value[key][field] = value
  }

  function handleModelConfigModelChange(tabKey: string, val: string): void {
    setModelConfigField(tabKey, 'model', val)
    const matched = refs.providerModels.value.find((m) => m.value === val)
    if (matched?.provider) { setModelConfigField(tabKey, 'channel', matched.provider) }
  }

  function handleModelConfigChannelChange(tabKey: string, val: string): void {
    setModelConfigField(tabKey, 'channel', val)
    const firstModel = filteredConfigModels.value.find((m) => m.provider === val)
    if (firstModel) { setModelConfigField(tabKey, 'model', firstModel.value) }
    else { setModelConfigField(tabKey, 'model', '') }
  }

  // ===== Computed =====
  const filteredConfigModels = computed(() => {
    const neededType = configTypeMap[modelConfigTabs[refs.modelConfigTab.value]?.key]
    if (!neededType) return refs.providerModels.value
    return refs.providerModels.value.filter((m) => m.modelType === neededType)
  })

  const textProviderModels = computed(() => {
    return refs.providerModels.value.filter((m) => m.modelType === 'text')
  })

  const filteredConfigChannels = computed(() => {
    const providers = new Set(filteredConfigModels.value.map((m) => m.provider))
    return refs.providerChannels.value.filter((c) => providers.has(c.value))
  })

  const scriptCharCount = computed(() => refs.parseScriptText.value.length)

  // ===== 清理 =====
  function cleanup(): void {
    stopBroadcastPolling()
    if (refs.broadcastAllDoneTimer.value) { clearTimeout(refs.broadcastAllDoneTimer.value); refs.broadcastAllDoneTimer.value = null }
  }

  return {
    purposeLabel,
    openGenRecord, loadGenerationRecords,
    pollBroadcast, startBroadcastPolling, stopBroadcastPolling,
    handleCancelBatch,
    retryTask, deleteGenRecord,
    handleUndo, handleRedo,
    handleExport, handleVideoExport, handleVideoConcat,
    handleGenerateVoice, handleBatchGenerateVoices, handlePDFExport,
    startEditProjectName, saveProjectName,
    handleStyleSelectFromToolbar, handleEraSelect, handleCustomEraSubmit,
    loadProviderModels, openModelConfig, loadModelConfigTemplates,
    setModelConfigTab, handleModelConfigSave,
    setModelConfigField, handleModelConfigModelChange, handleModelConfigChannelChange,
    filteredConfigModels, textProviderModels, filteredConfigChannels, scriptCharCount,
    cleanup,
  }
}
