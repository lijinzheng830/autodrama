# SD2.0 七段式 Prompt 字段映射表

## 数据来源速查

| 数据源 | 表/函数 | 关键字段 |
|--------|---------|---------|
| 项目 | `projects` | `style_prompt`, `style_name`, `era`, `aspect_ratio` |
| 分镜 | `shots` | `description`, `description_zh`, `description_en`, `shot_type`, `camera_movement`, `camera_angle`, `lighting_mood`, `focal_length`, `focus_point`, `sound_hint`, `narrative_function`, `character_actions`, `shot_scene` |
| 角色 | `characters` | `name`, `description`, `description_zh` |
| 场景 | `scenes` | `name`, `description`, `description_zh` |
| 角色图 | `character_images` | `source_url` (is_selected=1) |
| 场景图 | `scene_images` | `source_url` (is_selected=1) |
| 关联 | `shot_characters`, `shot_scenes` | JOIN |
| 风格 | `getStylePrompt()`, `getStylePromptZh()`, `mapEra()` | styleMapper.ts |

---

## 第1位：角色参考图调用

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| `{{char_ref_url}}` | `character_images.source_url` | 取第1个格中角色关联的图片，`is_selected=1`，`source_url IS NOT NULL`，取最新1条 |
| `{{char_a_url}}` | 同上 | 多人场景：角色A的 source_url |
| `{{char_b_url}}` | 同上 | 多人场景：角色B的 source_url |
| `{{char_a_frames}}` | 代码计算 | 遍历9格，角色A出现的格号列表，如 `1,2,3,7,8,9` |
| `{{char_b_frames}}` | 代码计算 | 角色B出现的格号列表 |

**代码取值**：
```typescript
// 单角色
const charImg = db.prepare(
  'SELECT source_url FROM character_images WHERE character_id = ? AND source_url IS NOT NULL AND source_url != \'\' ORDER BY created_at DESC LIMIT 1'
).get(allCharScenes[0]?.chars[0]?.id)

// 多人角色
const uniqueCharIds = [...new Set(allCharScenes.flatMap(cs => cs.chars.map(c => c.id)))]
```

---

## 第2位：场景参考图调用

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| `{{scene_ref_url}}` | `scene_images.source_url` | 取第1个格中场景关联的图片，`is_selected=1`，`source_url IS NOT NULL`，取最新1条 |

**代码取值**：
```typescript
const sceneImg = db.prepare(
  'SELECT source_url FROM scene_images WHERE scene_id = ? AND source_url IS NOT NULL AND source_url != \'\' ORDER BY created_at DESC LIMIT 1'
).get(allCharScenes[0]?.scenes[0]?.id)
```

---

## 第3位：格式+画质画风

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| `{{style_prompt}}` | `getStylePrompt(project.style_name, project.style_prompt)` | styleMapper 根据风格名返回英文画风关键词 |
| `{{style_prompt_zh}}` | `getStylePromptZh(project.style_name, project.style_prompt)` | 同上，中文版 |

**代码取值**：
```typescript
const stylePromptEn = getStylePrompt(project.style_name || '', project.style_prompt || '')
```

**当前样式默认值**（来自 styleMapper）：
```
Photorealistic → "Photorealistic, raw photo, natural skin texture, film grain, 85mm portrait lens"
Anime → "Anime style, clean line art, vibrant colors, studio anime quality, cel shading"
Gongbi → "Traditional Chinese gongbi painting, ink wash, delicate brushwork, rice paper texture"
```

---

## 第4位：全局场景锁定（空间锚点）

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| `{{scene_location}}` | 第1个格的场景 `description` | `allCharScenes[0].scenes[0].description`（英文），或从 `shot_scene` 取场景名 |
| `{{scene_time_weather}}` | `shot.lighting_mood` + `project.era` | 从光影描述中推断时间天气，年代补充时代背景 |
| `{{scene_atmosphere}}` | `shot.lighting_mood` | 直接取第1格的光影氛围 |
| `{{scene_lighting}}` | `shot.lighting_mood` | 同上，需补充光源方向+色温 |
| `{{scene_effects}}` | 无直接来源 | **需在资产提取模板中新增字段**，暂填 `"none"` |
| `{{scene_reference_objects}}` | 无直接来源 | **需在资产提取模板中新增字段**，暂填 `"none"` |

**当前缺的字段**（管线2资产提取需补）：
- `scenes.environment_effects` — 环境特效
- `scenes.reference_objects` — 固定参照物
- `scenes.time_weather` — 时间天气

**代码取值**：
```typescript
const mainScene = allCharScenes[0]?.scenes[0]
const mainShot = gridShots[0]
const vars: Record<string, string> = {
  scene_location: mainScene?.description || mainScene?.name || '',
  scene_time_weather: project.era || '',
  scene_atmosphere: mainShot?.lighting_mood || '',
  scene_lighting: mainShot?.lighting_mood || '',
  scene_effects: mainScene?.environment_effects || 'none',
  scene_reference_objects: mainScene?.reference_objects || 'none',
}
```

---

## 第5位：全局角色+道具锁定（角色锚点）

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| `{{char_role}}` | 第1个格的角色 `description` | `allCharScenes[0].chars[0].description`（英文8字段格式） |
| `{{char_age}}` | 同上 | 从 description 中提取 Age 字段 |
| `{{char_facial}}` | 同上 | 从 description 中提取 Facial features 字段 |
| `{{char_hair}}` | 同上 | 从 description 中提取 Hair 字段 |
| `{{char_outfit}}` | 同上 | 从 description 中提取 Outfit 字段 |
| `{{char_body}}` | 同上 | 从 description 中提取 Build 字段 |
| `{{char_marks}}` | 同上 | 从 description 中提取 Distinctive marks 字段 |
| `{{multi_character_positioning}}` | 代码检测多人 + shot数据 | 多人时生成站位描述 |
| `{{prop_name}}` | 道具 `description` | 取第1个格关联的道具 |
| `{{prop_initial}}` | 无直接来源 | **需在资产提取模板中新增字段**，暂填 `"none"` |

**当前实现**：仅支持 `{{char_role}}`（传入完整 description），子字段（age/facial/hair/outfit/body/marks）暂不拆分。

**简化方案**：不拆分8字段，直接用完整 description：
```typescript
const mainChar = allCharScenes[0]?.chars[0]
const vars = {
  char_role: mainChar?.description || mainChar?.name || '',
  char_age: '',   // 暂不拆分
  char_facial: '', // 暂不拆分
  char_hair: '',
  char_outfit: '',
  char_body: '',
  char_marks: '',
  multi_character_positioning: '',
  prop_name: '',
  prop_initial: 'none',
}

// 多人检测
const allCharIds = new Set(allCharScenes.flatMap(cs => cs.chars.map(c => c.id)))
if (allCharIds.size > 1) {
  vars.multi_character_positioning = 
    'CRITICAL: Multiple characters present. Each character must maintain fixed relative positions across all frames. Character A always on the left, Character B always on the right. Never cross the 180-degree axis.'
}
```

**当前缺的字段**（管线2资产提取需补）：
- `props.initial_state` — 道具初始状态
- `props.state_progression` — 状态递进逻辑

---

## 第6位：9镜分镜正文

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| `{{shots_body}}` | **代码动态构建** | 遍历9格，每格取 shot 的所有字段拼成表格行 |

**SD2.0 标准行格式**：
```
镜号｜时长｜景别｜机位｜运镜｜焦距｜灯光｜焦点｜画面内容｜声音｜叙事功能
```

**字段映射**：

| 表格列 | shot 字段 | 代码引用 |
|--------|----------|---------|
| 镜号 | `shot_index` (i+1) | `i + 1` |
| 时长 | `shot.duration_seconds` | `shot.duration_seconds ? \`${Math.round(s)}\` : '1-2s'` |
| 景别 | cells 景别缩写 | `cells[i].shotType` (WS/MS/CU/ECU/MLS/OTS) |
| 机位 | `shot.camera_angle`（优先），回退关键词匹配 | `cells[i].camera` (平视/低角度/高角度/仰拍/俯拍/侧拍) |
| 运镜 | cells 推导 | `cells[i].movement` (dolly in/static/tracking/whip pan/pull back) |
| 焦距 | `shot.focal_length` | `shot.focal_length \|\| cells[i].focal` |
| 灯光 | `shot.lighting_mood` | `shot.lighting_mood` (取前20字符) |
| 焦点 | `shot.focus_point` | `shot.focus_point` |
| 画面内容 | `shot.description_en` | `shot.description_en` (取前60字符) |
| 声音 | `shot.sound_hint` | `shot.sound_hint` |
| 叙事功能 | `shot.narrative_function` | `shot.narrative_function` |

**代码构建函数**：
```typescript
function buildShotsBody(gridShots: any[], cells: any[]): string {
  return gridShots.map((shot, i) => {
    const c = cells[i]
    const desc = (shot.description_en || shot.description || '').slice(0, 60)
    const lighting = (shot.lighting_mood || '').slice(0, 20)
    const focus = shot.focus_point || (['WS','EWS'].includes(c.shotType) ? 'deep focus' : 'upper body')
    const sound = shot.sound_hint || ''
    const narrative = shot.narrative_function || ''
    
    return `${i+1}｜1-2s｜${c.shotType}｜${c.camera}｜${c.movement}｜${c.focal}｜${lighting}｜${focus}｜${desc}｜${sound}｜${narrative}`
  }).join('\n')
}
```

---

## 第7位：一致性强制规则

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| 无变量 | DB模板固定文本 | 直接使用模板中的 `section_7_consistency` 字段 |

**模板内容**：
```
(strict visual consistency, all frames share exact same facial features, same hairstyle, same costume, same prop details, same environment, same lighting palette, no character changes, no scene jumps, continuous narrative motion and prop state:1.25)
```

---

## 负向提示词

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| 无变量 | DB模板固定文本 | 直接使用模板中的 `negative_prompt` 字段 |

**[WARN] 优化机会**：根据 `project.era` 或 `project.style_name` 动态补充风格专属负向词：

| 风格 | 额外负向词 |
|------|-----------|
| 真人写实 | `3d render, cartoon, anime, over-smoothed skin, plastic texture, painted` |
| 二次元 | `realistic, 3d render, photorealistic, bad hands, deformed fingers` |
| 古风工笔 | `photorealistic, 3d render, neon, modern objects, HDR, lens flare` |

---

## 品质关键词

| 模板变量 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| 无变量 | DB模板固定文本 | 直接使用模板中的 `quality` 字段 |

---

## 完整变量汇总

### DB模板变量（需 `applyTemplate` 填充）

| 变量 | 可空 | 来源 |
|------|------|------|
| `{{char_ref_url}}` | [OK] | DB查询 |
| `{{char_a_url}}` | [OK] | DB查询 |
| `{{char_b_url}}` | [OK] | DB查询 |
| `{{char_a_frames}}` | [OK] | 代码计算 |
| `{{char_b_frames}}` | [OK] | 代码计算 |
| `{{scene_ref_url}}` | [OK] | DB查询 |
| `{{style_prompt}}` | [MISS] | `getStylePrompt()` |
| `{{scene_location}}` | [MISS] | 场景/镜头数据 |
| `{{scene_time_weather}}` | [OK] | era + lighting_mood |
| `{{scene_atmosphere}}` | [MISS] | lighting_mood |
| `{{scene_lighting}}` | [MISS] | lighting_mood |
| `{{scene_effects}}` | [OK] | 暂填 none |
| `{{scene_reference_objects}}` | [OK] | 暂填 none |
| `{{char_role}}` | [MISS] | 角色 description |
| `{{char_age}}` | [OK] | 暂不拆分 |
| `{{char_facial}}` | [OK] | 暂不拆分 |
| `{{char_hair}}` | [OK] | 暂不拆分 |
| `{{char_outfit}}` | [OK] | 暂不拆分 |
| `{{char_body}}` | [OK] | 暂不拆分 |
| `{{char_marks}}` | [OK] | 暂不拆分 |
| `{{multi_character_positioning}}` | [OK] | [OK] 已实现 (imageGenerator.ts:876-877) |
| `{{prop_name}}` | [OK] | 暂填 none |
| `{{prop_initial}}` | [OK] | 暂填 none |

### 代码构建（不经过 `applyTemplate`）

| 内容 | 构建方式 |
|------|---------|
| `section_6_shots_body` | `buildShotsBody()` 函数，遍历9格拼表格 |
| 完整 prompt | 七段拼接 + negative + quality |

---

## 数据流全景

```
projects 表
├─ style_prompt ──→ getStylePrompt() ──→ section_3
├─ era ──→ mapEra() ──→ section_4
└─ aspect_ratio ──→ getAPISize()

shots 表 (每格一条)
├─ description_en ──→ section_6 (画面内容)
├─ shot_type ──→ buildCellFromShot() ──→ section_6 (景别)
├─ camera_movement ──→ buildCellFromShot() ──→ section_6 (运镜)
├─ focal_length ──→ section_6 (焦距)
├─ lighting_mood ──→ section_4 + section_6 (灯光)
├─ focus_point ──→ section_6 (焦点)
├─ sound_hint ──→ section_6 (声音)
├─ narrative_function ──→ section_6 (叙事)
└─ character_actions ──→ styleMapper

characters 表
├─ description ──→ section_5 (角色锚点)
└─ id ──→ JOIN character_images.source_url ──→ section_1

scenes 表
├─ description ──→ section_4 (场景锚点)
└─ id ──→ JOIN scene_images.source_url ──→ section_2

character_images 表
└─ source_url ──→ section_1 (Reference @url)

scene_images 表
└─ source_url ──→ section_2 (Reference @url)
```

---

## 当前缺失字段（后续补）

| 表 | 缺字段 | 用途 | 暂时填充 |
|----|--------|------|---------|
| `scenes` | `environment_effects` | 环境特效 | `"none"` |
| `scenes` | `reference_objects` | 固定参照物 | `"none"` |
| `scenes` | `time_weather` | 时间天气 | era |
| `props` | `initial_state` | 道具初始状态 | `"none"` |
| `props` | `state_progression` | 状态递进 | `"none"` |

---

## 管线8：视频生成参考图（新增）

| 数据字段 | 数据来源 | 取值逻辑 |
|---------|---------|---------|
| `poster_image_path` | `shots.poster_image_path` | 故事板生成后写入，视频生成时自动作为本地参考图传入 |

**代码取值**：
```typescript
addRefIfExists(shot.poster_image_path, 'storyboard')
```

---

## 故障修正重试（新增）

故事板 API 调用失败时，自动追加修正语句重试一次：

```
修正语句 = (strict equal 3x3 grid, clear thin white dividers, 
  clear white number 1-9 at bottom-left of each frame:1.3), 
  (absolute character consistency, identical face, identical hairstyle, 
  identical clothes in all 9 frames:1.3), 
  no extra objects, no extra people, strictly follow the fixed scene setting
```

**代码位置**：`imageGenerator.ts` `generateGridStoryboard` — `callImageGenerationAPI` 调用处 try-catch。

---

## 模板版本：v35

v35 核心变更：
- 七段式 DB 模板替换代码硬编码 prompt
- 参考图 URL 注入（section_1/2 有 URL 才加段）
- SD2.0 权重语法 `(keyword:1.3)` 全线使用
- shots_body 表格格式 `1｜2s｜WS｜eye-level｜dolly in｜...`
- 视频传 poster_image_path 作参考
- 失败自动修正重试
