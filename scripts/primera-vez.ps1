# EV97: the installed app on an EMPTY data folder, captured, next to the user's own app (it stays open on HIS data).
# -SinNada: also an empty user folder (no Claude Code accounts, no hooks, no claude.exe, no Node.js), as on a PC that has
# nothing yet. -Exe: another build (dist\win-unpacked\…exe, to look before installing).
# -ConClaudeCode: with -SinNada, Claude Code stays on the PATH (installed, no account logged in yet). -Routes: the screens.
param([string]$Out, [switch]$SinNada, [string]$Exe, [switch]$ConClaudeCode, [string]$Routes = 'inicio,agentes,ajustes')
$ErrorActionPreference = 'Stop'
$installed = Join-Path $env:LOCALAPPDATA 'Programs\Pakitron Mission Control\Pakitron Mission Control.exe'
$exe = if ($Exe) { (Resolve-Path $Exe).Path } else { $installed }
$data = Join-Path $Out 'data'
if (Test-Path $data) { Remove-Item -Recurse -Force $data -Confirm:$false }
New-Item -ItemType Directory -Force -Path $data | Out-Null
$shots = Join-Path $Out 'shots'
New-Item -ItemType Directory -Force -Path $shots | Out-Null
# The user's app stays open (13-11, claude6): in capture mode the app skips the single-instance lock and, since 0.31.8,
# touches nothing outside its own data folder (pmc launchers, the accounts' trusted folders).
$env:PMC_DATA_DIR = $data
$realProfile = $env:USERPROFILE
$realHome = $env:HOME
if ($SinNada) {
  $user = Join-Path $Out 'usuario'
  if (Test-Path $user) { Remove-Item -Recurse -Force $user -Confirm:$false }
  New-Item -ItemType Directory -Force -Path $user | Out-Null
  $env:USERPROFILE = $user
  $env:HOME = $user
  # Nothing of this PC's own app data either (usage readings, notices): a newcomer has none.
  $realLocal = $env:LOCALAPPDATA
  $realRoaming = $env:APPDATA
  New-Item -ItemType Directory -Force -Path (Join-Path $user 'AppData\Local'), (Join-Path $user 'AppData\Roaming') | Out-Null
  $env:LOCALAPPDATA = Join-Path $user 'AppData\Local'
  $env:APPDATA = Join-Path $user 'AppData\Roaming'
  # EV126: no Claude Code and no Node.js on the PATH either (Claude Code's own installer does not bring Node).
  $realPath = $env:PATH
  $env:PATH = ($env:PATH -split ';' | Where-Object { $_ -and ($ConClaudeCode -or -not (Test-Path (Join-Path $_ 'claude.exe'))) -and -not (Test-Path (Join-Path $_ 'node.exe')) }) -join ';'
  $env:PMC_SIN_NODE = '1'
}
$env:PMC_SHOT_DIR = $shots
$env:PMC_SHOT_SIZES = '1480x920'
$env:PMC_SHOT_ROUTES = $Routes
# Started from the repo, the app adds Mission Control itself (it finds ENCARGO.md there): a newcomer starts it elsewhere.
$p = if ($SinNada) { Start-Process -FilePath $exe -WorkingDirectory $user -PassThru } else { Start-Process -FilePath $exe -PassThru }
$p.WaitForExit(300000) | Out-Null
Remove-Item Env:PMC_DATA_DIR, Env:PMC_SHOT_DIR, Env:PMC_SHOT_SIZES, Env:PMC_SHOT_ROUTES -ErrorAction SilentlyContinue
$env:USERPROFILE = $realProfile
if ($realHome) { $env:HOME = $realHome } else { Remove-Item Env:HOME -ErrorAction SilentlyContinue }
if ($SinNada) { $env:LOCALAPPDATA = $realLocal; $env:APPDATA = $realRoaming; $env:PATH = $realPath; Remove-Item Env:PMC_SIN_NODE -ErrorAction SilentlyContinue }
if (-not (Get-Process -Name 'Pakitron Mission Control' -ErrorAction SilentlyContinue)) { Start-Process -FilePath $installed }
Get-ChildItem $shots -Filter *.png | Select-Object -ExpandProperty Name
