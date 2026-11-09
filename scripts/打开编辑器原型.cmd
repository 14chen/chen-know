@echo off
chcp 65001 >nul
setlocal
set URL=http://127.0.0.1:8080/proto/index.html

rem 先确认服务在跑（curl.exe 是 Windows 10+ 自带的）
curl.exe -s -o nul -m 3 http://127.0.0.1:8080/api/health
if errorlevel 1 goto noserver

echo 正在打开编辑器原型...
start "" "%URL%"
exit /b 0

:noserver
echo.
echo   [x] 服务还没启动（127.0.0.1:8080 没有响应）。
echo.
echo   请先双击同目录下的  start.cmd  启动知识库，等它打印出访问地址后，
echo   再回来双击本文件。
echo.
pause
exit /b 1
