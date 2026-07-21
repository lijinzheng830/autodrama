# v1-07-grid-storyboard — 九宫格故事板模板

**文件**：`src/main/data/prompt-templates/v1-07-grid-storyboard.md`
**DB ID**：`official-v1-grid-storyboard`
**用法**：`grid_storyboard`
**格式**：七段式 SD2.0 架构，JSON 格式存储，`applyTemplate()` 填充 `{{变量}}`

---

## Section 1 — 角色参考图

```
{{char_refs}} (character appearance consistency based on reference images:1.3)
```

- `{{char_refs}}` — 代码动态构建，每个角色 `[A] 角色名: @source_url (参考图优先指令...)`
- 有 `source_url` 时输出角色参考行，无 URL 时跳过整段
- 权重：**1.3**

---

## Section 2 — 场景参考图

```
Reference @{{scene_ref_url}} (This reference image defines the EXACT scene — environment style, architecture, lighting, props, color palette. Use it as the sole visual source. Do NOT combine with text descriptions. All frames keep the same scene environment. scene consistency based on reference image:1.25)
```

- `{{scene_ref_url}}` — 场景图 URL
- 有 URL 时输出，无 URL 时跳过整段
- 权重：**1.25**

---

## Section 3 — 格式 + 画风

```
(masterpiece, 3x3 equal-size cinematic storyboard grid, 16:9 single image, thin clean white dividers, white number 1-9 marked at bottom-left of each frame, no extra text, no watermark, no logo:1.3), {{style_prompt}}, 8K, HDR, volumetric light, sharp focus, cinematic color grading, unified visual style across all frames
```

- `{{style_prompt}}` — `getStylePrompt()` 返回的画风关键词，如 `Photorealistic, 8K resolution, highly detailed textures...`
- 权重：**1.3**

---

## Section 4 — 场景空间锚点

```
【SPATIAL ANCHOR — LOCKED ACROSS ALL FRAMES】
Location: {{scene_location}}.
Time & Weather: {{scene_time_weather}}.
Atmosphere: {{scene_atmosphere}}.
Main Light Source & Color Temperature: {{scene_lighting}}.
Environmental Effects: {{scene_effects}}.
Fixed Reference Objects: {{scene_reference_objects}}.
【TONE TRANSITION RULE】
Primary color palette locked, only brightness and warm/cool shift gradually:
Frames 1-3 warm and bright → Frames 4-6 gradually cooling → Frames 7-8 high contrast dramatic → Frame 9 soft dim resolution.
No abrupt color jumps.
```

| 变量 | DB 来源 |
|------|---------|
| `{{scene_location}}` | `scenes.description`，去 `Location:` 前缀 |
| `{{scene_time_weather}}` | `scenes.time_weather` 或 `project.era` |
| `{{scene_atmosphere}}` | `shots.lighting_mood`（第 1 镜） |
| `{{scene_lighting}}` | `shots.lighting_mood`（同上） |
| `{{scene_effects}}` | `scenes.environment_effects`，兜底 `none` |
| `{{scene_reference_objects}}` | `scenes.reference_objects`，兜底 `none` |

无独立权重。

---

## Section 5 — 角色锚点 + 服装 + 武器

```
【CHARACTER ANCHOR — LOCKED ACROSS ALL FRAMES】
{{char_role}}
【OUTFIT CONSISTENCY】
{{char_outfits}} (each character's outfit, armor, and clothing must stay identical in every frame:1.3)
【WEAPON/PROP CONSISTENCY】
{{char_props}} (each character's weapon, tool, or signature prop must stay identical in every frame:1.3)
{{multi_character_positioning}}
【PROP STATE CONTINUITY】
Core Prop: {{prop_name}}. Initial State: {{prop_initial}}. State progression follows shot action sequence without skipping steps; each transition has a corresponding bridging frame.
```

| 变量 | 来源 |
|------|------|
| `{{char_role}}` | 所有角色 `characters.description` 拼接 |
| `{{char_outfits}}` | `parseDescField(desc, 'Outfit')` — 每角色服装 |
| `{{char_props}}` | `parseDescField(desc, 'Key prop')` — 每角色武器/道具 |
| `{{multi_character_positioning}}` | 帧-角色分配，如 `Frames 2,3,4 use 安敬思` |
| `{{prop_name}}` | 写死 `none` |
| `{{prop_initial}}` | 写死 `none` |

权重：**1.3**（服装）+ **1.3**（武器）

---

## Section 6 — 分镜正文

```
{{shots_body}}
```

- 代码动态构建，格式：`[前缀] + 9行表格`
- 每行 11 列：`镜号｜时长｜景别｜机位｜运镜｜焦距｜灯光｜焦点｜画面内容｜声音｜叙事功能`
- 前缀（代码注入）：`[CHARACTER APPEARANCE LOCKED — Each character wears the EXACT same outfit...]`

无独立权重。

---

## Section 7 — 一致性强制

```
(strict visual consistency, all frames share exact same facial features, same hairstyle, same costume, same prop details, same environment, same lighting palette, no character changes, no scene jumps, continuous narrative motion and prop state:1.25)
```

- 无变量，纯固定文本
- 权重：**1.25**

---

## Negative Prompt

```
blurry, low resolution, deformed, disfigured, bad anatomy, extra limbs, missing limbs, asymmetric face, deformed hands, extra fingers, missing fingers, text, watermark, signature, logo, messy grid, uneven frame size, missing numbers, broken dividers, inconsistent character, different face, different hair, different clothes, wrong prop state, floating objects, unrealistic physics, messy scene, extra people, extra objects, distorted perspective, random buildings, inconsistent lighting, sudden color change, cartoon, anime, 3d render, plastic texture, over-smooth skin, ugly, mutated, dull colors, flat lighting
```

- 无变量，纯固定文本

---

## Quality

```
masterpiece, ultra-detailed, 8K, HDR, volumetric light, shallow depth of field, cinematic color grading, photorealistic, sharp focus, unified art style across all frames, consistent color palette, no style deviation.
```

- 无变量，纯固定文本

---

## 权重汇总

| 权重 | 段 | 约束 |
|------|-----|------|
| 1.3 | 1 | 角色外观一致性 |
| 1.3 | 3 | 九宫格格式 |
| 1.3 | 5 | 服装一致性 |
| 1.3 | 5 | 武器/道具一致性 |
| 1.25 | 2 | 场景一致性 |
| 1.25 | 7 | 全局视觉一致性 |

---

## 组装逻辑（代码）

**`imageGenerator.ts` `generateGridStoryboard()`** 中：

1. 加载 DB 模板 `official-v1-grid-storyboard`，解析 JSON
2. Section 1：有角色 URL 时，`applyTemplate(section_1_ref_character, tplVars)`
3. Section 2：有场景 URL 时，`applyTemplate(section_2_ref_scene, tplVars)`
4. Section 3-7：始终 `applyTemplate()`
5. Section 6：直接 push 代码构建的 `shotsBodyPrefix` + `shotsBody`
6. 拼接负向词 + 品质词
7. `sanitizePromptContent()` 过滤敏感词
8. `callImageGenerationAPI()` 发送
