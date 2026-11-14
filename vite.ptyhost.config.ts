// EV156: the process that holds the Claude sessions living inside the app (src/ptyhost/host.ts), as one file that Node
// runs apart from the app. node-pty is native and goes next to it (package.json › build › extraResources).
// Built with: vite build -c vite.ptyhost.config.ts
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    ssr: resolve('src/ptyhost/host.ts'),
    outDir: 'out/ptyhost',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { external: ['node-pty'], output: { entryFileNames: 'host.cjs', format: 'cjs', inlineDynamicImports: true } }
  },
  ssr: { noExternal: true, external: ['node-pty'] }
})
