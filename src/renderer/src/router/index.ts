import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Editor from '../views/Editor.vue'
import Settings from '../views/Settings.vue'

const routes = [
  { path: '/', name: 'Home', component: Home },
  { path: '/editor/:id', name: 'Editor', component: Editor },
  { path: '/settings', name: 'Settings', component: Settings },
  {
    path: '/reviewer',
    name: 'ScriptReviewer',
    // 懒加载：避免 CSS 处理问题影响首页加载
    component: () => import('../views/ScriptReviewerView.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
