// Restoring a backup of the app's database (EV13). The app makes one a day (db.ts › backupDb, the last 14 kept) but had no
// way back. Restoring replaces the database while it is open, so it is done in two steps: the user picks a copy (after
// a confirmation, and a copy of how things are now is made first, so nothing is lost), the app writes which one in
// `restore.json` and restarts, and on the next start the copy is put in place before the database is opened.
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

export interface BackupInfo { file: string; name: string; at: number; bytes: number }

export function listBackups(dir = paths.backupsDir()): BackupInfo[] {
  try {
    return readdirSync(dir).filter((f) => /^mission-.*\.db$/.test(f)).map((f) => {
      const st = statSync(join(dir, f))
      return { file: join(dir, f), name: f, at: st.mtimeMs, bytes: st.size }
    }).sort((a, b) => b.at - a.at)
  } catch { return [] }
}

const marker = (root: string) => join(root, 'restore.json')

/** Step one: says which copy to put in place at the next start. Only a copy from the backups folder. */
export function requestRestore(file: string, root: string, backups = paths.backupsDir()): void {
  if (!file.toLowerCase().startsWith(backups.toLowerCase()) || !existsSync(file)) throw new Error('Esa copia no está en la carpeta de copias')
  writeFileSync(marker(root), JSON.stringify({ file, at: Date.now() }))
}

/** Step two, before the database is opened: the chosen copy becomes the database. Returns the copy restored, if any. */
export function applyPendingRestore(root: string, dbFile: string): string | undefined {
  const m = marker(root)
  if (!existsSync(m)) return undefined
  let file: string | undefined
  try { file = JSON.parse(readFileSync(m, 'utf8')).file } catch { /* broken marker: drop it */ }
  try { unlinkSync(m) } catch { /* gone */ }
  if (!file || !existsSync(file)) return undefined
  // The write-ahead files belong to the database being replaced: left behind they would be replayed on top of the copy.
  for (const ext of ['-wal', '-shm']) rmSync(dbFile + ext, { force: true })
  copyFileSync(file, dbFile)
  // The phone's notice keys and subscriptions of that day, if they were kept with it (db.ts › backupDb).
  const remote = file.replace(/\.db$/, '.remote.json')
  if (existsSync(remote)) copyFileSync(remote, join(root, 'remote.json'))
  return file
}
