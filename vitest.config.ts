// 14-11 (claude1): with the PC busy (Unity for the game project at full power, video exports), tests that take 1-2 s on a
// quiet PC went past Vitest's default 5 s, a different one each run (profile-kinds, skillmove, backuprun), and
// `pmc verifica` refused tasks for it. 20 s per test; everything else as Vitest's defaults.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { testTimeout: 20_000 }
})
