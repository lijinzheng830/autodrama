# SD2.0 七段式 Prompt 改造实施步骤

## 改造范围

涉及文件：
- `src/main/services/imageGenerator.ts` — 重写故事板 prompt 构建逻辑
- `src/main/data/prompt-templates/v1-07-grid-storyboard.md` — 更新为七段式模板
- `src/main/services/db.ts` — 版本号升级
- `src/main/data/prompt-templates/v1-13-video-pixverse.md` — 确认 grid_to_video 模板
- `src/main/services/videoGenerator.ts` — 可选：视频参考故事板图

---

## 步骤1：重写 v1-07-grid-storyboard.md ★核心

**目的**：模板不再被代码绕过，改为七段式结构。

**当前**：文件内容被代码完全忽略，prompt 硬编码在 imageGenerator.ts 中。

**目标**：模板分7段，代码读取各段后按需组装：

```json
{
  "section_1_ref_character": "Reference @{{char_ref_url}}, strictly refer to the character's facial features, face shape, bone structure, hairstyle, costume details, fabric texture and body proportion in the reference image, all 9 frames keep 100% consistent with the reference character, no facial changes, no hairstyle changes, no costume changes, no body shape changes. Only refer to the character's appearance and clothing attributes, do not reference the pose, shooting angle, background and lighting of the reference image. (character appearance consistency based on reference image:1.3)",
  "section_1_ref_multi_character": "Reference @{{char_a_url}}, Reference @{{char_b_url}}, Frames {{char_a_frames}} use character A; Frames {{char_b_frames}} use character B. Each frame strictly follows the facial features, hairstyle and costume of the corresponding reference character, 100% appearance consistency, no character mixing, no face swapping. Only refer to character appearance, do not reference pose, angle and background of the reference images. (multi-character consistency based on reference pictures:1.3)",
  "section_2_ref_scene": "Reference @{{scene_ref_url}}, strictly refer to the environment style, architectural structure, spatial layout, prop details, color tone and overall atmosphere in the reference image, all 9 frames keep the same scene environment, consistent spatial perspective, unified color palette, no scene jumping, no random extra objects. Only refer to the scene environment and atmosphere, do not reference the characters, composition and camera angle in the reference image. (scene consistency based on reference image:1.25)",
  "section_3_format_style": "(masterpiece, 3x3 equal-size cinematic storyboard grid, 16:9 single image, thin clean white dividers, white number 1-9 marked at bottom-left of each frame, no extra text, no watermark, no logo:1.3), {{style_prompt}}, 8K, HDR, volumetric light, sharp focus, cinematic color grading, unified visual style across all frames",
  "section_4_scene_lock": "【SPATIAL ANCHOR - LOCKED ACROSS ALL FRAMES】Location: {{scene_location}}. Time & Weather: {{scene_time_weather}}. Atmosphere: {{scene_atmosphere}}. Main Light Source & Color Temperature: {{scene_lighting}}. Environmental Effects: {{scene_effects}}. Fixed Reference Objects: {{scene_reference_objects}}. 【TONE TRANSITION RULE】Primary color palette locked, only brightness and warm/cool shift gradually: Frames 1-3 warm and bright → Frames 4-6 gradually cooling → Frames 7-8 high contrast dramatic → Frame 9 soft dim resolution. No abrupt color jumps.",
  "section_5_character_lock": "【CHARACTER ANCHOR - LOCKED ACROSS ALL FRAMES】Role: {{char_role}}. Age: {{char_age}}. Facial Features: {{char_facial}}. Hair: {{char_hair}}. Full Outfit: {{char_outfit}}. Body Type: {{char_body}}. Distinctive Marks: {{char_marks}}. {{multi_character_positioning}}【PROP STATE CONTINUITY】Core Prop: {{prop_name}}. Initial State: {{prop_initial}}. State Progression Logic: State changes follow shot action sequence without skipping steps; each transition has a corresponding bridging frame.",
  "section_6_shots_body": "{{shots_body}}",
  "section_7_consistency": "(strict visual consistency, all frames share exact same facial features, same hairstyle, same costume, same prop details, same environment, same lighting palette, no character changes, no scene jumps, continuous narrative motion and prop state:1.25)",
  "negative_prompt": "blurry, low resolution, deformed, disfigured, bad anatomy, extra limbs, missing limbs, asymmetric face, deformed hands, extra fingers, missing fingers, text, watermark, signature, logo, messy grid, uneven frame size, missing numbers, broken dividers, inconsistent character, different face, different hair, different clothes, wrong prop state, floating objects, unrealistic physics, messy scene, extra people, extra objects, distorted perspective, random buildings, inconsistent lighting, sudden color change, cartoon, anime, 3d render, plastic texture, over-smooth skin, ugly, mutated, dull colors, flat lighting",
  "quality": "masterpiece, ultra-detailed, 8K, HDR, volumetric light, shallow depth of field, cinematic color grading, photorealistic, sharp focus, unified art style across all frames, consistent color palette, no style deviation."
}
```

**变量说明**：
- `{{char_ref_url}}` — `character_images.source_url`（取第一个有URL的角色）
- `{{scene_ref_url}}` — `scene_images.source_url`（取第一个有URL的场景）
- `{{shots_body}}` — 由代码动态构建的9格分镜表格
- `{{multi_character_positioning}}` — 多人时注入站位规则
- 其他 — 从项目和镜头数据填充

---

## 步骤2：重写 imageGenerator.ts 故事板 prompt 构建

**文件**：`src/main/services/imageGenerator.ts`
**位置**：`generateGridStoryboard` 函数（当前行号 ~1165）

### 2.1 读取七段式模板

```typescript
// 替换当前的硬编码 prompt 构建
const tplRow = db.prepare("SELECT content FROM prompt_templates WHERE id = 'official-v1-grid-storyboard'").get() as { content: string } | undefined
let tpl: any = {}
if (tplRow?.content) {
  try { tpl = JSON.parse(tplRow.content) } catch { /* fallback */ }
}
```

### 2.2 构建 `section_6_shots_body`（9格表格）

每格从自然语言改为 SD2.0 参数表格格式：

```typescript
// 之前：Frame 1 (top-left): Wide shot, establishing... [自然语言]
// 之后：1｜2s｜WS｜eye-level｜dolly in｜35mm｜warm backlight｜deep focus｜[描述]｜[声音]｜[叙事]

function buildShotsBody(gridShots: any[], cells: any[]): string {
  return gridShots.map((shot, i) => {
    const c = cells[i]
    const desc = (shot.description_en || shot.description || '').slice(0, 60)
    const sound = shot.sound_hint || ''
    const narrative = shot.narrative_function || ''
    const lighting = shot.lighting_mood || 'natural'
    const focus = shot.focus_point || (['WS','EWS'].includes(c.shotType) ? 'deep focus' : 'upper body')
    
    return `${i+1}｜1-2s｜${c.shotType}｜${c.camera}｜${c.movement}｜${c.focal}｜${lighting.slice(0,20)}｜${focus}｜${desc}｜${sound}｜${narrative}`
  }).join('\n')
}
```

### 2.3 注入参考图 URL

```typescript
// 从已收集的 allCharScenes 中提取 source_url
let charRefUrl = ''
let sceneRefUrl = ''
for (const { chars, scenes } of allCharScenes) {
  if (!charRefUrl && chars.length > 0) {
    const row = db.prepare('SELECT source_url FROM character_images WHERE character_id = ? AND source_url IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(chars[0].id) as any
    charRefUrl = row?.source_url || ''
  }
  if (!sceneRefUrl && scenes.length > 0) {
    const row = db.prepare('SELECT source_url FROM scene_images WHERE scene_id = ? AND source_url IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(scenes[0].id) as any
    sceneRefUrl = row?.source_url || ''
  }
}
```

### 2.4 组装七段式 prompt

```typescript
const promptSections: string[] = []

// 第1位：角色参考图（有URL才加）
if (charRefUrl) {
  const multiChar = allCharScenes.filter(cs => cs.chars.length > 0).length > 1
  if (multiChar) {
    promptSections.push(applyTemplate(tpl.section_1_ref_multi_character, { char_a_url: charRefUrl, /* ... */ }))
  } else {
    promptSections.push(applyTemplate(tpl.section_1_ref_character, { char_ref_url: charRefUrl }))
  }
}

// 第2位：场景参考图（有URL才加）
if (sceneRefUrl) {
  promptSections.push(applyTemplate(tpl.section_2_ref_scene, { scene_ref_url: sceneRefUrl }))
}

// 第3位：格式+画风（始终）
promptSections.push(applyTemplate(tpl.section_3_format_style, { style_prompt: stylePromptEn }))

// 第4位：场景锁定
const mainScene = allCharScenes[0]?.scenes[0]
promptSections.push(applyTemplate(tpl.section_4_scene_lock, {
  scene_location: mainScene?.description || '',
  scene_time_weather: project.era || '',
  scene_atmosphere: gridShots[0]?.lighting_mood || '',
  scene_lighting: gridShots[0]?.lighting_mood || '',
  scene_effects: 'none',
  scene_reference_objects: 'none',
}))

// 第5位：角色锁定
const mainChar = allCharScenes[0]?.chars[0]
promptSections.push(applyTemplate(tpl.section_5_character_lock, {
  char_role: mainChar?.description || '',
  // ...
  multi_character_positioning: '',
  prop_name: 'none',
  prop_initial: 'none',
}))

// 第6位：分镜正文
promptSections.push(buildShotsBody(gridShots, cells))

// 第7位：一致性
promptSections.push(tpl.section_7_consistency || '(strict visual consistency...:1.25)')

// 负向词+品质
const prompt = promptSections.filter(Boolean).join('\n\n')
  + '\n\n' + (tpl.negative_prompt || '')
  + '\n\n' + (tpl.quality || '')
```

### 2.5 多角色检测逻辑

```typescript
// 统计所有格中出现的角色
const allCharIds = new Set<string>()
for (const { chars } of allCharScenes) {
  for (const ch of chars) allCharIds.add(ch.id)
}
const isMultiChar = allCharIds.size > 1
```

---

## 步骤3：更新视频模板 v1-13 启用 grid_to_video

**目的**：确保 grid_to_video 模板段可用。

**操作**：确认 `v1-13-video-pixverse.md` 中 `grid_to_video` 字段存在且格式正确。

当前文件已有，无需修改。重点是步骤4让它被调用。

---

## 步骤4：视频生成可选传入故事板图（可选）

**文件**：`src/main/services/videoGenerator.ts`

在视频 prompt 构建时，检查该镜是否有 `poster_image_path`（故事板图），有则注入：

```typescript
// 在 buildPixversePrompt 之前或 video prompt 组装时
if (shot.poster_image_path) {
  // 将故事板图作为视频参考
  videoRefImages.unshift(shot.poster_image_path)
}
```

这个改动很小，顺手做。

---

## 步骤5：版本号升级+构建

```typescript
// db.ts
const TPL_DATA_VERSION = 35
// v35: SD2.0 七段式故事板 prompt + 参考图注入 + 权重语法
```

---

## 步骤6：验收测试

1. 重启应用
2. 解析一个测试剧本（生成角色+场景）
3. 先生成角色图 → 确保 `source_url` 有值
4. 生成场景图 → 确保 `source_url` 有值
5. 生成故事板 → 检查日志中的 prompt 是否包含：
   - [OK] `Reference @` 角色/场景 URL
   - [OK] `(keyword:1.3)` 权重语法
   - [OK] `1｜2s｜WS｜eye-level｜...` 表格格式
   - [OK] `【SPATIAL ANCHOR】` 空间锚点
   - [OK] `【CHARACTER ANCHOR】` 角色锚点
   - [OK] 七段之间空行分隔

---

## 改动量估算

| 文件 | 改动类型 | 行数 |
|------|---------|------|
| `v1-07-grid-storyboard.md` | 重写 | ~80行 JSON |
| `imageGenerator.ts` | 重写 prompt 构建逻辑 | ~100行 改 ~50行 |
| `db.ts` | 版本号 | 1行 |
| **合计** | | ~130行 |

---

## 前置条件

- 角色图/场景图必须已生成（需要 `source_url`）
- 无 `source_url` 时第1/2段自动跳过，不影响生图
