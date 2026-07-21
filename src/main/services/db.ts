import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'

let db: Database.Database | null = null
import { logger } from '../utils/logger'

export function initDatabase(): Database.Database {
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'autodrama.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

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
      parse_group INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      shot_index INTEGER NOT NULL,
      storyboard_position INTEGER,
      description TEXT,
      description_en TEXT,
      description_zh TEXT,
      dialogue TEXT,
      narration TEXT,
      inner_monologue TEXT,
      video_prompt TEXT,
      video_prompt_zh TEXT,
      poster_image_path TEXT,
      video_path TEXT,
      duration_seconds REAL,
      shot_type TEXT,
      camera_movement TEXT,
      camera_angle TEXT,
      lighting_mood TEXT,
      character_actions TEXT,
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
      source_url TEXT,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scene_images (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      source_url TEXT,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prop_images (
      id TEXT PRIMARY KEY,
      prop_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      source_url TEXT,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (prop_id) REFERENCES props(id) ON DELETE CASCADE
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
    logger.error('迁移 prompt_templates 外键失败:', e)
  }

  // 官方模板种子注入：首次运行或模板为空时从文件灌入 DB（前端弹窗依赖 DB 读取）
  try {
    const tplCount = db.prepare('SELECT COUNT(*) as cnt FROM prompt_templates WHERE is_default = 1').get() as { cnt: number }
    if (tplCount.cnt === 0) {
      const tplDir = join(app.getAppPath(), 'src', 'main', 'data', 'prompt-templates')
      const tplRegistry: Array<{ file: string; id: string; usage: string; name: string; version: string }> = [
        { file: 'v0-01-script-parse.md', id: 'official-v0-script-parse', usage: 'script_parse', name: 'AI 剧本解析', version: 'v0' },
        { file: 'v1-04-character-image.md', id: 'official-v1-character-image', usage: 'character_image', name: 'AI 角色参考图', version: 'v1' },
        { file: 'v1-05-scene-image.md', id: 'official-v1-scene-image', usage: 'scene_image', name: 'AI 场景参考图', version: 'v1' },
        { file: 'v1-06-prop-image.md', id: 'official-v1-prop-image', usage: 'prop_image', name: 'AI 道具参考图', version: 'v1' },
        { file: 'v1-07-grid-storyboard.md', id: 'official-v1-grid-storyboard', usage: 'grid_storyboard', name: 'AI 九宫格故事板', version: 'v1' },
        { file: 'v1-12-asset-extract.md', id: 'official-v1-asset-extract', usage: 'asset_extract', name: 'AI 资产提取', version: 'v1' },
      ]
      const insertStmt = db.prepare(
        "INSERT OR REPLACE INTO prompt_templates (id, project_id, usage, name, content, template_version, is_default, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))"
      )
      let inserted = 0
      for (const t of tplRegistry) {
        try {
          const content = readFileSync(join(tplDir, t.file), 'utf8').trim()
          if (content) {
            insertStmt.run(t.id, t.usage, t.name, content, t.version)
            inserted++
          }
        } catch { /* 文件不存在则跳过 */ }
      }
      if (inserted > 0) logger.info(`[db] 已注入 ${inserted} 条官方模板`)
    }
  } catch (e) {
    logger.error('[db] 模板种子注入失败:', e)
  }

  // 迁移：给已有表添加新字段（不 DROP 重建）
  const migrations = [
    { table: 'projects', column: 'script_text', type: 'TEXT' },
    { table: 'projects', column: 'era', type: 'TEXT' },
    { table: 'projects', column: 'negative_prompt', type: 'TEXT' },
    { table: 'projects', column: 'model_config_json', type: 'TEXT' },
    { table: 'projects', column: 'parent_project_id', type: 'TEXT' },
    { table: 'shots', column: 'dialogue', type: 'TEXT' },
    { table: 'shots', column: 'video_path', type: 'TEXT' },
    { table: 'shots', column: 'poster_image_path', type: 'TEXT' },
    { table: 'shots', column: 'poster_source_url', type: 'TEXT' },
    { table: 'shots', column: 'poster_history', type: 'TEXT' },
    { table: 'shots', column: 'storyboard_position', type: 'INTEGER' },
    { table: 'shots', column: 'video_prompt_zh', type: 'TEXT' },
    { table: 'characters', column: 'skin_images', type: 'TEXT' },
    { table: 'generation_tasks', column: 'started_at', type: 'TEXT' },
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
    { table: 'characters', column: 'voice_preset', type: 'TEXT' },
    { table: 'shots', column: 'description_en', type: 'TEXT' },
    { table: 'shots', column: 'inner_monologue', type: 'TEXT' },
    { table: 'chapters', column: 'parse_group', type: 'INTEGER DEFAULT 0' },
    { table: 'character_images', column: 'source_url', type: 'TEXT' },
    { table: 'scene_images', column: 'source_url', type: 'TEXT' },
    { table: 'prop_images', column: 'source_url', type: 'TEXT' },
    { table: 'characters', column: 'aspect_ratio', type: "TEXT DEFAULT '16:9'" },
    { table: 'characters', column: 'character_type', type: "TEXT DEFAULT 'human'" },
    { table: 'scenes', column: 'aspect_ratio', type: "TEXT DEFAULT '16:9'" },
    { table: 'props', column: 'aspect_ratio', type: "TEXT DEFAULT '16:9'" },
    { table: 'shots', column: 'focal_length', type: 'TEXT' },
    { table: 'shots', column: 'focus_point', type: 'TEXT' },
    { table: 'shots', column: 'sound_hint', type: 'TEXT' },
    { table: 'shots', column: 'narrative_function', type: 'TEXT' },
    { table: 'shots', column: 'camera_angle', type: 'TEXT' },
    { table: 'shots', column: 'seedance_params', type: 'TEXT' },
    { table: 'characters', column: 'time_period', type: 'TEXT' },
    { table: 'scenes', column: 'time_period', type: 'TEXT' },
    { table: 'scenes', column: 'environment_effects', type: 'TEXT' },
    { table: 'scenes', column: 'reference_objects', type: 'TEXT' },
    { table: 'scenes', column: 'time_weather', type: 'TEXT' },
    { table: 'props', column: 'initial_state', type: 'TEXT' },
    { table: 'props', column: 'state_progression', type: 'TEXT' }
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
    logger.error('迁移 scenes.prompt 失败:', e)
  }

  // M1-04: 从 description 中提取对话到 dialogue 列（历史数据修复）
  try {
    const countRow = db
      .prepare("SELECT COUNT(*) as c FROM shots WHERE description LIKE '%\n对白: %' AND (dialogue IS NULL OR dialogue = '')")
      .get() as { c: number }
    if (countRow.c > 0) {
      logger.info(`[db] Extracting dialogue from ${countRow.c} shots...`)
      db.prepare(`
        UPDATE shots SET
          dialogue = TRIM(SUBSTR(description, INSTR(description, '\n对白: ') + 5)),
          description = TRIM(SUBSTR(description, 1, INSTR(description, '\n对白: ') - 1))
        WHERE description LIKE '%\n对白: %' AND (dialogue IS NULL OR dialogue = '')
      `).run()
      const remaining = db
        .prepare("SELECT COUNT(*) as c FROM shots WHERE description LIKE '%\n对白: %'")
        .get() as { c: number }
      logger.info(`[db] Dialogue extracted, ${remaining.c} shots still have dialogue in description`)
    }
  } catch (e) {
    logger.error('[db] Dialogue migration failed:', e)
  }

  // ===== 种子数据：13种风格模板 =====
  const styleCount = db.prepare('SELECT COUNT(*) as cnt FROM style_templates').get() as { cnt: number }
  if (styleCount.cnt === 0) {
    const styles = [
      { id: 'style-photoreal', name: '写实摄影', key: 'photorealistic', colorScheme: '#D4A574,#2D5016,#87CEEB,#A89F91,#8B4513' },
      { id: 'style-xianxia', name: '仙侠动漫', key: 'xianxia', colorScheme: '#F0E8D8,#9BC1BC,#DAA520,#7EC8E3,#3C2A20' },
      { id: 'style-3d', name: '3D渲染', key: '3d_render', colorScheme: '#4A90D9,#F5A623,#7ED321,#BD10E0,#FFFFFF' },
      { id: 'style-cyberpunk', name: '赛博朋克', key: 'cyberpunk', colorScheme: '#00FFFF,#FF00FF,#FFFF00,#00FF00,#1A1A2E' },
      { id: 'style-anime', name: '二次元动漫', key: 'anime', colorScheme: '#E8A838,#7EC8E3,#FFB6C1,#6B5B95,#FFFFFF' },
      { id: 'style-watercolor', name: '水彩插画', key: 'watercolor', colorScheme: '#F8E3C4,#B8D4E3,#E8C4D8,#C4E3D4,#F5F0E8' },
      { id: 'style-pixel', name: '像素复古', key: 'pixel_art', colorScheme: '#FF6B6B,#4ECDC4,#FFE66D,#292F36,#F7FFF7' },
      { id: 'style-oil', name: '油画质感', key: 'oil_painting', colorScheme: '#8B4513,#DAA520,#2F4F4F,#CD853F,#F5DEB3' },
      { id: 'style-flat', name: '扁平插画', key: 'flat_illustration', colorScheme: '#FF6B6B,#4ECDC4,#45B7D1,#F7DC6F,#2C3E50' },
      { id: 'style-ghibli', name: '吉卜力', key: 'ghibli', colorScheme: '#87CEEB,#98FB98,#FFB6C1,#F0E68C,#FFF8DC' },
      { id: 'style-comic', name: '美漫风格', key: 'american_comics', colorScheme: '#FF0000,#0000FF,#FFFF00,#000000,#FFFFFF' },
      { id: 'style-dark', name: '暗黑奇幻', key: 'dark_fantasy', colorScheme: '#1A1A2E,#4A0030,#0D1B2A,#3D0C11,#C0C0C0' },
      { id: 'style-healing', name: '日系治愈', key: 'iyashikei', colorScheme: '#FDF5E6,#E8F5E9,#FFF3E0,#E3F2FD,#FFE0B2' },
      { id: 'style-ink', name: '中国水墨', key: 'ink_wash', colorScheme: '#1A1A1A,#4A4A4A,#8B8B8B,#C0C0C0,#F5F0E8' },
    ]

    const assetsBase = join(app.getPath('userData'), 'style-references')
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
      xianxia: "14.仙侠动漫（Xianxia animation）",
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
// Copy style reference images to userData    const srcDir = join(__dirname, '..', 'renderer', 'style-references')    const destDir = join(app.getPath('userData'), 'style-references')    if (existsSync(srcDir) && !existsSync(destDir)) {      try {        mkdirSync(destDir, { recursive: true })        const folders = readdirSync(srcDir, { withFileTypes: true }).filter(d => d.isDirectory())        for (const f of folders) {          const dstFolder = join(destDir, f.name)          mkdirSync(dstFolder, { recursive: true })          const files = readdirSync(join(srcDir, f.name))          for (const file of files) {            copyFileSync(join(srcDir, f.name, file), join(dstFolder, file))          }        }        logger.info('[db] 风格参考图已复制到 userData')      } catch (e) { logger.error('[db] 复制风格参考图失败:', e) }    }
    logger.info('[db] 已插入13种风格模板参考图')
  }

  // 默认model_routes → 无边界AI（首次运行自动注入）
  // 迁移：已有 model_routes 补上 grid_storyboard
  try {
    const routesRow = db.prepare("SELECT value FROM settings WHERE key = 'model_routes'").get() as { value: string } | undefined
    if (routesRow?.value) {
      const routes = JSON.parse(routesRow.value)
      if (!routes.grid_storyboard) {
        routes.grid_storyboard = { model: 'lk888:gpt-image-2', channel: 'lk888' }
        db.prepare("UPDATE settings SET value = ? WHERE key = 'model_routes'").run(JSON.stringify(routes))
        logger.info('[db] model_routes 已补上 grid_storyboard')
      }
      if (routes.video?.model === 'lk888:kwvideo-v2') {
        routes.video = { model: 'lk888:kwvideo-v2-ref', channel: 'lk888' }
        db.prepare("UPDATE settings SET value = ? WHERE key = 'model_routes'").run(JSON.stringify(routes))
        logger.info('[db] model_routes 视频模型已迁移到 kwvideo-v2-ref')
      }
    }
  } catch {}

  // 供应商自动注入/更新（DashScope + Apimart + HCC + Manxueapi）
  const provRaw = db.prepare("SELECT value FROM settings WHERE key = 'providers'").get() as { value: string } | undefined
  let providers: any[] = []
  let providersChanged = false
  const isFirstRun = !provRaw?.value
  if (provRaw?.value) {
    try { providers = JSON.parse(provRaw.value) } catch { providers = [] }
  }

  // 去重：同 key 只保留一个有 apiKey 的；lk888 → wubianjie 合并
  const deduped: any[] = []
  const seen = new Set<string>()
  for (const p of providers) {
    const k = p.key === 'lk888' ? 'wubianjie' : p.key  // lk888 → wubianjie 统一
    if (k === 'lk888') continue
    if (seen.has(k)) {
      // 合并：已有记录没 apiKey 但新记录有 → 替换；已有记录 apiKey 优先保留
      const existing = deduped.find(d => d.key === k)
      if (existing && !existing.apiKey && p.apiKey) {
        Object.assign(existing, p)
      }
      // 合并模型列表
      if (existing && p.models) {
        const existKeys = new Set(existing.models?.map((m: any) => m.key) || [])
        for (const m of p.models) {
          if (!existKeys.has(m.key)) { existing.models.push(m); existKeys.add(m.key) }
        }
      }
      providersChanged = true
      logger.info('[db] 供应商去重合并:', k)
    } else {
      if (p.key !== k) { p.key = k; providersChanged = true }
      seen.add(k)
      deduped.push(p)
    }
  }
  if (deduped.length < providers.length) {
    providers = deduped
    providersChanged = true
    logger.info(`[db] 供应商去重: ${providers.length}个（原${deduped.length}个唯一）`)
  }

  // DashScope 供应商创建/更新（Key + Wan2.7 模型）
  const dsIdx = providers.findIndex((p: any) => p.key === 'dashscope')
  if (dsIdx >= 0) {
    if (!providers[dsIdx].apiKey) {
      providers[dsIdx].apiKey = 'sk-e2c0971d85f44082818925b2b0e043e0'
      providersChanged = true
      logger.info('[db] DashScope API Key 已注入')
    }
    const dsModels = providers[dsIdx].models || []
    // 补 qwen-image-2.0
    if (!dsModels.some((m: any) => m.key === 'qwen-image-2.0')) {
      dsModels.push({ key: 'qwen-image-2.0', name: 'Qwen Image 2.0 图编', type: 'image', free: true })
      providersChanged = true
    }
    if (!dsModels.some((m: any) => m.key === 'qwen-image-2.0-pro')) {
      dsModels.push({ key: 'qwen-image-2.0-pro', name: 'Qwen Image 2.0 Pro 图编', type: 'image', free: false })
      providersChanged = true
    }
    if (!dsModels.some((m: any) => m.key === 'wan2.7-i2v-2026-04-25')) {
      dsModels.push({ key: 'wan2.7-i2v-2026-04-25', name: 'Wan2.7 图生视频', type: 'video', free: true })
      providersChanged = true
      logger.info('[db] DashScope Wan2.7 模型已添加')
    }
    if (!dsModels.some((m: any) => m.key === 'qwen3.7-plus')) {
      dsModels.push({ key: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', type: 'text', free: false })
      providersChanged = true
      logger.info('[db] DashScope Qwen 3.7 Plus 模型已添加')
    }
  } else if (isFirstRun) {
    // DashScope 不存在，创建它
    providers.push({
      key: 'dashscope', name: '阿里云 DashScope', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-e2c0971d85f44082818925b2b0e043e0',
      models: [
        { key: 'qwen3.6-flash', name: 'Qwen 3.6 Flash', type: 'text', free: false },
        { key: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', type: 'text', free: false },
        { key: 'qwen-plus', name: 'Qwen Plus', type: 'text', free: false },
        { key: 'qwen-image-2.0', name: 'Qwen Image 2.0 图编', type: 'image', free: true },
        { key: 'qwen-image-2.0-pro', name: 'Qwen Image 2.0 Pro 图编', type: 'image', free: false },
        { key: 'wan2.7-i2v-2026-04-25', name: 'Wan2.7 图生视频', type: 'video', free: true }
      ],
      implemented: true
    })
    providersChanged = true
    logger.info('[db] DashScope 供应商已创建')
  }

  // Apimart 供应商创建/更新
  const apimartProviderDef = {
    key: 'apimart', name: 'Apimart', baseURL: 'https://api.apib.ai/v1',
    apiKey: 'sk-g1aNkrsWllhgl3ObWCRzdbfE6Ai713Zt3u5x5Pt6KCGjmWaK',
    models: [{ key: 'gpt-image-2-official', name: 'GPT-Image-2 Official', type: 'image', free: false }, { key: 'doubao-seedance-2.0', name: 'doubao-seedance-2.0', type: 'video', free: false }, { key: 'grok-imagine-1.5-video-apimart', name: 'Grok Imagine Video 1.5', type: 'video', free: false }],
    implemented: true
  }
  const amIdx = providers.findIndex((p: any) => p.key === 'apimart')
  if (amIdx >= 0) {
    const amModels = providers[amIdx].models || []
    if (!amModels.some((m: any) => m.key === 'gpt-image-2-official')) {
      amModels.push({ key: 'gpt-image-2-official', name: 'GPT-Image-2 Official', type: 'image', free: false })
      providersChanged = true
    }
    if (!amModels.some((m: any) => m.key === 'doubao-seedance-2.0')) {
      amModels.push({ key: 'doubao-seedance-2.0', name: 'doubao-seedance-2.0', type: 'video', free: false })
      providersChanged = true
    }
    if (!amModels.some((m: any) => m.key === 'grok-imagine-1.5-video-apimart')) {
      amModels.push({ key: 'grok-imagine-1.5-video-apimart', name: 'Grok Imagine Video 1.5', type: 'video', free: false })
      providersChanged = true
      logger.info('[db] Apimart Grok 视频模型已添加')
    }
  } else if (isFirstRun) {
    providers.push(apimartProviderDef)
    providersChanged = true
    logger.info('[db] Apimart 供应商已自动注入')
  }

  // 无边界AI 供应商创建/更新（GPT-Image-2 + Grok 视频模型）
  const wbIdx = providers.findIndex((p: any) => p.key === 'wubianjie')
  if (wbIdx >= 0) {
    const wbModels = providers[wbIdx].models || []
    if (!wbModels.some((m: any) => m.key === 'gpt-image-2')) {
      wbModels.push({ key: 'gpt-image-2', name: 'GPT-Image-2', type: 'image', free: false })
      providersChanged = true
    }
    if (!wbModels.some((m: any) => m.key === 'grok-imagine-1.5-video-apimart-preview')) {
      wbModels.push({ key: 'grok-imagine-1.5-video-apimart-preview', name: 'grok-video-3.5', type: 'video', free: false })
      providersChanged = true
      logger.info('[db] 无边界AI Grok 视频模型已添加')
    }
  } else if (isFirstRun) {
    providers.push({
      key: 'wubianjie', name: '无边界AI', baseURL: 'https://api.lk888.ai/api/v1',
      apiKey: '',
      models: [
        { key: 'gpt-image-2', name: 'GPT-Image-2', type: 'image', free: false },
        { key: 'grok-imagine-1.5-video-apimart-preview', name: 'grok-video-3.5', type: 'video', free: false }
      ],
      implemented: true
    })
    providersChanged = true
    logger.info('[db] 无边界AI 供应商已自动注入')
  }

  // HCC (HermesRoute) 供应商创建/更新
  const hccIdx = providers.findIndex((p: any) => p.key === 'hcc')
  if (hccIdx >= 0) {
    const hccModels = providers[hccIdx].models || []
    if (!hccModels.some((m: any) => m.key === 'gpt-5.5')) {
      hccModels.push({ key: 'gpt-5.5', name: 'GPT-5.5', type: 'text', free: false })
      providersChanged = true
    }
    if (!hccModels.some((m: any) => m.key === 'gpt-5.4')) {
      hccModels.push({ key: 'gpt-5.4', name: 'GPT-5.4', type: 'text', free: false })
      providersChanged = true
    }
    if (!hccModels.some((m: any) => m.key === 'gpt-image-2')) {
      hccModels.push({ key: 'gpt-image-2', name: 'GPT-Image-2', type: 'image', free: false })
      providersChanged = true
    }
    if (!hccModels.some((m: any) => m.key === 'seedance-2-fast')) {
      hccModels.push({ key: 'seedance-2-fast', name: 'Seedance 2 Fast', type: 'video', free: false })
      providersChanged = true
      logger.info('[db] HCC Seedance 视频模型已添加')
    }
  } else if (isFirstRun) {
    providers.push({
      key: 'hcc', name: 'HCC (HermesRoute)', baseURL: 'https://hermesroute.vwuxiameng.cn/v1',
      apiKey: '',
      models: [
        { key: 'gpt-5.5', name: 'GPT-5.5', type: 'text', free: false },
        { key: 'gpt-5.4', name: 'GPT-5.4', type: 'text', free: false },
        { key: 'claude-opus-4-8', name: 'Claude Opus 4.8', type: 'text', free: false },
        { key: 'claude-opus-4-7', name: 'Claude Opus 4.7', type: 'text', free: false },
        { key: 'claude-opus-4-6', name: 'Claude Opus 4.6', type: 'text', free: false },
        { key: 'gpt-image-2', name: 'GPT-Image-2', type: 'image', free: false },
        { key: 'seedance-2-fast', name: 'Seedance 2 Fast', type: 'video', free: false }
      ],
      implemented: true
    })
    providersChanged = true
    logger.info('[db] HCC 供应商已自动注入')
  }

  // Manxueapi (满血API) 供应商
  const mxIdx = providers.findIndex((p: any) => p.key === 'manxueapi')
  if (mxIdx >= 0) {
    const mxModels = providers[mxIdx].models || []
    if (!mxModels.some((m: any) => m.key === 'vyro-seedance-2-fast')) {
      mxModels.push({ key: 'vyro-seedance-2-fast', name: 'Vyro Seedance 2.0 Fast', type: 'video', free: false })
      providersChanged = true
      logger.info('[db] Manxueapi Vyro Seedance 视频模型已添加')
    }
  } else if (isFirstRun) {
    const { randomUUID } = require('crypto') as typeof import('crypto')
    providers.push({
      id: randomUUID(), key: 'manxueapi', name: '满血API', baseURL: 'https://manxueapi.com/v1',
      apiKey: '',
      models: [
        { key: 'vyro-seedance-2-fast', name: 'Vyro Seedance 2.0 Fast', type: 'video', free: false }
      ],
      implemented: true
    })
    providersChanged = true
    logger.info('[db] 满血API 供应商已自动注入')
  }

  if (providersChanged) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('providers', ?)").run(JSON.stringify(providers))
  }

  // 默认路由 → Apimart（首次运行或从 lk888 迁移）
  const routesRow = db.prepare("SELECT value FROM settings WHERE key = 'model_routes'").get() as { value: string } | undefined
  if (!routesRow) {
    const modelRoutes = {
      language_model: { model: 'dashscope:deepseek-chat', channel: 'dashscope' },
      character_image: { model: 'apimart:gpt-image-2-official', channel: 'apimart' },
      scene_image: { model: 'apimart:gpt-image-2-official', channel: 'apimart' },
      prop_image: { model: 'apimart:gpt-image-2-official', channel: 'apimart' },
      grid_storyboard: { model: 'apimart:gpt-image-2-official', channel: 'apimart' },
      video: { model: 'apimart:doubao-seedance-2.0', channel: 'apimart' }
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('model_routes', ?)").run(JSON.stringify(modelRoutes))
    logger.info('[db] 默认路由已写入（Apimart）')
  } else {
    // 已有配置：将 lk888 路由迁移到 apimart
    try {
      const routes = JSON.parse(routesRow.value)
      let migrated = false
      for (const key of ['character_image', 'scene_image', 'prop_image', 'grid_storyboard']) {
        if (routes[key]?.channel === 'lk888' || routes[key]?.channel === 'apimart') {
          routes[key] = { model: 'apimart:gpt-image-2-official', channel: 'apimart' }
          migrated = true
        }
      }
      if (routes.video?.channel === 'lk888') {
        routes.video = { model: 'apimart:doubao-seedance-2.0', channel: 'apimart' }
        migrated = true
      }
      if (migrated) {
        db.prepare("UPDATE settings SET value = ? WHERE key = 'model_routes'").run(JSON.stringify(routes))
        logger.info('[db] 路由已从 lk888 迁移到 Apimart')
      }
    } catch { /* ignore parse errors */ }
  }
  // 启动时清理孤儿数据 + 修复历史数据
  const d = db
  if (d) {
  try {
    // 更新角色图模板：Style 提到最前面
    try {
      const tplPath = join(app.getAppPath(), 'src', 'main', 'data', 'prompt-templates', 'v1-04-character-image.md')
      const newContent = readFileSync(tplPath, 'utf8').trim()
      if (newContent) {
        d.prepare("UPDATE prompt_templates SET content = ?, updated_at = datetime('now','localtime') WHERE id = 'official-v1-character-image' AND content != ?").run(newContent, newContent)
      }
      const sceneTplPath = join(app.getAppPath(), 'src', 'main', 'data', 'prompt-templates', 'v1-05-scene-image.md')
      const newSceneContent = readFileSync(sceneTplPath, 'utf8').trim()
      if (newSceneContent) {
        d.prepare("UPDATE prompt_templates SET content = ?, updated_at = datetime('now','localtime') WHERE id = 'official-v1-scene-image' AND content != ?").run(newSceneContent, newSceneContent)
      }
    } catch {}

    // 修复历史：清掉同一镜头中与对白共存的旁白
    const mixedShots = d.prepare("SELECT COUNT(*) as c FROM shots WHERE dialogue IS NOT NULL AND dialogue != '' AND narration IS NOT NULL AND narration != ''").get() as { c: number }
    logger.info(`[db] Startup scan: ${mixedShots.c} shots with mixed dialogue+narration`)
    if (mixedShots.c > 0) {
      d.prepare("UPDATE shots SET narration = '' WHERE dialogue IS NOT NULL AND dialogue != '' AND narration IS NOT NULL AND narration != ''").run()
      logger.info(`[db] Fixed ${mixedShots.c} shots — narration cleared`)
    }
    const orphanChars = d.prepare("SELECT COUNT(*) as c FROM characters WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL").get() as { c: number }
    const orphanScenes = d.prepare("SELECT COUNT(*) as c FROM scenes WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL").get() as { c: number }
    const orphanProps = d.prepare("SELECT COUNT(*) as c FROM props WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL").get() as { c: number }
    const orphanChapters = d.prepare("SELECT COUNT(*) as c FROM chapters WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL").get() as { c: number }
    const orphanShots = d.prepare("SELECT COUNT(*) as c FROM shots WHERE chapter_id NOT IN (SELECT id FROM chapters)").get() as { c: number }
    const orphanCharImgs = d.prepare("SELECT COUNT(*) as c FROM character_images WHERE character_id NOT IN (SELECT id FROM characters)").get() as { c: number }
    const orphanSceneImgs = d.prepare("SELECT COUNT(*) as c FROM scene_images WHERE scene_id NOT IN (SELECT id FROM scenes)").get() as { c: number }
    const orphanTasks = d.prepare("SELECT COUNT(*) as c FROM generation_tasks WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL").get() as { c: number }
    const total = orphanChars.c + orphanScenes.c + orphanProps.c + orphanChapters.c + orphanShots.c + orphanCharImgs.c + orphanSceneImgs.c + orphanTasks.c
    logger.info(`[db] Startup scan: ${total} total orphan records`)
    if (total > 0) {
      d.transaction(() => {
        for (const s of d.prepare("SELECT id FROM shots WHERE chapter_id NOT IN (SELECT id FROM chapters)").all() as { id: string }[]) {
          d.prepare('DELETE FROM shot_characters WHERE shot_id = ?').run(s.id)
          d.prepare('DELETE FROM shot_scenes WHERE shot_id = ?').run(s.id)
          d.prepare('DELETE FROM shot_props WHERE shot_id = ?').run(s.id)
          d.prepare('DELETE FROM shot_videos WHERE shot_id = ?').run(s.id)
        }
        d.prepare('DELETE FROM generation_tasks WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL').run()
        d.prepare('DELETE FROM shots WHERE chapter_id NOT IN (SELECT id FROM chapters)').run()
        d.prepare('DELETE FROM chapters WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL').run()
        d.prepare('DELETE FROM character_images WHERE character_id NOT IN (SELECT id FROM characters)').run()
        d.prepare('DELETE FROM characters WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL').run()
        d.prepare('DELETE FROM scene_images WHERE scene_id NOT IN (SELECT id FROM scenes)').run()
        d.prepare('DELETE FROM scenes WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL').run()
        d.prepare('DELETE FROM prop_images WHERE prop_id NOT IN (SELECT id FROM props)').run()
        d.prepare('DELETE FROM props WHERE project_id NOT IN (SELECT id FROM projects) OR project_id IS NULL').run()
        logger.info('[db] Orphan records cleaned up')
      })()
    }
  } catch (e: any) { logger.warn('[db] Orphan cleanup error:', e.message) }
  }

  return db
// 全局默认provider/model（首次运行）
}


export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized")
  }
  return db
}
