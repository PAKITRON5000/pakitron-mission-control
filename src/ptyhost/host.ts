// EV156: the process that holds the Claude sessions living inside the app (server.ts). The app starts it, detached, the
// first time one is opened, and it outlives the app: it ends by itself with no session left and nobody connected.
// Run as: node host.cjs <pipe> <token file> <log file>
import { appendFileSync, readFileSync } from 'node:fs'
import { startHost } from './server'

const [pipe, tokenFile, logFile] = process.argv.slice(2)
let token = ''
try { token = readFileSync(tokenFile, 'utf8').trim() } catch { /* checked below */ }
if (!pipe || token.length < 16) process.exit(2)

// Never taken down by one bad moment: it holds sessions that are working.
process.on('uncaughtException', (e) => { try { appendFileSync(logFile, `${new Date().toISOString()} error: ${e.stack ?? e.message}\n`) } catch { /* no log */ } })
startHost({ pipe, token, logFile, onIdle: () => process.exit(0) }).catch(() => process.exit(3))
