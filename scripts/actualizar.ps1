# Updates the per-user copy of Mission Control from dist\win-unpacked without an installer and without asking for
# administrator rights: closes the app, mirrors the files into %LOCALAPPDATA%\Programs\Pakitron Mission Control,
# refreshes the "Pakitron Mission Control" shortcuts (desktop and Start menu, current user) and opens it again.
# The data (%LOCALAPPDATA%\PakitronMC) is never touched. Build first with: npm run dist (or npm run build:win-dir).
param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'dist\win-unpacked'
$dst = Join-Path $env:LOCALAPPDATA 'Programs\Pakitron Mission Control'
$exe = Join-Path $dst 'Pakitron Mission Control.exe'
if (-not (Test-Path (Join-Path $src 'Pakitron Mission Control.exe'))) { throw "No hay compilación en ${src}; ejecuta npm run dist" }

# The app reads this mark and writes «cerrada para actualizar» instead of «pantalla caída» (13-11: 51 «caídas» were installs).
try { Set-Content -Path (Join-Path $env:LOCALAPPDATA 'PakitronMC\closing.txt') -Value (Get-Date -Format o) -Encoding utf8 } catch {}
Get-Process -Name 'Pakitron Mission Control' -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
# Until it is really gone (13-11 16:16: with the processor full of a video export, 0,9 s was not enough, a file was still
# in use, the copy failed and the app stayed closed).
for ($i = 0; $i -lt 40 -and (Get-Process -Name 'Pakitron Mission Control' -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 250 }
Start-Sleep -Milliseconds 400

New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP /R:5 /W:2 | Out-Null
if ($LASTEXITCODE -ge 8) {
  # Never leave the user without the app: open the copy that is there and say what failed.
  if (-not $NoLaunch -and (Test-Path $exe)) { Start-Process -FilePath $exe -WorkingDirectory $dst }
  throw "robocopy falló con código $LASTEXITCODE (se ha vuelto a abrir la versión que había)"
}

$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Pakitron Mission Control.lnk'))
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $dst
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = 'Centro de control de las cuatro cuentas de Claude'
  $lnk.Save()
}

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
Set-Content -Path (Join-Path $dst 'VERSION.txt') -Value $version -Encoding ASCII
if (-not $NoLaunch) { Start-Process -FilePath $exe -WorkingDirectory $dst }
"Mission Control $version en $dst"
