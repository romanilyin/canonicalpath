@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "BASE_URL=%CANONICALFS_DAEMON_URL%"
if "%BASE_URL%"=="" set "BASE_URL=http://127.0.0.1:8765"
if "%BASE_URL:~-1%"=="/" set "BASE_URL=%BASE_URL:~0,-1%"
set "TOKEN=%CANONICALFS_DAEMON_TOKEN%"
set "POWERSHELL_BIN=%POWERSHELL%"
if "%POWERSHELL_BIN%"=="" set "POWERSHELL_BIN=powershell.exe"

where curl.exe >nul 2>nul || (echo required command not found: curl.exe 1>&2 & exit /b 69)
where "%POWERSHELL_BIN%" >nul 2>nul || (echo required command not found: %POWERSHELL_BIN% 1>&2 & exit /b 69)

if "%~1"=="" goto usage
set "OP=%~1"
shift /1

if /i "%OP%"=="health" goto op_health
if /i "%OP%"=="caps" goto op_caps
if /i "%OP%"=="open-project" goto op_open_project
if /i "%OP%"=="close-project" goto op_close_project
if /i "%OP%"=="mkdir-all" goto op_mkdir_all
if /i "%OP%"=="write-text" goto op_write_text
if /i "%OP%"=="read-text" goto op_read_text
if /i "%OP%"=="stat" goto op_stat
if /i "%OP%"=="remove" goto op_remove
if /i "%OP%"=="rename" goto op_rename
goto usage

:usage
echo usage: %~n0 ^<op^> [args...] 1>&2
echo. 1>&2
echo ops: 1>&2
echo   health 1>&2
echo   caps 1>&2
echo   open-project ^<project_id^> ^<host_root^> 1>&2
echo   close-project ^<project_id^> 1>&2
echo   mkdir-all ^<project_id^> ^<path^> 1>&2
echo   write-text ^<project_id^> ^<path^> ^<text^> 1>&2
echo   read-text ^<project_id^> ^<path^> [max_bytes] 1>&2
echo   stat ^<project_id^> ^<path^> 1>&2
echo   remove ^<project_id^> ^<path^> 1>&2
echo   rename ^<project_id^> ^<path^> ^<target^> 1>&2
echo. 1>&2
echo Set CANONICALFS_DAEMON_URL and CANONICALFS_DAEMON_TOKEN for authenticated daemon calls. 1>&2
exit /b 64

:op_health
if not "%~1"=="" (echo health takes no arguments 1>&2 & exit /b 64)
call :request GET /healthz json
exit /b %ERRORLEVEL%

:op_caps
if not "%~1"=="" (echo caps takes no arguments 1>&2 & exit /b 64)
call :request GET /v1/caps json
exit /b %ERRORLEVEL%

:op_open_project
if "%~2"=="" (echo open-project requires project_id and host_root 1>&2 & exit /b 64)
if not "%~3"=="" (echo open-project requires project_id and host_root 1>&2 & exit /b 64)
call :json_body project_id "%~1" host_root "%~2"
if errorlevel 1 exit /b %ERRORLEVEL%
call :request POST /v1/projects/open none
exit /b %ERRORLEVEL%

:op_close_project
if "%~1"=="" (echo close-project requires project_id 1>&2 & exit /b 64)
if not "%~2"=="" (echo close-project requires project_id 1>&2 & exit /b 64)
call :json_body project_id "%~1"
if errorlevel 1 exit /b %ERRORLEVEL%
call :request POST /v1/projects/close none
exit /b %ERRORLEVEL%

:op_mkdir_all
if "%~2"=="" (echo mkdir-all requires project_id and path 1>&2 & exit /b 64)
if not "%~3"=="" (echo mkdir-all requires project_id and path 1>&2 & exit /b 64)
call :json_body project_id "%~1" path "%~2"
if errorlevel 1 exit /b %ERRORLEVEL%
call :request POST /v1/fs/mkdirAll none
exit /b %ERRORLEVEL%

:op_write_text
if "%~3"=="" (echo write-text requires project_id, path, and text 1>&2 & exit /b 64)
if not "%~4"=="" (echo write-text requires project_id, path, and text 1>&2 & exit /b 64)
set "JSON_BODY="
set "CP_WRITE_PROJECT_ID=%~1"
set "CP_WRITE_PATH=%~2"
set "CP_WRITE_TEXT=%~3"
for /f "usebackq delims=" %%J in (`%POWERSHELL_BIN% -NoProfile -ExecutionPolicy Bypass -Command "$payload = [ordered]@{ 'project_id' = $env:CP_WRITE_PROJECT_ID; 'path' = $env:CP_WRITE_PATH; 'data_base64' = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($env:CP_WRITE_TEXT)) }; ConvertTo-Json -InputObject $payload -Compress"`) do set "JSON_BODY=%%J"
if "%JSON_BODY%"=="" (echo failed to build JSON request body 1>&2 & exit /b 1)
call :request POST /v1/fs/writeFile none
exit /b %ERRORLEVEL%

:op_read_text
if "%~2"=="" (echo read-text requires project_id, path, and optional max_bytes 1>&2 & exit /b 64)
if not "%~4"=="" (echo read-text requires project_id, path, and optional max_bytes 1>&2 & exit /b 64)
if "%~3"=="" (
  call :json_body project_id "%~1" path "%~2"
) else (
  call :json_body project_id "%~1" path "%~2" max_bytes "%~3"
)
if errorlevel 1 exit /b %ERRORLEVEL%
call :request POST /v1/fs/readFile text
exit /b %ERRORLEVEL%

:op_stat
if "%~2"=="" (echo stat requires project_id and path 1>&2 & exit /b 64)
if not "%~3"=="" (echo stat requires project_id and path 1>&2 & exit /b 64)
call :json_body project_id "%~1" path "%~2"
if errorlevel 1 exit /b %ERRORLEVEL%
call :request POST /v1/fs/stat stat
exit /b %ERRORLEVEL%

:op_remove
if "%~2"=="" (echo remove requires project_id and path 1>&2 & exit /b 64)
if not "%~3"=="" (echo remove requires project_id and path 1>&2 & exit /b 64)
call :json_body project_id "%~1" path "%~2"
if errorlevel 1 exit /b %ERRORLEVEL%
call :request POST /v1/fs/remove none
exit /b %ERRORLEVEL%

:op_rename
if "%~3"=="" (echo rename requires project_id, path, and target 1>&2 & exit /b 64)
if not "%~4"=="" (echo rename requires project_id, path, and target 1>&2 & exit /b 64)
call :json_body project_id "%~1" path "%~2" target "%~3"
if errorlevel 1 exit /b %ERRORLEVEL%
call :request POST /v1/fs/rename none
exit /b %ERRORLEVEL%

:json_body
set "JSON_BODY="
set "CP_JSON_COUNT=0"

:json_body_loop
if "%~1"=="" goto json_body_run
set "CP_JSON_KEY_%CP_JSON_COUNT%=%~1"
set "CP_JSON_VALUE_%CP_JSON_COUNT%=%~2"
set /a CP_JSON_COUNT+=1 >nul
shift /1
shift /1
goto json_body_loop

:json_body_run
for /f "usebackq delims=" %%J in (`%POWERSHELL_BIN% -NoProfile -ExecutionPolicy Bypass -Command "$payload = [ordered]@{}; $count = [int]$env:CP_JSON_COUNT; for ($index = 0; $index -lt $count; $index++) { $key = [Environment]::GetEnvironmentVariable('CP_JSON_KEY_' + $index); $value = [Environment]::GetEnvironmentVariable('CP_JSON_VALUE_' + $index); if ($key -eq 'max_bytes') { $payload[$key] = [int64]$value } else { $payload[$key] = $value } }; ConvertTo-Json -InputObject $payload -Compress"`) do set "JSON_BODY=%%J"
if "%JSON_BODY%"=="" (echo failed to build JSON request body 1>&2 & exit /b 1)
exit /b 0

:request
set "REQ_METHOD=%~1"
set "REQ_PATH=%~2"
set "RESP_MODE=%~3"
set "RESP_FILE="
set "STATUS="
if /i not "%REQ_PATH%"=="/healthz" if "%TOKEN%"=="" (echo CANONICALFS_DAEMON_TOKEN is required for this operation 1>&2 & exit /b 64)
rem HttpWebRequest reads the capability from the inherited environment. Neither
rem PowerShell nor a curl process receives an Authorization value in argv.
for /f "usebackq tokens=1,* delims=|" %%S in (`%POWERSHELL_BIN% -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $file = [IO.Path]::GetTempFileName(); try { $request = [Net.HttpWebRequest]::Create($env:BASE_URL + $env:REQ_PATH); $request.Method = $env:REQ_METHOD; $request.Accept = 'application/json'; $request.AllowAutoRedirect = $false; if ($env:REQ_PATH -ne '/healthz') { $request.Headers['Authorization'] = 'Bearer ' + $env:TOKEN }; if ($env:REQ_METHOD -eq 'POST') { $request.ContentType = 'application/json'; $bytes = [Text.Encoding]::UTF8.GetBytes($env:JSON_BODY); $request.ContentLength = $bytes.Length; $stream = $request.GetRequestStream(); try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() } }; try { $response = $request.GetResponse() } catch [Net.WebException] { $response = $_.Exception.Response; if ($null -eq $response) { throw } }; try { $output = [IO.File]::Create($file); try { $response.GetResponseStream().CopyTo($output) } finally { $output.Dispose() }; [Console]::WriteLine(([int]$response.StatusCode).ToString() + '|' + $file) } finally { $response.Dispose() } } catch { Remove-Item -LiteralPath $file -Force; [Console]::Error.WriteLine('daemon request failed'); exit 1 }"`) do (
  set "STATUS=%%S"
  set "RESP_FILE=%%T"
)
if "%STATUS%"=="" (echo daemon request failed 1>&2 & exit /b 1)
call :parse_response "%RESP_MODE%" "%STATUS%" "%RESP_FILE%"
set "PARSE_STATUS=%ERRORLEVEL%"
"%POWERSHELL_BIN%" -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath $env:RESP_FILE -Force"
exit /b %PARSE_STATUS%

:parse_response
set "CP_RESP_MODE=%~1"
set "CP_RESP_STATUS=%~2"
set "CP_RESP_FILE=%~3"
"%POWERSHELL_BIN%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $mode = $env:CP_RESP_MODE; $status = [int]$env:CP_RESP_STATUS; $file = $env:CP_RESP_FILE; try { $data = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json } catch { [Console]::Error.WriteLine('invalid daemon JSON response: ' + $_.Exception.Message); exit 1 }; if ($data.error) { [Console]::Error.WriteLine($data.error.code + ': ' + $data.error.message); exit 1 }; if ($status -ge 400) { [Console]::Error.WriteLine('ERR_DAEMON: HTTP ' + $status); exit 1 }; if ($mode -eq 'none') { exit 0 }; if ($mode -eq 'json') { ConvertTo-Json -InputObject $data -Compress -Depth 8; exit 0 }; if ($mode -eq 'text') { [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($data.data_base64))); exit 0 }; if ($mode -eq 'stat') { ConvertTo-Json -InputObject $data.stat -Compress -Depth 8; exit 0 }; [Console]::Error.WriteLine('unsupported response mode: ' + $mode); exit 1"
exit /b %ERRORLEVEL%
