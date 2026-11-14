import { t } from './i18n'
// What a project is, read from its folder (the user, 12-11: «que la app entienda sola cómo funciona cada proyecto… la
// colocación de carpetas sin que el usuario tenga que colocar él la galería»). Nothing is asked and nothing is written by
// `detectProfile`; `prepareProject` only creates what is missing and never overwrites a file.
//
// One profile gives: the kind of project (a Unity game, a web app, a video edit…), the folders with pictures, videos,
// sounds and models (the gallery), how its work is checked (pmc.json), what heavy resources it uses (Unity, the graphics
// card), the coordination files it has or lacks, the installed skills that fit, and the subagents worth giving it.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'

export type ProjectKind =
  | 'unity' | 'unreal' | 'godot' | 'blender' | 'electron' | 'web' | 'node' | 'python' | 'video' | 'docs'
  // EV127 (the user, 13-11: «cada usuario hará proyectos que ninguno tenga que ver»): kinds unlike the first projects.
  | 'rust' | 'go' | 'dotnet' | 'java' | 'android' | 'flutter' | 'swift' | 'cpp' | 'data' | 'writing' | 'audio'

export const KIND_LABEL: Record<ProjectKind, string> = {
  unity: 'juego de Unity', unreal: 'juego de Unreal', godot: 'juego de Godot', blender: 'arte 3D con Blender', electron: 'aplicación de escritorio (Electron)',
  web: 'web', node: 'programa en Node', python: 'programa en Python', video: 'vídeo', docs: 'documentos',
  rust: 'programa en Rust', go: 'programa en Go', dotnet: 'programa en C# (.NET)', java: 'programa en Java o Kotlin', android: 'app de Android',
  flutter: 'app de Flutter', swift: 'app de Apple (Swift)', cpp: 'programa en C o C++', data: 'análisis de datos', writing: 'escritura (libro, artículo o guion)',
  audio: 'música y audio'
}

/**
 * EV127: how each kind is worked best by several Claude at once, in one or two plain lines: what is slow, what cannot be
 * shared or merged, and how its work is shown to the user. Goes into the project's card (docs/PROYECTO.md).
 */
export const WORK_TIPS: Record<ProjectKind, string> = {
  unity: 'El editor y las compilaciones de Unity, uno cada vez: una cuenta con Unity y las demás en scripts y documentos. Escenas y prefabs se mezclan mal en git: que no los toquen dos cuentas a la vez. Una copia de trabajo nueva reimporta Library (horas): pocas y que duren.',
  unreal: 'El editor de Unreal pesa mucho: uno cada vez. Los .uasset son binarios: nunca dos cuentas en el mismo.',
  godot: 'Las escenas (.tscn) son texto pero se mezclan mal: una cuenta por escena. Se prueba sin ventana con `godot --headless`.',
  blender: 'Los .blend son binarios: nunca dos cuentas en el mismo, y uno con nota del usuario no se sobrescribe. Mejor por guiones de Python, que se repiten y se corrigen.',
  electron: 'Lo que se ve, con captura de la app abierta de verdad antes de darlo por bueno. El proceso principal y las pantallas se pueden repartir entre cuentas. Las copias de .claude/worktrees usan el node_modules de la principal; si cambian dependencias, npm install en ellas.',
  web: 'Cada pantalla, con captura a tamaño de móvil y de escritorio. Las dependencias (package-lock.json) las cambia una sola cuenta cada vez. Las copias de .claude/worktrees usan el node_modules de la principal; si cambian dependencias, npm install en ellas.',
  node: 'Tipos y pruebas antes y después de cada cambio; package-lock.json lo cambia una sola cuenta cada vez. Las copias de .claude/worktrees usan el node_modules de la principal; si cambian dependencias, npm install en ellas.',
  python: 'Un entorno virtual (`.venv`) fuera de git; pruebas con pytest antes de cerrar. Las dependencias las cambia una sola cuenta cada vez. El .venv no pasa a las copias de trabajo: cada una, el suyo.',
  video: 'Renderizar usa la gráfica: uno cada vez, y nunca mientras el usuario edita o juega. Cada versión nueva va con otro nombre.',
  docs: 'Una cuenta por documento o capítulo; cada dato con su fuente.',
  rust: 'Compilar en Rust tarda: `cargo check` mientras se trabaja y `cargo test` para cerrar. Dos cuentas compilando en la misma copia se esperan la una a la otra (la carpeta target): mejor cada una en su copia.',
  go: '`go vet ./...` y `go test ./...` antes de cerrar; go.mod y go.sum los cambia una sola cuenta cada vez.',
  dotnet: '`dotnet build` y `dotnet test` antes de cerrar. Los .sln y .csproj se mezclan mal en git: una cuenta cada vez.',
  java: 'Las compilaciones de Maven o Gradle son largas: se lanzan al cerrar, no en cada cambio. Las dependencias, una sola cuenta cada vez.',
  android: 'Gradle y el emulador pesan mucho: uno cada vez (`pmc recurso build`). Cada pantalla, con captura del emulador o del móvil.',
  flutter: '`flutter analyze` y `flutter test` antes de cerrar; cada pantalla, con captura. pubspec.lock lo cambia una sola cuenta cada vez.',
  swift: 'Una app de iPhone o de Mac solo se compila y se prueba en un Mac: desde Windows se escribe y se revisa el código, pero no se ve funcionar. Dilo en cada entrega.',
  cpp: 'Cada cuenta compila en su propia carpeta (`build-<cuenta>`) para no pisarse; los avisos del compilador cuentan como fallos.',
  data: 'Cada cifra sale de código que se puede volver a ejecutar, nunca a mano. Los cuadernos se guardan sin salidas pesadas (`jupyter nbconvert --clear-output --inplace`) y los datos grandes, fuera de git. Antes de entregar una conclusión, que la compruebe el subagente revisor-datos.',
  writing: 'Un capítulo o parte por cuenta. El estilo, los nombres y lo que ya ha pasado van en docs/DECISIONS.md para que nadie se contradiga. Se entrega texto para leer, no resúmenes, y antes lo repasa el subagente corrector.',
  audio: 'Los proyectos de la estación de audio (Ableton, FL Studio, Reaper…) son binarios: uno por cuenta, y nunca se sobrescriben. Cada mezcla nueva va con otro nombre y se entrega para oírla.'
}

export interface ProfileCheck { nombre: string; orden: string; recurso?: string; minutos?: number; fallaSi?: string; pasaSi?: string; resumen?: string }

export interface AgentSpec {
  name: string; description: string; model: 'haiku' | 'sonnet' | 'opus'; tools: string; body: string
  /** EV139: a cap on its turns, so a lost helper cannot spend the session's usage (Claude Code's `maxTurns`). Default 20. */
  maxTurns?: number
  /** EV139: what it learns stays for next time, in .claude/agent-memory/<name>/ inside the project: every account shares it. */
  memory?: 'project'
}

export interface ProjectProfile {
  root: string
  name: string
  kinds: ProjectKind[]
  /** One line for the user: «Juego de Unity 6000.3.9f1, con arte en Blender y git». */
  summary: string
  details: Record<string, string>
  /** Folders with media, found by looking, not from a fixed list. */
  mediaDirs: string[]
  checks: ProfileCheck[]
  /** Single-use resources its work needs (see resources.ts). */
  heavy: string[]
  docs: { tasks: boolean; relevo: boolean; state: boolean; decisions: boolean; claudeMd: boolean; cadaSesion: boolean; pmcJson: boolean; agents: string[]; skill: boolean; card?: boolean }
  /** Installed skills (~/.claude/skills) that fit this kind of project. */
  skills: string[]
  agents: AgentSpec[]
}

const MEDIA = /\.(png|jpe?g|webp|gif|bmp|tga|exr|hdr|psd|mp4|mov|webm|mkv|avi|wav|mp3|ogg|flac|m4a|glb|gltf|fbx|obj|blend)$/i
/** Never media of the project: generated caches, dependencies, version control, builds of code. */
const SKIP = new Set(['node_modules', '.git', 'library', 'temp', 'obj', 'packagecache', '.venv', 'venv', '__pycache__', 'site-packages', '.vs', '.idea', '.cache',
  'out', 'dist', 'builds', 'usersettings', 'packages', 'intermediate', 'deriveddatacache', 'saved', 'binaries', '.godot', '.import', 'graphify-out', '.claude', '.next', 'coverage'])

function list(dir: string): import('node:fs').Dirent[] {
  try { return readdirSync(dir, { withFileTypes: true }) } catch { return [] }
}

/** How many media files a folder holds, looking at most `budget` entries deep inside it. */
function mediaCount(dir: string, budget = 4000, depth = 0): { n: number; seen: number } {
  let n = 0, seen = 0
  for (const e of list(dir)) {
    if (++seen > budget) break
    if (e.isFile() && MEDIA.test(e.name)) n++
    else if (e.isDirectory() && depth < 6 && !SKIP.has(e.name.toLowerCase())) {
      const r = mediaCount(join(dir, e.name), budget - seen, depth + 1)
      n += r.n; seen += r.seen
    }
  }
  return { n, seen }
}

/**
 * The gallery folders: every top-level folder of the project with at least `min` media files inside, plus the root when
 * it holds media itself (a video project keeps its clips there). Big folders whose media sits deeper (Unity's Assets)
 * stay as one entry: the gallery walks inside.
 */
export function findMediaDirs(root: string, min = 3): string[] {
  const out: string[] = []
  let atRoot = 0
  for (const e of list(root)) {
    if (e.isFile() && MEDIA.test(e.name)) atRoot++
    if (!e.isDirectory() || SKIP.has(e.name.toLowerCase()) || e.name.startsWith('.')) continue
    if (mediaCount(join(root, e.name)).n >= min) out.push(join(root, e.name))
  }
  if (atRoot >= min) out.unshift(root)
  return out
}

function readJson(f: string): any { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, '')) } catch { return undefined } }
function has(root: string, ...p: string[]) { return existsSync(join(root, ...p)) }
function filesWith(root: string, re: RegExp, depth = 2): number {
  let n = 0
  const walk = (d: string, k: number) => { for (const e of list(d)) { if (e.isFile() && re.test(e.name)) n++; else if (e.isDirectory() && k < depth && !SKIP.has(e.name.toLowerCase())) walk(join(d, e.name), k + 1) } }
  walk(root, 0)
  return n
}

export function installedSkills(dir = join(homedir(), '.claude', 'skills')): string[] {
  return list(dir).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name)
}

const SKILL_MATCH: Record<ProjectKind, RegExp> = {
  unity: /unity|game-|level-design|camera-systems|shader|urp|balance|art-bible|map-systems|game/i,
  unreal: /unreal|game-|level-design|shader/i,
  godot: /godot|game-|level-design/i,
  blender: /blender/i,
  electron: /^(impeccable|emil-design-eng|frontend-design|break-ui|ui-ux-pro-max|apple-design|animate|improve-animations|review-animations|find-animation-opportunities|dataviz)$/i,
  web: /^(impeccable|emil-design-eng|frontend-design|break-ui|ui-ux-pro-max|apple-design|animate|improve-animations|review-animations|find-animation-opportunities|mobile-native|dataviz)$/i,
  node: /planning/i,
  python: /planning/i,
  video: /premiere|resolve|edit|house-style/i,
  docs: /planning|research/i,
  rust: /rust|planning/i,
  go: /golang|^go-|planning/i,
  dotnet: /dotnet|csharp|planning/i,
  java: /java|kotlin|spring|planning/i,
  android: /android|kotlin|mobile|planning/i,
  flutter: /flutter|dart|mobile|planning/i,
  swift: /swift|ios|realitykit|apple-design/i,
  cpp: /cpp|cmake|planning/i,
  data: /dataviz|xlsx|data|pandas|jupyter|streamlit/i,
  writing: /writing|docx|pdf|research/i,
  audio: /audio|music|sound/i
}

const GAME = (k: ProjectKind) => k === 'unity' || k === 'unreal' || k === 'godot'

function readText(f: string): string | undefined { try { return readFileSync(f, 'utf8') } catch { return undefined } }

interface FileCounts {
  ext: Map<string, number>
  /** Texts outside docs/ that look like a manuscript (the app's own notes in docs/ and the usual README do not count). */
  manuscripts: number
  /** .NET test projects (Facturas.Tests.csproj). */
  testProjects: number
}

/** One walk of the project, three folders deep and without caches: how many files of each extension, for every kind. */
function fileCounts(root: string, budget = 20000): FileCounts {
  const ext = new Map<string, number>()
  let manuscripts = 0, testProjects = 0, seen = 0
  const walk = (d: string, k: number, inDocs: boolean) => {
    for (const e of list(d)) {
      if (++seen > budget) return
      if (e.isFile()) {
        const x = e.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
        if (!x) continue
        ext.set(x, (ext.get(x) ?? 0) + 1)
        if (!inDocs && k <= 2 && /^(md|docx|odt|fountain|fdx|rtf)$/.test(x) && !/^(readme|claude|license|changelog|contributing|leeme)\b/i.test(e.name)) manuscripts++
        if (/tests?\.(csproj|fsproj)$/i.test(e.name)) testProjects++
      } else if (e.isDirectory() && k < 3 && !SKIP.has(e.name.toLowerCase()) && !e.name.startsWith('.')) {
        walk(join(d, e.name), k + 1, inDocs || (k === 0 && e.name.toLowerCase() === 'docs'))
      }
    }
  }
  walk(root, 0, false)
  return { ext, manuscripts, testProjects }
}

const counted = (c: FileCounts, ...exts: string[]) => exts.reduce((n, x) => n + (c.ext.get(x) ?? 0), 0)

/**
 * EV127: the kinds that do not look like the first projects (a game, this app, a video edit), each read from the files it
 * always has, with the orders that check it. A tool missing on this PC makes its check fail with a clear message; the
 * project's card says what the check is, so the first Claude can install the tool or change it.
 */
function detectMoreKinds(root: string, kinds: ProjectKind[], details: Record<string, string>, checks: ProfileCheck[], heavy: Set<string>): void {
  const game = kinds.some(GAME)
  const c = fileCounts(root)
  const cargo = readText(join(root, 'Cargo.toml'))
  if (cargo !== undefined) {
    kinds.push('rust')
    const n = cargo.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1]
    if (n) details.crate = n
    checks.push({ nombre: 'compila', orden: 'cargo build --quiet', minutos: 20 })
    checks.push({ nombre: 'pruebas', orden: 'cargo test --quiet', minutos: 20, resumen: 'test result: .*' })
  }
  if (has(root, 'go.mod')) {
    kinds.push('go')
    const m = readText(join(root, 'go.mod'))?.match(/^module\s+(\S+)/m)?.[1]
    if (m) details.modulo = m
    checks.push({ nombre: 'revisa', orden: 'go vet ./...', minutos: 10 })
    checks.push({ nombre: 'pruebas', orden: 'go test ./...', minutos: 15 })
  }
  // Unity and Godot write .csproj files of their own: those are games, not .NET programs.
  if (!game && (list(root).some((e) => e.isFile() && /\.(sln|slnx|vbproj)$/i.test(e.name)) || counted(c, 'csproj', 'fsproj') > 0)) {
    kinds.push('dotnet')
    checks.push({ nombre: 'compila', orden: 'dotnet build --nologo -v q', minutos: 15, fallaSi: 'error [A-Z]+[0-9]+' })
    if (c.testProjects) checks.push({ nombre: 'pruebas', orden: 'dotnet test --nologo -v q', minutos: 20 })
  }
  const pubspec = readText(join(root, 'pubspec.yaml'))
  if (pubspec !== undefined) {
    const flutter = /^\s*flutter\s*:/m.test(pubspec) || /sdk:\s*flutter/.test(pubspec)
    kinds.push('flutter')
    if (!flutter) details.dart = 'sin Flutter'
    checks.push({ nombre: 'revisa', orden: flutter ? 'flutter analyze' : 'dart analyze', minutos: 10 })
    if (has(root, 'test')) checks.push({ nombre: 'pruebas', orden: flutter ? 'flutter test' : 'dart test', minutos: 15 })
  }
  const gradle = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some((f) => has(root, f))
  const gw = has(root, 'gradlew.bat') ? 'gradlew.bat' : 'gradle'
  if (gradle && (has(root, 'app', 'src', 'main', 'AndroidManifest.xml') || has(root, 'src', 'main', 'AndroidManifest.xml'))) {
    kinds.push('android')
    heavy.add('build')
    checks.push({ nombre: 'compila', orden: `${gw} assembleDebug --quiet`, recurso: 'build', minutos: 30 })
    checks.push({ nombre: 'pruebas', orden: `${gw} test --quiet`, recurso: 'build', minutos: 30 })
  } else if (gradle || has(root, 'pom.xml')) {
    kinds.push('java')
    checks.push(has(root, 'pom.xml') ? { nombre: 'pruebas', orden: 'mvn -q -B test', minutos: 20 } : { nombre: 'pruebas', orden: `${gw} test --quiet`, minutos: 20 })
  }
  if (has(root, 'Package.swift')) {
    kinds.push('swift')
    checks.push({ nombre: 'compila', orden: 'swift build', minutos: 15 })
    if (has(root, 'Tests')) checks.push({ nombre: 'pruebas', orden: 'swift test', minutos: 20 })
  } else if (list(root).some((e) => /\.(xcodeproj|xcworkspace)$/i.test(e.name))) {
    // Only a Mac builds it: no check that would always fail here (the card and WORK_TIPS say so).
    kinds.push('swift')
    details.xcode = 'se compila en un Mac'
  }
  const cmake = readText(join(root, 'CMakeLists.txt'))
  if (cmake !== undefined && !game) {
    kinds.push('cpp')
    checks.push({ nombre: 'compila', orden: 'cmake -S . -B build && cmake --build build', minutos: 20 })
    if (/enable_testing|add_test|catch_discover_tests|gtest_discover_tests/i.test(cmake)) checks.push({ nombre: 'pruebas', orden: 'ctest --test-dir build --output-on-failure', minutos: 15 })
  } else if (has(root, 'Makefile') && !kinds.length && counted(c, 'c', 'cc', 'cpp', 'cxx', 'h', 'hpp')) {
    kinds.push('cpp')
    checks.push({ nombre: 'compila', orden: 'make', minutos: 15 })
  }
  const notebooks = counted(c, 'ipynb')
  const tables = counted(c, 'csv', 'tsv', 'parquet', 'feather', 'arrow', 'xlsx', 'xls', 'sav', 'dta', 'rds')
  if (notebooks || tables >= 5 || has(root, 'DESCRIPTION') && list(root).some((e) => /\.Rproj$/i.test(e.name))) {
    kinds.push('data')
    details.datos = [notebooks ? `${notebooks} ${notebooks === 1 ? 'cuaderno' : 'cuadernos'}` : '', tables ? `${tables} ${tables === 1 ? 'tabla' : 'tablas'}` : ''].filter(Boolean).join(', ') || 'proyecto de R'
  }
  const tex = counted(c, 'tex')
  if (tex) {
    kinds.push('writing')
    const main = list(root).find((e) => e.isFile() && /\.tex$/i.test(e.name) && /\\documentclass/.test(readText(join(root, e.name)) ?? ''))
    if (main) checks.push({ nombre: 'compila', orden: `latexmk -pdf -interaction=nonstopmode -halt-on-error "${main.name}"`, minutos: 10 })
    details.latex = `${tex} archivos .tex`
  } else if (!kinds.length && c.manuscripts >= 5) {
    kinds.push('writing')
  }
  const daw = counted(c, 'als', 'flp', 'rpp', 'ptx', 'cpr', 'song', 'aup3', 'reason', 'bwproject', 'mmp', 'mmpz')
  // Loose sounds make a music project only where nothing else is: a game's, an app's or a video edit's are theirs
  // (13-11: an Electron app with its sound effects came out «con música y audio»).
  const sounds = kinds.length || counted(c, 'mp4', 'mov', 'mkv', 'prproj', 'drp') >= 3 ? 0 : counted(c, 'wav', 'flac', 'aif', 'aiff', 'mp3', 'ogg', 'm4a')
  if (daw || sounds >= 10) {
    kinds.push('audio')
    if (daw) details.audio = `${daw} ${daw === 1 ? 'proyecto' : 'proyectos'} de estación de audio`
  }
}

export function detectProfile(dir: string, skills: string[] = installedSkills()): ProjectProfile {
  const root = resolve(dir)
  const kinds: ProjectKind[] = []
  const details: Record<string, string> = {}
  const checks: ProfileCheck[] = []
  const heavy = new Set<string>()
  const pkg = readJson(join(root, 'package.json'))

  if (has(root, 'Assets') && has(root, 'ProjectSettings')) {
    kinds.push('unity')
    const v = (() => { try { return readFileSync(join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8').match(/m_EditorVersion:\s*(\S+)/)?.[1] } catch { return undefined } })()
    if (v) details.unity = v
    heavy.add('unity')
    if (has(root, 'tools', 'unity.ps1')) {
      checks.push({ nombre: 'compila', orden: 'powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity.ps1 build', recurso: 'unity', minutos: 45, fallaSi: 'error CS[0-9]+|Scripts have compiler errors|another Unity instance is running|ExitCode=-?[1-9]' })
      checks.push({ nombre: 'pruebas', orden: 'powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity.ps1 test', recurso: 'unity', minutos: 120, fallaSi: 'error CS[0-9]+|Scripts have compiler errors', pasaSi: 'Tests: total=[0-9]+ passed=[0-9]+ failed=0', resumen: 'Tests: total=.*' })
    } else if (v) {
      const editor = `C:/Program Files/Unity/Hub/Editor/${v}/Editor/Unity.exe`
      checks.push({ nombre: 'compila', orden: `"${editor}" -batchmode -quit -projectPath . -logFile -`, recurso: 'unity', minutos: 45, fallaSi: 'error CS[0-9]+|Scripts have compiler errors' })
    }
  }
  if (list(root).some((e) => e.isFile() && /\.uproject$/i.test(e.name))) { kinds.push('unreal'); heavy.add('unreal') }
  if (has(root, 'project.godot')) kinds.push('godot')
  const blends = filesWith(root, /\.blend$/i, 3)
  if (blends) { kinds.push('blender'); heavy.add('gpu'); details.blender = `${blends} archivos .blend` }
  if (pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    kinds.push(deps.electron ? 'electron' : deps.react || deps.vue || deps.svelte || deps.next || deps.vite || deps.astro ? 'web' : 'node')
    if (pkg.name) details.paquete = pkg.name
    if (deps.typescript && has(root, 'tsconfig.json')) checks.push({ nombre: 'tipos', orden: 'npx tsc --noEmit -p tsconfig.json', minutos: 5 })
    if (pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test)) checks.push({ nombre: 'pruebas', orden: 'npm test', minutos: 15 })
    else if (pkg.scripts?.build) checks.push({ nombre: 'compila', orden: 'npm run build', minutos: 15 })
  }
  else if (has(root, 'index.html')) kinds.push('web')
  if (has(root, 'pyproject.toml') || has(root, 'requirements.txt') || has(root, 'setup.py')) {
    kinds.push('python')
    if (has(root, 'tests') || has(root, 'pytest.ini')) checks.push({ nombre: 'pruebas', orden: 'python -m pytest -q', minutos: 15 })
  }
  detectMoreKinds(root, kinds, details, checks, heavy)
  const videos = filesWith(root, /\.(mp4|mov|mkv|prproj|drp|braw|mxf)$/i, 2)
  if (videos >= 3 && !kinds.some(GAME)) { kinds.push('video'); heavy.add('gpu') }
  if (!kinds.length) kinds.push('docs')

  const docsDir = join(root, 'docs')
  const claudeMd = (() => { try { return readFileSync(join(root, 'CLAUDE.md'), 'utf8') } catch { return '' } })()
  const agentsDir = join(root, '.claude', 'agents')
  const docs = {
    tasks: existsSync(join(docsDir, 'TASKS.md')), relevo: existsSync(join(docsDir, 'RELEVO.md')), state: existsSync(join(docsDir, 'STATE.md')) || existsSync(join(docsDir, 'ESTADO.md')),
    decisions: existsSync(join(docsDir, 'DECISIONS.md')), card: existsSync(join(docsDir, 'PROYECTO.md')), claudeMd: Boolean(claudeMd), cadaSesion: /^##\s+Cada sesi[oó]n/m.test(claudeMd), pmcJson: has(root, 'pmc.json'),
    agents: list(agentsDir).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.replace(/\.md$/, '')),
    skill: existsSync(join(root, '.claude', 'skills', 'mission-control', 'SKILL.md'))
  }
  const fitting = [...new Set(kinds.flatMap((k) => skills.filter((s) => SKILL_MATCH[k].test(s))))].sort()
  const name = basename(root)
  const main = kinds[0]
  const extra = kinds.slice(1).map((k) => KIND_LABEL[k])
  const summary = `${KIND_LABEL[main][0].toUpperCase()}${KIND_LABEL[main].slice(1)}${details.unity ? ` ${details.unity}` : ''}${extra.length ? `, con ${extra.join(' y ')}` : ''}${has(root, '.git') ? '; con git' : '; sin git'}`
  return { root, name, kinds, summary, details, mediaDirs: findMediaDirs(root), checks, heavy: [...heavy], docs, skills: fitting, agents: agentsFor(kinds, [...heavy], fitting) }
}

/**
 * A new, empty project read as the kind the user chose (core/templates.ts): the files that would say «Unity» are not there
 * yet, but its helpers (game reviewer, 3D artist…) should be from the first minute.
 */
export function profileAs(dir: string, kinds: ProjectKind[], heavy: string[], skills: string[] = installedSkills()): ProjectProfile {
  const p = detectProfile(dir, skills)
  if (!kinds.length) return p
  const fitting = [...new Set(kinds.flatMap((k) => skills.filter((s) => SKILL_MATCH[k].test(s))))].sort()
  const label = KIND_LABEL[kinds[0]]
  return { ...p, kinds, heavy, skills: fitting, agents: agentsFor(kinds, heavy, fitting), summary: `${label[0].toUpperCase()}${label.slice(1)} (proyecto nuevo); con git` }
}

// ---- subagents ------------------------------------------------------------------------------------------------------
// Claude Code subagents (.claude/agents/<name>.md) run inside a session with their own context and, here, a cheaper
// model: the main agent hands them the reading, checking and note-keeping, and gets back a few lines. That is the saving:
// the long logs and the big files never enter the main conversation.

const PMC = 'pmc'

export function agentsFor(kinds: ProjectKind[], heavy: string[], skills: string[]): AgentSpec[] {
  const out: AgentSpec[] = [
    {
      name: 'explorador', model: 'haiku', tools: 'Read, Grep, Glob, Bash', maxTurns: 15, memory: 'project',
      description: t('Úsalo por tu cuenta, sin que te lo pidan, para orientarte sin gastar tu contexto: dónde está algo, qué archivos toca una tarea, qué llama a qué. Devuelve rutas con número de línea y un resumen corto; no cambia nada.'),
      body: [
        'Eres el explorador del proyecto. Te piden encontrar algo; tú buscas y devuelves solo lo útil.',
        `- Empieza por \`${PMC} tarea <ID>\` si te dan una tarea, y por \`graphify query "<pregunta>" --budget 1200\` si existe \`graphify-out/graph.json\`.`,
        '- Busca con Grep y Glob; abre solo los tramos que importan.',
        '- No leas enteros docs/TASKS.md, docs/STATE.md ni docs/DECISIONS.md: busca en ellos.',
        '- Devuelve como mucho 15 líneas: `ruta:línea` y qué hay ahí. Nada de copiar archivos enteros.',
        '- No edites ni ejecutes nada que cambie el proyecto.'
      ].join('\n')
    },
    {
      name: 'verificador', model: 'haiku', tools: 'Bash, Read, Grep',
      description: t('Úsalo por tu cuenta, sin que te lo pidan, al terminar una tarea, antes de darla por hecha: pasa las comprobaciones del proyecto y, si fallan, lee el registro y dice en pocas líneas qué falla y dónde. No arregla nada.'),
      body: [
        'Eres el verificador. Compruebas con pruebas objetivas, nunca con opiniones.',
        `1. Ejecuta \`${PMC} verifica <ID>\` (la tarea que te digan). Si dice «aplazada», devuelve eso y por qué: no es un fallo.`,
        '2. Si falla, abre el registro que indica y busca la primera causa real (el primer error de compilación, la primera prueba que falla con su mensaje).',
        '3. Devuelve: BIEN o FALLA, la causa en una o dos líneas con `ruta:línea`, y el registro. Como mucho 10 líneas.',
        '- No cambies código ni des la tarea por buena tú: eso lo decide quien te llamó con tu resultado.',
        '- Si el proyecto no tiene comprobaciones (pmc.json), dilo y sugiere cuáles tendría.'
      ].join('\n')
    },
    {
      name: 'relevo', model: 'haiku', tools: 'Read, Edit, Bash',
      description: t('Úsalo por tu cuenta, sin que te lo pidan, al cerrar un bloque de trabajo o cuando Mission Control avise de que se acaba el uso: pone al día docs/RELEVO.md y la tarea en docs/TASKS.md y guarda con un commit, para que otra cuenta pueda seguir sin adivinar.'),
      body: [
        'Eres quien deja el relevo escrito. Te dicen qué se ha hecho, qué falta y por dónde seguir.',
        '1. En docs/TASKS.md: marca la tarea (`[x]` hecha, `[~]` a medias) con una nota breve de cómo quedó.',
        '2. En docs/RELEVO.md: pon al día la línea «**En curso:**» (quién, desde cuándo, en qué).',
        '3. Ejecuta `pmc guarda "qué quedó hecho y probado, qué falta y el siguiente paso concreto, con archivos"`: escribe el «Último latido» con la hora real, hace el commit solo de lo de esta cuenta y guarda sus reservas para quien la releve. Si dice que algo quedó sin guardar, devuélvelo tal cual: no hagas `git add -A` a ciegas ni borres nada.',
        '4. Devuelve en dos líneas qué has escrito.'
      ].join('\n')
    }
  ]
  out.push({
    name: 'coordinador', model: 'sonnet', tools: 'Bash, Read, Grep',
    description: t('Úsalo por tu cuenta, sin que te lo pidan, cuando haya que decidir qué hacer después o quién hace qué: mira el estado del equipo con las órdenes de Mission Control y devuelve la siguiente tarea para ti, qué tienen las demás cuentas y si conviene reservar, soltar o pasar algo.'),
    body: [
      'Eres el coordinador del equipo de cuentas de Claude en este proyecto. No programas: decides con datos y devuelves poco.',
      `1. Mira: \`${PMC} parte\` (en curso, último latido, cola, equipo), \`${PMC} plan\` (cuántos frentes caben a la vez), \`${PMC} claims\` (reservas) y \`${PMC} recursos\` (Unity, gráfica, si el usuario juega).`,
      '2. Decide la siguiente tarea para quien te llama: la primera de su cola que no espere a otra («tras:»), que no tenga otra cuenta y cuyo recurso esté libre. Si su modelo no es el que pide la tarea ([sonnet], [opus], [fable]) y hay otra libre que sí, elige esa.',
      `3. Si te piden reservar o soltar: \`${PMC} claim <ID>\` o \`${PMC} release <ID>\`. Si una reserva lleva horas caducada y su cuenta no trabaja, dilo: se puede recoger.`,
      '4. Devuelve como mucho 8 líneas: la tarea elegida y por qué, lo que tienen las otras cuentas y cualquier conflicto (dos en el mismo sistema, recurso ocupado, tarea bloqueada).',
      '- No abras ventanas ni lances cuentas: eso lo hace Mission Control.'
    ].join('\n')
  })
  const visual = kinds.some((k) => ['unity', 'unreal', 'godot', 'blender', 'web', 'electron', 'video', 'android', 'flutter', 'swift'].includes(k))
  if (visual) out.push({
    name: 'revisor-visual', model: 'sonnet', tools: 'Read, Glob, Bash',
    description: t('Úsalo por tu cuenta, sin que te lo pidan, para juzgar capturas, renders o fotogramas antes de enseñárselos al usuario: compara lo que se ve con lo que se pidió y dice qué está mal, con dónde está en la imagen. No aprueba lo que no se ve.'),
    body: [
      'Eres el revisor visual. Miras imágenes de verdad (ábrelas con Read) y comparas con lo pedido.',
      '- Recorta o amplía mentalmente la zona de la que se habla; si la pieza es pequeña en la captura, dilo: hace falta una captura más cerca.',
      '- Devuelve una lista corta: qué cumple, qué no, y dónde (arriba a la izquierda, sobre el castillo…).',
      '- Si no puedes juzgarlo con lo que hay (falta la imagen, está oscura, no se ve la pieza), di exactamente qué captura hace falta.',
      '- Nunca digas que algo está bien sin haberlo visto en una imagen.'
    ].join('\n')
  })
  if (kinds.includes('unity') || kinds.includes('unreal') || kinds.includes('godot')) out.push({
    name: 'jugabilidad', model: 'sonnet', tools: 'Read, Grep, Glob, Bash',
    description: t('Úsalo por tu cuenta, sin que te lo pidan, para revisar un cambio de jugabilidad antes de cerrarlo: lee el código tocado y las reglas del proyecto (CLAUDE.md, docs/DESIGN.md) y avisa si rompe una regla, la red, el equilibrio o algo validado por el usuario.'),
    body: [
      'Eres el revisor de jugabilidad. Te dan un cambio (archivos o un diff).',
      '- Lee las reglas del proyecto en CLAUDE.md y, si hace falta, el apartado que toque de docs/DESIGN.md o docs/ARCHITECTURE.md (busca, no leas entero).',
      '- Comprueba: autoridad del servidor y red, datos en ScriptableObjects y no en constantes, lógica separada de la presentación, que no toque lo que el usuario dio por bueno.',
      '- Devuelve solo problemas reales con `ruta:línea` y por qué; si no hay, di «sin problemas» en una línea.'
    ].join('\n')
  })
  // EV127: the ones whose work is not code: what a reviewer of numbers and a proofreader catch before the user sees it.
  if (kinds.includes('data')) out.push({
    name: 'revisor-datos', model: 'sonnet', tools: 'Read, Grep, Glob, Bash',
    description: t('Úsalo por tu cuenta, sin que te lo pidan, antes de dar por buena una cifra, una tabla o un gráfico: vuelve a sacar el resultado desde los datos y avisa de filas perdidas, unidades, duplicados o un gráfico que no dice lo que dice el texto. No cambia nada.'),
    body: [
      'Eres el revisor de datos. Te dan una conclusión, una tabla o un gráfico y de dónde salen.',
      '- Vuelve a calcularlo desde los datos originales con un guion corto (no a mano): cuántas filas entran y cuántas salen, nulos, duplicados, unidades y fechas.',
      '- Comprueba que el gráfico y el texto dicen lo mismo, con los ejes y la escala correctos.',
      '- Devuelve como mucho 10 líneas: qué cuadra, qué no y con qué cifra, y el guion que usaste.',
      '- No edites los datos ni los cuadernos: eso lo decide quien te llamó.'
    ].join('\n')
  })
  if (kinds.includes('writing')) out.push({
    name: 'corrector', model: 'sonnet', tools: 'Read, Grep, Glob',
    description: t('Úsalo por tu cuenta, sin que te lo pidan, antes de entregar un capítulo, un artículo o una escena: lo lee contra la guía de estilo y lo ya escrito (docs/DECISIONS.md, CLAUDE.md, capítulos anteriores) y devuelve solo los fallos. No reescribe.'),
    body: [
      'Eres el corrector. Te dan un texto (archivo y tramo) para revisar antes de que lo lea el usuario.',
      '- Busca en docs/DECISIONS.md y CLAUDE.md el estilo, el tono y los nombres fijados; busca en los capítulos anteriores lo que ya pasó (no los leas enteros).',
      '- Señala: contradicciones con lo anterior, nombres o datos que cambian, saltos de tono, frases que no se entienden y erratas.',
      '- Devuelve una lista corta con `archivo:línea`, el fallo y una propuesta de una línea. Si no hay nada, dilo en una línea.',
      '- No reescribas el texto ni cambies el estilo del autor.'
    ].join('\n')
  })
  if (kinds.includes('blender') || heavy.includes('gpu')) {
    const blenderSkills = skills.filter((s) => /blender/i.test(s))
    if (kinds.includes('blender')) out.push({
      name: 'arte-3d', model: 'sonnet', tools: 'Read, Write, Edit, Bash, Glob',
      description: t('Úsalo por tu cuenta, sin que te lo pidan, para trabajo de Blender por guiones (modelar, materiales, exportar a motor) que se pueda hacer sin la ventana: escribe o ajusta el guion, lo ejecuta en segundo plano y devuelve la vista previa.'),
      body: [
        'Eres el especialista de arte 3D. Trabajas con guiones de Blender en segundo plano (`blender -b archivo.blend --python guion.py`).',
        `- Antes de lanzar Blender: \`${PMC} recursos\`; si la gráfica está ocupada o el usuario juega, no lo lances y dilo.`,
        blenderSkills.length ? `- Carga la skill que encaje: ${blenderSkills.join(', ')}.` : '- Si hay skills de Blender instaladas, carga la que encaje.',
        '- Guarda las vistas previas en una carpeta de capturas del proyecto y devuelve sus rutas.',
        '- No sobrescribas un .blend ni una imagen con nota del usuario: guarda con otro nombre.'
      ].join('\n')
    })
  }
  return out
}

/** The last line of a subagent the app wrote: while it is there, the app may rewrite the file with a newer version. */
export const AGENT_MARK = '<!-- Creado por Mission Control (pmc preparar). Si lo cambias a mano, borra esta línea y no se volverá a escribir. -->'

/** A subagent starts without the session's context: it is told what `pmc` stands for, with no path of this machine. */
const PMC_NOTE = 'Ejecuta `pmc` desde la carpeta del proyecto. Si esa ventana no la encuentra, es `node "$LOCALAPPDATA/PakitronMC/bin/pmc.mjs"` (en PowerShell, `node "$env:LOCALAPPDATA/PakitronMC/bin/pmc.mjs"`).'

export function agentFile(a: AgentSpec): string {
  const body = /\bpmc\b/.test(a.body) ? `${a.body}\n\n${PMC_NOTE}` : a.body
  // EV139: none of them edits code alongside the session, so none takes `isolation: worktree` (relevo must write the real docs).
  const extra = `maxTurns: ${a.maxTurns ?? 20}\n${a.memory ? `memory: ${a.memory}\n` : ''}`
  return `---\nname: ${a.name}\ndescription: ${a.description}\ntools: ${a.tools}\nmodel: ${a.model}\n${extra}---\n\n${body}\n\n${AGENT_MARK}\n`
}

// ---- preparing a project ---------------------------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10)

/** The project skill (`.claude/skills/mission-control/SKILL.md`): how to work with Mission Control, every order with an example. */
export const PMC_SKILL = [
  '---',
  'name: mission-control',
  'description: Cómo trabajar en un proyecto coordinado por Mission Control con la orden pmc. Úsala al empezar a trabajar, al cerrar un bloque, antes de preguntar algo al usuario, antes de lanzar Unity, Blender o la gráfica, al entregar algo que se ve o se oye, o cuando el usuario diga que te ha contestado.',
  '---',
  '',
  '# Mission Control: cómo se trabaja aquí',
  '',
  'Mission Control coordina a varios Claude (cuentas distintas) en este proyecto. Todo se hace con la orden `pmc`, desde la carpeta del proyecto. Si esa ventana no la encuentra, es `node "$LOCALAPPDATA/PakitronMC/bin/pmc.mjs"` (en PowerShell, `node "$env:LOCALAPPDATA/PakitronMC/bin/pmc.mjs"`).',
  '',
  '## Empezar',
  '- `pmc parte`: lo que está en curso, el último latido, tu cola y lo que tienen las demás cuentas, en poco texto. No leas enteros `docs/RELEVO.md`, `docs/TASKS.md` ni `docs/STATE.md`: son archivo.',
  '- `pmc tarea EV12`: el texto entero de una tarea. `pmc next`: tus siguientes tareas libres, con el modelo que basta.',
  '- `pmc claim EV12` antes de tocar una tarea (nadie más la cogerá); `pmc release EV12` al acabarla. `pmc claims`: quién tiene qué.',
  '- `pmc relevo claude1`: si una cuenta sin uso dejó trabajo a medias aquí, te lo pasa con su latido, sus reservas y sus cambios sin guardar.',
  '- `pmc respuestas`: lo que el usuario te contestó en Decidir o te escribió y aún no has recibido (de cualquier proyecto).',
  '- `pmc corregido 12 "Mano recolocada sobre el mango" --foto "ruta::qué se ve"`: una nota que el usuario dejó sobre una imagen (te llega con su n.º) ya está arreglada; vuelve a él en Revisar para que la apruebe.',
  '',
  '## Mientras trabajas',
  '- `pmc ahora "Preparando las capturas del menú"`: una frase clara de en qué estás, al empezar y cada vez que cambies de faena. Es lo que el usuario ve en la app.',
  '- Antes de algo pesado: `pmc recursos` y `pmc recurso unity "compilar para probar los bots"` (o `gpu`, `build`); al acabar, `pmc recurso unity --soltar`. Si dice que el usuario juega o edita vídeo, no lo lances.',
  '- Algo de más de 5 minutos (un render, una grabación): `pmc trabajo "Render del tráiler" --log ruta.log --salida ruta.mp4 [--pid N]`.',
  '- Para que el usuario decida, no te pares: `pmc decide "título" --pregunta "…" --opcion "A: …" --opcion "B: …" --foto "ruta::qué se ve" [--audio "ruta::qué es::para qué"] [--tarea EV12]`, y sigue con otra cosa; su respuesta te llega sola (o con `pmc respuestas`). Enséñale siempre lo concreto.',
  '',
  '## Cerrar',
  '- `pmc verifica EV12`: pasa las comprobaciones del proyecto (`pmc.json`) y deja el resultado en la tarea. Si fallan, arréglalo antes de darla por hecha. Lo que no tenga prueba, dilo en la entrega.',
  '- Lo que se ve o se oye: `pmc entrega EV12 --que "qué es, sin tecnicismos" --mirar "qué tiene que mirar para aprobarla" --foto "ruta::qué se ve"` (recorta y amplía la pieza).',
  '- Al cerrar cada bloque: `pmc guarda "qué has hecho y qué queda" --probado "qué y cómo" --siguiente "el paso concreto" --no-rehacer "lo que ya está"`. Escribe el «Último latido» con la hora real, hace el commit de lo tuyo (solo lo tuyo si otra cuenta trabaja en la misma copia) y guarda tus reservas para quien te releve. Si te dice que algo quedó sin guardar, míralo.',
  '- Mientras te quede uso y trabajo, no termines el turno ni escribas un resumen: el usuario lo ve todo en Mission Control. Que el límite te corte a mitad de una tarea es lo que quiere; quien te releve sigue desde tu latido.',
  '',
  '## Tareas nuevas en docs/TASKS.md',
  '`- [ ] ID · título`, y cuando lo sepas: `(tras: EV4)` si espera a otra, `[sonnet]`, `[opus]` o `[fable]` con el modelo que basta, y `{unity}` o `{gpu}` si necesita algo que no se comparte. Las tareas a medias se firman al principio de su nota: `*Primera parte (12-11, claude3): …*`.',
  '',
  'Subagentes del proyecto (`.claude/agents`): explorador (buscar sin gastar tu contexto), verificador (comprobar), relevo (dejar el relevo y guardar), revisor-visual (juzgar capturas)… Úsalos por tu cuenta.',
  '',
  AGENT_MARK,
  ''
].join('\n')

export const CADA_SESION = [
  '## Cada sesión',
  '',
  '1. Ejecuta `pmc parte` (Mission Control te da la orden completa al empezar): lo que está en curso, el último latido, tu cola y lo que tienen otras cuentas. El texto de una tarea: `pmc tarea <ID>`. No leas enteros los documentos largos de `docs/`: busca en ellos.',
  '2. Reserva la tarea con `pmc claim <ID>` antes de tocarla. Para buscar en el proyecto usa el subagente `explorador`; para comprobar, `verificador` (`pmc verifica <ID>`); para juzgar imágenes, `revisor-visual` si existe.',
  '3. Al cerrar cada bloque, o cuando Mission Control avise de que se acaba el uso: `pmc guarda "qué has hecho y qué queda" --probado "…" --siguiente "…" --no-rehacer "…"` (latido, commit de lo tuyo y reservas para quien te releve), o el subagente `relevo`, que además marca la tarea.',
  ''
].join('\n')

/** What a card still lacks: the parts only a Claude reading the project can write. */
export const TO_FILL = '(por completar)'

/**
 * EV109 (the user, 13-11 12:40: «que cada proyecto añadido los claude sepan leerlo y mejorar el flujo de trabajo
 * adaptándose y analizando cada proyecto»): `docs/PROYECTO.md`, the project's card. The app writes what it can see from
 * the files; the first Claude that works there fills the rest by reading the project, and every session starts with
 * one line pointing at it. Short on purpose (a page): it is read by whoever does not know the project yet.
 */
export function projectCard(p: ProjectProfile): string {
  const L: string[] = [
    `# ${p.name}: ficha del proyecto`,
    '',
    `Escrita por Mission Control al preparar el proyecto (${today()}). Lo marcado ${TO_FILL} lo completa el primer Claude que trabaje aquí, leyendo el proyecto (10 minutos como mucho); quien cambie mucho el proyecto la pone al día. Una página: lo que necesita saber quien no lo conoce.`,
    '',
    '## Qué es',
    '',
    `${p.summary}.${Object.keys(p.details).length ? ' ' + Object.entries(p.details).map(([k, v]) => `${k}: ${v}`).join('; ') + '.' : ''}`,
    `Para qué lo quiere el usuario y hacia dónde va: ${TO_FILL}`,
    '',
    '## Dónde está cada cosa',
    '',
    `Las carpetas principales y qué hay en cada una: ${TO_FILL}`,
    ...(p.mediaDirs.length ? [`Imágenes, vídeos y modelos (los ve la Galería): ${p.mediaDirs.map((m) => m.slice(p.root.length + 1) || 'la raíz').join(', ')}.`] : []),
    '',
    '## Cómo se comprueba',
    '',
    ...(p.checks.length ? p.checks.map((c) => `- ${c.nombre}: \`${c.orden}\`${c.recurso ? ` (necesita ${c.recurso})` : ''}`) : [`- ${TO_FILL}: la orden que dice si algo se ha roto (y apúntala en \`pmc.json\`).`]),
    '',
    '## Cómo trabajarlo mejor',
    '',
    p.heavy.length
      ? `Usa ${p.heavy.join(' y ')}: un trabajo pesado cada vez (\`pmc recurso <nombre>\` antes de lanzarlo). Con varias cuentas, una en lo pesado y las demás en lo que no lo necesite (documentos, scripts, pruebas).`
      : 'No usa nada que no se pueda compartir: varias cuentas pueden trabajar a la vez si cogen partes distintas (cada una reserva su tarea con `pmc claim`).',
    // EV127: what each of its kinds asks for (KIND_LABEL says which is which when there are several).
    ...p.kinds.map((k) => (p.kinds.length > 1 ? `${KIND_LABEL[k][0].toUpperCase()}${KIND_LABEL[k].slice(1)}: ${WORK_TIPS[k]}` : WORK_TIPS[k])),
    `Qué partes se pueden trabajar a la vez, qué es delicado y qué no se toca sin preguntar: ${TO_FILL}`,
    '',
    '## Ayudas instaladas',
    '',
    `Subagentes: ${p.agents.map((a) => a.name).join(', ') || 'ninguno'}.${p.skills.length ? ` Skills que le sirven: ${p.skills.slice(0, 12).join(', ')}.` : ''}`,
    ''
  ]
  return L.join('\n')
}

/**
 * EV142: only the subagents the app wrote (they still carry its mark) brought up to date in a project, nothing created:
 * what a new version of the app does by itself in every project, so its helpers improve without anyone pressing «Preparar».
 */
export function refreshMarkedAgents(root: string, agents: AgentSpec[]): string[] {
  const out: string[] = []
  for (const a of agents) {
    const rel = `.claude/agents/${a.name}.md`
    const f = join(root, rel)
    if (!existsSync(f)) continue
    const cur = readFileSync(f, 'utf8')
    const next = agentFile(a)
    if (cur.includes(AGENT_MARK) && cur.replace(/\r\n/g, '\n') !== next) { writeFileSync(f, next); out.push(rel) }
  }
  return out
}

/** Creates what the project lacks to be worked on by several accounts. Never overwrites: returns what it created. */
export function prepareProject(p: ProjectProfile, opts: { agents?: boolean; refreshAgents?: boolean } = {}): string[] {
  const made: string[] = []
  const write = (rel: string, text: string) => {
    const f = join(p.root, rel)
    if (existsSync(f)) return
    mkdirSync(join(f, '..'), { recursive: true })
    writeFileSync(f, text)
    made.push(rel)
  }
  write('docs/TASKS.md', `# Tareas de ${p.name}\n\nUna línea por tarea: \`- [ ] ID · título\` (\`[~]\` a medias, \`[x]\` hecha). Si una tarea espera a otra: \`(tras: ID)\`. El modelo que basta: \`[sonnet]\`, \`[opus]\` o \`[fable]\`. Si necesita algo que no se comparte: \`{unity}\`, \`{gpu}\`.\n\n## Por hacer\n\n`)
  write('docs/RELEVO.md', `# Relevo de ${p.name}\n\nQuien trabaje aquí pone al día estas dos líneas al cerrar cada bloque.\n\n**En curso:** nadie.\n\n**Último latido:** ${today()} · Mission Control · Proyecto preparado: ${p.summary}.\n`)
  if (!p.docs.state) write('docs/STATE.md', `# Estado de ${p.name}\n\n${p.summary}.\n`)
  write('docs/DECISIONS.md', `# Decisiones de ${p.name}\n\nUna línea por decisión, con su fecha y su motivo.\n`)
  write('docs/PROYECTO.md', projectCard(p))
  if (p.checks.length) write('pmc.json', JSON.stringify({ verifica: p.checks }, null, 2) + '\n')
  if (!p.docs.cadaSesion) {
    const f = join(p.root, 'CLAUDE.md')
    const cur = existsSync(f) ? readFileSync(f, 'utf8') : `# ${p.name}\n\n${p.summary}.\n`
    writeFileSync(f, cur.trimEnd() + '\n\n' + CADA_SESION)
    made.push(p.docs.claudeMd ? 'CLAUDE.md (sección «Cada sesión»)' : 'CLAUDE.md')
  }
  if (opts.agents !== false) for (const a of p.agents) {
    const rel = `.claude/agents/${a.name}.md`
    const f = join(p.root, rel)
    // One the app wrote and nobody edited (it still has the mark) is brought up to date; any other is left alone.
    if (opts.refreshAgents && existsSync(f)) {
      const cur = readFileSync(f, 'utf8')
      const next = agentFile(a)
      // Git may turn its line ends into CRLF on a checkout: that is not a change worth rewriting it for.
      if (cur.includes(AGENT_MARK) && cur.replace(/\r\n/g, '\n') !== next) { writeFileSync(f, next); made.push(`${rel} (actualizado)`) }
      continue
    }
    write(rel, agentFile(a))
  }
  // The project skill with every pmc order (12-11): only its description is in every session; the rest, when needed.
  if (opts.agents !== false) {
    const rel = '.claude/skills/mission-control/SKILL.md'
    const f = join(p.root, rel)
    if (opts.refreshAgents && existsSync(f)) {
      const cur = readFileSync(f, 'utf8')
      if (cur.includes(AGENT_MARK) && cur.replace(/\r\n/g, '\n') !== PMC_SKILL) { writeFileSync(f, PMC_SKILL); made.push(`${rel} (actualizado)`) }
    } else write(rel, PMC_SKILL)
  }
  return made
}

/** Does a folder look like a project at all (and not a home folder or a drive)? */
export function looksLikeProject(root: string): boolean {
  try { if (!statSync(root).isDirectory()) return false } catch { return false }
  const n = list(root).length
  return n > 0 && n < 5000
}
