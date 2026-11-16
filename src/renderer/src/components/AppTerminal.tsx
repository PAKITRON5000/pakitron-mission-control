// EV156: one Claude living inside the app, drawn as its console window would show it (xterm.js), and typed into the same
// way. The session itself runs in the app's terminal process (src/ptyhost): this only draws it, so it can be drawn in
// Chats and in a window of its own at the same time, or in neither, and nothing stops.
import { useEffect, useRef, useState } from 'react'
import { ChevronsDown } from 'lucide-react'
import { t } from '../../../core/i18n'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
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
  /**
   * EV197: drawn on a touch screen (the phone): a finger scrolls it, and typing goes through the bar under it (a phone's
   * keyboard typing straight into the terminal repeats letters on Android), so touching it does not bring the keyboard up.
   */
  touch?: boolean
}

export function AppTerminal({ id, autoFocus, sizes = true, fontSize = 13, onExit, touch }: AppTerminalProps) {
  const box = useRef<HTMLDivElement>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes
  // EV199: on the phone, scrolled up through what it wrote: a button to go back to the end.
  const [away, setAway] = useState(false)
  const toEnd = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    const el = box.current
    const pty = window.pmc.pty
    if (!el || !pty) return
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", "JetBrains Mono Variable", Consolas, Menlo, "SF Mono", ui-monospace, "Roboto Mono", "Droid Sans Mono", monospace',
      fontSize,
      lineHeight: 1.1,
      cursorBlink: !touch,
      disableStdin: Boolean(touch),
      scrollback: 5000,
      theme: THEME,
      allowProposedApi: true,
      macOptionIsMeta: true,
      ...(window.pmc.platform === 'win32' ? { windowsPty: { backend: 'conpty' as const } } : {})
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    // EV197: on the phone a touch on it does not bring the keyboard up (xterm still takes the focus for its own textarea).
    if (touch && term.textarea) { term.textarea.readOnly = true; term.textarea.setAttribute('inputmode', 'none') }
    // The user, 15-11 04:20: «¿por qué se escriben como guiones en las ventanas de los chats?». Claude Code draws its boxes
    // with line characters (─ │ ╭); drawn as letters each one had a gap at its sides and the lines looked like dashes.
    // WebGL draws them whole, the way a console window does; if the graphics card says no, the letters stay as before.
    try { const gl = new WebglAddon(); gl.onContextLoss(() => gl.dispose()); term.loadAddon(gl) } catch { /* drawn as letters */ }

    // Ctrl+C copies when something is selected (otherwise it goes to Claude, which stops what it is doing), Ctrl+V pastes.
    // Both by letting the browser do its own copy and paste (xterm takes them from there): answering «false» here only
    // keeps xterm from sending ^C or ^V. Pasting by hand as well pasted everything twice.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined)
        return false
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'v') return false
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
    // The user, 16-11 19:50: «en el de claude2, se está escribiendo solo "CECECECDCDCD…C/C-C+C)C/C0C0…" y sigue sin parar».
    // Mouse moves in the old X10 format (ESC [ M and three bytes): Claude Code reads only the modern one (ESC [ <…M), took
    // ESC [ M as an unknown sequence and the bytes after it as typed letters. The terminal fell back to X10 when the screen
    // replayed on opening the chat lacked Claude's «?1006h»; it is set again below, and an X10 report never reaches Claude.
    const send = (d: string) => { const clean = d.replace(/\x1b\[M[\s\S]{0,3}/g, ''); if (clean) pty.input(id, clean) }
    const input = term.onData(send)
    const binary = term.onBinary(send)

    let lastSize = ''
    // EV202: another view (the phone) set the size Claude Code draws for: this one draws at that size too until it is
    // looked at again (claim), so nothing is left over from the old screen. Its box not changing keeps it following.
    let following = false
    const refit = () => {
      if (!el.isConnected || !el.clientWidth || !el.clientHeight) return
      const dims = (() => { try { return fit.proposeDimensions() } catch { return undefined } })()
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
      const size = `${dims.cols}x${dims.rows}`
      if (following && size === lastSize) return
      following = false
      try { fit.fit() } catch { return }
      const now = `${term.cols}x${term.rows}`
      if (sizesRef.current && now !== lastSize) { lastSize = now; pty.resize(id, term.cols, term.rows) }
    }
    const offSize = window.pmc.on('pty-size', (sid, c, r) => {
      if (sid !== id || !ready) return
      const cols = Math.max(20, Number(c) || 0)
      const rows = Math.max(5, Number(r) || 0)
      following = sizesRef.current && `${cols}x${rows}` !== lastSize
      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows)
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(refit, 60) })
    ro.observe(el)
    // EV197: the PC and the phone may draw the same Claude at different sizes; the one looked at says the size each time
    // it is looked at again (the window taking focus, the phone waking up, a touch on it). The same size is not sent twice
    // (main/embedded.ts › resizeEmbedded).
    const claim = () => { if (!ready) return; lastSize = ''; following = false; refit() }
    const onVisible = () => { if (document.visibilityState === 'visible') claim() }
    // The phone's connection came back (lib/remoteBridge.ts): the PC may have taken its size back meanwhile.
    const onBack = (e: Event) => { if ((e as CustomEvent).detail === id) claim() }
    window.addEventListener('pmc-pty-back', onBack)
    window.addEventListener('focus', claim)
    document.addEventListener('visibilitychange', onVisible)
    el.addEventListener('pointerdown', claim)
    // EV197: a finger scrolls what it wrote, a line at a time as the finger goes (the terminal's own scrolling does not
    // follow a finger on every phone).
    // EV199: the user, 15-11 14:50: «no puedo deslizarme en el chat». Claude Code draws itself on the terminal's second
    // screen (?1049h, with the mouse on): that screen keeps no history, Claude Code keeps the conversation itself and moves
    // it with the mouse wheel (on the PC, xterm sends it the wheel). So here the finger sends it the wheel. One turn of
    // the wheel moves it 3 lines, but turns closer than ~100 ms speed up to 10-14 lines each (measured 15-11 on Claude Code
    // 2.1.325): a slow drag sends them spaced, so the text goes with the finger; a quick swipe, close together, and the
    // rest of it keeps going a moment after the finger lifts. A new touch stops it.
    let touchY: number | undefined
    let carry = 0
    const cellH = () => Math.max(8, el.clientHeight / Math.max(1, term.rows))
    let want = 0 // lines the finger has moved that Claude Code has not been asked to move yet (+ towards the end)
    let up = 0 // about how many lines above the end it is now
    let lastWheel = 0
    let pump: ReturnType<typeof setTimeout> | undefined
    const wheel = () => {
      pump = undefined
      if (Math.abs(want) < 2) return // less than two lines: it waits for more finger
      const fast = Math.abs(want) > 24
      const step = fast ? 10 : 3
      const gap = fast ? 45 : 140
      const wait = lastWheel + gap - performance.now()
      if (wait > 0) { pump = setTimeout(wheel, wait); return }
      lastWheel = performance.now()
      const down = want > 0
      // SGR mouse report (?1006, what Claude Code asks for), over the conversation (a third of the way down, the middle).
      pty.input(id, `\x1b[<${down ? 65 : 64};${Math.max(1, Math.floor(term.cols / 2))};${Math.max(1, Math.floor(term.rows / 3))}M`)
      // What it moved beyond the finger (up to a line) is owed to the next one, so finger and text go one to one.
      want -= down ? step : -step
      up = Math.max(0, up + (down ? -step : step))
      setAway(up > 0)
      if (Math.abs(want) >= 2) pump = setTimeout(wheel, gap)
    }
    const tStart = (e: TouchEvent) => { touchY = e.touches[0]?.clientY; carry = 0; want = 0; clearTimeout(pump); pump = undefined }
    const tMove = (e: TouchEvent) => {
      if (touchY == null || e.touches.length !== 1) return
      const y = e.touches[0].clientY
      e.preventDefault()
      e.stopPropagation()
      if (term.modes.mouseTrackingMode !== 'none') {
        want += (touchY - y) / cellH()
        touchY = y
        if (!pump) wheel()
        return
      }
      carry += touchY - y
      touchY = y
      const lines = Math.trunc(carry / cellH())
      if (lines) { term.scrollLines(lines); carry -= lines * cellH() }
    }
    const tEnd = () => { touchY = undefined }
    // Back to the end: Ctrl+End (Claude Code's «scroll:bottom»; with its box empty it only scrolls, tried 15-11), by the
    // button or when the box under it has just sent a message (EmbeddedGrid › PhoneTerminals), to see the answer come.
    toEnd.current = () => { want = 0; clearTimeout(pump); pump = undefined; up = 0; setAway(false); pty.input(id, '\x1b[1;5F') }
    const onSent = (e: Event) => { if ((e as CustomEvent).detail === id && up > 0) toEnd.current?.() }
    window.addEventListener('pmc-pty-sent', onSent)
    if (touch) {
      el.addEventListener('touchstart', tStart, { capture: true, passive: true })
      el.addEventListener('touchmove', tMove, { capture: true, passive: false })
      el.addEventListener('touchend', tEnd, { capture: true })
    }

    let alive = true
    void pty.attach(id).then((snap) => {
      if (!alive) return
      // Drawn at the size it was taken, then fitted to this view (Claude Code redraws itself at the new size).
      term.resize(Math.max(20, snap.cols), Math.max(5, snap.rows))
      term.write(snap.data)
      for (const d of early) term.write(d)
      early.length = 0
      // Mouse reports in the modern (SGR) format whenever Claude tracks the mouse, even if the replay lost its order.
      term.write('\x1b[?1006h')
      ready = true
      refit()
      if (autoFocus) term.focus()
    }, (e: Error) => { term.write(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`) })

    return () => {
      alive = false
      clearTimeout(timer)
      clearTimeout(pump)
      toEnd.current = undefined
      window.removeEventListener('pmc-pty-sent', onSent)
      ro.disconnect()
      window.removeEventListener('focus', claim)
      window.removeEventListener('pmc-pty-back', onBack)
      document.removeEventListener('visibilitychange', onVisible)
      el.removeEventListener('pointerdown', claim)
      el.removeEventListener('touchstart', tStart, { capture: true })
      el.removeEventListener('touchmove', tMove, { capture: true })
      el.removeEventListener('touchend', tEnd, { capture: true })
      el.removeEventListener('keydown', keep)
      offData(); offExit(); offSize(); input.dispose(); binary.dispose()
      pty.detach(id)
      term.dispose()
    }
    // A new view for another session, another font size or another kind of screen; the rest is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fontSize, touch])

  return (
    <div className="app-term-wrap">
      <div ref={box} className="app-term" onMouseDown={(e) => e.stopPropagation()} />
      {touch && away && (
        <button type="button" className="app-term-end" onClick={() => toEnd.current?.()} aria-label={t('Ir al final')}>
          <ChevronsDown size={15} aria-hidden /> {t('Al final')}
        </button>
      )}
    </div>
  )
}
