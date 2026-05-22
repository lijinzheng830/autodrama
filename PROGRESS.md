# AutoDrama 开发进度记忆

> 最后更新：2026-05-22
> 当前 commit：`d0a9f97`
> 已完成：M1-01 ~ M1-16

---

## 一、Git 提交历史（最近15条）

```
d0a9f97 M1-16: 顶部工具栏完整实现——编辑器/画布切换+生成记录+撤销重做+导出+设置
82ca6dc M1-11~15: 剧集结构页完整实现——列表+右侧面板+编辑+关联
0ddb65b M1-09b+10: 总览页改造+AI解析弹窗+追加解析
5329671 M1-09: Home.vue改造——项目列表+创建弹窗
bb0741f M1-08: AI解析升级——模板参数+道具+只创建不覆盖
4e0e720 M1-07: 提示词模板服务——CRUD + 官方预设
60e438d M1-06: 分镜查询服务层——关联查询+移动+删除
f5f8c33 M1-05: 资产服务层——characters/scenes/props CRUD + 改名全局联动
b3c76cf M1-04: 项目CRUD扩展——新字段+续集复制+updateProject
34c1826 M1-03: 新建资产历史记录表 + 修scenes.prompt
b35370a M1-02: 新建核心表——props/shot_props/generation_tasks/prompt_templates
208db55 M1-01: 数据库迁移——projects/shots/characters 新增字段
d3868f3 fix: 4个修复 - 结果面板不遮挡剧本 + N+1查询优化 + 多窗口广播 + store重置
3ba87e5 fix: 进入编辑器时清空旧项目数据
58e5649 fix: 生成状态持久化 + 错误信息增强 + 超时机制 + 加载已有数据
1d0162a feat: AI服务层 + 自动挡流程 + 设置页面
```

---

## 二、数据库 Schema（13张表）

```
projects          ← 项目（含 era/negative_prompt/model_config_json/parent_project_id）
characters        ← 角色（含 skin_images，无 prompt 字段）
scenes            ← 场景（description = 提示词主体，无 prompt 字段）
props             ← 道具（M1-02 新建）
chapters          ← 章节
shots             ← 分镜（含 dialogue/first_frame_image_path/.../voice_path）
shot_characters   ← 分镜-角色关联
shot_scenes       ← 分镜-场景关联
shot_props        ← 分镜-道具关联（id TEXT PK + UNIQUE shot_id+prop_id）
settings          ← 全局设置
character_images  ← 角色形象图历史（M1-03）
scene_images      ← 场景图历史（M1-03）
prop_images       ← 道具图历史（M1-03）
shot_images       ← 分镜图历史（M1-03）
shot_videos       ← 分镜视频历史（含 has_new_badge，M1-03）
generation_tasks  ← 生成任务队列（M1-02）
prompt_templates  ← 提示词模板（M1-02）
```

---

## 三、后端服务层（Main Process）

### 3.1 文件清单

| 文件 | 功能 | 行数 |
|------|------|------|
| `src/main/services/db.ts` | SQLite 初始化 + 迁移 | 362 |
| `src/main/services/project.ts` | 项目 CRUD + 分镜查询/移动/删除 + 生成任务 | 580 |
| `src/main/services/asset.ts` | 角色/场景/道具 CRUD + 改名全局联动 | 248 |
| `src/main/services/ai.ts` | AI 调用 + autoProcess + 保存数据库 | 456 |
| `src/main/services/template.ts` | 提示词模板 CRUD + 官方预设 | 98 |
| `src/main/services/prompts.ts` | AI 提示词（storyboard/extract/associate） | 63 |
| `src/main/services/providers.ts` | 供应商配置 | 68 |
| `src/main/services/settings.ts` | 设置读写 | 12 |

### 3.2 IPC Handlers（40个）

```
project:create/list/get/delete/update
project:chapters/shots/characters/scenes
project:shotCharacters/shotScenes/shotCharactersByProject/shotScenesByProject
project:shotsWithAssociations/data
ai:auto-process
ai:progress（事件推送）
settings:get/set
providers:list
asset:character:create/update/delete
asset:scene:create/update/delete
asset:prop:create/update/delete/list
template:list/save/delete
shot:moveUp/moveDown/delete/update/associate
generationTask:create/list
dialog:selectDirectory/selectImage
```

---

## 四、前端页面

### 4.1 页面清单

| 页面 | 路由 | 状态 |
|------|------|------|
| Home.vue（首页） | `/` | ✅ M1-09 完成：项目卡片网格 + 创建弹窗（名称/目录/续集） |
| Editor.vue（编辑器） | `/editor/:id` | ✅ M1-09b+10+11~15 完成 |
| Settings.vue（设置） | `/settings` | ✅ 供应商/模型/APIKey |

### 4.2 Editor.vue 结构（M1-09b ~ M1-15）

**左侧导航（2项）：**
- 项目总览：风格选择（13种）+ 比例选择 + AI解析/追加按钮
- 剧集结构：分镜列表 + 右侧面板

**AI解析弹窗：**
- Tab：AI生成 / 手动切分（占位）
- 剧本输入 + 字数统计
- 风格/比例/模板/模型选择
- 4步骤进度推送
- 支持 full（清空重来）/ append（追加）模式

**剧集结构页：**
- 顶部工具栏：编辑器/画布切换 + 撤销重做 + 生成记录 + 导出 + 设置
- 横向分镜列表（12列）：序号/剧本/人物/场景/道具/配音/首帧/首帧提示词/尾帧/尾帧提示词/视频/操作
- 右侧面板常驻：角色/场景/道具 Tab + 搜索 + 作品中/全部可用分组
- 右侧面板详情：名称可编辑（全局联动）/ 描述可编辑 / 图片上传 / 生图控制栏（MVP1占位）
- 画布视图占位（MVP2）

---

## 五、关键架构约定

1. **prompt 字段已删除**：characters/scenes/props 的 `description` 就是生图提示词主体
2. **只创建、不覆盖**：AI 解析按名称匹配，已存在的资产只建关联不修改 name/description
3. **模型配置双层**：`settings` 表管全局供应商+APIKey；`projects.model_config_json` 管项目级模型选择
4. **改名全局联动**：updateCharacter/updateScene/updateProp 改名时，自动替换所有分镜提示词中的旧名字
5. **MVP1 生图占位**：点击 AI生图 按钮创建 `generation_tasks` 记录 + 弹窗提示"后续版本开放"
6. **id 统一 TEXT UUID**：所有主键和关联字段都是 TEXT（UUID），包括 shot_props.id

---

## 六、已知技术债务 / TODO

| # | 事项 | 优先级 |
|---|------|--------|
| 1 | ~~M1-16：顶部工具栏~~ ✅ 已完成 | 高 |
| 2 | M1-17：批量生成占位改为真实逻辑 | 中 |
| 3 | M1-18：生图控制栏从占位改为真实调用（generation_tasks → 真实 AI 调用） | 中 |
| 4 | M1-19：批量操作（批量生图/生视频） | 中 |
| 5 | 前后端分离评估（方案B已评估，搁置中） | 低 |
| 6 | `shot_props` 表有 `id TEXT PK` + `UNIQUE(shot_id, prop_id)`，与其他关联表不同（shot_characters 无 id 列） | 低（历史遗留） |
| 7 | Home.vue 创建项目时 styleName/stylePrompt/styleNegativePrompt 传空字符串（因为风格已移到编辑器）| 低 |

---

## 七、开发环境注意事项

- **Electron 33.4.2**（降级后的稳定版本）
- **better-sqlite3** 已用 `npx electron-rebuild` 重建（ABI 130）
- **必须 `unset ELECTRON_RUN_AS_NODE`** 再运行 `npm run dev`
- Dev server 超时 60s 是正常现象，用 `taskkill /F /IM electron.exe` 清理
- GitHub 连接偶发超时，commit 本地保留，网络恢复后 push

---

## 八、下一步（M1-16 及后续）

根据 `开发步骤清单`，剩余步骤：

- ~~M1-16：顶部工具栏完整实现~~ ✅
- M1-17：批量生成功能
- M1-18：真实生图调用（替换 MVP1 占位）
- M1-19：批量操作
- M2-01 ~ M2-XX：MVP2 功能（视频生成、配音等）

---

*本文档由 Kimi 在每次开发会话后自动更新。*
