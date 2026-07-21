/**
 * Seedance module — auto-extracted from scriptParse.ts
 */

export function buildSeedanceVideoPromptZh(s: any, index: number, totalShots: number): string {
  const isLast = index === totalShots - 1
  const videoDesc = s.video_description || s.shot_description || ''
  const chars = (s.character_list || []).join('、')
  const scene = s.scene_name || ''

  const lines: string[] = [videoDesc]
  lines.push(`${s.shot_type || ''} | 场景: ${scene}${chars ? ' | 角色: ' + chars : ''} | 镜${index + 1}/${totalShots}`)
  if (s.dialogue) lines.push(`对白: ${s.dialogue}`)
  if (s.narration) lines.push(`旁白: ${s.narration}`)
  if (isLast) lines.push('锁帧: camera_fixed, return_last_frame, 画面定格为下一章首帧')
  return lines.join('\n')
}

export function buildSeedanceVideoPrompt(s: any, index: number, totalShots: number): string {
  const isLast = index === totalShots - 1
  const videoDesc = s.video_description || s.shot_description || ''
  const chars = (s.character_list || []).join(', ')
  const scene = s.scene_name || ''

  const lines: string[] = [videoDesc]
  lines.push(`${s.shot_type || ''} | Scene: ${scene}${chars ? ' | Characters: ' + chars : ''} | Shot ${index + 1}/${totalShots}`)
  if (isLast) lines.push('LOCK FRAME: camera_fixed, return_last_frame, freeze on this composition for next-chapter continuity')
  return lines.join('\n')
}

export function buildAutoVideoPrompt(
  description: string,
  charNames: string[],
  sceneName: string,
  shotType?: string,
  cameraMovement?: string,
  lighting?: string,
  duration?: number,
  dialogue?: string,
  narration?: string
): string {
  const parts: string[] = []
  if (description) parts.push(description)
  const technical = [shotType || '中景', cameraMovement || '固定'].filter(Boolean).join('，')
  parts.push(technical)
  if (lighting) parts.push(lighting)
  if (duration && duration > 0) parts.push(`时长${duration.toFixed(1)}秒`)
  if (sceneName) parts.push(`场景：${sceneName}`)
  if (charNames.length > 0) parts.push(`角色：${charNames.join('、')}`)
  if (dialogue && dialogue.trim()) parts.push('角色正在说话')
  if (narration && narration.trim()) parts.push('旁白配音中')
  parts.push('consistent motion, motivated lighting, one primary camera movement')
  return parts.join('。')
}

// ===== 中文检查 =====