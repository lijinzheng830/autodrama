# AutoDrama 改动记录 — 2026-06-05

## 1. 新增风格：中国仙侠

- **Editor.vue** `stylePresets` 数组新增第14项「中国仙侠」
- **db.ts** 种子数据加入 `style-xianxia` 及文件夹映射
- **参考图路径** `assets/style-references/14.中国仙侠（Chinese Xianxia）/`（4张）
- **stylePrompt**: `Chinese Xianxia fantasy art, semi-realistic cel-shaded rendering, ink wash influences, ethereal glow, dramatic god rays, misty atmosphere, jade green and celestial gold palette, painterly textures, spiritual mood`

## 2. 画面比例支持（imageGenerator.ts）

- 读取 `project.aspect_ratio`，映射为 API `size` 参数：
  - 16:9 → `1792x1024` / 9:16 → `1024x1792` / 1:1 → `1024x1024`
- Prompt 首行强指令：`IMPORTANT: This must be a [horizontal/vertical/square] [16:9/9:16/1:1] image`
- 布局方向自动联动：Horizontal / Vertical / Square

## 3. 格式提示词重构（imageGenerator.ts）

- 角色生图：四宫格角色参考图格式，风格通过 `${finalStylePrompt}` 动态注入
- 场景生图：四象限场景模组板格式，风格动态注入
- 移除了参考图 base64 注入（避免请求体过大导致超时）
- 移除了 `findStyleByName` / `resolveStyleImagePath` 的导入

## 4. 模型切换

- 满血供应商（manxueapi）新增 `gpt-image-2-pro` 模型
- model_routes 全部图片类型切换为 `manxueapi:gpt-image-2-pro`

## 5. 其他

- Editor.vue 风格列表确认：14种风格的 stylePrompt 全部为纯画风/技法描述，无具体内容元素
- 新增 `ScriptReviewerView.vue` 剧本审查器页面
- 新增 `scriptReviewer.ts` 审查引擎（16条规则）
- 新增 `styleTemplate.ts` 风格模板服务
- Editor.vue `genLoading` 从全局布尔值改为 `Set<string>` 独立状态

## 备份

- **D盘**: `D:\autodrama_backup_20260605`
- **数据库**: `C:\Users\Administrator\AppData\Roaming\electron-app\autodrama.db`
