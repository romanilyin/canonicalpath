@echo off
setlocal
call "%~dp0canonicalfs.cmd" %*
exit /b %ERRORLEVEL%
