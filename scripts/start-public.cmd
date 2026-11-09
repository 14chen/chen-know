@echo off
rem Personal Knowledge Base - public (Cloudflare Tunnel) launcher
rem Usage: start-public.cmd            app + tunnel
rem        start-public.cmd -SkipApp   reuse an already running app, tunnel only
title Personal Knowledge Base - Public
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\start-public.ps1" %*
exit /b %ERRORLEVEL%
