@echo off
rem Personal Knowledge Base - local / LAN launcher (logic lives in lib\start.ps1)
title Personal Knowledge Base - Local
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\start.ps1" %*
exit /b %ERRORLEVEL%
