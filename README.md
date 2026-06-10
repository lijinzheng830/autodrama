# AutoDrama — AI 漫剧生成器

基于 Electron + Vue 3 + TypeScript 的 AI 漫剧一键生成桌面应用。从剧本解析到角色定妆、分镜画面、视频生成，全链路可控。

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 33 |
| 前端 | Vue 3.5 (Composition API) + Element Plus + TypeScript |
| 数据库 | better-sqlite3 |
| AI 调用 | OpenAI 兼容 API (Agnes / DashScope / 自定义) |
| 测试 | Vitest |

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev

# 构建 + 启动
npm run build && npm run start

# 仅类型检查
npm run typecheck

# 运行测试
npm test
```

> **Windows 注意**：如果启动报 `Cannot read properties of undefined`，检查系统环境变量是否设置了 `ELECTRON_RUN_AS_NODE=1`，删除它即可。

## 项目架构

```
src/
├── main/                         # Electron 主进程
│   ├── index.ts                  # IPC handler 注册 + 窗口管理
│   ├── types.ts                  # 类型定义（DB 行类型 / IPC 输入类型）
│   ├── services/
│   │   ├── ai.ts                 # AI 文本处理：剧本解析 / 角色提取 / 中英翻译
│   │   ├── imageGenerator.ts     # 图片生成管线：资产图 / 分镜首尾帧 / 角度锚点
│   │   ├── videoGenerator.ts     # 视频生成 + 轮询
│   │   ├── project.ts            # 项目 CRUD / 分镜关联 / 批量任务
│   │   ├── asset.ts              # 角色/场景/道具资产管理
│   │   ├── db.ts                 # 数据库初始化 + 迁移 + 索引 + 模板灌表
│   │   ├── styleMapper.ts        # 风格映射 / 景别检测 / 中英术语翻译
│   │   ├── modelRouter.ts        # AI 模型四级降级路由
│   │   ├── characterAnchorService.ts  # 多角度锚点 + 历史图片 CRUD
│   │   ├── consistencyChecker.ts # Prompt 级角色外貌一致性校验
│   │   ├── scriptReviewer.ts     # 剧本审查（16 条规则 / 关键词匹配 + AI 深度审查）
│   │   └── prompts.ts            # AI Prompt 模板常量
│   ├── utils/
│   │   ├── constants.ts          # 全局常量
│   │   ├── crypto.ts             # safeStorage 加密
│   │   ├── license.ts            # 许可证校验
│   │   ├── pathValidator.ts      # 路径安全校验
│   │   ├── sql.ts                # SQL 表名/列名白名单
│   │   ├── remoteConfig.ts       # 远程配置
│   │   └── telemetry.ts          # 遥测
│   └── data/prompt-templates/    # 18 条官方 Prompt 模板
├── preload/                      # Electron 预加载脚本
│   └── index.ts                  # contextBridge API 暴露
└── renderer/                     # Vue 3 渲染进程
    └── src/
        ├── views/
        │   ├── Editor.vue        # 主编排页（剧本解析 + 分镜编辑 + 资产管理）
        │   └── ScriptReviewerView.vue  # 剧本审查页
        ├── components/
        │   ├── ShotFlowEditor.vue # 分镜表格（13 列可编辑 + 内联编辑）
        │   ├── AssetPanel.vue     # 右侧资产面板（详情 + 历史 + 多角度锚点）
        │   └── GenerationOrchestrator.vue  # 对话框组（待接入）
        └── stores/               # Pinia 状态管理
```

## 数据流

```
用户输入剧本
  │
  ▼
ai.ts (剧本解析) → 提取角色/场景/道具/分镜
  │
  ▼
Editor.vue (编辑/调整)
  │
  ├──► imageGenerator.ts ──► AI 生图 API ──► 角色定妆照 / 场景图 / 首尾帧
  │
  └──► videoGenerator.ts ──► AI 视频 API ──► 分镜视频
```

## AI 服务商配置

AutoDrama 兼容所有 OpenAI 格式的 API。在设置页配置：

### Agnes AI（默认）

| 字段 | 值 |
|------|-----|
| Base URL | `https://api.agnes-ai.com/v1` |
| 生图模型 | `agnes-image-2.1-flash` |
| 视频模型 | `agnes-video-v2.0` |

### 阿里 DashScope（通义千问）

| 字段 | 值 |
|------|-----|
| Base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 文本模型 | `deepseek-chat` |
| 生图模型 | `qwen-plus` |

### 自定义

任何兼容 OpenAI `/v1/chat/completions` 和 `/v1/images/generations` 的服务商都可以通过设置页添加。

## 模型配置

在项目编辑页 → 模型配置弹窗中可分别为以下用途指定模型/供应商：

- 语言模型（剧本解析）
- 角色生图 / 场景生图 / 道具生图
- 首帧生图 / 尾帧生图
- 视频生成

未配置时自动走四级降级链：项目配置 → 全局 model_routes → 全局 provider/model → 默认值。

## 数据库

SQLite 文件位于 `%APPDATA%/electron-app/autodrama.db`。

### 核心表

| 表 | 用途 |
|----|------|
| projects | 项目元数据 |
| characters / scenes / props | 资产库（含 description_zh 中文描述） |
| chapters / shots | 分镜结构 |
| shot_characters / shot_scenes / shot_props | 分镜-资产关联 |
| generation_tasks | 生成任务记录（轮询/播报） |
| character_images / shot_images / shot_videos | 历史版本管理 |
| prompt_templates | 18 条官方 Prompt 模板 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ELECTRON_RUN_AS_NODE` | ⚠️ **必须为空**。设为 1 会导致 Electron 以 Node 模式运行而崩溃 | (空) |

## 开发约定

- 文件 ≤ 800 行，函数 ≤ 50 行（参见 `CLAUDE.md`）
- SQL 参数化查询，禁止字符串拼接
- 所有文件路径操作通过 IPC handler 校验
- API Key 使用 safeStorage 加密存储，不暴露到渲染进程
- 批量写操作使用 `db.transaction()` 包裹
- TypeScript 类型优先，渐进消除 `any`

## 许可证

MIT
