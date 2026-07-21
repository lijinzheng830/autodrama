// Spatial experiment — node test-spatial.mjs YOUR_API_KEY
import { readFileSync, writeFileSync } from 'fs'

const API_KEY = process.argv[2]
if (!API_KEY || API_KEY.length < 10) {
  console.error('Usage: node test-spatial.mjs YOUR_API_KEY')
  process.exit(1)
}

const BASE = 'https://apihub.agnes-ai.com/v1/images/generations'
const MODEL = 'agnes-image-2.1-flash'
const PROMPT = 'Medium shot, a young woman standing next to a wooden desk in a studio, facing the camera, gentle smile, warm golden lighting, photorealistic, 8K, professional photography, natural proportions, feet on the ground with visible shadows'
const OUT = 'C:/Users/Administrator/autodrama/experiments/output'

const TESTS = [
  { name: 'A_red_box', path: `${OUT}/layout_A_red_box.png` },
  { name: 'B_silhouette', path: `${OUT}/layout_B_silhouette.png` },
  { name: 'C_ghost', path: `${OUT}/layout_C_ghost.png` },
]

async function run(name, layoutPath) {
  console.log(`\n[${new Date().toLocaleTimeString()}] ${name}...`)
  const rawB64 = readFileSync(layoutPath).toString('base64')
  const imgDataUri = `data:image/png;base64,${rawB64}`

  const body = {
    model: MODEL, prompt: PROMPT, n: 1,
    seed: Math.floor(Math.random() * 2e9),
    size: '1024x768',
    extra_body: { image: [imgDataUri], response_format: 'b64_json' }
  }

  try {
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const j = await r.json()
    console.log(`  status=${r.status} keys=[${Object.keys(j).join(',')}]`)

    if (!r.ok) {
      console.log(`  ✗ ${JSON.stringify(j).slice(0, 400)}`)
      return false
    }

    // Same logic as app: resp.data?.data || resp.data?.images || ...
    const data = j.data || j.images || j.choices?.[0]?.message?.content || []
    const items = Array.isArray(data) ? data : [data]
    let saved = 0
    for (const item of items) {
      if (typeof item === 'string') {
        if (item.startsWith('data:')) {
          const b = Buffer.from(item.includes('base64,') ? item.split('base64,')[1] : item.split(',')[1], 'base64')
          writeFileSync(`${OUT}/result_${name}.png`, b)
          saved++
        } else if (item.startsWith('http')) {
          const dr = await fetch(item)
          writeFileSync(`${OUT}/result_${name}.png`, Buffer.from(await dr.arrayBuffer()))
          saved++
        }
      } else if (item.url) {
        const dr = await fetch(item.url)
        writeFileSync(`${OUT}/result_${name}.png`, Buffer.from(await dr.arrayBuffer()))
        saved++
      } else if (item.b64_json) {
        writeFileSync(`${OUT}/result_${name}.png`, Buffer.from(item.b64_json, 'base64'))
        saved++
      } else if (item.image_url) {
        const dr = await fetch(item.image_url)
        writeFileSync(`${OUT}/result_${name}.png`, Buffer.from(await dr.arrayBuffer()))
        saved++
      } else {
        console.log(`  ⚠ unknown item: ${JSON.stringify(item).slice(0, 200)}`)
      }
    }
    console.log(`  ✓ ${saved} images saved`)
    return saved > 0
  } catch (err) {
    console.error(`  ✗ ${err.message}`)
    return false
  }
}

console.log(`=== Agnes Spatial Understanding Experiment ===`)
console.log(`Model: ${MODEL}`)
for (const t of TESTS) {
  await run(t.name, t.path)
  await new Promise(r => setTimeout(r, 2000))
}
console.log(`\nResults: ${OUT}/result_*.png`)
