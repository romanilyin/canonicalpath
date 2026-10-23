@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Only fixed dispatch is permitted here. Operation data arrives as JSON on stdin.
rem Use PowerShell 7 directly; never probe or fall back to Windows PowerShell.
if not defined CANONICALPATH_POWERSHELL set "CANONICALPATH_POWERSHELL=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not exist "%CANONICALPATH_POWERSHELL%" (
  >&2 echo PowerShell 7 is required. Set CANONICALPATH_POWERSHELL to its full executable path.
  exit /b 1
)
"%CANONICALPATH_POWERSHELL%" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0canonicalfs.ps1"
if errorlevel 1 exit /b 1
if not errorlevel 0 exit /b 1
exit /b 0
