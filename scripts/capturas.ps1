# Captures every screen of the installed Mission Control at three window sizes (EV57) and says which ones have something
# sticking out sideways (the app writes that check next to each picture). Pictures go to
# %LOCALAPPDATA%\PakitronMC\capturas\<version>, never into the project. Usage: npm run capturas [-- -Sizes 1480x920]
# Since 13-11 it does not close the open app (that restarted it in front of the user and reset any measurement running,
# EV115): the capture copy works on a snapshot of the app's data in %TEMP%\pmc-capturas-datos (PMC_DATA_DIR), with the
# big read-mostly folders (photos of decisions and deliveries, thumbnails) linked, not copied. -Cerrar does it the old
# way, on the real data, closing and reopening the app.
# Every screen of the menu (Sidebar.tsx › NAV): the app's own default list left out Asistente, Relevos and Skills.
# -Layouts lateral,columna…: also each of those shapes of the app (EV131), pictures named «…-Llateral». -Exe: a build not
# installed yet (dist\win-unpacked\…exe), to look before installing.
param([string]$Sizes = '1480x920,900x700,3440x1440', [string]$Routes = 'inicio,decisiones,revisiones,asistente,relevos,proximo,chats,agentes,skills,tareas,galeria,cronologia,integracion,memoria,ajustes', [switch]$Cerrar, [string]$Layouts = '', [string]$Exe = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$dir = Join-Path $env:LOCALAPPDATA "PakitronMC\capturas\$version"
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -Confirm:$false }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$installed = Join-Path $env:LOCALAPPDATA 'Programs\Pakitron Mission Control\Pakitron Mission Control.exe'
$exe = if ($Exe) { (Resolve-Path $Exe).Path } else { $installed }
if (-not (Test-Path $exe)) { throw "No está instalada: npm run actualizar" }
$wasOpen = [bool](Get-Process -Name 'Pakitron Mission Control' -ErrorAction SilentlyContinue)
$real = Join-Path $env:LOCALAPPDATA 'PakitronMC'
if ($Cerrar -or -not $wasOpen) {
  # The app reads this mark and writes «cerrada para actualizar» instead of «pantalla caída» (13-11: 51 «caídas» were installs).
  if ($wasOpen) {
    try { Set-Content -Path (Join-Path $real 'closing.txt') -Value (Get-Date -Format o) -Encoding utf8 } catch {}
    Get-Process -Name 'Pakitron Mission Control' -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
    Start-Sleep -Milliseconds 800
  }
  Remove-Item Env:PMC_DATA_DIR -ErrorAction SilentlyContinue
} else {
  # Snapshot of the data. Never deleted recursively (links inside would take the real folders with them in PowerShell 5):
  # the same folder is refreshed on every run.
  $copy = Join-Path $env:TEMP 'pmc-capturas-datos'
  New-Item -ItemType Directory -Force -Path $copy | Out-Null
  $linked = @('decisions', 'entregas', 'thumbs', 'converted', 'frames', 'kept')
  $skip = $linked + @('capturas', 'backups')
  foreach ($f in Get-ChildItem $real -File) {
    if ($f.Name -like 'mission.db*' -or $f.Name -eq 'closing.txt') { continue }
    Copy-Item $f.FullName (Join-Path $copy $f.Name) -Force
  }
  foreach ($d in Get-ChildItem $real -Directory) {
    if ($skip -contains $d.Name) { continue }
    robocopy $d.FullName (Join-Path $copy $d.Name) /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "No se pudo copiar $($d.Name) (robocopy $LASTEXITCODE)" }
  }
  foreach ($n in $linked) {
    $l = Join-Path $copy $n
    if ((Test-Path (Join-Path $real $n)) -and -not (Test-Path $l)) { New-Item -ItemType Junction -Path $l -Target (Join-Path $real $n) | Out-Null }
  }
  # The database, consistent while the app keeps writing to it (VACUUM INTO reads one snapshot).
  $db = Join-Path $copy 'mission.db'
  foreach ($x in @('', '-wal', '-shm')) { if (Test-Path "$db$x") { Remove-Item "$db$x" -Force } }
  & node --no-warnings (Join-Path $PSScriptRoot 'copia-db.mjs') (Join-Path $real 'mission.db') $db $real $copy
  if (-not (Test-Path $db)) { throw "No se pudo copiar la base de datos: prueba npm run capturas -- -Cerrar" }
  $env:PMC_DATA_DIR = $copy
}
$env:PMC_SHOT_DIR = $dir
$env:PMC_SHOT_SIZES = $Sizes
if ($Routes) { $env:PMC_SHOT_ROUTES = $Routes } else { Remove-Item Env:PMC_SHOT_ROUTES -ErrorAction SilentlyContinue }
if ($Layouts) { $env:PMC_SHOT_LAYOUTS = $Layouts } else { Remove-Item Env:PMC_SHOT_LAYOUTS -ErrorAction SilentlyContinue }
$p = Start-Process -FilePath $exe -PassThru
$p.WaitForExit(900000) | Out-Null
Remove-Item Env:PMC_SHOT_DIR, Env:PMC_SHOT_SIZES, Env:PMC_SHOT_LAYOUTS -ErrorAction SilentlyContinue
Remove-Item Env:PMC_SHOT_ROUTES, Env:PMC_DATA_DIR -ErrorAction SilentlyContinue
if ($wasOpen -and $Cerrar) { Start-Process -FilePath $installed }
# Up to 0.31.5 the app in capture mode rewrote the pmc launchers of every window to its own data folder (13-11: on the
# copy, they ran %TEMP%\pmc-capturas-datos\bin\pmc.mjs): back to the real one if so.
$realMjs = Join-Path $real 'bin\pmc.mjs'
$shims = Join-Path $env:USERPROFILE '.local\bin'
$fixed = @{ 'pmc.cmd' = "@echo off`r`nnode `"$realMjs`" %*`r`n"; 'pmc' = "#!/bin/sh`nexec node `"$($realMjs.Replace('\', '/'))`" `"`$@`"`n" }
foreach ($name in $fixed.Keys) {
  $f = Join-Path $shims $name
  if ((Test-Path $f) -and ((Get-Content $f -Raw) -match 'pmc-capturas-datos')) { [IO.File]::WriteAllText($f, $fixed[$name]); "Lanzador $name devuelto a $realMjs" }
}
$bad = 0
foreach ($j in Get-ChildItem $dir -Filter *.json | Sort-Object Name) {
  $r = Get-Content $j.FullName -Raw | ConvertFrom-Json
  $n = @($r.overflow).Count
  if ($n -gt 0) { $bad++; "DESBORDA  $($j.BaseName): $n elementos, p. ej. $(@($r.overflow)[0])" }
}
$pngs = @(Get-ChildItem $dir -Filter *.png).Count
"$pngs capturas en $dir; $bad con algo que se sale de la ventana."
