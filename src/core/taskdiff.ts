// EV138 (research, idea 4: the other tools review the diff of each task): the code a task changed, commit by commit, for
// Revisar. A line the user comments goes back to the Claude as a change he asked for (core/changes.ts › askChange).
// Pure, so the window can use it too; reading it from git is core/projects.ts › taskDiff.

export interface DiffLine { kind: 'add' | 'del' | 'ctx'; text: string; oldNo?: number; newNo?: number }
export interface DiffHunk { header: string; lines: DiffLine[] }
export interface DiffFile { path: string; added: number; removed: number; hunks: DiffHunk[]; binary?: boolean; /** Lines left out (too long to show). */ cut?: number }
export interface TaskCommit { hash: string; at: number; subject: string; files: DiffFile[] }

export const TASK_ID = /\b([A-Z]{1,4}\d{1,4})\b/

/**
 * The task a commit is about: the first id its subject names. A checkpoint lists what is done and what not to redo
 * («Punto de control (claude6): EV136 hecha… EV133-EV135 cerradas»): it is EV136's, not the others'.
 */
export function taskOfSubject(subject: string): string | undefined {
  return subject.replace(/^Punto de control \([^)]*\):\s*/i, '').match(TASK_ID)?.[1]
}

/** Files that keep the record of the work (tasks, handoff, history, decisions), not the work itself. */
export const BOOKKEEPING = /^docs\/(TASKS|RELEVO|ESTADO|STATE|DECISIONS)\.md$/i

/** `git show` / `git diff` output into files, hunks and numbered lines; at most `maxLines` lines shown per file. */
export function parseDiff(text: string, maxLines = 400): DiffFile[] {
  const files: DiffFile[] = []
  let f: DiffFile | undefined
  let h: DiffHunk | undefined
  let oldNo = 0
  let newNo = 0
  let shown = 0
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('diff --git ')) {
      const i = line.lastIndexOf(' b/')
      f = { path: i > 0 ? line.slice(i + 3) : line.slice(11), added: 0, removed: 0, hunks: [] }
      files.push(f)
      h = undefined
      shown = 0
      continue
    }
    if (!f) continue
    if (line.startsWith('Binary files ')) { f.binary = true; continue }
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (m) {
      oldNo = Number(m[1])
      newNo = Number(m[2])
      h = { header: m[3].trim(), lines: [] }
      f.hunks.push(h)
      continue
    }
    if (!h) continue // the file's header lines (index, ---, +++, modes)
    const c = line[0]
    if (c !== '+' && c !== '-' && c !== ' ') continue // «\ No newline at end of file», or the empty last line
    const l: DiffLine = c === '+' ? { kind: 'add', text: line.slice(1), newNo: newNo++ } : c === '-' ? { kind: 'del', text: line.slice(1), oldNo: oldNo++ } : { kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ }
    if (l.kind === 'add') f.added++
    if (l.kind === 'del') f.removed++
    if (shown < maxLines) { h.lines.push(l); shown++ } else f.cut = (f.cut ?? 0) + 1
  }
  for (const x of files) x.hunks = x.hunks.filter((y) => y.lines.length)
  return files
}

/** One line commented by the user, as it goes in the note to the Claude: where it is and what it says. */
export function lineNote(c: { path: string; commit: string; line: DiffLine; text: string }): string {
  const no = c.line.newNo ?? c.line.oldNo
  const what = c.line.kind === 'del' ? 'línea quitada' : 'línea'
  const code = c.line.text.trim().slice(0, 120)
  return `- ${c.path}, ${what} ${no} (commit ${c.commit.slice(0, 7)})${code ? `: «${code}»` : ''}. ${c.text.trim()}`
}
