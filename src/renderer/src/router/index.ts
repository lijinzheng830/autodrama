import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Editor from '../views/Editor.vue'

const routes = [
  { path: '/', name: 'Home', component: Home },
  { path: '/editor/:id', name: 'Editor', component: Editor }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
