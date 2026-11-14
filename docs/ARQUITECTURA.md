# Arquitectura de Pakitron Mission Control

Aplicación de escritorio para Windows (con camino a macOS) que coordina las cuatro cuentas de Claude Code y sus proyectos. Todo es local: no hay servidores ni servicios externos, y no gasta uso de ninguna cuenta.

## Decisión: Electron en vez de Tauri

El encargo proponía Tauri 2. Se cambió a **Electron 45 + React 19 + TypeScript + Vite (electron-vite) + Tailwind 4 + Motion**. Las razones:

1. **La lógica se usa sin la app abierta.** La línea de estado y los hooks de Claude Code ejecutan un programa en cada respuesta, también con Mission Control cerrado. Ese programa (`pmc.mjs`) y la app comparten el mismo núcleo en TypeScript (`src/core`). Con Tauri habría que escribir esa lógica dos veces (en Rust y en TS) o depender igualmente de Node.
2. **Base de datos sin módulos nativos.** SQLite viene dentro de Node (`node:sqlite`, en Node 24 y en el Node de Electron 45). No hay que compilar nada, y la app y el CLI usan la misma base de datos a la vez (modo WAL).
3. **El equipo no tiene Rust.** Tauri exigía instalar Rust y su cadena de compilación; Electron solo necesita npm.
4. **Vídeo y WebGL iguales en todas partes.** Electron trae su propio Chromium (con H.264), útil para el visor de vídeo y el futuro visor 3D.

**Coste aceptado:** el instalador es más grande (unos 80-120 MB frente a ~10 MB) y la app usa más memoria (~150-250 MB). En un equipo que mueve Unity y cuatro Claude Code, es poco.

**Para un cambio futuro a Tauri:** la interfaz no sabe nada de Electron. Solo habla con `window.pmc.call(método, ...args)` (`src/preload/index.ts`), así que bastaría con reimplementar ese puente.

## Módulos (los 11 del encargo)

| Módulo | Dónde | Estado |
|---|---|---|
| 1. Interfaz visual | `src/renderer` (React; pantallas en `screens/`, piezas en `components/`) | Hecho v0.1 |
| 2. Base de datos | `src/core/db.ts` (SQLite, migraciones que solo añaden) | Hecho |
| 3. Gestor de proyectos | `src/core/projects.ts` (worktrees, carpetas, git de solo lectura) | Hecho |
| 4. Gestor de sesiones | `src/core/sessions.ts` (`claude agents --json`, `history.jsonl`, final de cada conversación) | Lectura hecha; abrir y retomar con botones |
| 5. Sistema de eventos | tabla `events` + cronología calculada de fuentes reales (`engine.ts › timeline`) | Hecho; hooks preparados (`pmc hook`), sin instalar |
| 6. Coordinador de agentes | estado de cada cuenta (`engine.ts › buildAgents`); tablas `claims` y `claim_history` listas | Fase 3 |
| 7. Gestor de tareas | `engine.ts › syncTasks` (TASKS.md, solo lectura) + tareas propias | Hecho |
| 8. Archivos y multimedia | `src/core/media.ts` (índice sin copiar; huella rápida contra duplicados) + protocolo `pmc://` | Hecho (sin 3D) |
| 9. Control de uso | `pmc statusline` + `accounts.ts › buildUsage` (línea de estado, `credits_*.txt` y `wake.log`) | Hecho; falta activarlo en cada cuenta |
| 10. Motor de anotaciones | `src/core/review.ts` + `components/Viewer.tsx` (punto, círculo, flecha, segundo de vídeo y fotograma) | Hecho |
| 11. Integración Git | `projects.ts` (estado de cada copia, commits) | Lectura hecha; integración: fase 5 |

## De dónde sale cada dato (procedencia)

Nada se inventa. Si un dato no existe, la interfaz pone «Sin datos».

- **Sesiones vivas:** `claude agents --json`, con el `CLAUDE_CONFIG_DIR` de cada cuenta. Es la orden documentada «para scripts». Se consulta cada 20 s y al volver a la ventana (unos 300 ms las cuatro cuentas).
- **Qué cuenta usó cada conversación:** el `history.jsonl` de cada carpeta de cuenta. Si varias cuentas usaron la misma conversación, cuenta la última que escribió en ella.
- **Modelo, título y última actividad:** el final (los últimos 384 KB) de `projects/<carpeta>/<sesión>.jsonl`, solo lectura. Es un formato interno de Claude Code: si cambia, esos campos quedan en «Sin datos» y nada se rompe.
- **Consumo de 5 h y semanal, con sus reinicios:** la `statusLine` oficial (`rate_limits.five_hour` y `seven_day`). La escribe `pmc statusline` en `%LOCALAPPDATA%\PakitronMC\usage\<cuenta>.json`, con historial en `<cuenta>.history.jsonl`. Solo llega a partir de la primera respuesta de cada sesión.
- **Límites agotados:** los lee la app del mensaje de límite en la conversación, de la línea de estado y de la sonda de uso; un proyecto puede tener además su propio gancho que los apunta en una carpeta (`credits_<cuenta>.txt` y `wake.log`), y también se lee si esa carpeta está en `carpetasDeLimites` de `%LOCALAPPDATA%\PakitronMC\este-pc.json`. Ese archivo guarda lo que es solo de ese PC y no va en el código: esas carpetas y los juegos propios del usuario (`juegos`, que se suman a los comunes de `core/resources.ts` para no lanzar nada pesado mientras juega). Un límite cuenta como activo mientras su reinicio está en el futuro, salvo que la cuenta haya trabajado después.
- **Contexto de la conversación:** sale de la línea de estado y se muestra aparte. Nunca se mezcla con los límites de la suscripción.
- **Tareas:** el `TASKS.md` cambiado más recientemente de entre todas las copias. `[x]` significa «hecha según el agente». **Verificada** solo lo es cuando el usuario lo marca en la app.
- **Relevos:** las líneas de «latido» de `RELEVO.md` de cada copia.
- **Cronología:** se calcula al pedirla desde git, `RELEVO.md`, `TASKS.md` (las fechas escritas junto a «Hecho»), `history.jsonl` (tus peticiones), los archivos nuevos y `wake.log`. Los cambios de casilla de `TASKS.md` que se detectan entre dos lecturas se guardan como eventos.

## Qué escribe Mission Control y dónde

- `%LOCALAPPDATA%\PakitronMC\`: `mission.db`, `usage\`, `thumbs\` (miniaturas de Windows), `frames\` (fotogramas de vídeo comentados), `backups\` (base de datos a diario, 14 copias; `config\` con los settings.json anteriores), `bin\pmc.mjs`, `statusline-chain.json` y `mission.log`.
- **Solo si el usuario lo activa:**
  - El `settings.json` de cada cuenta, para añadir la `statusLine`, con copia previa. Se quita con un clic y devuelve la línea de estado anterior si la había.
  - El `docs\Buzón.md` del proyecto, bajo «Apuntes nuevos», con copia previa. Está desactivado por defecto: los proyectos empiezan en solo lectura.
- **Nunca:** credenciales (solo se comprueba que el archivo existe), código del proyecto, git (solo `--no-optional-locks status/log/worktree list`), hooks existentes.

## Coordinación (v0.5)

- **Reservas de tareas** (`src/core/coord.ts`, tablas `claims` y `claim_history`):
  - Una tarea reservada por una cuenta no la puede tomar otra mientras la reserva siga viva: dura 2 h y se renueva en cada `Stop` de esa cuenta.
  - Si una sesión muere, la reserva caduca, sale como «abandonada» y otra cuenta puede recogerla. Queda en el historial.
  - Los agentes usan `pmc claim <ID>`, `pmc release <ID>` y `pmc claims`.
- **Hooks** (`integrations.ts › installHooks`):
  - Los activa el usuario en Ajustes. Llevan copia previa, se suman a los existentes y solo se quitan los suyos.
  - `SessionStart` devuelve `additionalContext` con las instrucciones pendientes de esa cuenta en ese proyecto, que pasan a «recibida» porque han llegado de verdad, y la lista de tareas reservadas por otras cuentas.
  - El resto (`Stop`, `StopFailure`, `PreCompact`, `SessionEnd` y `PostToolUse` en Write/Edit) solo escribe en `%LOCALAPPDATA%\PakitronMC\spool\` y no bloquea nunca.
  - La app lee ese spool cada 5 s (posición en `spool_offsets`) y lo convierte en eventos de cronología y en «Claude responsable» de los archivos escritos.
- **Relevo:** «Pasar su trabajo a…», en la ficha de un Claude, genera con `handoffText` una instrucción para el receptor con qué hacía, sus tareas, lo que quedó sin guardar y por dónde empezar, y le pasa las reservas. No se arranca ninguna sesión: la recibe al abrir la suya.

## Integración git (v0.3)

`projects.ts › integration` compara cada copia con la rama de la copia principal: lo guardado que falta integrar (`rev-list`, `log base..rama`), lo que le falta de la principal, y los archivos tocados en las dos ramas desde que se separaron (`merge-base`, más `diff --name-only` en cada lado). Esos archivos son el posible conflicto. No usa `merge-tree`, porque escribe objetos en `.git`: todo es lectura.

## Visor 3D (v0.4)

`components/ModelStage.tsx`, cargado solo al abrir un modelo:
- **Formatos:** GLB y glTF (con Draco local en `public/draco` y meshopt), FBX y OBJ.
- **Luz:** `RoomEnvironment`, generada en local y sin red.
- **Vistas:** sólido, arcilla, malla y normales.
- **Comentarios:** en un punto 3D (`geom.p`).
- **Archivos acompañantes:** los del `.gltf` se sirven con `pmc://rel/<id>/<ruta>`, sin salir de su carpeta.

## Actualizar la app

`npm run actualizar` (`scripts/actualizar.ps1`) copia `dist\win-unpacked` a `%LOCALAPPDATA%\Programs\Pakitron Mission Control` y pone los accesos del usuario. No usa el instalador: con la instalación vieja para todos los usuarios que hay en Program Files, el instalador NSIS siempre pide permiso de administrador, también en silencio.

## Entrega de instrucciones: estados honestos

`guardada` → `entregada` (escrita en el Buzón) → `recibida` (la línea desaparece del Buzón, que es la regla de los agentes: «si un apunte ya no está, lo ha leído y apuntado») → `ejecutada` (lo aprueba el usuario). Cada línea lleva la marca `(MC-<id>)` para seguirla. Sin permiso de Buzón, la instrucción se queda en `guardada`: se puede copiar, pero no se presenta como entregada.

## Comprobación visual automática

`PMC_SHOT_DIR=<carpeta>` arranca la app, recorre las pantallas con los tamaños de `PMC_SHOT_SIZES` (por defecto 1480×920, 3440×1440 y 900×700) y los temas de `PMC_SHOT_THEMES`, guarda una captura por pantalla y un `.json` con los elementos que se salen de la ventana, y se cierra. `PMC_SHOT_STEPS` abre capas (visor, ficha de agente, búsqueda, compositor) mediante `window.__pmc`.

## Seguridad

- La ventana usa `contextIsolation` y no tiene Node en la interfaz.
- El protocolo `pmc://` solo sirve archivos indexados por su id, o miniaturas.
- La CSP solo permite `self` y `pmc:`.
- Los enlaces externos se abren en el navegador.
- No se lanza ninguna sesión de Claude sin que el usuario pulse un botón. Los botones usan el lanzador de cada cuenta (`claude-accesos\claudeN.cmd`), que comprueba la cuenta.

## Módulos de `src/core` añadidos el 12-11 (0.14 a 0.16)

- `dispatch.ts`: la única puerta de las ventanas automáticas (una por cuenta, tope por proyecto, nada para «No usar» o «De baja»).
- `workmode.ts`: las tres formas de trabajar («Solo cuando yo lo diga», «Cada uno sigue con lo suyo», «Se relevan entre ellos») y los interruptores que pone cada una.
- `profile.ts`: qué es un proyecto leyendo su carpeta, qué le falta, sus subagentes y su skill `mission-control` (`pmc preparar`); `templates.ts`, las plantillas de «Crear proyecto».
- `autonomy.ts`: el «no termines el turno» del modo autónomo (gancho Stop, que no debe ir en segundo plano) y cuándo un «para» del usuario manda.
- `checkpoint.ts`: `pmc guarda` (latido con hora real, commit solo de lo propio si otra cuenta escribe en la misma copia, relevo que no crece).
- `routines.ts`: comprobaciones que la app lanza sola tras cada commit y de noche (`nightWindow`), sin gastar Claude.
- `route.ts`: a qué proyecto apunta un texto y qué cuenta lo hará (encargos, carpetas de Astra en `astra.ts`).
- `projecthealth.ts`: la línea de salud de cada proyecto en Inicio; `models.ts`, el modelo que pide una tarea.
- `subagentuse.ts`: usos reales de subagentes y skills, leyendo las conversaciones en segundo plano y solo lo nuevo (son gigas).
- `shim.ts`: `pmc` como orden corta en `~/.local/bin`; `restore.ts`: restaurar una copia de la base al reiniciar.

## Añadido el 13-11 por la tarde (0.31.0 a 0.31.5, claude1)

- `core/probe.ts` + `main/probe.ts` (EV120): la sonda de uso. Cada 10 min, a las cuentas que la app cree agotadas, `claude -p` con Haiku sin herramientas, ganchos, MCP ni conversación guardada, en `%LOCALAPPDATA%\PakitronMC\sonda`; lee el `rate_limit_event` del stream-json. «allowed»: apunta la lectura donde la statusLine y marca la cuenta como recargada; «rejected» con vuelta antes de lo que se creía: corrige la hora (`backSooner`). Agotada no cuesta nada.
- `core/backup.ts` + `main/backup.ts` (EV44): copias de seguridad en `G:\Copias de proyectos\<id>.git` cada noche (03:00): `git clone --bare` la primera vez, después `git push --porcelain --no-verify` sin forzar (lo reescrito va a `reescritas/<día>/`), LFS con robocopy. Nunca borra.
- `core/disk.ts`: cuándo falta disco de verdad (`diskLow`). `core/projects.ts › isInside`: una carpeta dentro de otra, no solo empezando igual.
- `main/service.ts › timed` y `every`: todo lo que la app hace sola se mide como las llamadas de la ventana («lento: <nombre> N ms (sola)»); `rebuildSoon` agrupa los cambios de la carpeta usage. `core/sessions.ts › readTranscriptTail` lee de una conversación en marcha solo lo añadido.
- `App.tsx › useStill` y la clase `pmc-still`: las animaciones sin fin (y las lecturas de Chats) se paran cuando nadie mira la ventana.
- `index.ts › hooksSweep` (EV52): la app pone sola los ganchos a una cuenta en uso que no los tenga. `core/decisions.ts › jargonIn` (EV122): `pmc decide` devuelve las preguntas con jerga.