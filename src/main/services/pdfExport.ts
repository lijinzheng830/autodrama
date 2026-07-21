/**
 * PDF 分镜表导出 — 创作者的交付物
 * 使用 PDFKit 生成 A4 横版分镜审查表
 */
import PDFDocument from 'pdfkit'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getProjectData } from './project'
import { getProject } from './project'

export interface PDFExportConfig {
  projectId: string
  shotIds?: string[]
  includeImages?: boolean
}

async function createPDF(config: PDFExportConfig): Promise<Buffer> {
  const { projectId, shotIds, includeImages = true } = config

  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const data = getProjectData(projectId)
  if (!data.shots || data.shots.length === 0) throw new Error('项目没有分镜数据')

  // 过滤 + 排序
  const shots = data.shots
    .filter(s => shotIds ? shotIds.includes(s.id) : true)
    .sort((a, b) => {
      const ciA = data.chapters.find(c => c.id === a.chapter_id)
      const ciB = data.chapters.find(c => c.id === b.chapter_id)
      const keyA = `${ciA?.chapter_index ?? 0}_${a.shot_index}`
      const keyB = `${ciB?.chapter_index ?? 0}_${b.shot_index}`
      return keyA.localeCompare(keyB)
    })

  if (shots.length === 0) throw new Error('没有匹配的分镜')

  // 注册中文字体
  const fontPath = 'C:/Windows/Fonts/msyh.ttc'
  const fontName = 'Microsoft YaHei'

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 30, bottom: 30, left: 40, right: 40 }
    })

    if (existsSync(fontPath)) {
      doc.registerFont(fontName, fontPath)
    }

    const bufs: Buffer[] = []
    doc.on('data', (chunk: Buffer) => bufs.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(bufs)))
    doc.on('error', reject)

    const font = existsSync(fontPath) ? fontName : 'Helvetica'
    const pageW = doc.page.width
    const pageH = doc.page.height
    const imgW = pageW * 0.45
    const imgH = pageH * 0.55
    const textX = imgW + 60
    const textW = pageW - textX - 40

    // ===== 封面 =====
    doc.font(font).fontSize(22).text(project.name || '分镜表', { align: 'center' })
    doc.moveDown(0.5)
    doc.fontSize(11).fillColor('#666')
      .text(`${project.style_name || '未设风格'}  |  ${project.era || '未设年代'}  |  ${project.aspect_ratio || '16:9'}`, { align: 'center' })
    doc.moveDown(0.5)
    doc.fontSize(10).fillColor('#999').text(`共 ${shots.length} 个分镜  |  导出时间 ${new Date().toLocaleString('zh-CN')}`, { align: 'center' })
    doc.addPage()

    // ===== 分镜页 =====
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]
      const imgPath = shot.poster_image_path || ''

      // 页码
      doc.font(font).fontSize(8).fillColor('#999')
        .text(`${i + 1} / ${shots.length}`, pageW - 80, 15, { width: 60, align: 'right' })

      // 编号
      const chapter = data.chapters.find(c => c.id === shot.chapter_id)
      const label = chapter
        ? `#${chapter.chapter_index + 1}-${shot.shot_index + 1}`
        : `#${i + 1}`
      doc.font(font).fontSize(16).fillColor('#333').text(label, 40, 30)

      // 缩略图（左半页）
      let hasImg = false
      if (includeImages && imgPath) {
        try {
          if (existsSync(imgPath)) {
            const buf = readFileSync(imgPath)
            doc.image(buf, 40, 60, { width: imgW, height: imgH, fit: [imgW, imgH], align: 'center', valign: 'center' })
            hasImg = true
          }
        } catch { /* 图片加载失败 → 占位 */ }
      }
      if (!hasImg) {
        doc.rect(40, 60, imgW, imgH).fillOpacity(0.05).fill('#000').fillOpacity(1)
        doc.rect(40, 60, imgW, imgH).lineWidth(0.5).stroke('#ccc')
        doc.font(font).fontSize(12).fillColor('#999')
          .text('未生成', 40, 60 + imgH / 2 - 10, { width: imgW, align: 'center' })
      }

      // 文字信息（右半页）
      let y = 60
      const title = (label: string, value: string) => {
        if (label) {
          doc.font(font).fontSize(9).fillColor('#999').text(label, textX, y)
          y += 12
        }
        doc.font(font).fontSize(10).fillColor('#333')
        const h = doc.heightOfString(value, { width: textW })
        doc.text(value, textX, y, { width: textW, lineGap: 1 })
        y += h + 8
      }

      if (shot.description || shot.description_zh) {
        const desc = shot.description_zh || shot.description || ''
        doc.font(font).fontSize(9).fillColor('#666').text('画面描述', textX, y)
        y += 14
        doc.font(font).fontSize(10).fillColor('#222')
        const h = doc.heightOfString(desc, { width: textW })
        doc.text(desc.slice(0, 300), textX, y, { width: textW })
        y += h + 10
      }

      const meta: string[] = []
      if (shot.shot_type) meta.push(`景别: ${shot.shot_type}`)
      if (shot.camera_movement) meta.push(`运镜: ${shot.camera_movement}`)
      if (shot.lighting_mood) meta.push(`光线: ${shot.lighting_mood}`)
      if (meta.length > 0) title('', meta.join('  |  '))

      if (shot.dialogue) title('对白', shot.dialogue)
      if ((shot as any).inner_monologue) title('内心独白', (shot as any).inner_monologue)
      if (shot.narration) title('旁白', shot.narration)

      if (shot.characters && shot.characters.length > 0) {
        const charNames = shot.characters.map((c: any) => c.name).join('、')
        title('出场角色', charNames)
      }
      if (shot.scenes && shot.scenes.length > 0) {
        const sceneNames = shot.scenes.map((s: any) => s.name).join('、')
        title('场景', sceneNames)
      }

      if (i < shots.length - 1) doc.addPage()
    }

    doc.end()
  })
}

export async function exportStoryboardPDF(config: PDFExportConfig): Promise<string> {
  const { projectId } = config
  const project = getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const buffer = await createPDF(config)

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `${project.name || 'project'}_storyboard_${ts}.pdf`
  const outputPath = join(project.path, 'exports', fileName)

  mkdirSync(join(project.path, 'exports'), { recursive: true })
  writeFileSync(outputPath, buffer)

  return outputPath
}
