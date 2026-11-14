// Where Mission Control keeps its own data. Everything lives under one folder so the CLI (run by hooks and the
// statusLine, with the app closed) and the app agree without configuration. Nothing here is inside a project.
import { homedir } from 'node:os'
import { join } from 'node:path'

export function dataRoot(): string {
  if (process.env.PMC_DATA_DIR) return process.env.PMC_DATA_DIR
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'PakitronMC')
  if (process.platform !== 'win32') return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'PakitronMC')
  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  return join(local, 'PakitronMC')
}

export const paths = {
  root: () => dataRoot(),
  db: () => join(dataRoot(), 'mission.db'),
  /** EV146: each account's sign-in as `claude auth status` gave it (method and plan; never e-mail or organisation). */
  logins: () => join(dataRoot(), 'logins.json'),
  usageDir: () => join(dataRoot(), 'usage'),
  usageFile: (account: string) => join(dataRoot(), 'usage', `${account}.json`),
  usageHistory: (account: string) => join(dataRoot(), 'usage', `${account}.history.jsonl`),
  liveSessionsDir: () => join(dataRoot(), 'usage', 'sessions'),
  spoolDir: () => join(dataRoot(), 'spool'),
  thumbsDir: () => join(dataRoot(), 'thumbs'),
  backupsDir: () => join(dataRoot(), 'backups'),
  binDir: () => join(dataRoot(), 'bin'),
  outboxDir: () => join(dataRoot(), 'outbox'),
  logFile: () => join(dataRoot(), 'mission.log')
}

export const home = () => homedir()
