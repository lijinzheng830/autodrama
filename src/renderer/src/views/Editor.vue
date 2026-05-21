<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
const projectId = route.params.id as string
</script>

<template>
  <div class="editor-container">
    <h1>编辑器</h1>
    <p>项目 ID: {{ projectId }}</p>
    <p>编辑器页面正在开发中...</p>
  </div>
</template>

<style scoped>
.editor-container {
  padding: 40px;
  text-align: center;
  color: #e0e0e0;
}

h1 {
  font-size: 32px;
  margin-bottom: 20px;
  background: linear-gradient(90deg, #a78bfa, #60a5fa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

p {
  font-size: 16px;
  color: #9ca3af;
  margin: 8px 0;
}
</style>
