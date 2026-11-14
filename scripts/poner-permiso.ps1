# Añade el «Permiso permanente del usuario» al CLAUDE.md global de cada cuenta de Claude de este PC.
# Lo ejecuta el usuario (doble clic en «Poner permiso permanente.cmd»): una sesión de Claude no puede darse permisos.
# Antes de tocar cada archivo guarda una copia al lado (.bak-permiso). Si ya lo tiene, no lo repite.
$ErrorActionPreference = 'Stop'
$texto = @'


# Permiso permanente del usuario
Tienes mi permiso, sin preguntar, para instalar lo que el trabajo necesite (dependencias, herramientas, skills de autores fiables), ejecutar órdenes, compilar, probar, crear y modificar archivos de mis proyectos, y aceptar los pasos intermedios. Trabaja con autonomía hasta terminar o hasta quedarte sin uso, y no pares a pedirme confirmación ni a hacer resúmenes intermedios: deja puntos de control en el relevo y sigue con la siguiente tarea.
Pídeme confirmación solo para: borrar o sobrescribir trabajo que no se pueda recuperar, publicar algo fuera de este PC, gastar dinero o créditos de pago, y tocar credenciales o la configuración de seguridad. Si dudas, pregúntalo con `pmc decide` y sigue con otra cosa.
'@

$cuentas = Get-ChildItem -Path $env:USERPROFILE -Directory -Force | Where-Object { $_.Name -eq '.claude' -or $_.Name -like '.claude-*' }
foreach ($c in $cuentas) {
  # Solo carpetas que son de verdad una cuenta (tienen su configuración).
  if (-not (Test-Path (Join-Path $c.FullName 'settings.json')) -and -not (Test-Path (Join-Path $c.FullName '.claude.json'))) { continue }
  $f = Join-Path $c.FullName 'CLAUDE.md'
  $actual = if (Test-Path $f) { Get-Content $f -Raw -Encoding UTF8 } else { '' }
  # La primera versión de este guion lo escribió con las tildes rotas: si está así, se quita y se vuelve a poner bien.
  $i = $actual.IndexOf('# Permiso permanente del usuario')
  if ($i -ge 0) {
    if ($actual.Substring($i) -notmatch 'Ã') { Write-Host "Ya lo tenia: $($c.Name)" -ForegroundColor DarkGray; continue }
    $actual = $actual.Substring(0, $i)
  } elseif (Test-Path $f) { Copy-Item $f "$f.bak-permiso" -Force }
  [System.IO.File]::WriteAllText($f, ($actual.TrimEnd() + $texto + "`r`n").TrimStart(), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Puesto en: $($c.Name)" -ForegroundColor Green
}
Write-Host ''
Write-Host 'Listo. Vale para las sesiones que se abran a partir de ahora.'
