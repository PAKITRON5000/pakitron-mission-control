// EV127: projects unlike the first ones (a game, this app, a video edit) are understood too, each with its card, its
// checks and its way of working («cinco proyectos de prueba de tipos distintos salen con ficha, comprobaciones y forma
// de trabajar sensatas»).
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectProfile, prepareProject, WORK_TIPS } from '../src/core/profile'

const mk = (root: string, rel: string, text = 'x') => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }
const dir = (name: string) => mkdtempSync(join(tmpdir(), `pmc-${name}-`))

/** Prepares it and returns what a Claude would read: the card, the checks and the subagents. */
function prepared(root: string, skills: string[] = []) {
  const p = detectProfile(root, skills)
  prepareProject(p)
  const card = readFileSync(join(root, 'docs', 'PROYECTO.md'), 'utf8')
  let checks: { nombre: string; orden: string }[] = []
  try { checks = JSON.parse(readFileSync(join(root, 'pmc.json'), 'utf8')).verifica } catch { /* none */ }
  return { p, card, checks, agents: p.agents.map((a) => a.name) }
}

describe('kinds of project beyond games, apps and video (EV127)', () => {
  it('a Rust program: cargo build and cargo test, and the tip about compiling', () => {
    const root = dir('rust')
    mk(root, 'Cargo.toml', '[package]\nname = "calculadora"\nversion = "0.1.0"\n')
    mk(root, 'src/main.rs', 'fn main() {}')
    const { p, card, checks } = prepared(root, ['rust-best-practices', 'impeccable'])
    expect(p.kinds).toEqual(['rust'])
    expect(p.summary).toBe('Programa en Rust; sin git')
    expect(p.details.crate).toBe('calculadora')
    expect(checks.map((c) => c.orden)).toEqual(['cargo build --quiet', 'cargo test --quiet'])
    expect(p.skills).toEqual(['rust-best-practices'])
    expect(card).toContain(WORK_TIPS.rust)
    expect(card).toContain('`cargo test --quiet`')
  })

  it('a data analysis in notebooks: no code checks invented, a reviewer of numbers, notebooks and data kept out of git', () => {
    const root = dir('datos')
    mk(root, 'analisis/ventas.ipynb', '{"cells": []}')
    mk(root, 'analisis/clientes.ipynb', '{"cells": []}')
    for (const m of ['enero', 'febrero', 'marzo']) mk(root, `datos/${m}.csv`, 'a,b\n1,2\n')
    const { p, card, checks, agents } = prepared(root, ['dataviz', 'xlsx', 'impeccable'])
    expect(p.kinds).toEqual(['data'])
    expect(p.details.datos).toBe('2 cuadernos, 3 tablas')
    expect(checks).toEqual([])
    expect(card).toContain('(por completar): la orden que dice si algo se ha roto')
    expect(agents).toContain('revisor-datos')
    expect(agents).not.toContain('revisor-visual')
    expect(p.skills).toEqual(['dataviz', 'xlsx'])
    expect(card).toContain('jupyter nbconvert --clear-output --inplace')
  })

  it('a book in LaTeX: compiled with latexmk from the file with \\documentclass, and a proofreader', () => {
    const root = dir('libro')
    mk(root, 'libro.tex', '\\documentclass{book}\n\\begin{document}\n\\input{capitulos/uno}\n\\end{document}\n')
    mk(root, 'capitulos/uno.tex', 'Érase una vez.')
    const { p, card, checks, agents } = prepared(root, ['setup-writing-style', 'docx', 'dataviz'])
    expect(p.kinds).toEqual(['writing'])
    expect(checks.map((c) => c.orden)).toEqual(['latexmk -pdf -interaction=nonstopmode -halt-on-error "libro.tex"'])
    expect(agents).toContain('corrector')
    expect(p.skills).toEqual(['docx', 'setup-writing-style'])
    expect(card).toContain(WORK_TIPS.writing)
  })

  it('a novel in Markdown chapters counts as writing; the app’s own notes in docs/ do not', () => {
    const root = dir('novela')
    for (let i = 1; i <= 6; i++) mk(root, `capitulos/capitulo-${i}.md`, `# Capítulo ${i}`)
    expect(detectProfile(root, []).kinds).toEqual(['writing'])
    const notes = dir('notas')
    for (const f of ['TASKS', 'RELEVO', 'STATE', 'DECISIONS', 'PROYECTO']) mk(notes, `docs/${f}.md`, '# x')
    mk(notes, 'README.md', '# x')
    expect(detectProfile(notes, []).kinds).toEqual(['docs'])
  })

  it('a song in Ableton with its stems: music, never two accounts on the same project file', () => {
    const root = dir('cancion')
    mk(root, 'Cancion Project/Cancion.als')
    for (let i = 0; i < 4; i++) mk(root, `Cancion Project/Samples/pista-${i}.wav`)
    const { p, card, checks } = prepared(root, ['audio-mixing', 'impeccable'])
    expect(p.kinds).toEqual(['audio'])
    expect(p.details.audio).toBe('1 proyecto de estación de audio')
    expect(checks).toEqual([])
    expect(p.skills).toEqual(['audio-mixing'])
    expect(card).toContain(WORK_TIPS.audio)
  })

  it('a Flutter app gets analyze and test and the visual reviewer; its android/ folder does not make it an Android app', () => {
    const root = dir('flutter')
    mk(root, 'pubspec.yaml', 'name: tienda\ndependencies:\n  flutter:\n    sdk: flutter\n')
    mk(root, 'test/widget_test.dart', 'void main() {}')
    mk(root, 'android/build.gradle', '')
    mk(root, 'android/app/src/main/AndroidManifest.xml', '<manifest/>')
    const { p, checks, agents } = prepared(root)
    expect(p.kinds).toEqual(['flutter'])
    expect(checks.map((c) => c.orden)).toEqual(['flutter analyze', 'flutter test'])
    expect(agents).toContain('revisor-visual')
  })

  it('an Android app takes the build resource; a .NET solution builds and tests; Unity’s own .csproj is not .NET', () => {
    const a = dir('android')
    mk(a, 'settings.gradle.kts', ''); mk(a, 'gradlew.bat', ''); mk(a, 'app/src/main/AndroidManifest.xml', '<manifest/>')
    const pa = prepared(a)
    expect(pa.p.kinds).toEqual(['android'])
    expect(pa.p.heavy).toEqual(['build'])
    expect(pa.checks.map((c) => c.orden)).toEqual(['gradlew.bat assembleDebug --quiet', 'gradlew.bat test --quiet'])
    const n = dir('dotnet')
    mk(n, 'Facturas.sln', ''); mk(n, 'src/Facturas/Facturas.csproj', '<Project/>'); mk(n, 'tests/Facturas.Tests/Facturas.Tests.csproj', '<Project/>')
    const pn = prepared(n)
    expect(pn.p.kinds).toEqual(['dotnet'])
    expect(pn.checks.map((c) => c.nombre)).toEqual(['compila', 'pruebas'])
    const u = dir('unity')
    mk(u, 'Assets/a.cs'); mk(u, 'ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 6000.0.1f1\n'); mk(u, 'Juego.sln'); mk(u, 'Assembly-CSharp.csproj')
    expect(detectProfile(u, []).kinds).toEqual(['unity'])
  })

  it('Go, C++ with CMake tests, a Swift package and an Xcode app (no check that only a Mac could pass)', () => {
    const g = dir('go'); mk(g, 'go.mod', 'module ejemplo.com/servidor\n\ngo 1.23\n')
    expect(detectProfile(g, []).checks.map((c) => c.orden)).toEqual(['go vet ./...', 'go test ./...'])
    expect(detectProfile(g, []).details.modulo).toBe('ejemplo.com/servidor')
    const c = dir('cpp'); mk(c, 'CMakeLists.txt', 'project(motor)\nenable_testing()\nadd_test(NAME t COMMAND t)\n')
    expect(detectProfile(c, []).checks.map((x) => x.nombre)).toEqual(['compila', 'pruebas'])
    const s = dir('swift'); mk(s, 'Package.swift', '// swift-tools-version:5.9'); mk(s, 'Tests/a.swift')
    expect(detectProfile(s, []).checks.map((x) => x.orden)).toEqual(['swift build', 'swift test'])
    const x = dir('xcode'); mkdirSync(join(x, 'Notas.xcodeproj'), { recursive: true })
    const px = detectProfile(x, [])
    expect(px.kinds).toEqual(['swift'])
    expect(px.checks).toEqual([])
    expect(px.details.xcode).toBe('se compila en un Mac')
  })

  it('a static web page without package.json is a web; loose sounds in a video edit do not make it music', () => {
    const w = dir('web'); mk(w, 'index.html', '<!doctype html>')
    expect(detectProfile(w, []).kinds).toEqual(['web'])
    const v = dir('video')
    for (const n of ['a.mp4', 'b.mp4', 'c.mov']) mk(v, n)
    for (let i = 0; i < 12; i++) mk(v, `musica/${i}.wav`)
    expect(detectProfile(v, []).kinds).toEqual(['video'])
  })
})
