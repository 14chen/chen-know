@echo off
rem Personal Knowledge Base - backup data\ into backups\kb-YYYYMMDD-HHMMSS\
title Personal Knowledge Base - Backup
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\backup.ps1" %*
exit /b %ERRORLEVEL%
