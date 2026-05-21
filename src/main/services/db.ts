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
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      reference_image TEXT,
      prompt TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      reference_image TEXT,
      prompt TEXT,
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
      first_frame_prompt TEXT,
      last_frame_prompt TEXT,
      video_prompt TEXT,
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

  // 迁移：给 projects 表添加 script_text 字段（如果不存在）
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN script_text TEXT`)
  } catch {
    // 字段已存在，忽略错误
  }

  return db
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}
