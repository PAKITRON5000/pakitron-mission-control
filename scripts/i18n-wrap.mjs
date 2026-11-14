// EV161: wraps the Spanish texts of the screens in t() / tn() (src/core/i18n.ts), so they can be shown in English.
// Only texts the user reads: JSX text, the title/placeholder/aria-label/alt/sub/label… attributes, toast(…), the label/
// title/sub/hint/description of objects, plural(n, 'a', 'b') and strings a function returns. Code, classes, keys and
// comparisons are left alone. It edits in place, keeping each file's line endings; what it could not do safely (a
// variable called `t` in the way) it lists. Run tsc and the tests afterwards.
//   node scripts/i18n-wrap.mjs <archivo.tsx> [más…] [--dry]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import traverseMod from '@babel/traverse'

const traverse = traverseMod.default ?? traverseMod
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dry = process.argv.includes('--dry')
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))

const ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'sub', 'label', 'hint', 'description', 'tooltip', 'empty', 'text', 'detail', 'why', 'question', 'confirm'])
const PROPS = new Set(['label', 'title', 'sub', 'hint', 'description', 'placeholder', 'tip', 'help', 'empty'])
const LETTER = /[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]/

/** A string the user reads (not a key, a class, a colour, a path or code). */
function uiText(s, strict = true) {
  const v = s.trim()
  if (v.length < 2 || !LETTER.test(v)) return false
  if (/^(var\(|#|https?:|\.{0,2}\/|[a-z]+:\/\/|rgb|calc\(|url\()/.test(v)) return false
  if (/[{}<>;=]|=>/.test(v)) return false
  if (/^[a-z0-9]+(?:[-_.:/][a-z0-9]+)+$/i.test(v)) return false // ids, routes, files
  if (/^[a-z][a-z0-9-]*( [a-z][a-z0-9-:[\]/.]*)+$/.test(v) && /-/.test(v)) return false // class lists
  if (!strict) return true
  // A lone lowercase word without accents is usually a value («general», «abiertos», «si»).
  if (!/\s/.test(v) && /^[a-z]+$/.test(v)) return false
  return true
}

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`

function relImport(file) {
  let r = relative(dirname(file), join(root, 'src', 'core', 'i18n')).replace(/\\/g, '/')
  if (!r.startsWith('.')) r = './' + r
  return r
}

let skipped = []

function transformFile(file) {
  const src = readFileSync(file, 'utf8')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'], ranges: false })
  const edits = []
  const taken = [] // ranges already replaced
  const inTaken = (n) => taken.some(([a, b]) => n.start >= a && n.end <= b)
  const add = (n, text) => { if (inTaken(n)) return false; edits.push({ start: n.start, end: n.end, text }); taken.push([n.start, n.end]); return true }
  let needsT = false
  let needsTn = false
  const slice = (n) => src.slice(n.start, n.end)

  // Names for the holes: a plain name when it says what it is, else v0, v1…
  function holeName(expr, used) {
    let base
    if (expr.type === 'Identifier') base = expr.name
    else if (expr.type === 'MemberExpression' && !expr.computed && expr.property.type === 'Identifier') base = expr.property.name
    if (!base || !/^[A-Za-z]\w{0,20}$/.test(base) || used.has(base) || base === 't') { let i = 0; while (used.has('v' + i)) i++; base = 'v' + i }
    used.add(base)
    return base
  }

  /** The expression's text with its UI strings translated; undefined if nothing in it is UI text. */
  function render(node, strict) {
    switch (node.type) {
      case 'StringLiteral':
        if (!uiText(node.value, strict)) return undefined
        needsT = true
        return `t(${q(node.value)})`
      case 'TemplateLiteral': {
        const text = node.quasis.map((x) => x.value.cooked ?? x.value.raw).join('')
        if (!LETTER.test(text) || !uiText(text.replace(/\s+/g, ' ') + ' x', false)) return undefined
        if (node.quasis.some((x) => /[{}]/.test(x.value.cooked ?? ''))) return undefined
        const used = new Set()
        let key = ''
        const vars = []
        node.quasis.forEach((qq, i) => {
          key += qq.value.cooked ?? qq.value.raw
          const e = node.expressions[i]
          if (e) { const name = holeName(e, used); key += `{${name}}`; vars.push(`${name}: ${render(e, false) ?? slice(e)}`) }
        })
        needsT = true
        return vars.length ? `t(${q(key)}, { ${vars.join(', ')} })` : `t(${q(key)})`
      }
      case 'ConditionalExpression': {
        const a = render(node.consequent, strict), b = render(node.alternate, strict)
        if (!a && !b) return undefined
        return `${slice(node.test)} ? ${a ?? slice(node.consequent)} : ${b ?? slice(node.alternate)}`
      }
      case 'LogicalExpression': {
        if (node.operator === '&&') { const b = render(node.right, strict); return b ? `${slice(node.left)} && ${b}` : undefined }
        const a = render(node.left, strict), b = render(node.right, strict)
        if (!a && !b) return undefined
        return `${a ?? slice(node.left)} ${node.operator} ${b ?? slice(node.right)}`
      }
      case 'ParenthesizedExpression': { const a = render(node.expression, strict); return a ? `(${a})` : undefined }
      case 'TSAsExpression': return undefined
      case 'CallExpression': {
        // plural(n, 'tarea', 'tareas') → tn(n, '{n} tarea', '{n} tareas')
        if (node.callee.type === 'Identifier' && node.callee.name === 'plural' && node.arguments.length === 3 && node.arguments[1].type === 'StringLiteral' && node.arguments[2].type === 'StringLiteral') {
          needsTn = true
          return `tn(${slice(node.arguments[0])}, ${q('{n} ' + node.arguments[1].value)}, ${q('{n} ' + node.arguments[2].value)})`
        }
        return undefined
      }
      default: return undefined
    }
  }

  let path0
  const shadowed = (path) => path.scope.hasBinding('t') && path.scope.getBinding('t')?.kind !== 'module'
  const replaceExpr = (path, node, strict = true) => {
    if (shadowed(path)) { skipped.push(`${relative(root, file)}:${node.loc.start.line} (hay una «t» local)`); return }
    const r = render(node, strict)
    if (r) add(node, r)
  }
  const insideT = (path) => !!path.findParent((p) => p.isCallExpression() && p.node.callee.type === 'Identifier' && ['t', 'tn'].includes(p.node.callee.name))

  traverse(ast, {
    JSXElement(path) { handleChildren(path) },
    JSXFragment(path) { handleChildren(path) },
    JSXAttribute(path) {
      const name = path.node.name.type === 'JSXIdentifier' ? path.node.name.name : path.node.name.name?.name
      if (!ATTRS.has(name)) return
      const v = path.node.value
      if (!v) return
      if (v.type === 'StringLiteral') {
        if (!uiText(v.value) || shadowed(path)) return
        needsT = true
        add(v, `{t(${q(v.value)})}`)
      } else if (v.type === 'JSXExpressionContainer' && v.expression.type !== 'JSXEmptyExpression') {
        if (insideT(path)) return
        replaceExpr(path, v.expression)
      }
    },
    CallExpression(path) {
      const c = path.node.callee
      const isToast = (c.type === 'Identifier' && c.name === 'toast') || (c.type === 'MemberExpression' && c.property.type === 'Identifier' && c.property.name === 'toast')
      if (isToast && path.node.arguments[0] && !insideT(path)) replaceExpr(path, path.node.arguments[0], false)
      if (c.type === 'Identifier' && c.name === 'plural' && !insideT(path)) replaceExpr(path, path.node)
    },
    ObjectProperty(path) {
      const k = path.node.key
      const key = k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : undefined
      if (!key || !PROPS.has(key) || path.node.computed) return
      const v = path.node.value
      if (insideT(path)) return
      const atModule = !path.getFunctionParent()
      if (atModule) {
        const r = render(v, true)
        if (!r) return
        // Made when the module loads: a getter, so it is read in the language of the moment.
        add(path.node, `get ${key}() { return ${r} }`)
      } else replaceExpr(path, v)
    },
    ReturnStatement(path) {
      const a = path.node.argument
      if (!a || insideT(path) || !file.endsWith('.tsx')) return
      if (['StringLiteral', 'TemplateLiteral', 'ConditionalExpression'].includes(a.type)) replaceExpr(path, a)
    }
  })

  function simpleExpr(e) {
    if (!e || e.type === 'JSXEmptyExpression') return false
    let ok = true
    traverse(e, { enter(p) { if (p.isJSXElement() || p.isJSXFragment() || p.isArrowFunctionExpression() || p.isFunctionExpression()) { ok = false; p.stop() } } }, path0.scope, undefined, path0)
    return ok
  }
  function handleChildren(path) {
    path0 = path
    if (shadowed(path)) { if (path.node.children.some((c) => c.type === 'JSXText' && uiText(c.value, false))) skipped.push(`${relative(root, file)}:${path.node.loc.start.line} (hay una «t» local)`); return }
    const kids = path.node.children
    let i = 0
    while (i < kids.length) {
      // A run on one line: text and simple expressions together, read as one sentence.
      let j = i
      while (j < kids.length && ((kids[j].type === 'JSXText' && !/\n/.test(kids[j].value)) || (kids[j].type === 'JSXExpressionContainer' && simpleExpr(kids[j].expression)))) j++
      const run = kids.slice(i, j)
      const texts = run.filter((k) => k.type === 'JSXText' && uiText(k.value, false))
      if (run.length > 1 && texts.length && run.some((k) => k.type === 'JSXExpressionContainer')) {
        let first = run.findIndex((k) => k.type !== 'JSXText' || k.value.trim())
        let last = run.length - 1 - [...run].reverse().findIndex((k) => k.type !== 'JSXText' || k.value.trim())
        const part = run.slice(first, last + 1)
        const used = new Set()
        let key = ''
        const vars = []
        for (const k of part) {
          if (k.type === 'JSXText') key += k.value
          else { const name = holeName(k.expression, used); key += `{${name}}`; vars.push(`${name}: ${render(k.expression, false) ?? slice(k.expression)}`) }
        }
        const lead = part[0].type === 'JSXText' ? part[0].value.match(/^\s*/)[0] : ''
        const trail = part[part.length - 1].type === 'JSXText' ? part[part.length - 1].value.match(/\s*$/)[0] : ''
        key = key.slice(lead.length, key.length - trail.length)
        if (!/[{}]/.test(key.replace(/\{\w+\}/g, '')) && !part.some((k) => inTaken(k))) {
          needsT = true
          const start = part[0].start, end = part[part.length - 1].end
          edits.push({ start, end, text: `${lead}{t(${q(key)}, { ${vars.join(', ')} })}${trail}` })
          taken.push([start, end])
        }
        i = j
        continue
      }
      if (i === j) j = i + 1
      for (const k of kids.slice(i, j)) {
        if (k.type !== 'JSXText' || !uiText(k.value, false) || inTaken(k)) continue
        const lead = k.value.match(/^\s*/)[0], trail = k.value.match(/\s*$/)[0]
        const body = k.value.slice(lead.length, k.value.length - trail.length).replace(/\s*\n\s*/g, ' ')
        needsT = true
        edits.push({ start: k.start, end: k.end, text: `${lead}{t(${q(body)})}${trail}` })
        taken.push([k.start, k.end])
      }
      i = j
    }
  }

  if (!edits.length) return 0
  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  // The import, once.
  const want = [needsT && 't', needsTn && 'tn'].filter(Boolean)
  const m = out.match(/^import \{([^}]*)\} from '([^']*core\/i18n)'/m)
  if (m) {
    const have = m[1].split(',').map((x) => x.trim()).filter(Boolean)
    const all = [...new Set([...have, ...want])]
    out = out.replace(m[0], `import { ${all.join(', ')} } from '${m[2]}'`)
  } else if (want.length) {
    const firstImport = out.search(/^import /m)
    const line = `import { ${want.join(', ')} } from '${relImport(file)}'${eol}`
    out = firstImport >= 0 ? out.slice(0, firstImport) + line + out.slice(firstImport) : line + out
  }
  if (!dry) writeFileSync(file, out)
  return edits.length
}

let total = 0
for (const f of files) {
  try {
    const n = transformFile(resolve(f))
    total += n
    if (n) console.log(`${f}: ${n}`)
  } catch (e) {
    console.log(`${f}: NO (${e.message.split('\n')[0]})`)
  }
}
if (skipped.length) console.log(`\nSin tocar (${skipped.length}): ${skipped.slice(0, 30).join('; ')}`)
console.log(`\n${total} textos envueltos${dry ? ' (sin escribir)' : ''}.`)
