从以下分镜结果中提取所有角色、场景和道具。

## 语言要求
- **名称（name）必须用中文**——角色名、场景名、道具名使用中文，从原文中提取。绝对禁止英文名。
- **名称必须与 shot_scene / shot_description 中的原始表述完全一致，不得改写、润色或补充任何额外文字。** 例如分镜里写的是"演播室"，场景名就必须是"演播室"，不能写成"演播厅"或"直播间舞台"。角色名同理——原文叫"李克用"就写"李克用"，不能写成"晋王"或"李晋王"或"王爷"。
- **全剧同一实体只提取一次**——同一角色/场景/道具在分镜数据中多次出现时，只输出一次，使用首次出现时的名称。不要因为上下文不同而创建重复条目（如"营帐"和"帅帐"是同一场景的两个叫法，只取一个）。
- description 字段必须用英文（发给AI生图API的指令）。
- **description_zh 字段必须用中文，绝对禁止复制英文description的内容。两个字段内容完全不同，一个是英文生图指令，一个是中文阅读版本。**

## 角色提取（导演级标准）

### 核心铁律
1. **朝代锁定**：所有描述必须符合剧本所在朝代（晚唐/古代中国），禁止出现现代元素（现代短发、现代服装、现代妆容、现代武器）。
2. **禁止时间线**：只描述角色在当前剧情的**一个确定状态**。严禁写成"初为...后为..."、"先是...再是..."。如果角色在剧情中形象有变化，取该角色在剧中**最主要/出场最多**的状态。
3. **旁白过滤**：旁白、画外音、系统广播、提示音不是角色，不要将其提取为角色。只有实际出场说话的人物才算角色。
4. **一人一态**：每个角色只输出一次，不要因服装变化而重复提取。
5. **具体具象**：禁止模糊词（"好看""帅气""有气质"）。每个字段必须写具体视觉特征。

### description 英文格式
```
Role: [角色身份+地位]. Age: [准确年龄段]. Facial features: [脸型+眉+眼+鼻+唇+气质], [肤色]. Hair: [发色+发型+发长，必须是古代中国发式：束髻/发冠/披发/髡发]. Outfit: [全套服装描述，必须包含：材质+形制+颜色+层次]. Key prop: [核心随身道具，必须是唐代存在的物品]. Build: [身高+体态+体型]. Distinctive marks: [伤疤/纹身/配饰/特殊标记，无则写'none'].
```

### description_zh 中文格式
```
身份：[角色身份+地位]。年龄：[年龄]。五官：[脸型+眉+眼+鼻+唇+气质]，[肤色]。头发：[发色+古代中国发式，如束髻/披发/戴冠]。服装：[全套：从内到外/从上到下，材质+形制+颜色]。道具：[核心随身道具]。体型：[身高+体态]。特征：[特殊标记，无则写'无']。
```

### 发式约束（CRITICAL）
古代中国没有"短发"。发式必须是：**束髻（武士/官员）、披发（少年/流民）、髡发（僧侣/囚犯）、戴冠/戴帽（文人/武将）**。绝对禁止 short hair、bob cut 等现代词汇。

### 服装约束（CRITICAL）
唐代服装类型：**札甲/明光铠/鱼鳞甲（武将）、圆领袍/襕衫（官员）、交领短衣/布衣（平民）、红袍（高官）、玄甲（精锐骑兵）**。必须写明材质（麻/棉/锦/熟铁/皮革/铜）和颜色。

### 示例（正确）
"身份：晚唐河东节度使。年龄：约四十岁。五官：方脸虬髯，虎目剑眉，鹰钩鼻，薄唇紧抿，面有风霜之痕，威压之气。头发：黑发间灰白，束成发髻于顶。服装：外披金漆山文甲，内衬暗红锦袍，腰束蹀躞带，足蹬乌皮靴。道具：腰悬玉首直刀。体型：高大魁梧，宽肩厚背，军旅姿态。特征：无。"

每个字段写具体具象。必须涵盖以上所有字段。

**正确示例（英文）**：
"Role: a young female swordswoman. Age: early 20s. Facial features: refined sharp features, willow-leaf eyebrows, almond-shaped brown eyes, straight nose bridge, thin firm lips, cool porcelain skin, oval face. Hair: jet-black hair in high ponytail reaching mid-back, side strands framing face. Outfit: white cross-collar martial tunic with dark navy embroidered trim, black leather wrist guards, knee-high leather boots. Key prop: a long sword with faint blue-glowing blade, silver scabbard at waist. Build: tall and slender at 168cm, upright posture, agile frame. Distinctive marks: thin calluses on right hand from sword training."

## 场景提取（导演级标准）
每个场景的 description（英文）和 description_zh（中文）必须使用结构化格式：

description 英文格式：
"Location: [地点+空间结构]. Time: [时间+天气]. Atmosphere: [氛围]. Lighting: [主光源方向+色温+色调]. Effects: [环境特效，无则写'none']. Light direction: [光源具体来向: front/back/side/top/three-point]. Spatial depth: [前景+中景+远景层次描述]. Material properties: [主要表面材质: rough wood/gleaming metal/worn stone/weathered fabric/ etc]."

description_zh 中文格式：
"地点：[地点+空间布局]。时间：[时间+天气]。氛围：[氛围描述]。光线：[光源方向+色温色调]。特效：[环境特效，无则写'无']。光源来向：[前光/逆光/侧光/顶光/三点布光]。空间层次：[前景+中景+远景分层描述]。材质属性：[主要表面材质：粗木/抛光金属/风化石材/旧织物等]。"

每个场景必须额外输出3个独立字段（与 description 分开，存独立DB列）：
- environment_effects: 英文环境特效短语（如 "drifting fog", "heavy rain", "swirling snow", "none"）
- reference_objects: 英文固定参照物短语（如 "ancient well on the left", "stone lighthouse in distance", "large oak tree center frame", "none"）
- time_weather: 英文时间天气短语（如 "dusk with golden hour light", "overcast before snowstorm", "midnight with full moon", "none"）

**CRITICAL：纯环境场景，绝对不能出现任何人、角色、生物、人影。**

## 道具提取
每个道具 description 用英文（至少30词），description_zh 用中文。涵盖：类型用途、尺寸形状、材质颜色、特殊细节（磨损/光泽/雕刻等）。

每个道具必须额外输出2个独立字段（与 description 分开，存独立DB列）：
- initial_state: 英文初始状态短语（道具在故事开始时的状态，如 "clean and sharp, sheathed at the waist", "dusty and covered with cobwebs in the corner", "gleaming under the display light"，无特殊状态则填 "none"）
- state_progression: 英文状态变化逻辑短语（道具在分镜序列中的状态变化，如 "unbroken → cracked in shot 3 → shattered in shot 7", "holstered → drawn → bloodied"，无变化则填 "none"）

## 输出格式
严格返回 JSON。无则返回空数组 []。

{
  "characters": [{"name": "中文名", "description": "英文结构化描述", "description_zh": "中文结构化描述"}],
  "scenes": [{"name": "中文名", "description": "英文结构化描述", "description_zh": "中文结构化描述", "environment_effects": "...", "reference_objects": "...", "time_weather": "..."}],
  "props": [{"name": "中文名", "description": "English description", "description_zh": "中文描述", "initial_state": "state phrase or none", "state_progression": "progression logic or none"}]
}