/**
 * 角色名 → 颜色映射工具
 * 共享于 Editor.vue、ShotListCard.vue 等需要角色颜色标注的组件
 */

export const CHAR_COLOR_PALETTE = ['#FF6B6B','#4ECDC4','#FFE66D','#95E1D3','#F38181','#A8D8EA','#FFD3B6','#D5ECC2']

const charColorMap = new Map<string, string>()

/** 根据角色名返回稳定的 hash 颜色 */
export function getCharColor(name: string): string {
  if (charColorMap.has(name)) return charColorMap.get(name)!
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i)
  const c = CHAR_COLOR_PALETTE[Math.abs(hash) % CHAR_COLOR_PALETTE.length]
  charColorMap.set(name, c)
  return c
}
