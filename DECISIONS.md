# 架构决策日志

> 记录反直觉的架构决策和陷阱。下次改代码遇到不理解的设计，先查这里。
> 更新方式：每次做出非显而易见的决策后追加到对应小节末尾。

## 对白管线

### 对白绝不丢弃
- **决策**：`overflowDialogue` 溢出对白 → `_overflowBin` 收集 → `buildOverflowChapters` 自动拆章
- **为什么**：用户要求"对白完整性优先"，AI 输出的对白一个字都不能丢
- **陷阱**：如果改回丢弃逻辑，用户会看到残句，必报 bug
- **来源**：2026-07-07 session，多次尝试 trimDialogue 均被用户拒绝

### 对白镜硬收敛 ≤3
- **决策**：`enforceDialogueShotLimit` 在 `overflowDialogue` 之后执行，保留字数最多的 3 个对白镜
- **为什么**：AI（尤其是 Qwen）不遵守"≤3 个对白镜"的 prompt 约束，代码侧必须兜底
- **陷阱**：不能保留"前 3 个"——必须按对白字数降序，优先保住核心剧情台词
- **来源**：2026-07-07，`对白镜7个 > 3个上限` 反复出现，时长超标到 17.1s

### overflowDialogue 不接不同说话人
- **决策**：溢出时只承接同说话人或空镜，不同说话人的镜跳过
- **为什么**：防止"林宇的词跑进艾娃的镜"，UI 台词混乱
- **来源**：2026-07-06 日志 `Shot #2→#4: 溢出到不同说话人镜`

## 时长引擎

### assignShotDurations 忽略 AI 的 duration
- **决策**：代码统一用 `max(景别基准, 对白字数÷3.0)` 计算时长，不读 AI 输出的 duration
- **为什么**：AI 时长分配不准确，"LLM 创作、代码算数"的分工原则
- **陷阱**：如果有人恢复读取 AI duration 的"混合计算"，时长超标会重现
- **来源**：2026-07-06，方案 C 实施

### 三级压缩兜底
- **决策**：一级压无对白镜→二级压对白镜画面余量（口型不碰）→三级比例缩放（last resort）
- **为什么**：当对白镜多到无对白镜全压到 floor 也不够时，必须有兜底
- **三级会触发吗**：正常不应触发——enforceDialogueShotLimit 收敛对白镜后，一级压缩足够达标。三级仅防极端场景
- **来源**：2026-07-07，`hard-clamped → total 17.1s` 仍超标

### FPS 24 非 60
- **决策**：seedance_params.fps fallback 从 60 改为 24，prompt 同步
- **为什么**：Seedance 2.0 API 固定 24fps（参考 Emily2040/seedance-2.0）
- **陷阱**：如果只改一处漏了另一处，API 会忽略或报错
- **位置**：`scriptParse.ts` seedance_params、`videoGenerator.ts` FPS 常量、`v0-02-seedance-9grid.md` schema、`v1-15-video-director.md` tech spec

## API 与格式

### response_format: json_object 已删除
- **决策**：从 `ai.ts` 的 fetch body 中删除 `response_format: { type: 'json_object' }`
- **为什么**：`json_object` 强制 API 只输出 `{...}`，导致 AI 无法输出数组 `[{...}]`。无论 prompt 怎么强调"必须输出数组"都无效——API 层就拦了
- **陷阱**：注释被删了，后来者看到 fetch body 没有 response_format 可能"修复"加回去。**绝对不能加回来**
- **来源**：2026-07-06，AI 连续两次输出单对象报错，查了 `ai_seedance_response.json` + curl 测试 API 才定位根因

### 模板变量 `{{CHAPTER_COUNT}}` 等
- **决策**：v0-02 模板中的 `{{CHAPTER_COUNT}}`、`{{EPISODE_HINT}}`、`{{EPISODE_RULE}}` 由 `autoProcess.ts:944-950` 运行时替换
- **为什么**：章节数根据对白量动态估算，不能写死在模板里
- **陷阱**：第一次读代码会以为这些是未定义的变量

## Pipeline 顺序

### renumberShots 执行顺序不可改
```
redistributeDialogue → overflowDialogue → enforceDialogueShotLimit → buildOverflowChapters → assignShotDurations → fixChapterTotalDuration
```
- 每步有依赖：redistribute 清镜1/9 后 overflow 才能正确跳过；overflow 后 enforce 才知道哪些镜有对白；enforce 后 buildOverflow 才拿到完整的 bin
- **陷阱**：改变顺序会导致对白漏处理或重复处理

## DB 与供应商

### providers 存储在 settings 表（明文 JSON）
- **决策**：providers 以 JSON 字符串存在 `settings` 表的 `providers` key，不加密
- **为什么**：仅 API Key 字段用 `safeStorage` 加密（`encryptApiKey`/`decryptApiKey`）。整个 providers JSON 是明文的
- **陷阱**：`safeStorage` 与 OS 用户绑定。DB 删除后 `safeStorage` 密钥不失效，但 providers 数据丢失需手动重建
- **来源**：2026-07-07，DB 清空后 `api_key_qwen` 为空，需用 Python 直接写 DB 修复

### DB 文件删除需同时删 .db .db-shm .db-wal
- **为什么**：SQLite WAL 模式有 3 个文件，只删 .db 会导致 -shm 残留引发 "disk I/O error"
- **位置**：`%APPDATA%/wuxianchuangyi/autodrama.db*`
