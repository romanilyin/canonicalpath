@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Only fixed dispatch is permitted here. Operation data arrives as JSON on stdin.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0canonicalfs.ps1"
if errorlevel 1 exit /b 1
if not errorlevel 0 exit /b 1
exit /b 0
