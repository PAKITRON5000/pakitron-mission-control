// The pmc CLI (statusLine, hooks, agent commands) as one self-contained file that system Node runs
// even when the app is closed. Built with: vite build -c vite.cli.config.ts
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    ssr: resolve('src/cli/pmc.ts'),
    outDir: 'out/cli',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'pmc.mjs', format: 'es', inlineDynamicImports: true } }
  },
  ssr: { noExternal: true }
})
