# 故事板 Prompt 完整结构

## 总览

```
Section 1 — 角色参考图 (权重 1.3)
Section 2 — 场景参考图 (权重 1.25)
Section 3 — 格式+画风 (权重 1.3)
Section 4 — 场景空间锚点 (无权重)
Section 5 — 角色锚点+服装+武器 (权重 1.3×2)
Section 6 — 分镜正文 (无权重)
Section 7 — 一致性强制 (权重 1.25)
NEGATIVE — 负向提示词
QUALITY — 品质关键词
```

---

## Section 1 — 角色参考图

**模板**：`{{char_refs}} (character appearance consistency based on reference images:1.3)`

**代码构建**：`imageGenerator.ts` `charRefsText` 变量

**数据来源**：

| 字段 | 来源 |
|------|------|
| `@url` | `character_images.source_url`，优先 `is_selected=1`，否则最新一条 |
| `name` | `characters.name` |
| 描述 | 代码用 `parseDescField()` 从 `characters.description` 提取 Outfit/Key prop/Hair/Facial features |

**示例输出**：
```
[A] 安敬思: @https://...png (This reference image defines the EXACT appearance — facial features, face shape, hairstyle, outfit, body type. Use it as the sole visual source. Do NOT combine with text descriptions. Keep 100% consistent across all frames.)
```

**规则**：有 `source_url` 才输出此行；无 URL 时输出文字描述兜底。每个角色一行，用 `[A][B][C]` 标签区分。

---

## Section 2 — 场景参考图

**模板**：`v1-07-grid-storyboard.md` `section_2_ref_scene`

**数据来源**：

| 字段 | 来源 |
|------|------|
| `@url` | `scene_images.source_url`，同角色图优先级逻辑 |
| 无其他文字 | 参考图为唯一视觉来源 |

**示例**：
```
Reference @https://...png (This reference image defines the EXACT scene — environment style, architecture, lighting, props, color palette. Use it as the sole visual source. Do NOT combine with text descriptions. All frames keep the same scene environment. scene consistency based on reference image:1.25)
```

---

## Section 3 — 格式+画风

**模板**：`v1-07-grid-storyboard.md` `section_3_format_style`

**数据来源**：

| 变量 | 来源 |
|------|------|
| `{{style_prompt}}` | `getStylePrompt(project.style_name, project.style_prompt)` → styleMapper.ts |

**权重**：`(masterpiece, 3x3 grid...:1.3)`

---

## Section 4 — 场景空间锚点

**模板**：`v1-07-grid-storyboard.md` `section_4_scene_lock`

**数据来源**：

| 变量 | DB 字段 | 取值逻辑 |
|------|---------|---------|
| `{{scene_location}}` | `scenes.description` 或 `scenes.name` | 去掉 `Location:` 前缀 |
| `{{scene_time_weather}}` | `scenes.time_weather` 或 `project.era` | 优先 DB 字段 |
| `{{scene_atmosphere}}` | `shots.lighting_mood` | 取第1镜 |
| `{{scene_lighting}}` | `shots.lighting_mood` | 同 atmosphere |
| `{{scene_effects}}` | `scenes.environment_effects` | 无值填 `none` |
| `{{scene_reference_objects}}` | `scenes.reference_objects` | 无值填 `none` |
| `{{tone_transition}}` | 代码动态 | 根据 `project.style_name` 判断 |

**色调渐变规则**（代码动态）：
- anime/二次元/工笔 → 全帧暖亮恒温
- 其他 → Frames 1-3 暖亮 → 4-6 渐变冷 → 7-8 高对比 → 9 柔和

---

## Section 5 — 角色锚点+服装+武器

**模板**：`v1-07-grid-storyboard.md` `section_5_character_lock`

**数据来源**：

| 变量 | 来源 | 说明 |
|------|------|------|
| `{{char_role}}` | `charRefMap` 所有角色 `description` 拼接 | 完整结构化描述 |
| `{{char_outfits}}` | `parseDescField(desc, 'Outfit')` | 每个角色的服装，支持别名 Clothing/Clothes |
| `{{char_props}}` | `parseDescField(desc, 'Key prop')` | 每个角色的武器/道具，支持别名 Prop/Weapon |
| `{{multi_character_positioning}}` | `multiCharText` | 多人帧分配，如 `Frames 2,3,4 use 安敬思` |
| `{{prop_name}}` | 写死 `'none'` | 暂未实现 |
| `{{prop_initial}}` | 写死 `'none'` | 暂未实现 |

**权重**：
- `(outfit consistency:1.3)`
- `(weapon/prop consistency:1.3)`

---

## Section 6 — 分镜正文

**代码构建**：`imageGenerator.ts` `shotsBody` 变量

**前缀**（最新版本）：
```
[CHARACTER APPEARANCE LOCKED — Each character wears the EXACT same outfit in every shot. Ignore per-shot clothing descriptions. Reference images (section 1) define the definitive appearance.]
```

**表格格式**（每镜一行）：
```
镜号｜时长｜景别｜机位｜运镜｜焦距｜灯光｜焦点｜画面内容｜声音｜叙事功能
```

**列映射**：

| 列 | DB 字段 | 代码逻辑 |
|----|---------|---------|
| 镜号 | `shot_index` | `i + 1` |
| 时长 | `shot.duration_seconds` | `toFixed(1) + 's'`，无值兜底 `1-2s` |
| 景别 | `shot.shot_type` | 缩写成 WS/MS/CU/ECU |
| 机位 | `shot.camera_angle` | 优先取 DB 字段，无值回退关键词匹配 |
| 运镜 | `shot.camera_movement` | 关键词推导 dolly/pan/track/static |
| 焦距 | `shot.focal_length` | 兜底 `50mm` |
| 灯光 | `shot.lighting_mood` | 截断 20 字符 |
| 焦点 | `shot.focus_point` | WS/EWS 兜底 `deep focus` |
| 画面内容 | `shot.description_en` | 截断 65 字符 |
| 声音 | `shot.sound_hint` | 兜底 `环境音` |
| 叙事 | `shot.narrative_function` | — |

---

## Section 7 — 一致性强制

**模板**：`v1-07-grid-storyboard.md` `section_7_consistency`

**权重**：`(strict visual consistency...:1.25)`

---

## NEGATIVE

**模板**：`v1-07-grid-storyboard.md` `negative_prompt`

**内容**：blurry, low resolution, deformed, disfigured, bad anatomy, extra limbs, missing limbs, asymmetric face, deformed hands, extra fingers, missing fingers, text, watermark, signature, logo, messy grid, uneven frame size, missing numbers, broken dividers, inconsistent character, different face, different hair, different clothes, wrong prop state, floating objects, unrealistic physics, messy scene, extra people, extra objects, distorted perspective, random buildings, inconsistent lighting, sudden color change, cartoon, anime, 3d render, plastic texture, over-smooth skin, ugly, mutated, dull colors, flat lighting

---

## QUALITY

**模板**：`v1-07-grid-storyboard.md` `quality`

**内容**：masterpiece, ultra-detailed, 8K, HDR, volumetric light, shallow depth of field, cinematic color grading, photorealistic, sharp focus, unified art style across all frames, consistent color palette, no style deviation.

---

## 内容安全过滤

**位置**：`imageGenerator.ts` `sanitizePromptContent()`

**作用范围**：故事板生成 + 角色/场景/道具生图

**规则**：中英文敏感词正则替换，约 60 条。从 `blood`/`slave`/`warlord` 等英文到 `奴隶`/`血腥`/`枯骨` 等中文全覆盖。

---

## API 调用参数

| 参数 | 值 |
|------|-----|
| 模型 | `lk888:gpt-image-2` |
| 参考图 | 最多 7 张（角色图 + 场景图），仅 HTTP/HTTPS URL |
| 尺寸 | 由 `getAPISize(aspect_ratio)` 计算 |
| 重试 | `withRetry()` 最多 2 次，指数退避 |

---

## 权重汇总

| 权重值 | 位置 | 约束对象 |
|--------|------|---------|
| 1.3 | Section 1 | 角色外观一致性 |
| 1.3 | Section 3 | 九宫格格式规范 |
| 1.3 | Section 5 | 服装一致性 |
| 1.3 | Section 5 | 武器/道具一致性 |
| 1.25 | Section 2 | 场景一致性 |
| 1.25 | Section 7 | 全局视觉一致性 |
