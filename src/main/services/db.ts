import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'

let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'autodrama.db')
  db = new Database(dbPath)

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      style_name TEXT NOT NULL,
      style_prompt TEXT NOT NULL,
      style_negative_prompt TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      era TEXT,
      negative_prompt TEXT,
      model_config_json TEXT,
      parent_project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      reference_image TEXT,
      skin_images TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      reference_image TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      shot_index INTEGER NOT NULL,
      description TEXT,
      dialogue TEXT,
      first_frame_prompt TEXT,
      last_frame_prompt TEXT,
      video_prompt TEXT,
      first_frame_image_path TEXT,
      last_frame_image_path TEXT,
      video_path TEXT,
      voice_path TEXT,
      duration_seconds REAL,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shot_characters (
      shot_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      PRIMARY KEY (shot_id, character_id),
      FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shot_scenes (
      shot_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      PRIMARY KEY (shot_id, scene_id),
      FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS props (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      reference_image TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      started_at TEXT DEFAULT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shot_props (
      id TEXT PRIMARY KEY,
      shot_id TEXT NOT NULL,
      prop_id TEXT NOT NULL,
      FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
      FOREIGN KEY (prop_id) REFERENCES props(id) ON DELETE CASCADE,
      UNIQUE(shot_id, prop_id)
    );

    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      shot_id TEXT DEFAULT NULL,
      type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      channel TEXT DEFAULT NULL,
      model TEXT DEFAULT NULL,
      status TEXT DEFAULT 'pending',
      input_params TEXT DEFAULT '{}',
      output_path TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      usage TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      template_version TEXT DEFAULT 'v1',
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS style_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      prompt TEXT,
      negative_prompt TEXT,
      character_ref_image TEXT,
      scene_ref_image TEXT,
      grid_ref_image TEXT,
      style_ref_image TEXT,
      color_scheme TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS character_images (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scene_images (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prop_images (
      id TEXT PRIMARY KEY,
      prop_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (prop_id) REFERENCES props(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shot_images (
      id TEXT PRIMARY KEY,
      shot_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      type TEXT DEFAULT 'first',
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shot_videos (
      id TEXT PRIMARY KEY,
      shot_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      has_new_badge INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE
    );
  `)

  // ===== 索引优化（CREATE INDEX IF NOT EXISTS — 幂等） =====
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_characters_project_id ON characters(project_id);
    CREATE INDEX IF NOT EXISTS idx_scenes_project_id ON scenes(project_id);
    CREATE INDEX IF NOT EXISTS idx_props_project_id ON props(project_id);
    CREATE INDEX IF NOT EXISTS idx_chapters_project_id ON chapters(project_id);
    CREATE INDEX IF NOT EXISTS idx_shots_chapter_id ON shots(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_project_id ON generation_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_shot_characters_shot_id ON shot_characters(shot_id);
    CREATE INDEX IF NOT EXISTS idx_shot_scenes_shot_id ON shot_scenes(shot_id);
    CREATE INDEX IF NOT EXISTS idx_shot_images_shot_id ON shot_images(shot_id);
    CREATE INDEX IF NOT EXISTS idx_shot_videos_shot_id ON shot_videos(shot_id);
  `)

  // 插入默认设置
  const defaultSettings = [
    { key: 'provider', value: 'qwen' },
    { key: 'model', value: 'qwen3.6-flash' },
    { key: 'api_key_qwen', value: '' }
  ]
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`)
  for (const s of defaultSettings) {
    insertSetting.run(s.key, s.value)
  }

  // 迁移：如果 prompt_templates 有外键约束，重建表移除它
  try {
    const fkList = db.prepare(`PRAGMA foreign_key_list(prompt_templates)`).all() as { table: string }[]
    if (fkList.length > 0) {
      const fkState = db.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }
      db.exec(`PRAGMA foreign_keys = OFF`)
      db.exec(`BEGIN TRANSACTION`)

      db.exec(`
        CREATE TABLE prompt_templates_new (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          usage TEXT NOT NULL,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          is_default INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `)

      db.exec(`
        INSERT INTO prompt_templates_new (id, project_id, "usage", name, content, is_default, created_at, updated_at)
        SELECT id, NULLIF(project_id, ''), "usage", name, content, is_default, created_at, updated_at FROM prompt_templates
      `)

      db.exec(`DROP TABLE prompt_templates`)
      db.exec(`ALTER TABLE prompt_templates_new RENAME TO prompt_templates`)

      db.exec(`COMMIT`)
      db.exec(`PRAGMA foreign_keys = ${fkState.foreign_keys}`)
    }
  } catch (e) {
    console.error('迁移 prompt_templates 外键失败:', e)
  }

  // 插入官方预设模板（从 src/main/data/prompt-templates/ 读取，INSERT OR REPLACE）
  try {
    // 优先 dev 路径（src/main/data/），回退到编译输出路径（out/main/data/）
    let templatesDir = join(app.getAppPath(), 'src', 'main', 'data', 'prompt-templates')
    if (!existsSync(templatesDir)) {
      templatesDir = join(__dirname, '..', 'data', 'prompt-templates')
    }

    // 18 条官方模板注册表
    const registry: Array<{ file: string; id: string; usage: string; name: string; version: string }> = [
      { file: 'v0-01-script-parse.md', id: 'official-v0-script-parse', usage: 'script_parse', name: '剧本解析', version: 'v0' },
      { file: 'v1-04-character-image.md', id: 'official-v1-character-image', usage: 'character_image', name: '角色定妆照填空', version: 'v1' },
      { file: 'v1-04.5-character-skin.md', id: 'official-v1-character-skin', usage: 'character_skin', name: '角色皮肤填空', version: 'v1' },
      { file: 'v1-05-scene-image.md', id: 'official-v1-scene-image', usage: 'scene_image', name: '场景图填空', version: 'v1' },
      { file: 'v1-06-prop-image.md', id: 'official-v1-prop-image', usage: 'prop_image', name: '道具图填空', version: 'v1' },
      { file: 'v1-07-grid-storyboard.md', id: 'official-v1-grid-storyboard', usage: 'grid_storyboard', name: '宫格故事板填空', version: 'v1' },
      { file: 'v1-08-first-frame.md', id: 'official-v1-first-frame', usage: 'first_frame', name: '首帧填空', version: 'v1' },
      { file: 'v1-09-last-frame.md', id: 'official-v1-last-frame', usage: 'last_frame', name: '尾帧填空', version: 'v1' },
      { file: 'v1-10A-video-basic.md', id: 'official-v1-video-basic', usage: 'video_basic', name: '视频基础图引导填空', version: 'v1' },
      { file: 'v1-10B-video-first-frame.md', id: 'official-v1-video-first-frame', usage: 'video_first_frame', name: '视频首帧引导填空', version: 'v1' },
      { file: 'v1-10C-video-both-frames.md', id: 'official-v1-video-both-frames', usage: 'video_both_frames', name: '视频首尾帧引导填空', version: 'v1' },
      { file: 'v1-10D-video-grid.md', id: 'official-v1-video-grid', usage: 'video_grid', name: '视频宫格引导填空', version: 'v1' },
      { file: 'v2-04A-character-polish.md', id: 'official-v2-character-polish', usage: 'character_polish', name: '角色润色', version: 'v2' },
      { file: 'v2-05A-scene-polish.md', id: 'official-v2-scene-polish', usage: 'scene_polish', name: '场景润色', version: 'v2' },
      { file: 'v2-06A-prop-polish.md', id: 'official-v2-prop-polish', usage: 'prop_polish', name: '道具润色', version: 'v2' },
      { file: 'v2-07-shot-polish.md', id: 'official-v2-shot-polish', usage: 'shot_polish', name: '分镜润色', version: 'v2' },
      { file: 'v2-08-first-frame-polish.md', id: 'official-v2-first-frame-polish', usage: 'first_frame_polish', name: '首帧润色', version: 'v2' },
      { file: 'v2-09-last-frame-polish.md', id: 'official-v2-last-frame-polish', usage: 'last_frame_polish', name: '尾帧润色', version: 'v2' },
    ]

    const insertOrIgnore = db.prepare(`
      INSERT OR IGNORE INTO prompt_templates (id, project_id, "usage", name, content, template_version, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `)

    let loaded = 0
    for (const item of registry) {
      const filePath = join(templatesDir, item.file)
      try {
        const content = readFileSync(filePath, 'utf8')
        if (content.trim()) {
          insertOrIgnore.run(item.id, null, item.usage, item.name, content, item.version)
          loaded++
        }
      } catch {
        console.error(`[db] template file not found: ${filePath}`)
      }
    }
    console.log(`[db] loaded ${loaded}/${registry.length} official prompt templates`)

    // 模板版本升级：仅当官方模板版本号升级时才覆盖
    const tplVersionRow = db.prepare("SELECT value FROM settings WHERE key = 'template_data_version'").get() as { value: string } | undefined
    const currentTplVersion = parseInt(tplVersionRow?.value || '0', 10)
    const TPL_DATA_VERSION = 11 // v11: 场景图改为单张全景大图（非四象限）
    if (currentTplVersion < TPL_DATA_VERSION) {
      console.log(`[db] Template data upgrade: v${currentTplVersion} → v${TPL_DATA_VERSION}`)
      for (const item of registry) {
        const filePath = join(templatesDir, item.file)
        try {
          const content = readFileSync(filePath, 'utf8')
          if (content.trim()) {
            db.prepare(`UPDATE prompt_templates SET content = ?, template_version = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(content, item.version, item.id)
          }
        } catch { /* skip */ }
      }
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('template_data_version', ?)").run(String(TPL_DATA_VERSION))
    }
  } catch (e) {
    console.error('[db] 加载官方模板失败:', e)
  }

  // 迁移：给已有表添加新字段（不 DROP 重建）
  const migrations = [
    { table: 'projects', column: 'script_text', type: 'TEXT' },
    { table: 'projects', column: 'era', type: 'TEXT' },
    { table: 'projects', column: 'negative_prompt', type: 'TEXT' },
    { table: 'projects', column: 'model_config_json', type: 'TEXT' },
    { table: 'projects', column: 'parent_project_id', type: 'TEXT' },
    { table: 'shots', column: 'dialogue', type: 'TEXT' },
    { table: 'shots', column: 'first_frame_image_path', type: 'TEXT' },
    { table: 'shots', column: 'last_frame_image_path', type: 'TEXT' },
    { table: 'shots', column: 'video_path', type: 'TEXT' },
    { table: 'shots', column: 'voice_path', type: 'TEXT' },
    { table: 'characters', column: 'skin_images', type: 'TEXT' },
    { table: 'generation_tasks', column: 'started_at', type: 'TEXT' },
    { table: 'shot_images', column: 'type', type: 'TEXT' },
    { table: 'prompt_templates', column: 'template_version', type: "TEXT DEFAULT 'v1'" },
    { table: 'shots', column: 'shot_type', type: 'TEXT' },
    { table: 'shots', column: 'camera_movement', type: 'TEXT' },
    { table: 'shots', column: 'lighting_mood', type: 'TEXT' },
    { table: 'shots', column: 'character_actions', type: 'TEXT' },
    { table: 'shots', column: 'audio_prompt', type: 'TEXT' },
    { table: 'shots', column: 'grid_image_path', type: 'TEXT' },
    { table: 'shots', column: 'first_frame_prompt_zh', type: 'TEXT' },
    { table: 'shots', column: 'last_frame_prompt_zh', type: 'TEXT' },
    { table: 'shots', column: 'video_prompt_zh', type: 'TEXT' },
    { table: 'shots', column: 'narration', type: 'TEXT' },
    { table: 'shots', column: 'description_zh', type: 'TEXT' },
    { table: 'characters', column: 'description_zh', type: 'TEXT' },
    { table: 'scenes', column: 'description_zh', type: 'TEXT' },
    { table: 'props', column: 'description_zh', type: 'TEXT' },
    { table: 'characters', column: 'voice_preset', type: 'TEXT' }
  ]

  for (const m of migrations) {
    try {
      db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`)
    } catch {
      // 字段已存在，忽略错误
    }
  }

  // M1-03: 迁移 scenes 表的 prompt 列
  // description 就是提示词主体，不需要单独的 prompt 列
  try {
    const colInfo = db.prepare(`PRAGMA table_info(scenes)`).all() as { name: string }[]
    const hasPrompt = colInfo.some((c) => c.name === 'prompt')

    if (hasPrompt) {
      // 检查 prompt 列是否有实际数据
      const countRow = db
        .prepare(`SELECT COUNT(*) as c FROM scenes WHERE prompt IS NOT NULL AND TRIM(prompt) != ''`)
        .get() as { c: number }

      if (countRow.c > 0) {
        // 有数据：合并到 description，然后重建表去掉 prompt 列
        const fkState = db.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }
        db.exec(`PRAGMA foreign_keys = OFF`)
        db.exec(`BEGIN TRANSACTION`)

        db.exec(`
          UPDATE scenes SET description =
            CASE
              WHEN description IS NULL OR TRIM(description) = '' THEN prompt
              ELSE description || '\n\n[Prompt] ' || prompt
            END
          WHERE prompt IS NOT NULL AND TRIM(prompt) != ''
        `)

        db.exec(`
          CREATE TABLE scenes_new (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            reference_image TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `)

        db.exec(`
          INSERT INTO scenes_new (id, project_id, name, description, reference_image)
          SELECT id, project_id, name, description, reference_image FROM scenes
        `)

        db.exec(`DROP TABLE scenes`)
        db.exec(`ALTER TABLE scenes_new RENAME TO scenes`)

        db.exec(`COMMIT`)
        db.exec(`PRAGMA foreign_keys = ${fkState.foreign_keys}`)
      } else {
        // 无数据：尝试 DROP COLUMN（SQLite 3.35.0+ 支持）
        try {
          db.exec(`ALTER TABLE scenes DROP COLUMN prompt`)
        } catch {
          // 旧版本 SQLite 不支持 DROP COLUMN，重建表
          const fkState = db.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }
          db.exec(`PRAGMA foreign_keys = OFF`)
          db.exec(`BEGIN TRANSACTION`)

          db.exec(`
            CREATE TABLE scenes_new (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              name TEXT NOT NULL,
              description TEXT,
              reference_image TEXT,
              FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
          `)

          db.exec(`
            INSERT INTO scenes_new (id, project_id, name, description, reference_image)
            SELECT id, project_id, name, description, reference_image FROM scenes
          `)

          db.exec(`DROP TABLE scenes`)
          db.exec(`ALTER TABLE scenes_new RENAME TO scenes`)

          db.exec(`COMMIT`)
          db.exec(`PRAGMA foreign_keys = ${fkState.foreign_keys}`)
        }
      }
    }
  } catch (e) {
    console.error('迁移 scenes.prompt 失败:', e)
  }

  // M1-04: 从 description 中提取对话到 dialogue 列（历史数据修复）
  try {
    const countRow = db
      .prepare("SELECT COUNT(*) as c FROM shots WHERE description LIKE '%\n对白: %' AND (dialogue IS NULL OR dialogue = '')")
      .get() as { c: number }
    if (countRow.c > 0) {
      console.log(`[db] Extracting dialogue from ${countRow.c} shots...`)
      db.prepare(`
        UPDATE shots SET
          dialogue = TRIM(SUBSTR(description, INSTR(description, '\n对白: ') + 5)),
          description = TRIM(SUBSTR(description, 1, INSTR(description, '\n对白: ') - 1))
        WHERE description LIKE '%\n对白: %' AND (dialogue IS NULL OR dialogue = '')
      `).run()
      const remaining = db
        .prepare("SELECT COUNT(*) as c FROM shots WHERE description LIKE '%\n对白: %'")
        .get() as { c: number }
      console.log(`[db] Dialogue extracted, ${remaining.c} shots still have dialogue in description`)
    }
  } catch (e) {
    console.error('[db] Dialogue migration failed:', e)
  }

  // ===== 种子数据：13种风格模板 =====
  const styleCount = db.prepare('SELECT COUNT(*) as cnt FROM style_templates').get() as { cnt: number }
  if (styleCount.cnt === 0) {
    const styles = [
      { id: 'style-anime', name: '二次元动漫', key: 'anime', colorScheme: '#E8A838,#7EC8E3,#FFB6C1,#6B5B95,#FFFFFF' },
      { id: 'style-photoreal', name: '写实摄影', key: 'photorealistic', colorScheme: '#D4A574,#2D5016,#87CEEB,#A89F91,#8B4513' },
      { id: 'style-3d', name: '3D渲染', key: '3d_render', colorScheme: '#4A90D9,#F5A623,#7ED321,#BD10E0,#FFFFFF' },
      { id: 'style-watercolor', name: '水彩插画', key: 'watercolor', colorScheme: '#F8E3C4,#B8D4E3,#E8C4D8,#C4E3D4,#F5F0E8' },
      { id: 'style-cyberpunk', name: '赛博朋克', key: 'cyberpunk', colorScheme: '#00FFFF,#FF00FF,#FFFF00,#00FF00,#1A1A2E' },
      { id: 'style-pixel', name: '像素复古', key: 'pixel_art', colorScheme: '#FF6B6B,#4ECDC4,#FFE66D,#292F36,#F7FFF7' },
      { id: 'style-oil', name: '油画质感', key: 'oil_painting', colorScheme: '#8B4513,#DAA520,#2F4F4F,#CD853F,#F5DEB3' },
      { id: 'style-flat', name: '扁平插画', key: 'flat_illustration', colorScheme: '#FF6B6B,#4ECDC4,#45B7D1,#F7DC6F,#2C3E50' },
      { id: 'style-ghibli', name: '吉卜力', key: 'ghibli', colorScheme: '#87CEEB,#98FB98,#FFB6C1,#F0E68C,#FFF8DC' },
      { id: 'style-comic', name: '美漫风格', key: 'american_comics', colorScheme: '#FF0000,#0000FF,#FFFF00,#000000,#FFFFFF' },
      { id: 'style-dark', name: '暗黑奇幻', key: 'dark_fantasy', colorScheme: '#1A1A2E,#4A0030,#0D1B2A,#3D0C11,#C0C0C0' },
      { id: 'style-healing', name: '日系治愈', key: 'iyashikei', colorScheme: '#FDF5E6,#E8F5E9,#FFF3E0,#E3F2FD,#FFE0B2' },
      { id: 'style-ink', name: '中国水墨', key: 'ink_wash', colorScheme: '#1A1A1A,#4A4A4A,#8B8B8B,#C0C0C0,#F5F0E8' },
      { id: 'style-xianxia', name: '中国仙侠', key: 'xianxia', colorScheme: '#F5F0E8,#7BC5A8,#DAA520,#7EC8E3,#2C1810' },
    ]

    const assetsBase = 'assets/style-references'
    const folders: Record<string, string> = {
      anime: '1.二次元动漫（Anime）',
      photorealistic: '2.写实摄影（Photorealistic）',
      '3d_render': '3.3D渲染（3D Render）',
      watercolor: '4.水彩插画（Watercolor）',
      cyberpunk: '5.赛博朋克（Cyberpunk）',
      pixel_art: '6.像素复古（Pixel Art Retro）',
      oil_painting: '7.油画质感（Oil Painting）',
      flat_illustration: '8.扁平插画（Flat Illustration）',
      ghibli: '9.吉卜力（Studio Ghibli）',
      american_comics: '10.美漫风格（American Comics）',
      dark_fantasy: '11.暗黑奇幻（Dark Fantasy）',
      iyashikei: '12.日系治愈（Japanese HealingIyashikei）',
      ink_wash: '13.中国水墨（Chinese Ink Wash）',
      xianxia: '14.中国仙侠（Chinese Xianxia）',
    }

    const insert = db.prepare(
      `INSERT INTO style_templates (id, name, key, prompt, negative_prompt, character_ref_image, scene_ref_image, grid_ref_image, style_ref_image, color_scheme, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const insertAll = db.transaction(() => {
      styles.forEach((s, i) => {
        const folder = folders[s.key]
        const charRef = `${assetsBase}/${folder}/角色布局参考图.png`
        const sceneRef = `${assetsBase}/${folder}/场景布局参考图.png`
        const gridRef = `${assetsBase}/${folder}/宫格排版参考图.png`
        const styleRef = `${assetsBase}/${folder}/风格参考图.png`
        insert.run(s.id, s.name, s.key, null, null, charRef, sceneRef, gridRef, styleRef, s.colorScheme, i)
      })
    })
    insertAll()
    console.log('[db] 已插入13种风格模板参考图')
  }

  return db
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}
