// EV156: one Claude living inside the app, drawn as its console window would show it (xterm.js), and typed into the same
// way. The session itself runs in the app's terminal process (src/ptyhost): this only draws it, so it can be drawn in
// Chats and in a window of its own at the same time, or in neither, and nothing stops.
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

const THEME = {
  background: '#0c0c0f', foreground: '#e6e6ea', cursor: '#e6e6ea', cursorAccent: '#0c0c0f', selectionBackground: '#3a3d4d',
  black: '#1d1d22', red: '#ff6b6b', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d4d4d8',
  brightBlack: '#71717a', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#fafafa'
}

export interface AppTerminalProps {
  id: string
  /** Takes the keyboard as soon as it is drawn (a popped-out window, a tile just opened). */
  autoFocus?: boolean
  /** Whether this view sets the session's size (the one the user looks at; the others draw at that size). */
  sizes?: boolean
  fontSize?: number
  onExit?: (code: number) => void
}

export function AppTerminal({ id, autoFocus, sizes = true, fontSize = 13, onExit }: AppTerminalProps) {
  const box = useRef<HTMLDivElement>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes

  useEffect(() => {
    const el = box.current
    const pty = window.pmc.pty
    if (!el || !pty) return
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", "JetBrains Mono Variable", Consolas, Menlo, monospace',
      fontSize,
      lineHeight: 1.1,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEME,
      allowProposedApi: true,
      macOptionIsMeta: true,
      ...(window.pmc.platform === 'win32' ? { windowsPty: { backend: 'conpty' as const } } : {})
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)

    // Ctrl+C copies when something is selected (otherwise it goes to Claude, which stops what it is doing), Ctrl+V pastes.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined)
        term.clearSelection()
        return false
      }
      if (mod && e.key.toLowerCase() === 'v') {
        void navigator.clipboard.readText().then((txt) => { if (txt) term.paste(txt) }).catch(() => undefined)
        return false
      }
      return true
    })
    // The app's own shortcuts (Ctrl+1…9, Ctrl+N, Ctrl+J) do not take keys meant for the Claude.
    const keep = (e: KeyboardEvent) => e.stopPropagation()
    el.addEventListener('keydown', keep)

    let ready = false
    const early: string[] = []
    const offData = window.pmc.on('pty', (sid, data) => {
      if (sid !== id) return
      if (ready) term.write(data as string)
      else early.push(data as string)
    })
    const offExit = window.pmc.on('pty-exit', (sid, code) => { if (sid === id) exitRef.current?.(Number(code)) })
    const input = term.onData((d) => pty.input(id, d))
    const binary = term.onBinary((d) => pty.input(id, d))

    let lastSize = ''
    const refit = () => {
      if (!el.isConnected || !el.clientWidth || !el.clientHeight) return
      try { fit.fit() } catch { return }
      const size = `${term.cols}x${term.rows}`
      if (sizesRef.current && size !== lastSize) { lastSize = size; pty.resize(id, term.cols, term.rows) }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(refit, 60) })
    ro.observe(el)

    let alive = true
    void pty.attach(id).then((snap) => {
      if (!alive) return
      // Drawn at the size it was taken, then fitted to this view (Claude Code redraws itself at the new size).
      term.resize(Math.max(20, snap.cols), Math.max(5, snap.rows))
      term.write(snap.data)
      for (const d of early) term.write(d)
      early.length = 0
      ready = true
      refit()
      if (autoFocus) term.focus()
    }, (e: Error) => { term.write(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`) })

    return () => {
      alive = false
      clearTimeout(timer)
      ro.disconnect()
      el.removeEventListener('keydown', keep)
      offData(); offExit(); input.dispose(); binary.dispose()
      pty.detach(id)
      term.dispose()
    }
    // A new view for another session or another font size; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fontSize])

  return <div ref={box} className="app-term" onMouseDown={(e) => e.stopPropagation()} />
}
