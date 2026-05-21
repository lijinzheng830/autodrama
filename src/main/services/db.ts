import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      usage TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_images (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scene_images (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prop_images (
      id TEXT PRIMARY KEY,
      prop_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (prop_id) REFERENCES props(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shot_images (
      id TEXT PRIMARY KEY,
      shot_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shot_videos (
      id TEXT PRIMARY KEY,
      shot_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      is_selected INTEGER DEFAULT 0,
      has_new_badge INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE
    );
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

  // 插入官方预设模板（失败则忽略，template.ts 中有硬编码兜底）
  try {
    const insertTemplate = db.prepare(`
      INSERT OR IGNORE INTO prompt_templates (id, project_id, "usage", name, content, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)
    insertTemplate.run(
      'official-shot-image-standard',
      '',
      'shot_image',
      '标准分镜模板',
      '【占位】标准分镜描述模板，用于生成常规分镜图像。包含场景描述、角色动作、镜头角度等要素。',
      1
    )
    insertTemplate.run(
      'official-shot-image-detailed',
      '',
      'shot_image',
      '精细镜头拆分模板',
      '【占位】精细镜头拆分模板，用于详细拆解每个镜头的构图、角色表情、光影效果和动作细节。',
      1
    )
    insertTemplate.run(
      'official-shot-image-pure',
      '',
      'shot_image',
      '纯分镜模板',
      '【占位】纯分镜模板，不包含额外描述，仅输出分镜的基本画面信息。',
      1
    )
    insertTemplate.run(
      'official-shot-video',
      '',
      'shot_video',
      '短视频制作模板',
      '【占位】短视频制作模板，用于生成视频分镜描述，包含运镜方式、时长、转场等要素。',
      1
    )
  } catch {
    // 外键约束或其他错误，template.ts 中的硬编码常量兜底
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
    { table: 'characters', column: 'skin_images', type: 'TEXT' }
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
    const colInfo = db.prepare(`PRAGMA table_info(scenes)`).all() as any[]
    const hasPrompt = colInfo.some((c) => c.name === 'prompt')

    if (hasPrompt) {
      // 检查 prompt 列是否有实际数据
      const countRow = db
        .prepare(
          `SELECT COUNT(*) as c FROM scenes WHERE prompt IS NOT NULL AND TRIM(prompt) != ''`
        )
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

  return db
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}
