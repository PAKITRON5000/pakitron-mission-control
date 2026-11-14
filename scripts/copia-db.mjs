// Copies Mission Control's database while the app keeps writing to it (VACUUM INTO reads one consistent snapshot).
// Used by capturas.ps1 so the screenshots run on a copy of the data without closing the app.
// Usage: node copia-db.mjs <from> <to> [<real data folder> <copy data folder>]
// With the two folders, the copy's photos of deliveries and decisions point into the copy (the app only serves files
// from its own data folder: in the first capture on a copy, 13-11, every task card with a photo showed it broken).
import { DatabaseSync } from 'node:sqlite'

const [from, to, realRoot, copyRoot] = process.argv.slice(2)
if (!from || !to) { console.error('uso: node copia-db.mjs <origen> <destino> [<datos reales> <datos copia>]'); process.exit(2) }
const db = new DatabaseSync(from, { readOnly: true })
db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`)
db.close()
if (realRoot && copyRoot) {
  // The paths are inside JSON text: backslashes doubled. The same folder may be written with either case.
  const inJson = (p) => JSON.stringify(p.replace(/[\\/]+$/, '')).slice(1, -1)
  const copy = new DatabaseSync(to)
  for (const [table, col] of [['task_cards', 'media'], ['decisions', 'images']]) {
    try {
      const rows = copy.prepare(`SELECT rowid AS id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`).all()
      const up = copy.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`)
      const re = new RegExp(inJson(realRoot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      for (const r of rows) { const v = String(r.v).replace(re, inJson(copyRoot)); if (v !== r.v) up.run(v, r.id) }
    } catch { /* an older database without that table */ }
  }
  copy.close()
}
