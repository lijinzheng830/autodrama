# SD2.0 对照优化方案

> 基于 SD2.0 手册逐项对比当前实现，标注差距和优先级。

---

## 一、SD2.0 七段式 Prompt 架构 vs 当前实现

SD2.0 手册定义的标准正向提示词架构（按权重排序）：

| 位序 | SD2.0 标准 | 当前实现 | 差距 |
|------|-----------|---------|------|
| **第1位** | 角色参考图调用 `Reference @角色定妆图1, (character consistency:1.3)` | [MISS] 代码收集了 source_url 但**没写进 prompt** | **致命** |
| **第2位** | 场景参考图调用 `Reference @场景概念图1, (scene consistency:1.25)` | [MISS] 同上 | **致命** |
| **第3位** | 格式+画质 `(masterpiece, 3x3 grid...:1.3), 8K, HDR...` | [WARN] 有格式描述但**权重语法弱** | 部分 |
| **第4位** | 全局场景锁定（空间锚点+色调渐变） | [WARN] 场景描述有但**缺空间锚点和色调渐变规则** | 部分 |
| **第5位** | 全局角色+道具锁定（角色锚点+道具初始状态） | [WARN] 角色描述有但**缺锚点和多人站位** | 部分 |
| **第6位** | 9镜分镜正文 `1｜2s｜WS｜eye-level｜dolly in｜...` | [MISS] 当前是自然语言描述，**缺少 SD2.0 元数据表格格式** | **缺失** |
| **第7位** | 一致性强制规则 `(all frames same face...:1.25)` | [WARN] 有约束但**缺权重括号** | 部分 |

**结论：7段中 3段完全缺失，4段部分实现但不标准。**

---

## 二、对照手册逐章节诊断

### 2.1 角色参考图调用（SD2.0 第1位）★★★★★

**手册标准**：
```
Reference @角色定妆图1, strictly refer to the character's facial features, 
face shape, bone structure, hairstyle, costume details, fabric texture and 
body proportion in the reference image, all 9 frames keep 100% consistent 
with the reference character.
Only refer to the character's appearance and clothing attributes, do not 
reference the pose, shooting angle, background and lighting.
(character appearance consistency based on reference image:1.3)
```

**当前状态**：代码收集了 `character_images.source_url`，但故事板 prompt 完全不写 Reference 调用句。

**修复**：在故事板 prompt 构建时，注入角色 source_url 的 Reference 调用。

---

### 2.2 场景参考图调用（SD2.0 第2位）★★★★★

**手册标准**：
```
Reference @场景概念图1, strictly refer to the environment style, 
architectural structure, spatial layout, prop details, color tone and 
lighting atmosphere in the reference image.
Only refer to the scene environment and atmosphere, do not reference the 
characters, composition and camera angle.
(scene consistency based on reference image:1.25)
```

**当前状态**：同上，source_url 收集了但不用。

**修复**：同2.1。

---

### 2.3 全局场景锁定（SD2.0 第4位）★★★★

**手册标准包含6个必填子项**：

| 子项 | 示例 | 当前状态 |
|------|------|---------|
| 空间地点 | 深山松树林间空地 | [OK] 从 `used_scene_description` 取 |
| 时间天气 | 黄昏雨后 | [WARN] 资产提取模板有此字段，但故事板 prompt 没单独写 |
| 环境氛围 | 薄雾弥漫，静谧萧瑟 | [WARN] 混在场景描述里 |
| 主光源&色温 | 夕阳侧逆光，暖金色调 | [WARN] 有 `lighting_mood` 但没强调方向+色温 |
| 环境特效 | 地面潮湿反光，松针飘落 | [MISS] 缺失 |
| 固定参照物 | 画面左侧始终有古松 | [MISS] 缺失 |

**还有色调渐变规则**：
```
第1-3镜偏暖亮 → 第4-6镜逐步转冷 → 第7-8镜高对比强反差 → 第9镜柔暗调
```
[MISS] 当前完全缺失。

**修复**：在资产提取模板和故事板 prompt 中补全这6项+色调渐变。

---

### 2.4 全局角色+道具锁定（SD2.0 第5位）★★★★

**手册标准包含7个必填子项**：

| 子项 | 示例 | 当前状态 |
|------|------|---------|
| 角色身份 | 年轻女剑客 | [OK] 资产提取8字段覆盖 |
| 年龄感 | 22岁左右 | [OK] |
| 五官气质 | 清冷锐利，冷白皮 | [OK] |
| 发型发色 | 高束黑色长发 | [OK] |
| 服饰全套 | 白色交领劲装... | [OK] |
| 身形体态 | 身形纤细挺拔 | [OK] |
| 补充特征 | 右手虎口有薄茧 | [OK] |
| **多人角色站位** | 左侧女剑客，右侧反派，间距1.5m | [MISS] **缺失** |

**道具初始状态+递进规则**：
```
初始：长剑入鞘 → 拔剑 → 挥砍 → 收剑
每个状态变化有过渡帧承接
```
[MISS] 当前只输出道具名和描述，**缺状态递进逻辑**。

**修复**：资产提取模板加入道具状态链；故事板 prompt 加入多人站位规则。

---

### 2.5 9镜分镜正文（SD2.0 第6位）★★★★★

**手册标准格式**：
```
1｜2s｜WS｜eye-level｜slow dolly in｜35mm｜warm backlight｜全景深｜
女剑客背对镜头伫立｜wind rustling｜建置时空
```

这是 SD2.0 模型理解力最强的格式——**表格化、参数化、英文缩写**。

**当前状态**：自然语言描述：
```
Frame 1 (top-left, "1"): Wide shot, establishing environment. 
Show the full scene — [description]. The character is visible...
```

模型需要先"读懂"自然语言再转换成画面，效率远低于参数表格。

**修复**：故事板 prompt 中的每格描述改为 SD2.0 标准格式：
```
Frame 1: 2s｜WS｜eye-level｜dolly in｜35mm｜warm backlight｜deep focus｜
[shot_description]｜[sound_hint]｜[narrative_function]
```

---

### 2.6 一致性强制规则（SD2.0 第7位）★★★

**手册标准**：
```
(strict visual consistency, all frames share exact same facial features, 
same hairstyle, same costume, same prop details, same environment, 
same lighting palette, no character changes, no scene jumps, 
continuous narrative motion and prop state:1.25)
```

**当前状态**：分多条写了约束，但**没有用括号括起来形成权重块**。

**修复**：合并为一条 `(...:1.25)` 格式的权重块。

---

### 2.7 画风专属替换补丁包（SD2.0 第七节）★★★

手册定义了3套画风关键词组合，当前代码有 `getStylePrompt()` 但：
- [MISS] 没有对应负向词补充（真人写实→禁止3D/anime，古风→禁止HDR/lens flare）
- [MISS] 没有风格专属正负向词联动

**修复**：`getStylePrompt()` 同时返回正负向词；或在模板中引入 `{{style_negative}}` 变量。

---

### 2.8 故障修正工具包（SD2.0 第六节）★★

手册提供了3条一键修正语句：
1. 分格错乱：`(strict equal 3x3 grid, clear thin white dividers, clear white number 1-9:1.3)`
2. 角色变脸：`(absolute character consistency, identical face/hairstyle/clothes in all 9 frames:1.3)`
3. 场景跳变：`no extra objects, no extra people, strictly follow the fixed scene setting`

[MISS] 当前完全没有故障修正机制——生图出问题只能手动重试。

**修复**：故事板生图失败后，自动追加修正语句重试一次。用户可配置开关。

---

### 2.9 图生视频联动（SD2.0 第五节）★★★★

手册定义了两种视频生成模式：
1. **单段15秒完整版**：九宫格图→15秒视频（9镜连播）
2. **分段生成**：1-5镜 + 5-9镜，中间共用衔接帧

**当前状态**：模板 `v1-13-video-pixverse.md` 有 `grid_to_video` 段，但代码从不使用。视频按单镜生成，没有九宫格联动。

**修复**：提供"从故事板生成视频"选项，使用 `grid_to_video` 模板段。

---

### 2.10 终极自检清单（SD2.0 第八节）★★★

手册要求生成前核对11项。当前零检核。

**修复**：在生成前自动校验（至少校验：格数≤9、景别无重复、每格有叙事功能），不通过则警告。

---

## 三、对比总结

| 类别 | SD2.0 要求 | 已实现 | 缺失 |
|------|-----------|--------|------|
| 7段式架构 | 完整 | 0/7 | 7段全需改造 |
| 参考图调用 | 角色+场景 Reference | 代码收集了URL但不写入prompt | 致命 |
| 空间锚点 | 6项固定 | 0/6 | 全部缺失 |
| 色调渐变 | 9格明暗过渡规则 | 无 | 缺失 |
| 多人站位 | 相对位置+轴线 | 无 | 缺失 |
| 道具状态链 | 初始→递进→结束 | 无 | 缺失 |
| 分镜正文格式 | 参数表格 | 自然语言 | 需改造 |
| 权重语法 | `(keyword:1.3)` | 无 | 需改造 |
| 画风补丁 | 3套正负向词 | 1套通用 | 缺风格专属负向词 |
| 故障修正 | 3条一键语句 | 无 | 缺失 |
| 图生视频 | 九宫格→视频 | 模板有但不用 | 缺失 |
| 自检清单 | 11项 | 0项 | 缺失 |

---

## 四、优化执行路径

### 第一步：故事板 Prompt 七段式改造（P0，影响最大）

重写故事板 prompt 构建逻辑，严格按 SD2.0 七段式排布：

```
[第1位] Reference @角色图URL1 (character consistency:1.3)
[第2位] Reference @场景图URL1 (scene consistency:1.25)
[第3位] (masterpiece, 3x3 grid...:1.3) 8K, HDR...
[第4位] 空间地点+时间天气+主光源+环境特效+固定参照物+色调渐变
[第5位] 角色锚点(7项)+多人站位+道具初始状态+递进逻辑
[第6位] Frame 1: 2s｜WS｜eye-level｜dolly in｜35mm｜... (表格格式)
        Frame 2: ...
        ...
[第7位] (strict visual consistency...:1.25)
NEGATIVE: [完整负向词]
```

### 第二步：参考图贯通（P0）

- 故事板生图时，自动注入 `character_images.source_url` 和 `scene_images.source_url` 为 Reference 调用
- 无 source_url 时跳过第1/2位

### 第三步：资产模板补全（P1）

- 资产提取模板新增：道具初始状态、空间锚点6项
- 故事板叠加标注新增：色调渐变提示

### 第四步：视频联动（P1）

- 启用 `grid_to_video` 模板
- 视频生成可传入故事板图片 URL 作为参考

### 第五步：故障修正+自检（P2）

- 生图失败自动追加修正语句重试
- 生成前校验景别配比、格数、叙事功能
