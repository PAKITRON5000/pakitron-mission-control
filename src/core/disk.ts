// When a disk is short of space, for Inicio and the assistant. No node imports: the screens use it.
// 13-11: «Queda poco disco» in red for C: with 111 GB free and B: with 124 GB (6-7 % of big disks): noise that hides the
// warnings that matter. A percentage alone does not say it; what a project needs is gigabytes.

const GB = 1 << 30

/** Short of space: under 15 GB anywhere, or under 50 GB and under 15 % of the disk. */
export function diskLow(free: number, total: number): boolean {
  if (!total) return false
  return free < 15 * GB || (free < 50 * GB && free / total < 0.15)
}

/** «6 % libre, 111 GB» */
export function diskWords(free: number, total: number): string {
  const pct = total ? Math.round((free / total) * 100) : 100
  return `${pct} % libre, ${Math.round(free / GB)} GB`
}
