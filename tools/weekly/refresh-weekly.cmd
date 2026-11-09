@echo off
rem Refresh Gitee trending data for the weekly digest (called by Windows Task Scheduler).
rem Keep this file ASCII-only and CRLF: cmd.exe mis-parses LF-only batch files.
setlocal
set "NODE=C:\Users\HP\AppData\Local\nodejs\node.exe"
set "KBROOT=%~dp0..\.."
pushd "%KBROOT%\tools\weekly"
"%NODE%" fetch-gitee.mjs "%KBROOT%\data\weekly-gitee.json" 5
set RC=%ERRORLEVEL%
popd
exit /b %RC%
