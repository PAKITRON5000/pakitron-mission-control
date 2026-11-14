---
name: mission-control
description: Cómo trabajar en un proyecto coordinado por Mission Control con la orden pmc. Úsala al empezar a trabajar, al cerrar un bloque, antes de preguntar algo al usuario, antes de lanzar Unity, Blender o la gráfica, al entregar algo que se ve o se oye, o cuando el usuario diga que te ha contestado.
---

# Mission Control: cómo se trabaja aquí

Mission Control coordina a varios Claude (cuentas distintas) en este proyecto. Todo se hace con la orden `pmc`, desde la carpeta del proyecto. Si esa ventana no la encuentra, es `node "$LOCALAPPDATA/PakitronMC/bin/pmc.mjs"` (en PowerShell, `node "$env:LOCALAPPDATA/PakitronMC/bin/pmc.mjs"`).

## Empezar
- `pmc parte`: lo que está en curso, el último latido, tu cola y lo que tienen las demás cuentas, en poco texto. No leas enteros `docs/RELEVO.md`, `docs/TASKS.md` ni `docs/STATE.md`: son archivo.
- `pmc tarea EV12`: el texto entero de una tarea. `pmc next`: tus siguientes tareas libres, con el modelo que basta.
- `pmc claim EV12` antes de tocar una tarea (nadie más la cogerá); `pmc release EV12` al acabarla. `pmc claims`: quién tiene qué.
- `pmc relevo claude1`: si una cuenta sin uso dejó trabajo a medias aquí, te lo pasa con su latido, sus reservas y sus cambios sin guardar.
- `pmc respuestas`: lo que el usuario te contestó en Decidir o te escribió y aún no has recibido (de cualquier proyecto).
- `pmc corregido 12 "Mano recolocada sobre el mango" --foto "ruta::qué se ve"`: una nota que el usuario dejó sobre una imagen (te llega con su n.º) ya está arreglada; vuelve a él en Revisar para que la apruebe.

## Mientras trabajas
- `pmc ahora "Preparando las capturas del menú"`: una frase clara de en qué estás, al empezar y cada vez que cambies de faena. Es lo que el usuario ve en la app.
- Antes de algo pesado: `pmc recursos` y `pmc recurso unity "compilar para probar los bots"` (o `gpu`, `build`); al acabar, `pmc recurso unity --soltar`. Si dice que el usuario juega o edita vídeo, no lo lances.
- Algo de más de 5 minutos (un render, una grabación): `pmc trabajo "Render del tráiler" --log ruta.log --salida ruta.mp4 [--pid N]`.
- Para que el usuario decida, no te pares: `pmc decide "título" --pregunta "…" --opcion "A: …" --opcion "B: …" --foto "ruta::qué se ve" [--audio "ruta::qué es::para qué"] [--tarea EV12]`, y sigue con otra cosa; su respuesta te llega sola (o con `pmc respuestas`). Enséñale siempre lo concreto.

## Cerrar
- `pmc verifica EV12`: pasa las comprobaciones del proyecto (`pmc.json`) y deja el resultado en la tarea. Si fallan, arréglalo antes de darla por hecha. Lo que no tenga prueba, dilo en la entrega.
- Lo que se ve o se oye: `pmc entrega EV12 --que "qué es, sin tecnicismos" --mirar "qué tiene que mirar para aprobarla" --foto "ruta::qué se ve"` (recorta y amplía la pieza).
- Al cerrar cada bloque: `pmc guarda "qué has hecho y qué queda" --probado "qué y cómo" --siguiente "el paso concreto" --no-rehacer "lo que ya está"`. Escribe el «Último latido» con la hora real, hace el commit de lo tuyo (solo lo tuyo si otra cuenta trabaja en la misma copia) y guarda tus reservas para quien te releve. Si te dice que algo quedó sin guardar, míralo.
- Mientras te quede uso y trabajo, no termines el turno ni escribas un resumen: el usuario lo ve todo en Mission Control. Que el límite te corte a mitad de una tarea es lo que quiere; quien te releve sigue desde tu latido.

## Tareas nuevas en docs/TASKS.md
`- [ ] ID · título`, y cuando lo sepas: `(tras: EV4)` si espera a otra, `[sonnet]`, `[opus]` o `[fable]` con el modelo que basta, y `{unity}` o `{gpu}` si necesita algo que no se comparte. Las tareas a medias se firman al principio de su nota: `*Primera parte (12-11, claude3): …*`.

Subagentes del proyecto (`.claude/agents`): explorador (buscar sin gastar tu contexto), verificador (comprobar), relevo (dejar el relevo y guardar), revisor-visual (juzgar capturas)… Úsalos por tu cuenta.

<!-- Creado por Mission Control (pmc preparar). Si lo cambias a mano, borra esta línea y no se volverá a escribir. -->
