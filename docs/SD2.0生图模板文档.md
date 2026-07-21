# SD2.0 角色/场景/道具参考图 — 提示词模板文档

---

## 一、角色参考图

**文件**：`v1-04-character-image.md`
**DB ID**：`official-v1-character-image`
**用法**：`character_image`

### 中英文双模板，v1 版本（JSON 格式，key=chinese/english）

---

### 中文版

```
[最重要指令 — 角色外观] {{character_description}}

[人种约束 — 关键] 东亚/中国外貌。东亚面部特征：内眦赘皮（单眼皮或内双眼皮），扁平到中高鼻梁，暖调肤色，深棕到乌黑直发。东方人典型苗条体型。绝对禁止欧美人种特征、深眼窝、高凸鼻梁、金色或浅色头发、苍白粉红肤色。

[任务] 生成一个四面板横排角色参考图。纯白背景。

[构图 — 四面板横排，比例 1.6:1:1:1] 从左到右依次排列：
面板1（左1，宽度比例1.6）：上半身特写照——胸部以上，面部正对镜头，展示五官、表情、发型和头部配饰细节，此面板最宽以容纳面部细节。
面板2（左2，宽度比例1）：全身正面照——直立正面，脚踩底线，展示完整服装、全身比例、整体轮廓。
面板3（左3，宽度比例1）：45度角侧身全身照——身体转向45度，展示侧面轮廓、身体曲线和服装侧面贴合度。
面板4（右1，宽度比例1）：背影全身照——展示背面发型和服装后部设计。
四个面板从左到右一字横排，总宽度比例1.6:1:1:1，间距均匀，不重叠，纯白背景。

[风格] {{style_prompt_zh}}
[光照] 专业演播室布光，柔和主光，均匀照明
[质量] 四面板角色比例严格一致，光照色温统一，间距均匀。严格遵循上方风格字段指定的美术风格。
```

### 英文版

```
[MOST IMPORTANT — CHARACTER APPEARANCE] {{character_appearance_prompt}}

[ETHNICITY — CRITICAL] East Asian / Chinese appearance. East Asian facial features: epicanthic fold (monolid or tapered double eyelid), flat to medium-high nose bridge, warm undertone skin, straight dark brown to jet-black hair. Slender build typical of East Asian body type. Absolutely NO European/Caucasian features, NO deep eye sockets, NO protruding nose bridge, NO blonde or light-colored hair, NO pale pinkish skin.

[Task] Generate a horizontal four-panel character reference sheet on pure white background.

[Composition — HORIZONTAL FOUR-PANEL, RATIO 1.6:1:1:1] Left to right in a single row:
Panel 1 (leftmost, width ratio 1.6): Upper body CLOSE-UP portrait — chest and above, facing camera directly, showing facial features, expression, hairstyle and head accessories in fine detail. This panel is the widest to accommodate facial detail.
Panel 2 (second from left, width ratio 1): FULL BODY FRONT view — standing upright facing forward with realistic adult proportions, feet grounded at bottom edge, showing complete outfit, full body proportions, overall silhouette.
Panel 3 (third from left, width ratio 1): 45-DEGREE SIDE FULL BODY view — body turned 45 degrees, showing side profile contour, body curves, and side garment fit from head to toe.
Panel 4 (rightmost, width ratio 1): FULL BODY BACK view — showing hairstyle from behind and back design of clothing from head to toe.
All four panels in one horizontal row, total width ratio 1.6:1:1:1, uniform spacing, no overlap, pure white background.

[Style] {{style_prompt}}, {{era}}
[Lighting] Professional studio lighting, soft key light, even illumination
[Quality] Consistent proportions across all panels, uniform studio lighting, equal panel spacing. Follow the style specified above — photorealistic means NO anime, cartoon, or illustration.
```

### 模板变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `{{character_description}}` | `characters.description` | 中文，LLM 输出的 8 字段结构化文本 |
| `{{character_appearance_prompt}}` | `characters.description` | 英文，同上 |
| `{{style_prompt}}` | `getStylePrompt(style_name, style_prompt)` | 英文画风关键词 |
| `{{style_prompt_zh}}` | `getStylePromptZh(style_name, style_prompt)` | 中文画风关键词 |
| `{{era}}` | `project.era` | 年代标签英文 |
| `{{era_zh}}` | `project.era`（中文） | 年代标签中文 |

### 角色描述格式（来自 v1-12-asset-extract.md）

**英文**：
```
Role: [身份]. Age: [年龄]. Facial features: [五官+肤色]. Hair: [发色+发型+发长]. Outfit: [上衣+下装+鞋+材质]. Key prop: [核心道具]. Build: [体型]. Distinctive marks: [特征或无].
```

**中文**：
```
身份：[身份]。年龄：[年龄]。五官：[脸型+眉+眼+鼻+唇+气质]，[肤色]。头发：[发色+发型+发长]。服装：[全套描述]。道具：[核心道具]。体型：[身高+体态]。特征：[特殊标记或无]。
```

### 构图布局

```
┌──────────────┬──────┬──────┬──────┐
│  Panel 1     │Panel2│Panel3│Panel4│
│  1.6x        │  1x  │  1x  │  1x  │
│  上半身特写   │ 全身 │45°侧 │ 背影 │
│  正对镜头     │ 正面 │ 全身 │ 全身 │
└──────────────┴──────┴──────┴──────┘
```

---

## 二、场景参考图

**文件**：`v1-05-scene-image.md`
**DB ID**：`official-v1-scene-image`
**用法**：`scene_image`

### 中文版

```
[最重要指令 — 场景外观] {{scene_description}}

[任务] 生成场景四象限模块化视觉拆解板。纯白背景上的四象限网格布局，细灰分割线。

[构图 — 四象限2×2]
左上象限：全景建立镜头，展示 {{scene_description}} 的整体氛围和空间布局。
右上象限：线稿结构图提取构图骨架和几何结构，旁边展示4-5色卡。
左下象限：近景细节特写，展示材质纹理和表面细节。
右下象限：三个垂直堆叠的细节模块配白色箭头和黑色粗体文字标签，分别分解光线方向、空间层次和材质属性三个核心元素。

[风格] {{style_prompt_zh}}
[光影] 四个象限保持统一光源方向和氛围色调
[质量] 绝对禁止出现任何人物。纯白背景，细灰分割线模块化网格布局，专业视觉参考板美学，无叙事内容，仅传递风格信号。禁止文字、标签
```

### 英文版

```
[MOST IMPORTANT — SCENE APPEARANCE] {{scene_prompt}}

[Task] Generate a scene four-quadrant modular visual analysis board. Four-quadrant grid layout on pure white background with thin gray dividing lines.

[Composition — FOUR-QUADRANT 2×2 GRID]
Top-left quadrant: panoramic establishing shot demonstrating the overall atmosphere and spatial layout of {{scene_description}}.
Top-right quadrant: line art structural diagram extracting composition skeleton and geometry, alongside a color palette strip with 4-5 hex codes.
Bottom-left quadrant: close-up detail shot focusing on material textures and surface details.
Bottom-right quadrant: three vertical stacked detail modules with white arrow pointers and black bold text labels, each breaking down a core visual element: light direction, spatial depth, and material properties.

[Style] {{style_prompt}}, {{era}}
[Lighting] Consistent light source direction and ambient tone across ALL four quadrants
[Quality] Absolutely NO people. Pure white background, modular grid layout with thin gray dividing lines, professional visual reference board aesthetic, no narrative content, only style signal transmission. No text, no labels.
```

### 模板变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `{{scene_description}}` | `scenes.description_zh` | 中文场景描述 |
| `{{scene_prompt}}` | `scenes.description` | 英文场景描述 |
| `{{style_prompt}}` | `getStylePrompt()` | 英文画风 |
| `{{style_prompt_zh}}` | `getStylePromptZh()` | 中文画风 |
| `{{era}}` | `project.era` | 年代标签 |

### 场景描述格式（来自 v1-12-asset-extract.md）

**英文**：
```
Location: [地点]. Time: [时间]. Atmosphere: [氛围]. Lighting: [光线]. Effects: [特效]. Details: [细节].
```

**中文**：
```
地点：[地点]。时间：[时间]。氛围：[氛围]。光线：[光线]。特效：[特效]。细节：[细节]。
```

### 构图布局

```
┌──────────┬──────────┐
│ 左上      │ 右上      │
│ 全景建立   │ 线稿+色卡  │
├──────────┼──────────┤
│ 左下      │ 右下      │
│ 材质特写   │ 三模块     │
│           │ 光/空间/材质│
└──────────┴──────────┘
```

### 特殊处理

**代码强制注入（imageGenerator.ts:238-239）**，prompt 最前面追加：

```
CRITICAL: This is a PURE ENVIRONMENT image. ABSOLUTELY NO people, characters, humans, figures, silhouettes, animals, or any living creatures anywhere. Empty architecture/interior/landscape only.
```

---

## 三、道具参考图

**文件**：`v1-06-prop-image.md`
**DB ID**：`official-v1-prop-image`
**用法**：`prop_image`

### 中文版

```
任务：图生图，根据下方文字描述生成新道具。参考图仅提供展示角度和光照方案——不得复制参考图中的道具。

[图生图指令] 保留参考图的展示角度和白色背景，但将道具替换为下方描述的道具。

[主体] {{prop_description}}
[背景] 纯白无缝背景
[风格] {{style_name}}，{{era_zh}}
[光照] 专业演播室布光
[构图] 道具居中，45度俯视角度，占画面60-70%
[质量要求] 禁止出现人物，纯白背景
```

### 英文版

```
Task: Image-to-image. Create a new prop based on the text description. Reference image provides viewing angle and lighting ONLY — do not copy the reference prop.

[Image-to-Image] Preserve the reference image's viewing angle and white background, but REPLACE the prop with the one described below.

[Subject] {{prop_prompt}}
[Background] Pure white seamless background
[Style] {{style_prompt}}, {{era}}
[Lighting] Professional studio lighting
[Composition] Centered prop, 45-degree overhead angle, 60-70% of frame
[Quality] No people, pure white background
```

### 模板变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `{{prop_description}}` | `props.description_zh` | 中文道具描述 |
| `{{prop_prompt}}` | `props.description` | 英文道具描述 |
| `{{style_prompt}}` | `getStylePrompt()` | 英文画风 |
| `{{style_name}}` | `project.style_name` | 原始风格名（不转换） |
| `{{era}}` | `project.era` | 年代标签 |
| `{{era_zh}}` | `project.era`（中文） | 年代标签中文 |

---

## 共用变量来源

| 变量 | 取值函数/字段 |
|------|-------------|
| `{{style_prompt}}` | `styleMapper.getStylePrompt(styleName, fallback)` |
| `{{style_prompt_zh}}` | `styleMapper.getStylePromptZh(styleName, fallback)` |
| `{{era}}` | `project.era` |
| `{{era_zh}}` | `project.era`（中文原文） |

### 画风映射（styleMapper）

| 风格名 | style_prompt 返回 |
|--------|------------------|
| 写实摄影 | `Photorealistic, raw photo, natural skin texture, film grain, 85mm portrait lens, 8K resolution, highly detailed textures...` |
| 二次元动漫 | `Anime style, clean line art, vibrant colors, studio anime quality, cel shading, flat color blocks, hard edge shadows...` |
| 中国水墨 | `Traditional Chinese ink painting, varying ink density, raw rice paper texture...` |
| 中国仙侠 | `Chinese xianxia style, flowing silk, jade luminescence, spiritual light effects, ancient architecture...` |

完整列表见 `styleMapper.ts` 中 `STYLE_TOKENS` 和 `STYLE_PROMPT_ZH`。

---

## 代码调用入口

**`imageGenerator.ts` `generateImage()`**：

1. 读取 DB 模板（`official-v1-{type}-image`）
2. v1 模板解析 JSON，取 `english` 或 `chinese` 字段
3. `applyTemplate()` 填充变量
4. `sanitizePromptContent()` 过滤敏感词
5. `callImageGenerationAPI()` 发送

**类型路由**：

| type | purpose | 模板 | 参考图 |
|------|---------|------|--------|
| character | `character_reference` | v1-04 | 无（首次）/ 同角色已有图 |
| scene | `scene_reference` | v1-05 | 无（首次）/ 同场景已有图 |
| prop | `prop_reference` | v1-06 | 有（图生图模式） |
