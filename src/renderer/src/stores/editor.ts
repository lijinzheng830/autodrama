import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ProgressItem {
  step: number
  status: 'running' | 'done' | 'error' | 'waiting'
  message: string
}

export interface ResultData {
  shotsData: any
  extractData: any
  assocData: any
}

const defaultProgress: ProgressItem[] = [
  { step: 1, status: 'waiting', message: '分析剧本、拆分镜头' },
  { step: 2, status: 'waiting', message: '提取角色和场景' },
  { step: 3, status: 'waiting', message: '关联角色和场景到分镜' },
  { step: 4, status: 'waiting', message: '保存项目' }
]

export const useEditorStore = defineStore('editor', () => {
  const generating = ref(false)
  const progressSteps = ref<ProgressItem[]>([...defaultProgress])
  const resultData = ref<ResultData | null>(null)
  const showResult = ref(false)
  const scriptText = ref('')

  function resetProgress() {
    progressSteps.value = [...defaultProgress]
  }

  function resetResult() {
    showResult.value = false
    resultData.value = null
    resetProgress()
  }

  function setGenerating(val: boolean) {
    generating.value = val
  }

  function updateProgressStep(stepIndex: number, status: ProgressItem['status'], message: string) {
    if (stepIndex >= 0 && stepIndex < progressSteps.value.length) {
      progressSteps.value[stepIndex].status = status
      progressSteps.value[stepIndex].message = message
    }
  }

  function markPreviousStepsDone(currentStepIndex: number) {
    for (let i = 0; i < currentStepIndex; i++) {
      if (progressSteps.value[i].status !== 'error') {
        progressSteps.value[i].status = 'done'
      }
    }
  }

  function setResult(data: ResultData | null) {
    resultData.value = data
    showResult.value = !!data
  }

  return {
    generating,
    progressSteps,
    resultData,
    showResult,
    scriptText,
    resetProgress,
    resetResult,
    setGenerating,
    updateProgressStep,
    markPreviousStepsDone,
    setResult
  }
})
