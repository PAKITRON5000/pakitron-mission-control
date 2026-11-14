@echo off
rem Doble clic: pone tu permiso permanente en todas las cuentas de Claude de este PC (con copia de lo que habia).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\poner-permiso.ps1"
echo.
pause
