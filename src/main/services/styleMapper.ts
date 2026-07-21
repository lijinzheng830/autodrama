/**
 * 风格映射服务
 * 纯函数模块 — 零依赖，提供年代/风格映射、中文回退、画面比例转换
 */

/** 年代中文 → 英文映射（生图 API 需要英文年代描述） */
export const ERA_MAP: Record<string, string> = {
  '古代': 'ancient China, traditional architecture, historical setting',
  '近代': 'early modern China, 19th-20th century transition era',
  '现代': 'modern China, contemporary urban setting',
  '当代': 'present-day China, current era',
  '未来': 'futuristic sci-fi China, advanced technology',
  '末世': 'post-apocalyptic wasteland, ruined world',
  '末世废土': 'post-apocalyptic wasteland, ruined world',
  '民国': 'Republican era China, 1912-1949, Shanghai Bund style',
  '唐朝': 'Tang Dynasty China, golden age of imperial China',
  '宋朝': 'Song Dynasty China, refined scholarly aesthetics',
  '明朝': 'Ming Dynasty China, classical gardens and architecture',
  '清朝': 'Qing Dynasty China, Manchu-influenced imperial style',
  '汉朝': 'Han Dynasty China, ancient silk road era',
  '上古': 'mythological ancient China, legendary era',
  '仙侠': 'Chinese xianxia fantasy realm, immortal cultivation world',
  '洪荒': 'primordial mythical era, creation myth times',
  '武侠': 'martial arts world, jianghu wandering swordsmen era',
  '架空世界': 'original fantasy world, fictional realm with unique cultures and architecture',
  '赛博朋克': 'cyberpunk dystopian future, neon-lit megacity',
  '蒸汽朋克': 'steampunk retro-futuristic, brass and gears aesthetic',
}

/** 将中文年代映射为英文描述，支持精确匹配、模糊匹配、原样回退 */
export function mapEra(eraText: string): string {
  if (!eraText || !eraText.trim()) return ''
  // 精确匹配
  if (ERA_MAP[eraText.trim()]) return ERA_MAP[eraText.trim()]
  // 模糊匹配：包含关键词
  for (const [key, value] of Object.entries(ERA_MAP)) {
    if (eraText.includes(key) || key.includes(eraText)) return value
  }
  // 已经是英文或自定义，原样返回
  return eraText.trim()
}

/** 模板变量 _zh 中文键回退到英文值 */
export function fillZhFallback(vars: Record<string, string>): void {
  for (const k of Object.keys(vars)) {
    if (k.endsWith('_zh') && !vars[k]) {
      vars[k] = vars[k.replace('_zh', '')] || ''
    }
  }
}

/** 风格英文质量描述（注入到模板的 style_prompt 变量，Agnes 对英文理解更精准） */
export const STYLE_PROMPT: Record<string, string> = {
  '二次元动漫': 'Anime style, clean lineart, flat color shading, hard-edged shadows, vibrant palette, crisp bright composition',
  '写实摄影': 'Photorealistic, 8K resolution, highly detailed textures, natural lighting, professional photography, visible skin pores, realistic material质感, soft shadows, fashion photography style',
  '3D渲染': '3D CGI render style, Blender Cycles quality, raytraced global illumination, ambient occlusion, PBR materials with metallic roughness, subsurface scattering on skin, volumetric light rays, depth of field bokeh, clean polygonal geometry edges, slight chromatic aberration on highlights, no film grain, no photographic noise, purely digital aesthetic',
  '水彩插画': 'Watercolor painting style, soft blurred edges, visible paper texture, natural paint bleeding, wet-on-wet color transitions, soft pastel tones',
  '赛博朋克': 'Cyberpunk style, neon lighting, rain-soaked street reflections, high-contrast dark tones, glowing circuit patterns, industrial metal textures',
  '像素复古': 'Pixel art style, visible pixel grid, 16-bit color palette, crisp block edges, classic RPG game sprite aesthetic',
  '油画质感': 'Classical oil painting style, visible impasto brushstrokes, chiaroscuro lighting, layered transparent glazes, rich warm tones, canvas texture',
  '扁平插画': 'Flat illustration style, solid color blocks, no gradients, clean geometric shapes, bold shadow shapes, modern vector aesthetic',
  '吉卜力': 'Studio Ghibli animation style, hand-drawn soft lineart, watercolor backgrounds, warm natural tones, soft lighting, everyday magic atmosphere',
  '美漫风格': 'American comic style, thick black outlines, vibrant saturated colors, halftone dot shading, dynamic composition, heroic proportions',
  '暗黑奇幻': 'Dark fantasy style, muted somber tones, dramatic lighting, gothic architecture, dense fog atmosphere, rusted metal textures',
  '日系治愈': 'Japanese healing style, soft warm light, gentle pastel tones, fluffy soft textures, warm peaceful atmosphere, shallow depth of field',
  '中国水墨': 'Chinese ink wash painting style, layered ink tones, rice paper texture, negative space composition, expressive brushwork, bleeding effect',
  '中国仙侠': 'Chinese xianxia fantasy style, flowing silk textures, jade luster, spiritual energy glow effects, ancient architecture, mist-shrouded, ethereal atmosphere',
}

/** 风格中文质量描述（注入到中文模板的 style_prompt_zh 变量） */
export const STYLE_PROMPT_ZH: Record<string, string> = {
  '二次元动漫': '二次元动漫风格，清晰黑色轮廓线，平涂色块，硬边阴影，鲜艳配色，干净明亮的画面',
  '写实摄影': '照片级真实感，8K分辨率，高细节纹理，自然光线，专业摄影，皮肤毛孔可见，真实材质质感，柔和阴影，时尚摄影风格',
  '3D渲染': '3D CGI渲染风格，Blender Cycles品质，光线追踪全局光照，环境光遮蔽，PBR金属粗糙度材质，皮肤次表面散射，体积光，景深虚化，几何边缘清晰，高光边缘微色散，无胶片颗粒，纯数字质感',
  '水彩插画': '水彩画风格，柔和模糊边缘，纸张纹理可见，颜料自然晕染，湿画法色彩过渡，柔和粉彩色调',
  '赛博朋克': '赛博朋克风格，霓虹灯光，雨湿街道反射，高对比暗色调，发光电路纹路，工业金属质感',
  '像素复古': '像素艺术风格，可见像素网格，16位色彩限制，清晰方块边缘，经典RPG游戏精灵风格',
  '油画质感': '古典油画风格，厚涂笔触可见，明暗对照，层层透明釉彩，丰富暖色调，画布纹理',
  '扁平插画': '扁平插画风格，纯色色块，无渐变，简洁几何形状，粗阴影色块，现代矢量美学',
  '吉卜力': '吉卜力动画风格，手绘柔和线稿，水彩背景，温暖自然色调，柔和光影，日常魔法氛围',
  '美漫风格': '美式漫画风格，粗黑轮廓线，鲜艳饱和色彩，网点阴影，动态构图，英雄比例',
  '暗黑奇幻': '暗黑奇幻风格，低沉色调，戏剧性光影，哥特式建筑，浓雾氛围，金属锈蚀质感',
  '日系治愈': '日系治愈风格，柔和暖光，淡雅粉彩色调，蓬松柔软质感，温馨宁静氛围，浅景深',
  '中国水墨': '中国水墨画风格，浓淡墨色层次，宣纸纹理，留白构图，写意笔触，晕染效果',
  '中国仙侠': '中国仙侠风格，飘逸丝绸质感，玉石光泽，灵气光效，古风建筑，云雾缭绕，仙境氛围',
}

/** 根据项目风格名获取英文风格描述（精确匹配 + 模糊匹配） */
export function getStylePrompt(styleName: string, fallback: string): string {
  if (!styleName) return fallback
  if (STYLE_PROMPT[styleName]) return STYLE_PROMPT[styleName]
  for (const [key, value] of Object.entries(STYLE_PROMPT)) {
    if (styleName.includes(key) || key.includes(styleName)) return value
  }
  return fallback
}

/** 根据项目风格名获取中文风格描述（精确匹配 + 模糊匹配） */
export function getStylePromptZh(styleName: string, fallback: string): string {
  if (!styleName) return fallback
  // 精确匹配
  if (STYLE_PROMPT_ZH[styleName]) return STYLE_PROMPT_ZH[styleName]
  // 模糊匹配（包含关系）
  for (const [key, val] of Object.entries(STYLE_PROMPT_ZH)) {
    if (styleName.includes(key) || key.includes(styleName)) return val
  }
  return fallback
}

/** 画面比例 → API size 参数 */
export function getAPISize(aspectRatio: string): string | undefined {
  const map: Record<string, string> = {
    // 标准分辨率（长边 ~1920，全部16倍数）
    '1:1': '1088x1088',
    '2:3': '1088x1632',
    '3:2': '1632x1088',
    '3:4': '1088x1456',
    '4:3': '1456x1088',
    '9:16': '1088x1936',
    '16:9': '1920x1088',
    // 2K 分辨率（长边 ~2880，全部16倍数）
    '1:1_2k': '2880x2880',
    '2:3_2k': '1920x2880',
    '3:2_2k': '2880x1920',
    '3:4_2k': '2160x2880',
    '4:3_2k': '2880x2160',
    '9:16_2k': '1616x2880',
    '16:9_2k': '2880x1616',
    // 4K 分辨率（长边 = 3840，API 上限，全部16倍数）
    '1:1_4k': '3840x3840',
    '2:3_4k': '2560x3840',
    '3:2_4k': '3840x2560',
    '3:4_4k': '2880x3840',
    '4:3_4k': '3840x2880',
    '9:16_4k': '2160x3840',
    '16:9_4k': '3840x2160',
  }
  return map[aspectRatio]
}

/** 无边界AI 画面比例 → size 参数 */
export function mapWubianjieSize(aspectRatio: string): string {
  const map: Record<string, string> = {
    // 标准分辨率（长边 ~1920，全部16倍数）
    '1:1': '1088x1088',
    '2:3': '1088x1632',
    '3:2': '1632x1088',
    '3:4': '1088x1456',
    '4:3': '1456x1088',
    '9:16': '1088x1936',
    '16:9': '1920x1088',
    // 2K 分辨率（长边 ~2880，全部16倍数）
    '1:1_2k': '2880x2880',
    '2:3_2k': '1920x2880',
    '3:2_2k': '2880x1920',
    '3:4_2k': '2160x2880',
    '4:3_2k': '2880x2160',
    '9:16_2k': '1616x2880',
    '16:9_2k': '2880x1616',
    // 4K 分辨率（长边 = 3840，API 上限，全部16倍数）
    '1:1_4k': '3840x3840',
    '2:3_4k': '2560x3840',
    '3:2_4k': '3840x2560',
    '3:4_4k': '2880x3840',
    '4:3_4k': '3840x2880',
    '9:16_4k': '2160x3840',
    '16:9_4k': '3840x2160',
  }
  return map[aspectRatio] || '1920x1088'
}

/** 画面比例可选项列表（供前端下拉框使用） */
export const ASPECT_RATIO_OPTIONS: Array<{ label: string; value: string; group: string }> = [
  { label: '正方形（1:1）', value: '1:1', group: '标准分辨率' },
  { label: '竖版（2:3）', value: '2:3', group: '标准分辨率' },
  { label: '横版（3:2）', value: '3:2', group: '标准分辨率' },
  { label: '竖版（3:4）', value: '3:4', group: '标准分辨率' },
  { label: '横版（4:3）', value: '4:3', group: '标准分辨率' },
  { label: '竖版（9:16）', value: '9:16', group: '标准分辨率' },
  { label: '横版（16:9）', value: '16:9', group: '标准分辨率' },
  { label: '2K正方形（1:1）', value: '1:1_2k', group: '2K分辨率' },
  { label: '2K竖版（2:3）', value: '2:3_2k', group: '2K分辨率' },
  { label: '2K横版（3:2）', value: '3:2_2k', group: '2K分辨率' },
  { label: '2K竖版（3:4）', value: '3:4_2k', group: '2K分辨率' },
  { label: '2K横版（4:3）', value: '4:3_2k', group: '2K分辨率' },
  { label: '2K竖版（9:16）', value: '9:16_2k', group: '2K分辨率' },
  { label: '2K横版（16:9）', value: '16:9_2k', group: '2K分辨率' },
  { label: '4K正方形（1:1）', value: '1:1_4k', group: '4K分辨率' },
  { label: '4K竖版（2:3）', value: '2:3_4k', group: '4K分辨率' },
  { label: '4K横版（3:2）', value: '3:2_4k', group: '4K分辨率' },
  { label: '4K竖版（3:4）', value: '3:4_4k', group: '4K分辨率' },
  { label: '4K横版（4:3）', value: '4:3_4k', group: '4K分辨率' },
  { label: '4K竖版（9:16）', value: '9:16_4k', group: '4K分辨率' },
  { label: '4K横版（16:9）', value: '16:9_4k', group: '4K分辨率' },
]

// ===== 多角度锚点 =====

export type AnchorAngle = 'front' | 'three_quarter' | 'side' | 'back'

/** 角度 → 像素尺寸（Agnes API 兼容） */
export function getAngleSize(angle: AnchorAngle): string {
  const map: Record<AnchorAngle, string> = {
    front: '1024x1024',
    three_quarter: '1024x768',
    side: '768x1024',
    back: '1024x1024'
  }
  return map[angle]
}

/** 角度标签 */
export function getAngleLabel(angle: AnchorAngle): string {
  const map: Record<AnchorAngle, string> = {
    front: '正面(0°)',
    three_quarter: '半侧面(45°)',
    side: '侧面(90°)',
    back: '背面(180°)'
  }
  return map[angle]
}

/** 生成角度专属生图 Prompt（注入角色描述 + 风格） */
export function getAnglePrompt(
  angle: AnchorAngle,
  characterDescription: string,
  stylePrompt?: string,
  eraPrompt?: string
): string {
  const angleDirectives: Record<AnchorAngle, string> = {
    front: [
      'Full body front view, facing camera directly, symmetrical composition',
      'Character stands centered, arms relaxed at sides, neutral expression',
      'Clean front lighting, even illumination, no dramatic shadows',
      'Show complete outfit silhouette and facial features from the front',
    ].join('. '),
    three_quarter: [
      'Three-quarter view at 45-degree angle, dynamic perspective',
      'Character body turned slightly to the side while head faces camera',
      'Soft key light from front, subtle shadow on far side for depth',
      'Show garment draping, fabric folds, and dimensional depth of the outfit',
    ].join('. '),
    side: [
      'Pure side profile view at exactly 90 degrees, lateral composition',
      'Character facing to the right, full body visible from head to toe',
      'Clean silhouette against white background, rim light highlighting contours',
      'Show the profile of facial features, hairstyle silhouette, and garment side seams',
    ].join('. '),
    back: [
      'Full body back view, character facing away from camera',
      'Character standing straight, centered composition',
      'Even backlighting to show hair texture and clothing details from behind',
      'Show hair flow, back of outfit, shoulder contours, and overall silhouette',
    ].join('. ')
  }

  const parts = [
    `[Subject] ${characterDescription}`,
    `[Angle] ${angleDirectives[angle]}`,
    `[Background] Pure white seamless background, studio lighting setup, no props`,
    stylePrompt ? `[Style] ${stylePrompt}` : '',
    eraPrompt ? `[Era] ${eraPrompt}` : '',
    `[Quality] ${getAngleSize(angle)} resolution, single character, full body, sharp focus, professional photography`
  ]

  return parts.filter(Boolean).join('\n')
}

// ===== 中文影视术语 → 英文（静态映射，零延迟）=====

export function translateCnField(text: string): string {
  const map: Record<string, string> = {
    '大特写': 'Extreme close-up, single detail fills frame',
    '特写': 'Close-up shot, face fills frame',
    '近景': 'Medium close-up, chest up',
    '中景': 'Medium shot, full body visible',
    '全景': 'Full shot, entire body and surroundings',
    '远景': 'Long shot, small figure in vast environment',
    '大远景': 'Extreme long shot, tiny figure in landscape',
    '固定': 'Static tripod shot, no camera movement',
    '推镜头': 'Push in, camera moves closer to subject',
    '缓慢推进': 'Slow push in, camera gradually moves closer',
    '拉镜头': 'Pull out, camera moves away from subject',
    '缓慢拉远': 'Slow pull out, camera gradually moves away',
    '摇镜头': 'Pan, camera pivots horizontally',
    '左摇': 'Pan left, camera pivots left',
    '右摇': 'Pan right, camera pivots right',
    '移镜头': 'Truck/dolly, camera moves laterally',
    '跟镜头': 'Tracking shot, camera follows subject movement',
    '跟随': 'Tracking shot, camera follows subject movement',
    '升镜头': 'Crane up, camera rises vertically',
    '降镜头': 'Crane down, camera descends vertically',
    '环绕': 'Orbital shot, camera circles around subject',
    '旋转': 'Orbital rotation around subject',
    '升降': 'Crane shot, camera moves vertically',
    '手持': 'Handheld camera, slight natural shake',
  }
  if (map[text]) return map[text]
  for (const [k, v] of Object.entries(map)) {
    if (text.includes(k) || k.includes(text)) return v
  }
  return text
}

/** 从文本中检测景别关键词 */
export function detectShotType(text: string): string {
  if (/大特写|extreme.?close.?up/i.test(text)) return '大特写'
  if (/大远景|extreme.?long.?shot/i.test(text)) return '大远景'
  if (/远景|long.?shot/i.test(text)) return '远景'
  if (/全景|full.?shot|wide.?shot|panoramic/i.test(text)) return '全景'
  if (/中景|medium.?shot/i.test(text)) return '中景'
  if (/近景|medium.?close.?up|chest.?up/i.test(text)) return '近景'
  if (/特写|close.?up/i.test(text)) return '特写'
  return ''
}

/** 模板变量替换：{{key}} → value，未匹配变量清理 */
export function applyTemplate(content: string, vars: Record<string, string>): string {
  let result = content
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\{\\{' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}\\}', 'g'), value)
  }
  return result.replace(/\{\{[^}]+\}\}/g, '')
}

/** 从结构化角色描述中提取指定字段（支持字段名别名） */
export function parseDescField(desc: string, field: string): string {
  if (!desc) return ''
  const aliases: Record<string, string[]> = {
    'Outfit': ['Outfit', 'Clothing', 'Clothes'],
    'Key prop': ['Key prop', 'Prop', 'Props', 'Weapon'],
    'Hair': ['Hair', 'Hairstyle'],
    'Facial features': ['Facial features', 'Face'],
    'Build': ['Build', 'Body type', 'Body'],
    'Role': ['Role', 'Identity'],
  }
  const names = aliases[field] || [field]
  let bestIdx = -1, bestName = ''
  for (const name of names) {
    const idx = desc.indexOf(name + ':')
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) { bestIdx = idx; bestName = name }
  }
  if (bestIdx === -1) return ''
  const start = bestIdx + bestName.length + 1
  const rest = desc.slice(start).trim()
  const allFields = ['Role:', 'Identity:', 'Age:', 'Facial features:', 'Face:', 'Hair:', 'Hairstyle:', 'Outfit:', 'Clothing:', 'Clothes:', 'Key prop:', 'Prop:', 'Props:', 'Weapon:', 'Build:', 'Body type:', 'Body:', 'Distinctive marks:', 'Features:']
  let end = rest.length
  for (const nf of allFields) {
    const ni = rest.indexOf('. ' + nf); if (ni > 0 && ni < end) end = ni
    const ni2 = rest.indexOf(' ' + nf); if (ni2 > 0 && ni2 < end) end = ni2
  }
  return rest.slice(0, end).replace(/\.$/, '').trim()
}

export function parseCharFaces(desc: string): string { return parseDescField(desc, 'Facial features') || desc || '' }
export function parseCharHairs(desc: string): string { return parseDescField(desc, 'Hair') || desc || '' }
export function parseCharOutfits(desc: string): string { return parseDescField(desc, 'Outfit') || desc || '' }
export function parseCharBodies(desc: string): string { return parseDescField(desc, 'Build') || desc || '' }
