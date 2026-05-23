# AutoDrama 技术架构文档

> 版本：2026-05-23  
> 范围：边界与约定，不含施工图  
> 技术栈：Electron + Vue3 + SQLite

**本次拉通修改摘要（v2）**：
1. 补充 `prompt_templates` 表 `project_id` 字段（nullable），支持全局模板（project_id IS NULL）与项目模板共存；
2. 新增 `getProjectStats` 接口定义，用于项目总览页统计卡片；
3. 新增「画布架构」章节：节点类型、自动连线规则、数据流方向、画布操作；
4. 新增「授权与账号架构」预留：注册/登录/授权码验证流程、HMAC签名授权码、管理后台；
5. 新增「远程配置架构」：COS预设分发、缓存策略、`.autodrama-config` 加密配置格式；
6. 更新「项目总览页数据流」：补充统计查询、风格/解析卡片化后的交互约定。

**本次拉通修改摘要（v3）**：
1. 补充供应商模型 `type` 字段（`text`/`prompt`/`image`/`video`），Settings.vue 弹窗模型列表改为结构化表单；
2. 补充齿轮弹窗三级优先级数据流：L1 sessionOverrides（内存级）> L2 model_config_json（项目级）> L3 model_routes（全局默认）；
3. 补充 `generateImage` 四级降级链：L1 input参数 → L2 project.model_config_json → L3 settings.model_routes → L4 自动匹配第一个有Key的供应商；
4. 补充 providerModels 缓存策略：`providers_dirty` localStorage 标记 + 清空重载机制。

---

## 一、数据库表结构

### 设计原则

- **方案B**：每个项目独立角色/场景/道具表，项目间数据隔离，通过"从其他项目导入"实现跨项目复用
- **迁移方式**：所有表结构变更通过 `ALTER TABLE` 或 `CREATE TABLE IF NOT EXISTS` 完成，不 DROP 重建
- **首帧/尾帧同字段**：`shots.first_frame_prompt` 同时用于"首帧提示词列"的显示编辑和"首帧列"的生图输入；`shots.last_frame_prompt` 同理
- **后台拼接**：所有生图/生视频的提示词 = 用户可见描述字段 + 项目风格提示词 + 年代关键词（后台自动注入，用户不可见）

---

### 1.1 核心表

#### projects（项目表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 项目唯一标识 |
| name | TEXT NOT NULL | 项目名称（可编辑，导出时用作文件名） |
| path | TEXT NOT NULL | 项目目录绝对路径 |
| script_text | TEXT | 原始剧本内容 |
| style_name | TEXT | 风格名称（如"写实摄影"） |
| style_prompt | TEXT | 风格提示词（后台拼接用，用户不可见） |
| negative_prompt | TEXT | 负面提示词（全局） |
| era | TEXT | 年代标签（古代/现代/未来等，注入所有提示词） |
| aspect_ratio | TEXT | 画面比例（16:9 / 9:16 / 1:1） |
| model_config_json | TEXT | 模型配置JSON（各用途独立配置，见下方「模型配置约定」） |
| parent_project_id | TEXT FK→projects.id | 续集项目的父项目ID |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

**迁移记录**：
- 初始版本已存在：`id, name, path, style_name, style_prompt, style_negative_prompt, aspect_ratio, created_at, updated_at`
- 新增：`script_text, negative_prompt, era, model_config_json, parent_project_id`

**模型配置约定**：
- `settings` 表（全局）：供应商列表、baseURL、API Key、插件扩展
- **设置页「模型路由 & 默认」**：管理全局默认值——每种用途（角色生图/场景生图/道具生图/分镜图/视频）默认用哪个模型、哪个渠道
- **顶部工具栏「模型配置弹窗」**：管理当前项目的模型选择，可以覆盖全局默认值，存到 `projects.model_config_json`
- `projects.model_config_json` 只存**差异覆盖项**：弹窗里改过的用途按项目配置执行，没改过的用途回退到设置页的全局默认值
- 项目创建时从全局配置复制当前默认值到 `model_config_json`，初始化后所有用途都有值

---

#### chapters（章节/剧集表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id ON DELETE CASCADE | |
| chapter_index | INTEGER NOT NULL | 章节顺序 |
| title | TEXT NOT NULL | 章节标题 |

---

#### shots（分镜表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| chapter_id | TEXT FK→chapters.id ON DELETE CASCADE | |
| shot_index | INTEGER NOT NULL | 分镜在章节内的顺序 |
| description | TEXT | 画面描述（不含对白） |
| dialogue | TEXT | 对白文本（独立字段，AI解析时拆分存储；提示词拼接只用description，dialogue供TTS配音独立读取） |
| first_frame_prompt | TEXT | **首帧提示词 = 首帧生图输入**，双向同步字段 |
| last_frame_prompt | TEXT | **尾帧提示词 = 尾帧生图输入**，双向同步字段 |
| video_prompt | TEXT | 视频提示词 |
| first_frame_image_path | TEXT | 当前选中的首帧图片路径 |
| last_frame_image_path | TEXT | 当前选中的尾帧图片路径 |
| video_path | TEXT | 当前选中的视频路径 |
| voice_path | TEXT | 配音文件路径（MVP3） |
| duration_seconds | REAL | 视频时长 |

> **分镜移动约定**：上下移动操作只在**同一章节内**调整 `shot_index` 顺序，不跨章节。跨章节移动需用户手动删除后在新章节添加。
>
> **新增约定（2026-05-22）**：`description` 只存画面描述，`dialogue` 独立存储对白文本。提示词拼接只用 `description`，`dialogue` 供 TTS 配音独立读取。AI 解析时如返回对白内容，拆分后分别存入两个字段。

**迁移记录**：
- 初始版本已存在：`id, chapter_id, shot_index, description, first_frame_prompt, last_frame_prompt, video_prompt, duration_seconds`
- 新增：`dialogue, first_frame_image_path, last_frame_image_path, video_path, voice_path`

> **约定**：`first_frame_prompt` 同时供"首帧提示词列"编辑显示和"首帧列"生图调用，UI 上两处绑定同一字段；`last_frame_prompt` 同理。

---

### 1.2 资产表（方案B：每个项目独立）

#### characters（角色表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id ON DELETE CASCADE | |
| name | TEXT NOT NULL | 角色名（全局唯一性约束在项目内） |
| description | TEXT | 角色描述（用户可见可编辑，生图时直接作为提示词主体） |
| reference_image | TEXT | 当前选中的定妆照路径 |
| skin_images | TEXT | 皮肤图片路径JSON数组（MVP2） |

**迁移记录**：初始版本已存在，新增 `skin_images`  
> **注**：`prompt` 字段已删除。AI 解析生成的英文提示词直接写入 `description`，`description` 即为生图提示词主体。用户只编辑 `description`，后台拼接时 `finalPrompt = description + stylePrompt + eraPrompt`。

---

#### scenes（场景表）

> **注**：同 characters，无 `prompt` 字段，`description` 即为提示词主体。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id ON DELETE CASCADE | |
| name | TEXT NOT NULL | 场景名 |
| description | TEXT | 场景描述（用户可见可编辑，生图时直接作为提示词主体） |
| reference_image | TEXT | 当前选中的场景图路径 |

---

#### props（道具表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id ON DELETE CASCADE | |
| name | TEXT NOT NULL | 道具名 |
| description | TEXT | 道具描述（用户可见可编辑，生图时直接作为提示词主体） |
| reference_image | TEXT | 当前选中的道具图路径 |

**迁移记录**：全新表  
> **注**：同 characters，无 `prompt` 字段，`description` 即为提示词主体。

---

### 1.3 关联表

#### shot_characters（分镜-角色关联）

| 字段 | 类型 | 说明 |
|------|------|------|
| shot_id | TEXT FK→shots.id ON DELETE CASCADE | |
| character_id | TEXT FK→characters.id ON DELETE CASCADE | |
| PK(shot_id, character_id) | | |

---

#### shot_scenes（分镜-场景关联）

| 字段 | 类型 | 说明 |
|------|------|------|
| shot_id | TEXT FK→shots.id ON DELETE CASCADE | |
| scene_id | TEXT FK→scenes.id ON DELETE CASCADE | |
| PK(shot_id, scene_id) | | |

---

#### shot_props（分镜-道具关联）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 关联记录ID（历史原因保留独立PK，与shot_characters/shot_scenes结构不完全一致） |
| shot_id | TEXT FK→shots.id ON DELETE CASCADE | |
| prop_id | TEXT FK→props.id ON DELETE CASCADE | |
| UNIQUE(shot_id, prop_id) | | 业务唯一约束 |

**迁移记录**：全新表
> **注**：与 `shot_characters` / `shot_scenes` 不同，`shot_props` 保留独立 `id` 字段 + `UNIQUE` 约束。这是历史实现，不影响业务逻辑。

---

### 1.4 资产历史记录表

每张表记录该资产的所有生成历史，用户可切换"当前选中"。

#### character_images（角色定妆照历史）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| character_id | TEXT FK→characters.id ON DELETE CASCADE | |
| image_path | TEXT NOT NULL | 图片文件路径 |
| model | TEXT | 生成所用模型 |
| is_selected | INTEGER DEFAULT 0 | 是否为当前选中（0/1） |
| created_at | INTEGER | |

---

#### scene_images（场景图历史）

同上结构，`scene_id` FK→scenes.id

---

#### prop_images（道具图历史）

同上结构，`prop_id` FK→props.id

---

#### shot_images（分镜首帧/尾帧图历史）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| shot_id | TEXT FK→shots.id ON DELETE CASCADE | |
| type | TEXT NOT NULL | `'first'` 或 `'last'` |
| image_path | TEXT NOT NULL | |
| model | TEXT | |
| is_selected | INTEGER DEFAULT 0 | |
| created_at | INTEGER | |

---

#### shot_videos（分镜视频历史）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| shot_id | TEXT FK→shots.id ON DELETE CASCADE | |
| video_path | TEXT NOT NULL | |
| model | TEXT | |
| is_selected | INTEGER DEFAULT 0 | |
| has_new_badge | INTEGER DEFAULT 1 | 是否有"new"角标（点击后清0） |
| created_at | INTEGER | |

---

### 1.5 系统表

#### settings（系统设置）

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT PK | |
| value | TEXT | |

**供应商数据结构（存储在 settings 表的 value 中，JSON 序列化）**：

```typescript
interface ProviderRecord {
  id: string           // 唯一标识（数据库生成或预置固定）
  name: string         // 显示名称（如"硅基流动"）
  key: string          // 标识键（如"siliconflow"）
  baseURL: string      // API 基础地址
  apiKey: string       // API Key（本地加密存储，MVP2）
  models: Model[]      // 模型列表
}

interface Model {
  key: string          // 模型标识（如"Kwai-Kolors/Kolors"）
  name: string         // 显示名称（如"Kolors"）
  type: 'text' | 'prompt' | 'image' | 'video'  // 模型用途分类
  free: boolean        // 是否免费（预留）
}
```

> **模型 type 字段约定**：
> - `text`：语言模型（用于剧本解析、提示词推理）
> - `prompt`：提示词专用模型（预留）
> - `image`：生图模型（用于角色/场景/道具定妆照、首帧/尾帧生图）
> - `video`：视频模型（用于视频生成）
>
> Settings.vue 供应商弹窗中，模型列表从 textarea（纯文本字符串数组）改为结构化表单，每行一个模型输入框 + type 下拉选择。保存时写入数据库，供模型路由、模型配置弹窗、齿轮面板按 type 过滤使用。
>
> **兼容性**：旧数据可能为字符串数组（如 `["gpt-image-2-all"]`），读取时 `typeof m === 'string'` 默认映射为 `type: 'text'`，用户需手动在设置页编辑旧供应商给模型选对类型。

---

#### prompt_templates（提示词模板）

> **统一一张表，通过 `usage` 区分不同类型**：AI解析模板（`script_parse`）和生图/生视频提示词模板（`character_image` / `scene_image` 等）共用同一张表。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id ON DELETE CASCADE | 所属项目ID，`NULL` 表示全局模板（官方预设+用户全局自定义模板） |
| name | TEXT NOT NULL | 模板名称 |
| usage | TEXT NOT NULL | 用途分类：`script_parse` / `character_image` / `scene_image` / `prop_image` / `first_frame` / `last_frame` / `video` |
| content | TEXT NOT NULL | 模板内容（含变量占位符） |
| is_builtin | INTEGER DEFAULT 0 | 是否官方预设（0=用户自定义，1=官方） |
| created_at | INTEGER | |

> **模板作用域约定**：`project_id IS NULL` 的模板为全局模板（所有项目共享）；`project_id` 有值的为项目级模板。项目选择模板时，先读项目级，再读全局。删除项目时级联删除其项目级模板。

---

#### generation_tasks（生成任务队列）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK→projects.id | |
| shot_id | TEXT FK→shots.id | 关联分镜ID，`null` 表示项目全局任务（角色/场景/道具定妆照） |
| purpose | TEXT NOT NULL | `character_reference` / `scene_reference` / `prop_reference` / `first_frame` / `last_frame` / `video` / `voice` |
| status | TEXT NOT NULL | `pending` / `running` / `completed` / `failed` |
| model | TEXT | 使用的模型 |
| channel | TEXT | 渠道标识（供应商/节点，对应生成记录窗口的「渠道」列） |
| prompt | TEXT | 实际发送的完整提示词 |
| input_params | TEXT | JSON字符串，存储生成张数、资产ID等额外参数 |
| result_path | TEXT | 生成结果文件路径 |
| error_message | TEXT | 失败原因 |
| created_at | INTEGER | |
| started_at | INTEGER | |
| completed_at | INTEGER | |

---

## 二、数据流向

### 2.1 核心流程总图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  创建项目页  │────→│  项目总览页  │────→│  AI解析弹窗  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                │
                                                ▼
                                    ┌─────────────────────┐
                                    │  调用AI解析剧本      │
                                    │  → chapters          │
                                    │  → shots             │
                                    │  → characters        │
                                    │  → scenes            │
                                    │  → props             │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │  批量写入数据库      │
                                    │  → 关联表同步建立    │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │  剧集结构页          │
                                    │  ← 左：分镜横向列表  │
                                    │  → 右：面板详情      │
                                    └─────────────────────┘
```

### 2.2 各页面数据流转

| 页面 | 数据来源 | 写入目标 | 关键行为 |
|------|----------|----------|----------|
| 创建项目页 | 用户输入 | `projects` 表 INSERT | 创建项目目录 `userData/projects/<id>/` |
| 项目总览页 | `projects` 表 SELECT | `projects` 表 UPDATE（风格/比例/年代） | 修改全局风格提示词，影响所有后续生成 |
| AI解析弹窗 | 用户粘贴剧本 + 模板选择 | `chapters` / `shots` / `characters` / `scenes` / `props` / `shot_*` 关联表批量INSERT | 解析完成后自动跳转到剧集结构页 |
| 剧集结构页 | `shots` + 关联表 JOIN 查询 | `shots` UPDATE / `characters` UPDATE / `generation_tasks` INSERT 等 | 分镜编辑、资产编辑、生成触发 |
| 右侧面板 | 当前选中项的详细数据 | 对应资产表 UPDATE | 角色描述修改后全局联动 |
| 生成记录弹窗 | `generation_tasks` 表 SELECT | — | 只读展示，操作"重试"会INSERT新任务 |

### 2.3 全局联动机制

#### 角色名修改联动

```
用户编辑角色名
    │
    ▼
UPDATE characters SET name = ? WHERE id = ?
    │
    ├──→ 触发器/应用层：遍历所有 shots.description / shots.first_frame_prompt /
    │     shots.last_frame_prompt / shots.video_prompt，文本替换旧名→新名
    │
    ├──→ 剧集结构页左侧列表：重新查询或局部刷新，高亮显示更新
    │
    └──→ 右侧面板（如正在查看该角色）：名称同步更新
```

**约定**：
- 角色名在项目内全局唯一（数据库层加 `UNIQUE(project_id, name)`）
- 改名时只做纯文本替换（不修改关联关系），关联表 `shot_characters` 用 `character_id` 不变
- 提示词中的角色名高亮依赖实时文本匹配，非硬编码位置

#### 提示词修改联动

```
用户编辑 shots.first_frame_prompt
    │
    ▼
UPDATE shots SET first_frame_prompt = ? WHERE id = ?
    │
    ├──→ 首帧提示词列：文本更新
    ├──→ 首帧列：生图时使用同一字段，无需额外同步
    └──→ 关联标签解析：实时扫描文本中的角色/场景/道具名，更新高亮和关联
```

#### 资产描述修改联动

```
用户编辑 characters.description
    │
    ▼
UPDATE characters SET description = ? WHERE id = ?
    │
    ├──→ 右侧面板详情：已更新（编辑源）
    ├──→ 左侧面板缩略图悬停提示：下次悬停时读取新数据
    └──→ 分镜列表中的关联标签：不直接显示描述，不受影响
```

### 2.4 右侧面板与左侧列表双向同步

**左侧 → 右侧（点击分镜单元格）**

```
用户点击分镜的"出场人物"缩略图
    │
    ▼
右侧面板从"常驻Tab列表"切换到"角色详情视图"
    │
    ▼
显示：大图预览 + 名称（只读）+ 描述（可编辑）+ 生图控制栏
```

**右侧 → 左侧（编辑后返回）**

```
用户在右侧面板编辑角色描述并返回
    │
    ▼
UPDATE characters SET description = ?
    │
    ▼
左侧面板该角色所在的所有分镜行：
    - 悬停预览时显示新描述
    - 如该角色在 shots.first_frame_prompt 中被引用，高亮逻辑依赖名称匹配，不受描述变更影响
```

**约定**：
- 右侧面板是"上下文详情区"，根据左侧点击对象动态切换内容类型
- 右侧编辑的字段（名称、描述）写入对应资产表，左侧通过重新查询或事件通知刷新
- **名称可编辑**：右侧面板中角色/场景/道具的名称均可编辑，改名后触发全局联动（遍历所有 shots 文本替换旧名→新名）
- 提示词模板不可在右侧面板编辑（需到模型配置弹窗的模板系统中编辑）

### 2.5 齿轮弹窗数据流

#### 三级优先级（模型选择回退链）

```
齿轮弹窗打开
    │
    ▼
initGearDefaults() 执行
    │
    ├──→ L1: 读 sessionOverrides[purposeKey]
    │     存在 ? 使用覆盖值（内存级，点"确认"写入，重启清空）
    │     不存在 → 继续
    │
    ├──→ L2: 读 window.api.getProject(projectId).model_config_json
    │     该用途有配置 ? 使用项目级配置（持久化，项目独享）
    │     不存在 → 继续
    │
    ├──→ L3: 读 window.api.getSetting('model_routes')
    │     该用途有路由 ? 使用全局默认（所有项目共享）
    │     不存在 → 继续
    │
    └──→ 全部无值：模型/渠道留空，显示"未设置"
```

**用途到 type 映射**：

| 用途 key | model type |
|----------|-----------|
| `language_model` | `text` |
| `character_image` | `image` |
| `scene_image` | `image` |
| `prop_image` | `image` |
| `first_frame` | `image` |
| `last_frame` | `image` |
| `video` | `video` |

**模型/渠道过滤逻辑**：
- `filteredModels = providerModels.filter(m => m.modelType === neededType)`
- `filteredChannels = providerChannels.filter(c => filteredModels.some(m => m.provider === c.value))`

#### providerModels 缓存策略

```
Settings.vue 保存/删除供应商
    │
    ▼
localStorage.setItem('providers_dirty', '1')
    │
    ▼
下次打开齿轮/模型配置弹窗
    │
    ▼
initGearDefaults() / openModelConfig()
    │
    ▼
检测 localStorage.getItem('providers_dirty') === '1'
    │
    ├──→ 是：providerModels.value = []（清空缓存）
    │         localStorage.removeItem('providers_dirty')
    │         重新调用 loadProviderModels() 从数据库加载
    │
    └──→ 否：复用已有 providerModels（避免重复请求）
```

#### 会话覆盖生命周期

```
用户在齿轮面板选择模型+渠道
    │
    ▼
点击"确认"按钮
    │
    ▼
setSessionOverride(purposeKey, model, channel)
    │
    ▼
sessionOverrides.value[purposeKey] = { model, channel }
    │
    ▼
外面"AI生图"按钮调用 handleGenerateImage()
    │
    ▼
优先读取 sessionOverrides[purposeKey]
    │  存在 ? 使用该 model/channel
    │  不存在 ? 回退到 model_config_json（L2）→ model_routes（L3）
    │
    ▼
调用 window.api.generateImage({ model, channel, ... })
    │
    ▼
应用关闭 → sessionOverrides 清空（内存级，不持久化）
```

> **关键约定**：sessionOverrides 是前端内存变量（`ref<Record<string, {model, channel}>>`），不写入数据库，不写入 localStorage，应用重启即丢失。其设计目的是"本次工作会话内的临时覆盖"，避免频繁修改项目配置。

---

## 三、接口契约

### 3.1 AI解析剧本

**调用时机**：项目总览页点击"一键生成分镜"

**输入格式**

```typescript
interface AIParseScriptInput {
  script: string           // 用户粘贴的剧本全文
  styleName: string        // 风格名称（如"写实摄影"）
  stylePrompt: string      // 风格提示词（后台传入，AI参考用）
  era: string              // 年代标签（如"古代"）
  aspectRatio: string      // 画面比例
  promptTemplate: string   // 提示词模板内容（含变量已替换）
  model: string            // 模型标识
}
```

**输出格式**

```typescript
interface AIParseScriptOutput {
  chapters: Array<{
    title: string
    shots: Array<{
      shot_index: number
      description: string       // 画面描述
      dialogue: string          // 对白（可为空）
      first_frame_prompt: string
      last_frame_prompt: string
      video_prompt: string
      character_names: string[] // 本镜出场的角色名列表
      scene_names: string[]     // 本镜涉及的场景名列表
      prop_names: string[]      // 本镜涉及的道具名列表
    }>
  }>
  characters: Array<{
    name: string
    description: string        // 角色外貌/性格描述（生图时直接作为提示词主体）
  }>
  scenes: Array<{
    name: string
    description: string
  }>
  props: Array<{
    name: string
    description: string
  }>
}
```

**持久化约定**：
- 输出写入数据库后，同一项目内角色/场景/道具名称全局唯一
- 若 AI 返回重名，应用层自动去重（加序号后缀）
- 关联表 `shot_characters` / `shot_scenes` / `shot_props` 按名称匹配建立
- **「只创建、不覆盖」原则**：AI 解析时，按名称匹配已存在的角色/场景/道具 → 只建立分镜关联，不修改已有记录的 `name` 和 `description`；只有数据库中不存在的资产才新建记录并写入 description。避免覆盖用户手动修改过的内容。

---

### 3.2 生图接口

**统一入口**：单条生成和批量生成共用同一底层接口

**输入格式**

```typescript
interface GenerateImageInput {
  // 用户可见部分
  description: string       // 角色描述 / 场景描述 / 道具描述 / 分镜画面描述
  
  // 后台自动拼接部分（用户不可见）
  stylePrompt: string       // 项目风格提示词（从 projects.style_prompt 读取）
  eraPrompt: string         // 年代关键词（从 projects.era 转换）
  negativePrompt: string    // 负面提示词（从 projects.negative_prompt 读取）
  
  // 控制参数
  model: string             // 生图模型标识（如 "Kwai-Kolors/Kolors"）
  channel: string           // 渠道标识（如 "siliconflow"），与 model 一起决定调用哪个供应商的 API
  count: number             // 生成张数（1-N）
  referenceImagePaths?: string[] // 参考图路径数组（可选，分镜图生图时传入关联的角色/场景/道具定妆照）
  
  // 上下文
  projectId: string
  targetType: 'character' | 'scene' | 'prop' | 'shot_first' | 'shot_last'
  targetId: string          // character_id / scene_id / prop_id / shot_id
}
```

**实际发送给模型的 prompt 拼接逻辑**

```
finalPrompt = description + ", " + stylePrompt + ", " + eraPrompt
```

> 拼接顺序和分隔符由具体模板决定，应用层保证不可见字段始终附加在末尾。

**输出格式**

```typescript
interface GenerateImageOutput {
  taskId: string            // generation_tasks.id
  imagePaths: string[]      // 生成的图片文件路径数组（保存到项目目录 assets/images/）
}
```

**异步约定**：
- 接口返回 `taskId` 后立即响应，不阻塞 UI
- 后台将任务写入 `generation_tasks` 队列，逐条执行
- 完成后更新对应资产表的 `reference_image` 或 `first_frame_image_path` / `last_frame_image_path`
- 如设置了 `is_selected = 1`，新图自动成为当前选中
- **MVP1 占位约定**：生图/生视频按钮点击后，正常创建 `generation_tasks` 记录并显示进行中的任务状态，但实际执行时弹出提示"图片/视频生成将在后续版本开放"。MVP2 接入真实 API 后，只需替换该提示为真实调用逻辑，任务队列和数据流已提前跑通

#### `generateImage` 模型选择降级链（主进程侧）

当 `model` 或 `channel` 为空时，主进程 `imageGenerator.ts` 按以下优先级自动回退：

```
L1: 传入参数
    generateImage({ model, channel, ... })
    model 和 channel 同时存在 ? 直接调用 → 结束
    任一不存在 → 继续

L2: 项目模型配置
    const proj = getProject(projectId)
    const cfg = JSON.parse(proj.model_config_json)[purposeKey]
    cfg?.model ? model = cfg.model
    cfg?.channel ? channel = cfg.channel
    model 和 channel 同时存在 ? 直接调用 → 结束
    任一不存在 → 继续

L3: 全局模型路由
    const routes = JSON.parse(getSetting('model_routes'))
    const route = routes[purposeKey]
    route?.model && !model ? model = route.model
    route?.channel && !channel ? channel = route.channel
    model 和 channel 同时存在 ? 直接调用 → 结束
    任一不存在 → 继续

L4: 自动匹配
    providers = getProviders()
    遍历 providers，找到第一个有 apiKey 的供应商
    model = 该供应商的第一个 image 类型模型
    channel = 该供应商的 key
```

> **约定**：降级链只在主进程执行，前端传入的 `model`/`channel` 为 undefined 或空字符串时触发。降级完成后，最终的 `model` 和 `channel` 写入 `generation_tasks` 表，供生成记录追溯。
>
> **L4 风险兜底**：L4 自动匹配后如果调用失败（如 Key 过期、余额不足、模型不可用），任务标记为失败，`error_message` 写入 `"供应商配置异常，请检查 API Key 和模型可用性"`，不再继续降级到其他供应商。避免在不可用的供应商之间无限循环。

#### 响应格式兼容

不同供应商的 API 响应格式不一致，主进程做兼容处理：

```typescript
// 硅基流动 / 通用 OpenAI 格式
const images = resp.data?.data || resp.data?.images || []
// 取每一项的 url 或 b64_json
const urls = images.map((img: any) => img.url || img.b64_json).filter(Boolean)
```

---

### 3.3 视频生成接口

**输入格式**

```typescript
interface GenerateVideoInput {
  // 素材来源
  firstFrameImagePath: string   // 首帧图路径（当前选中的 shot_images.is_selected=1）
  lastFrameImagePath?: string   // 尾帧图路径（可选）
  referenceImagePaths?: string[] // 角色/场景/道具参考图路径数组（可选，提升角色一致性）
  
  // 提示词（后台拼接）
  videoPrompt: string           // 用户可见：视频运动描述
  stylePrompt: string           // 后台附加：风格关键词
  eraPrompt: string             // 后台附加：年代关键词
  
  // 控制参数
  model: string
  count: number
  
  // 上下文
  projectId: string
  shotId: string
}
```

**输出格式**

```typescript
interface GenerateVideoOutput {
  taskId: string
  videoPaths: string[]          // 保存到项目目录 assets/videos/
}
```

**备选素材约定**：
- 每次生成结果写入 `shot_videos` 表，`is_selected = 0`，`has_new_badge = 1`
- 用户在右侧面板点击 ✓ 选中后，更新该记录 `is_selected = 1`，同时更新 `shots.video_path`
- 视频列缩略图始终显示 `shots.video_path` 对应的视频
- **"全部移除"逻辑**：删除该 shot 下所有 `shot_videos` 记录，同时清空 `shots.video_path`。操作后视频列恢复灰底占位，需重新生成。  
  > 与单条删除（🗑）的区别：「全部移除」是清空整个分镜的视频历史；单条删除只移除某一个备选素材。

---

### 3.4 批量操作接口

**统一入口**：各列头的"批量生成"按钮和右侧面板"批量生成"按钮共用同一调度器

#### 资产模式（角色/场景/道具定妆照）

**输入格式**

```typescript
interface AssetBatchGenerateInput {
  // 生成范围：当前项目的全部资产，不依赖分镜勾选
  projectId: string
  
  // 生成类型
  assetType: 'character' | 'scene' | 'prop'
  
  // 生成模式
  mode: 'all' | 'missing'   // 'all'=为每个资产创建任务，'missing'=只遍历reference_image为空的资产
  
  // 控制参数
  model: string
  count: number             // 每张生成数量
}
```

**缺失判定**：遍历项目全部资产，`!asset.reference_image` 为缺失

**任务创建**：`generation_tasks.shot_id = null`（项目全局任务），`purpose` 为 `character_reference` / `scene_reference` / `prop_reference`，`input_params` JSON 中包含 `characterId` / `sceneId` / `propId`

#### 分镜模式（首帧/尾帧/视频）

**输入格式**

```typescript
interface ShotBatchGenerateInput {
  // 生成范围：以序号列勾选为依据
  shotIds: string[]         // 空数组表示未勾选（需提示用户）
  
  // 生成类型
  targetType: 'first_frame' | 'last_frame' | 'video'
  
  // 生成模式
  mode: 'all' | 'missing'   // 'all'=覆盖重新生成，'missing'=只生成缺失项
  
  // 控制参数
  model: string
  count: number             // 每张/每条生成数量
  
  // 上下文
  projectId: string
}
```

**缺失生成判定逻辑**

```typescript
function isMissing(shotId: string, targetType: string): boolean {
  switch (targetType) {
    case 'first_frame':
      return !shot.first_frame_image_path
    case 'last_frame':
      return !shot.last_frame_image_path
    case 'video':
      return !shot.video_path
  }
}
```

**任务创建**：`generation_tasks.shot_id` 为对应分镜ID

#### 统一约定

**缺失生成按钮状态约定**：
- 调用前预扫描所有选中项，如全部 `isMissing = false`，按钮置灰不可点
- 批量执行过程中，中间状态不阻塞 UI，进度通过 `generation_tasks` 表和事件推送更新

**输出格式**

```typescript
interface BatchGenerateOutput {
  batchTaskId: string       // 批次ID（用于追踪）
  totalTasks: number        // 实际创建的任务数
  taskIds: string[]         // 子任务ID列表
}
```

---

### 3.5 项目统计接口

**调用时机**：项目总览页加载时

**输入格式**

```typescript
// GET /project/:id/stats
interface GetProjectStatsInput {
  projectId: string
}
```

**输出格式**

```typescript
interface GetProjectStatsOutput {
  characters: number  // SELECT COUNT(*) FROM characters WHERE project_id = ?
  scenes: number      // SELECT COUNT(*) FROM scenes WHERE project_id = ?
  props: number       // SELECT COUNT(*) FROM props WHERE project_id = ?
  chapters: number    // SELECT COUNT(*) FROM chapters WHERE project_id = ?
  shots: number       // SELECT COUNT(*) FROM shots WHERE chapter_id IN (SELECT id FROM chapters WHERE project_id = ?)
}
```

**约定**：纯读接口，不缓存；数据量小，每次进入总览页实时查询。

---

### 3.6 导出接口

**输入格式**

```typescript
interface ExportInput {
  projectId: string
  exportType: 'video' | 'scene' | 'character' | 'prop'
  
  // 范围选择
  shotIds?: string[]        // 视频导出时：以序号列勾选为依据
  assetIds?: string[]       // 角色/场景/道具导出时：卡片缩略图勾选
  
  // 命名规则
  namingPattern: string     // 默认："{index}_{projectName}_{timestamp}"
}
```

**输出格式**

```typescript
interface ExportOutput {
  exportPath: string        // 导出的文件夹路径
  files: Array<{
    originalPath: string
    exportedName: string
    exportedPath: string
  }>
}
```

**导出规则约定**：
- **视频导出**：导出 `shots.video_path` 对应的视频文件，按 `namingPattern` 重命名
- **角色/场景/道具导出**：导出 `reference_image` 对应的图片文件
- 所有导出文件放入用户选择的目录，不移动原文件（复制）

---

## 四、项目结构约定

### 4.1 目录组织

```
userData/                              # Electron app.getPath('userData')
├── autodrama.db                       # SQLite 数据库文件
├── settings.json                      # 系统配置（可选，与 settings 表互补）
└── projects/
    ├── <project-id-1>/               # 项目独立目录
    │   ├── assets/
    │   │   ├── images/
    │   │   │   ├── characters/       # 角色定妆照
    │   │   │   ├── scenes/           # 场景图
    │   │   │   ├── props/            # 道具图
    │   │   │   ├── first_frames/     # 分镜首帧图
    │   │   │   └── last_frames/      # 分镜尾帧图
    │   │   ├── videos/               # 分镜视频
    │   │   └── voices/               # 配音文件（MVP3）
    │   └── exports/                  # 导出缓存
    └── <project-id-2>/
        └── ...
```

**约定**：
- 数据库文件 `autodrama.db` 与项目目录平级，集中管理
- 每个项目的资产文件隔离在独立目录下，便于删除/备份/迁移
- 续集项目（`parent_project_id` 非空）创建时，复制父项目的 `characters` / `scenes` / `props` 数据到新项目目录

### 4.2 页面路由规划

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | Home.vue（项目列表+创建入口） | 显示已有项目卡片，点击创建新项目 |
| `/editor/:id` | 编辑器容器页 | 包含顶部工具栏 + 左侧导航 + 中间内容区 |
| `/editor/:id/overview` | 项目总览 | 风格/比例/AI解析入口 |
| `/editor/:id/episodes` | 剧集结构 | 核心工作区：分镜列表 + 右侧面板 |
| `/settings` | 设置页 | API供应商/模型路由/通用设置 |

**约定**：
- 编辑器内所有子页面（总览/剧集结构）共享同一个顶部工具栏和左侧导航
- 右侧面板是剧集结构页的专属区域，不随路由切换独立存在
- 设置页是全局弹窗/独立页面，不嵌入编辑器布局
- > **路由标注**：当前实现采用单页内 `activeNav` 切换（总览/剧集结构），未使用子路由。Web化迁移时改为 `/editor/:id/overview` 和 `/editor/:id/episodes` 子路由。

### 4.3 数据库文件位置

```typescript
// 主进程初始化时
const dbPath = path.join(app.getPath('userData'), 'autodrama.db')
```

**迁移脚本约定**：
- 应用启动时执行 `initDatabase()`，按版本号顺序执行迁移
- 每个迁移记录执行状态，避免重复执行
- 新增表用 `CREATE TABLE IF NOT EXISTS`
- 新增字段用 `ALTER TABLE ... ADD COLUMN ...` 包裹在 `try-catch` 中
- 删除字段 SQLite 不支持直接 `DROP COLUMN`，如需删除标记为废弃，不物理删除

---

## 五、画布架构

> **技术选型**：`@vue-flow/core`（Vue Flow）—— Vue3 生态最成熟的节点流编辑器，支持自定义节点/边、拖拽平移缩放、自动布局，与当前技术栈完全兼容。



### 5.1 核心设计

- **画布 = 编辑器的可视化翻版**：编辑器一行分镜 = 画布一条节点流，编辑器一列 = 画布一个节点
- **连线自动生成**：跟随编辑器数据关系，用户不需要手动连线；精修时支持手动拖拽调整
- **一个分镜一个空间**：画布上每个分镜是独立的完整区域，包含该分镜所有节点；分镜之间无连线
- **编辑器与画布同一套数据**：编辑器表格视角 ↔ 画布节点流视角，数据双向同步

### 5.2 节点类型

| 节点类型 | 输入 | 输出 | 说明 |
|----------|------|------|------|
| 资产生图节点 | 风格参考图(预设) + 提示词 | 定妆照/场景图/道具图 | 角色/场景/道具通用结构 |
| 帧生图节点 | 角色/场景/道具输出图(连线) + 风格参考图 + 提示词 | 首帧图/尾帧图 | 首帧/尾帧通用结构 |
| 视频生成节点 | 首帧图 + 尾帧图(可选) + 角色/场景/道具参考图 + 提示词 | 视频 | 图生视频 |
| 结果展示节点 | — | — | 显示生成结果缩略图+状态，不可编辑 |

**节点内部结构（从上到下）**：
1. 展开/折叠按钮
2. 后台提示词缩略展示（不可编辑，暗色）
3. 风格参考图缩略（不可编辑，暗色）
4. 可编辑提示词区域（点击弹窗放大编辑）
5. 模型下拉框
6. 参数按钮行：画面比例 + 分辨率选择
7. 底部状态栏：动态工作状态，失败时显示错误信息

### 5.3 连线规则

**自动生成逻辑**：
```
资产生图节点 → 结果展示节点（自动）
结果展示节点 → 帧生图节点（参考图输入，自动）
帧生图节点 → 结果展示节点（自动）
结果展示节点 → 视频生成节点（参考图输入，自动）
首帧结果 → 视频生成节点（自动）
尾帧结果 → 视频生成节点（有尾帧时，自动）
```

**手动调整**：用户可拖拽端口增删连线，手动修改后连线状态持久化到项目配置。

### 5.4 画布操作

- 拖拽平移、滚轮缩放
- 适配按钮：当前分镜节点缩放至可视区域
- 点击空白取消选中
- 底部工具栏：添加节点、缩放控制、适配视图、撤销/重做

### 5.5 左侧面板

- 五个图标：角色、场景、道具、分镜、资产库
- 点中展开对应竖向面板，同位置切换，同时只展开一个；默认展开角色面板，不收起；再点同一图标收起面板
- 面板内容与编辑器右侧面板一致，不额外加操作
- **角色/场景/道具面板跟随当前分镜**：切换分镜，面板列表跟着变（每个分镜一个独立空间）
- **资产库面板全局**：不跟分镜走，显示项目全部资产
- **画布深浅色切换**：右上角太阳/月亮图标，仅切换画布区域主题

#### 分镜面板详情

- 顶部：分镜编号（#001）+ 提示词摘要 + 编辑按钮
- 上/下一分镜切换按钮
- 按章节分组展示分镜列表，当前分镜高亮
- 点击某个分镜跳转到画布对应节点
- 每个资产项显示：缩略图 + 名称 + 跳转工作流按钮（点击定位到该资产对应的生图节点）
- 面板布局：顶部标题+数量，当前分镜关联项置顶，其余项折叠

---

## 六、授权与账号架构

### 6.1 授权流程

```
首次打开应用 → 注册弹窗（邮箱/手机号 + 密码）
已有账号 → 登录弹窗
登录后无授权码 → 授权码输入弹窗（XXXX-XXXX-XXXX-XXXX）
```

### 6.2 授权码技术方案

- 算法生成：HMAC签名，码本身包含等级（免费/Pro）和有效期信息
- 验证时密钥校验，无需实时联网（可选离线验证+定期联网校验）
- 设置页"账号与授权"：查看授权状态、切换账号、重新输入授权码

### 6.3 管理后台（独立Web页面）

- 生成授权码：指定功能等级、有效期、批量生成数量
- 授权码列表：码值、等级、有效期、状态（未使用/已激活/已过期/已吊销）、激活设备数
- 吊销授权码、查看激活用户、绑定设备数
- 测试阶段：给漫剧公司生成测试授权码

---

## 七、远程配置架构

### 7.1 预设分发

- COS 存放 `presets.json`，应用启动时拉取合并
- 带缓存头（如 `If-None-Match`），网络不通时沿用本地缓存
- 官方模板只读，用户模板可编辑/删除/新建

### 7.2 配置加密格式

- 导出配置：系统预设 + 我的模板 + 模型路由 → JSON → AES加密 → `.autodrama-config`
- 导入配置：解密 → 合并（官方不动、我的同名覆盖+新增、系统预设和路由直接覆盖）
- 双击 `.autodrama` 文件自动打开软件并导入

### 7.3 API供应商返利

- 设置页每个API供应商旁加"获取API Key"按钮
- 点击跳转带推荐码的官方注册页
- 用户通过按钮注册/充值，软件方获得佣金返利

---

## 八、风格参考图数据结构

### 8.1 存储位置

风格参考图作为项目级资源，存储在项目目录下：
```
projects/<project-id>/assets/style_references/
├── <style-name-hash>.png       # 每种风格一张参考图
└── thumbnails/                  # 缩略图缓存
```

### 8.2 数据结构

```typescript
interface StyleReference {
  id: string
  projectId: string
  styleName: string        // 对应 projects.style_name
  imagePath: string        // 参考图文件路径
  thumbnailPath: string    // 缩略图路径
  category: 'character' | 'scene' | 'general'  // 用途分类
  createdAt: number
}
```

### 8.3 使用约定

- **预设风格**：官方13种预设风格各带一张默认参考图，安装时内置在应用包中
- **自定义风格**：用户上传自己的风格参考图 + 输入风格提示词，保存到项目目录
- **自动注入**：所有生图/生视频节点自动加载当前项目的风格参考图作为输入，**不出现在连线上**（后台隐式注入，用户不可见连线）
- **节点内展示**：生图节点内部暗色区域显示风格参考图缩略，提示用户"风格已自动注入"

---

## 附录：已有表 vs 新增表对照

| 表名 | 初始版本状态 | 本架构变更 |
|------|-------------|-----------|
| projects | 已存在 | 新增：`era, negative_prompt, model_config_json, parent_project_id` |
| chapters | 已存在 | 无变更 |
| shots | 已存在 | 新增：`dialogue, first_frame_image_path, last_frame_image_path, video_path, voice_path` |
| characters | 已存在 | 新增：`skin_images` |
| scenes | 已存在 | 删除：`prompt`（description 即为提示词主体） |
| shot_characters | 已存在 | 无变更 |
| shot_scenes | 已存在 | 无变更 |
| settings | 已存在 | 无变更 |
| props | **新增** | 全新表 |
| shot_props | **新增** | 全新表 |
| character_images | **新增** | 全新表 |
| scene_images | **新增** | 全新表 |
| prop_images | **新增** | 全新表 |
| shot_images | **新增** | 全新表 |
| shot_videos | **新增** | 全新表 |
| generation_tasks | **新增** | 全新表 |
| prompt_templates | **新增** | 全新表 |
