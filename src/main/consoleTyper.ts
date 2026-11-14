// Writes into the console of a running Claude, as if the user were at its window: this is how a message from the phone
// reaches a conversation that is open on the PC. Only ever called when the user sends one.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../core/paths'

const SCRIPT = String.raw`param([int]$TargetPid, [string]$TextBase64 = '', [string]$Key = '')
$code = @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleTyper {
  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
  public struct KeyRecord {
    [FieldOffset(0)] public short EventType;
    [FieldOffset(4)] public int KeyDown;
    [FieldOffset(8)] public short Repeat;
    [FieldOffset(10)] public short VirtualKey;
    [FieldOffset(12)] public short ScanCode;
    [FieldOffset(14)] public char Char;
    [FieldOffset(16)] public int Control;
  }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint mode, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "WriteConsoleInputW")]
  public static extern bool Write(IntPtr handle, KeyRecord[] records, int count, out int written);
  static KeyRecord Rec(char c, short vk, bool down) {
    var r = new KeyRecord(); r.EventType = 1; r.KeyDown = down ? 1 : 0; r.Repeat = 1; r.VirtualKey = vk; r.Char = c; return r;
  }
  public static void Send(IntPtr h, string text, short vk) {
    var list = new System.Collections.Generic.List<KeyRecord>();
    foreach (char c in text) { list.Add(Rec(c, vk, true)); list.Add(Rec(c, vk, false)); }
    int w; if (!Write(h, list.ToArray(), list.Count, out w)) throw new Exception("write " + Marshal.GetLastWin32Error());
  }
  public static IntPtr Open(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) throw new Exception("attach " + Marshal.GetLastWin32Error());
    IntPtr h = CreateFile("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) throw new Exception("conin " + Marshal.GetLastWin32Error());
    return h;
  }
}
'@
Add-Type -TypeDefinition $code
$h = [ConsoleTyper]::Open([uint32]$TargetPid)
if ($Key -eq 'esc') { [ConsoleTyper]::Send($h, [string][char]27, 27) }
elseif ($Key -eq 'down') { [ConsoleTyper]::Send($h, [string][char]0, 40) }
elseif ($Key -eq 'up') { [ConsoleTyper]::Send($h, [string][char]0, 38) }
elseif ($Key -eq 'enter') { [ConsoleTyper]::Send($h, [string][char]13, 13) }
elseif ($Key) { [ConsoleTyper]::Send($h, $Key, 0) }
else {
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
  [ConsoleTyper]::Send($h, $text, 0)
  # Text and Enter together would read as a pasted line break, not as "send".
  Start-Sleep -Milliseconds 450
  [ConsoleTyper]::Send($h, [string][char]13, 13)
}
'ok'
`

let written = false

function run(args: string[]): Promise<void> {
  const file = join(paths.root(), 'type-into-console.ps1')
  if (!written || !existsSync(file)) writeFileSync(file, SCRIPT)
  written = true
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], { windowsHide: true, timeout: 20_000 }, (err, out, errOut) => {
      if (err || !String(out).includes('ok')) reject(new Error(String(errOut || err?.message || 'no se pudo escribir en esa ventana').slice(0, 200)))
      else resolve()
    })
  })
}

export function typeText(pid: number, text: string): Promise<void> {
  const flat = text.replace(/\s*\r?\n\s*/g, ' ').trim()
  return run(['-TargetPid', String(pid), '-TextBase64', Buffer.from(flat, 'utf8').toString('base64')])
}

/** One key: 'esc' stops what it is doing, a number picks a choice in a question, 'up'/'down' move in a menu, 'enter' confirms. */
export function typeKey(pid: number, key: string): Promise<void> {
  return run(['-TargetPid', String(pid), '-Key', key])
}

// Reads what a console window shows (EV88): before answering a question for the user, the app looks at it. Claude Code
// calls any dialog «permission prompt», and some menus put «No, exit» first. The text goes out as base64 of UTF-8 so the
// reader never has to change any console's code page.
const READER = String.raw`param([int]$TargetPid, [int]$Lines = 40)
$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ConsoleReader {
  [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
  [StructLayout(LayoutKind.Sequential)] public struct SMALL_RECT { public short Left; public short Top; public short Right; public short Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct CSBI { public COORD Size; public COORD Cursor; public short Attr; public SMALL_RECT Window; public COORD Max; }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint mode, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSBI info);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "ReadConsoleOutputCharacterW")]
  public static extern bool ReadChars(IntPtr h, StringBuilder buf, uint len, COORD at, out uint read);
  public static string Read(uint pid, int lines) {
    FreeConsole();
    if (!AttachConsole(pid)) throw new Exception("attach " + Marshal.GetLastWin32Error());
    IntPtr h = CreateFile("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) throw new Exception("conout " + Marshal.GetLastWin32Error());
    CSBI i; if (!GetConsoleScreenBufferInfo(h, out i)) throw new Exception("info " + Marshal.GetLastWin32Error());
    int w = i.Size.X; int bottom = i.Window.Bottom; int top = Math.Max(i.Window.Top, bottom - lines + 1);
    var sb = new StringBuilder();
    for (int y = top; y <= bottom; y++) {
      var row = new StringBuilder(w); uint got; var c = new COORD(); c.X = 0; c.Y = (short)y;
      ReadChars(h, row, (uint)w, c, out got);
      sb.Append(row.ToString(0, (int)Math.Min(got, (uint)row.Length)).TrimEnd()); sb.Append('\n');
    }
    return Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString()));
  }
}
'@
Add-Type -TypeDefinition $code
'screen:' + [ConsoleReader]::Read([uint32]$TargetPid, $Lines)
`

let readerWritten = false

/** The last lines a console window shows, as text. */
export function readScreen(pid: number, lines = 40): Promise<string> {
  const file = join(paths.root(), 'read-console.ps1')
  if (!readerWritten || !existsSync(file)) writeFileSync(file, READER)
  readerWritten = true
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, '-TargetPid', String(pid), '-Lines', String(lines)], { windowsHide: true, timeout: 20_000 }, (err, out, errOut) => {
      const m = /screen:([A-Za-z0-9+/=]*)/.exec(String(out))
      if (err || !m) reject(new Error(String(errOut || err?.message || 'no se pudo leer esa ventana').slice(0, 200)))
      else resolve(Buffer.from(m[1], 'base64').toString('utf8'))
    })
  })
}

// EV151 (the user, 14-11: «me gusta ver los cmd si quiero e interactuar con ellos»): brings a session's window to the
// front. Since 0.32.35 each session has its own console window (conhost), whose handle GetConsoleWindow gives once
// attached to the process's console. Restored if minimised. Allowed to take the focus because the app, in front when the
// user clicks, starts it. With a session still in a Windows Terminal tab, it can only bring that window, not the tab.
const FRONT = String.raw`param([int]$TargetPid)
$code = @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleFront {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static string Front(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) throw new Exception("attach " + Marshal.GetLastWin32Error());
    IntPtr w = GetConsoleWindow();
    FreeConsole();
    if (w == IntPtr.Zero) throw new Exception("sin ventana");
    ShowWindow(w, IsIconic(w) ? 9 : 5);
    SetForegroundWindow(w);
    return "ok";
  }
}
'@
Add-Type -TypeDefinition $code
[ConsoleFront]::Front([uint32]$TargetPid)
`

let frontWritten = false

/** Puts the console window of a running Claude in front of the others. */
export function bringToFront(pid: number): Promise<void> {
  const file = join(paths.root(), 'console-front.ps1')
  if (!frontWritten || !existsSync(file)) writeFileSync(file, FRONT)
  frontWritten = true
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, '-TargetPid', String(pid)], { windowsHide: true, timeout: 20_000 }, (err, out, errOut) => {
      if (err || !String(out).includes('ok')) reject(new Error(String(errOut || err?.message || 'no se pudo traer esa ventana').slice(0, 200)))
      else resolve()
    })
  })
}

// EV155 (the user, 14-11: «veo raro el muñeco del claude»): the windows the app opens are conhost's (EV151), whose default
// font (Consolas) has no quadrant blocks, so Claude Code's logo came out as boxes with «?». Each one sets its own font to
// Cascadia Mono (in Windows 10 and 11) before Claude starts: same window, same typing into it; a failure changes nothing.
const FONT = String.raw`param([string]$Face = 'Cascadia Mono')
$code = @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleFont {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct FontInfo {
    public int Size; public int Index; public short W; public short H; public int Family; public int Weight;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Face;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetCurrentConsoleFontEx(IntPtr h, bool max, ref FontInfo f);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetCurrentConsoleFontEx(IntPtr h, bool max, ref FontInfo f);
  public static string Set(string face) {
    IntPtr h = GetStdHandle(-11);
    var f = new FontInfo(); f.Size = Marshal.SizeOf(f);
    if (!GetCurrentConsoleFontEx(h, false, ref f)) return "get " + Marshal.GetLastWin32Error();
    string before = f.Face;
    short height = f.H < 12 ? (short)16 : f.H;
    f.Face = face; f.W = 0; f.H = height; f.Family = 54; if (f.Weight == 0) f.Weight = 400;
    if (!SetCurrentConsoleFontEx(h, false, ref f)) return "set " + Marshal.GetLastWin32Error();
    return before + " -> " + face;
  }
}
'@
try { Add-Type -TypeDefinition $code; [ConsoleFont]::Set($Face) | Out-Null } catch { }
`

/** The line that sets the font of the console it runs in (empty if the script cannot be written). */
export function fontLine(): string {
  const file = join(paths.root(), 'console-font.ps1')
  try {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== FONT) writeFileSync(file, FONT)
  } catch { return '' }
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${file}"`
}

/** What goes before the command of a new console window: sets its font, then runs it (`^&` gets past the outer cmd). */
export function fontPrefix(): string {
  const line = fontLine()
  return line ? `${line} ^& ` : ''
}
