@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Compatibility name for the same structured stdin transport; never reparse argv.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0canonicalfs.ps1"
if errorlevel 1 exit /b 1
if not errorlevel 0 exit /b 1
exit /b 0
