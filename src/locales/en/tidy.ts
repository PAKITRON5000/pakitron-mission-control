// Windows closed because nobody uses them (main/wheel.ts › tidy, core/tidy.ts › strayWindowsToClose). Keyed by the Spanish text.
export const tidy: Record<string, string> = {
  'Cerrada la ventana de {v0}, apartada y sin uso hasta {v1}': 'Closed {v0}\'s window: set aside and out of usage until {v1}',
  'Cerrada la ventana de {v0} en {name}, sin uso hasta {v1}: su rueda está en otro proyecto': 'Closed {v0}\'s window in {name}, out of usage until {v1}: its wheel is in another project',
  'otro proyecto': 'another project',
  // Between two keys in Settings › General («Ctrl + Ctrl − y Ctrl 0»).
  'y': 'and',
  // Left in Spanish in Accounts with the app in English (14-11 17:25, demo capture): the ring and the tasks of an account.
  'semana': 'week',
  '{n} tarea a su nombre': '{n} task in its name',
  '{n} tareas a su nombre': '{n} tasks in its name',
  // The tray (main/index.ts › updateTray, EV163).
  'bloqueada': 'blocked',
  'sin abrir': 'not open',
  'esperando a que alguien recupere su uso': 'waiting for someone to get usage back',
  'turno de Claude {n}': 'Claude {n}\'s turn',
  'empezando': 'starting',
  '{n} trabajando': '{n} working',
  'nadie trabajando': 'nobody working',
  // Notices and timeline of src/main/index.ts that were still plain Spanish (EV163, 14-11 17:37).
  'Nadie puede trabajar ahora.': 'Nobody can work right now.',
  'La primera vuelve el {when}.': 'The first one is back on {when}.',
  'Seguirá sola donde lo dejó: no tienes que hacer nada.': 'It will carry on by itself where it left off: you do not have to do anything.',
  'Ábrela cuando vuelva, o en Relevos elige que siga sola.': 'Open it when it is back, or choose in Relays that it carries on by itself.',
  'esa carpeta no se manda a la papelera desde aquí': 'that folder is not sent to the bin from here',
  'Prioridad {label}: {task}': '{label} priority: {task}',
  'Mission Control: el usuario te pide que cierres esta sesión. Termina el paso en curso sin dejar nada roto (no cortes una compilación ni una captura a medias), deja docs/RELEVO.md al día, libera tus reservas con pmc release y para. No empieces nada nuevo.': 'Mission Control: the user asks you to close this session. Finish the step you are on without leaving anything broken (do not cut a build or a capture halfway), bring docs/RELEVO.md up to date, release your claims with pmc release and stop. Do not start anything new.',
  'Llevaba 15 min quieta y la cuenta está apartada: no hace nada y gasta memoria. Su conversación queda guardada.': 'It had been idle for 15 min and the account is set aside: it does nothing and takes memory. Its conversation stays saved.',
  'Llevaba 15 min quieta. Cuando vuelva a tener uso, su rueda le abre otra ventana donde le toque. Su conversación queda guardada y lo que dejó está en el relevo.': 'It had been idle for 15 min. When it has usage again, its wheel opens a new window wherever its turn is. Its conversation stays saved and what it left is in the handoff.'
}
