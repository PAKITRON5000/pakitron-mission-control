// The local database (SQLite, through Node's built-in node:sqlite, no native modules). WAL mode so the app and the
// CLI can use it at the same time. Migrations only add: an update of the app never drops data.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { paths } from './paths'

export type DB = DatabaseSync

const MIGRATIONS: string[] = [
  // 1: base schema
  `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_snapshots (
    id INTEGER PRIMARY KEY, account TEXT NOT NULL, captured_at INTEGER NOT NULL,
    five_pct REAL, five_resets INTEGER, week_pct REAL, week_resets INTEGER, model TEXT, session_id TEXT, source TEXT NOT NULL,
    UNIQUE(account, captured_at)
  );
  CREATE INDEX IF NOT EXISTS usage_by_account ON usage_snapshots(account, captured_at);
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, ext_id TEXT, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, section TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 2, owner TEXT, source TEXT NOT NULL,
    source_file TEXT, source_line INTEGER, mark TEXT, verified INTEGER NOT NULL DEFAULT 0, gone INTEGER NOT NULL DEFAULT 0, done_at INTEGER, override TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(project_id, key)
  );
  CREATE INDEX IF NOT EXISTS tasks_by_project ON tasks(project_id, status);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, project_id TEXT, at INTEGER NOT NULL, account TEXT, kind TEXT NOT NULL, title TEXT NOT NULL,
    detail TEXT, source TEXT NOT NULL, ref TEXT, dedupe TEXT UNIQUE
  );
  CREATE INDEX IF NOT EXISTS events_by_time ON events(project_id, at);
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL, rel TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
    category TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, first_seen INTEGER NOT NULL, hash TEXT,
    width INTEGER, height INTEGER, account TEXT, task_ext_id TEXT, status TEXT NOT NULL DEFAULT 'nuevo', gone INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, path)
  );
  CREATE INDEX IF NOT EXISTS assets_by_time ON assets(project_id, mtime);
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, asset_id INTEGER, x REAL, y REAL, time_sec REAL, shape TEXT,
    body TEXT NOT NULL, status TEXT NOT NULL, target TEXT, instruction_id INTEGER, history TEXT NOT NULL DEFAULT '[]', geom TEXT, frame_path TEXT, asset_mtime INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_by_asset ON comments(asset_id);
  CREATE TABLE IF NOT EXISTS instructions (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, target TEXT, status TEXT NOT NULL,
    channel TEXT, error TEXT, comment_id INTEGER, asset_id INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, delivered_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS claims (
    project_id TEXT NOT NULL, task_key TEXT NOT NULL, account TEXT NOT NULL, session_id TEXT, claimed_at INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, note TEXT,
    PRIMARY KEY(project_id, task_key)
  );
  CREATE TABLE IF NOT EXISTS claim_history (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, task_key TEXT NOT NULL, account TEXT, action TEXT NOT NULL, at INTEGER NOT NULL, note TEXT
  );
  CREATE TABLE IF NOT EXISTS spool_offsets (file TEXT PRIMARY KEY, offset INTEGER NOT NULL);
  `,
  // 2: decisions waiting for the user, and the copy of a noted file (so a new file with the same name cannot take it away)
  `
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, question TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '',
    options TEXT NOT NULL DEFAULT '[]', images TEXT NOT NULL DEFAULT '[]', asked_by TEXT, task_ext_id TEXT, priority INTEGER NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'pendiente', choice TEXT, note TEXT, dedupe TEXT, instruction_id INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, decided_at INTEGER,
    UNIQUE(project_id, dedupe)
  );
  CREATE INDEX IF NOT EXISTS decisions_by_status ON decisions(project_id, status);
  ALTER TABLE comments ADD COLUMN kept_path TEXT;
  `,
  // 3: what the user liked of each picture or sound of a decision
  `
  ALTER TABLE decisions ADD COLUMN reactions TEXT;
  `,
  // 4: the gallery knows each file's folder (without the copy) and where it comes from; what the user assigned in «Próximo»
  // (it stays until the tasks are done, unlike a reservation); and the plain card of a task (what it is, what to look at).
  `
  ALTER TABLE assets ADD COLUMN folder TEXT;
  ALTER TABLE assets ADD COLUMN source TEXT;
  CREATE INDEX IF NOT EXISTS assets_by_name ON assets(project_id, name, size);
  CREATE INDEX IF NOT EXISTS assets_by_folder ON assets(project_id, folder);
  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, to_account TEXT NOT NULL, from_account TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    task_order TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL,
    UNIQUE(project_id, to_account, from_account)
  );
  CREATE TABLE IF NOT EXISTS task_cards (
    project_id TEXT NOT NULL, ext_id TEXT NOT NULL, simple TEXT, ask TEXT, media TEXT NOT NULL DEFAULT '[]', account TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY(project_id, ext_id)
  );
  `,
  // 5: what the user asks to change when reviewing a task
  `
  CREATE TABLE IF NOT EXISTS task_changes (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, task_key TEXT NOT NULL, ext_id TEXT, note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pedido',
    instruction_id INTEGER, target TEXT, urgent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, done_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS task_changes_by_task ON task_changes(project_id, task_key, status);
  `,
  // 6: what the project's own checks said, by task (the verification gate)
  `
  CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, task_key TEXT, account TEXT, at INTEGER NOT NULL, outcome TEXT NOT NULL,
    summary TEXT NOT NULL, commit_id TEXT, dirty INTEGER, checks TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS verifications_by_task ON verifications(project_id, task_key, at);
  `,
  // 7: the project's memory (core/memory.ts): rules, preferences and facts every session reads first
  `
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
    source TEXT NOT NULL, at INTEGER NOT NULL, gone INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS memories_by_project ON memories(project_id, gone);
  `,
  // 8: a question in Decidir can say what happens if nobody answers in time (EV79: the work never waits on the user)
  `
  ALTER TABLE decisions ADD COLUMN default_choice TEXT;
  ALTER TABLE decisions ADD COLUMN wait_until INTEGER;
  `
]

export function openDb(file = paths.db()): DB {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

export function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined
  let version = row ? Number(row.value) : 0
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      version++
      db.prepare("INSERT INTO meta(key, value) VALUES('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(version))
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

export function schemaVersion(): number {
  return MIGRATIONS.length
}

/** A consistent copy of the database (VACUUM INTO), kept with the last `keep` ones. */
export function backupDb(db: DB, keep = 14): string {
  const dir = paths.backupsDir()
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = join(dir, `mission-${stamp}.db`)
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  // The phone's notice keys and subscriptions live outside the database (EV13): kept next to it, restored with it.
  const remote = join(paths.root(), 'remote.json')
  try { if (existsSync(remote)) copyFileSync(remote, target.replace(/\.db$/, '.remote.json')) } catch { /* the database copy still counts */ }
  const old = readdirSync(dir)
    .filter((f) => /^mission-.*\.db$/.test(f))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const o of old.slice(keep)) {
    try { unlinkSync(join(dir, o.f)) } catch { /* in use */ }
    try { unlinkSync(join(dir, o.f.replace(/\.db$/, '.remote.json'))) } catch { /* none */ }
  }
  return target
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return fallback
  try { return JSON.parse(row.value) as T } catch { return fallback }
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}

export function addEvent(
  db: DB,
  e: { projectId?: string; at: number; account?: string; kind: string; title: string; detail?: string; source: string; ref?: string; dedupe?: string }
): boolean {
  const r = db
    .prepare('INSERT OR IGNORE INTO events(project_id, at, account, kind, title, detail, source, ref, dedupe) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(e.projectId ?? null, e.at, e.account ?? null, e.kind, e.title, e.detail ?? null, e.source, e.ref ?? null, e.dedupe ?? null)
  return Number(r.changes) > 0
}

export { existsSync, copyFileSync }
