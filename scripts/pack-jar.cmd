@echo off
rem Pack the current frontend build into the existing Spring Boot jar.
rem Use when Maven is unavailable: it replaces BOOT-INF/classes/static/** only.
rem
rem   scripts\pack-jar.cmd                 build frontend, repack, replace the jar
rem   scripts\pack-jar.cmd -SkipFrontend   repack the static dir as-is
rem   scripts\pack-jar.cmd -Out <path>     repack to <path>, leave the jar alone
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%" || exit /b 1
set "SKIP_FE="
set "OUT="

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="-SkipFrontend" set "SKIP_FE=1" & shift & goto parse
if /i "%~1"=="-Out" goto take_out
echo [x] unknown option: %~1
exit /b 2

:take_out
set "OUT=%~2"
if not defined OUT echo [x] -Out needs a path & exit /b 2
shift
shift
goto parse

:parsed
set "JAR=backend\target\knowledge-base-0.0.1-SNAPSHOT.jar"
set "STATIC=backend\src\main\resources\static"

if not exist "%JAR%" echo [x] %JAR% not found - build the backend once first & exit /b 1
if not exist "%STATIC%\index.html" echo [x] %STATIC%\index.html not found - run the frontend build first & exit /b 1

if not defined SKIP_FE call :build_frontend
if errorlevel 1 exit /b 1

set "PACKED=backend\target\kb-packed.jar"
if defined OUT set "PACKED=%OUT%"
if exist "%PACKED%" del /q "%PACKED%"

echo [i] repacking %JAR%
java scripts\tools\RepackStatic.java "%JAR%" "%STATIC%" "%PACKED%"
if errorlevel 1 echo [x] repack failed & exit /b 1

if defined OUT echo [ok] wrote %PACKED% (the installed jar is unchanged) & exit /b 0

set "BACKUP=%JAR%.old-static"
copy /y "%JAR%" "%BACKUP%" >nul
if errorlevel 1 echo [x] cannot back up the jar - stop the running app first & del /q "%PACKED%" >nul 2>&1 & exit /b 1
rem move is a rename on one volume; AV or the indexer can briefly deny it,
rem while copy still succeeds - so fall back to copy + delete.
move /y "%PACKED%" "%JAR%" >nul
if errorlevel 1 goto replace_by_copy
goto replaced

:replace_by_copy
copy /y "%PACKED%" "%JAR%" >nul
if errorlevel 1 echo [x] cannot replace the jar - stop the running app first & exit /b 1
del /q "%PACKED%" >nul 2>&1

:replaced
echo [ok] new static packed into %JAR%
echo [i] previous jar kept as %BACKUP%
echo [i] start with scripts\start.cmd, then hard-refresh the browser once
exit /b 0

:build_frontend
if not exist frontend\node_modules\vite\bin\vite.js echo [!] frontend\node_modules missing - skipping frontend build & exit /b 0
pushd frontend
node node_modules\vite\bin\vite.js build
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" echo [x] frontend build failed & exit /b 1
exit /b 0
