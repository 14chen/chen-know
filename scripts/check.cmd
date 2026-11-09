@echo off
rem Personal Knowledge Base - read-only health check (logic lives in lib\check.ps1)
title Personal Knowledge Base - Check
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\check.ps1" %*
exit /b %ERRORLEVEL%
