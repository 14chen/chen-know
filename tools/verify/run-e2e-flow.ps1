# 完整流程验收运行器：每次都从**全新空库**起，保证「首人成为管理员」这一段可验证。
# 用法：powershell -File run-e2e-flow.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dataDir = Join-Path $env:TEMP 'kb-e2e-flow'
$log = Join-Path $env:TEMP 'kb-e2e-flow.out'

Write-Host '=== 1) 停掉 8090 上的实例（只停端口 8090 的，不碰 8080）===' -ForegroundColor Cyan
$conn = Get-NetTCPConnection -State Listen -LocalPort 8090 -ErrorAction SilentlyContinue
if ($conn) {
    foreach ($pid8090 in ($conn | Select-Object -ExpandProperty OwningProcess -Unique)) {
        Stop-Process -Id $pid8090 -Force -ErrorAction SilentlyContinue
        Write-Host "  停止 PID $pid8090"
    }
    Start-Sleep -Seconds 3
} else { Write-Host '  8090 本就空闲' }

Write-Host '=== 2) 清空流程数据目录（全新空库）===' -ForegroundColor Cyan
if (Test-Path $dataDir) { Remove-Item $dataDir -Recurse -Force }
Write-Host "  已清空 $dataDir"

Write-Host '=== 3) 启动实例 ===' -ForegroundColor Cyan
$jar = Join-Path $root 'backend\target\knowledge-base-0.0.1-SNAPSHOT.jar'
if (-not (Test-Path $jar)) { throw "找不到 jar：$jar" }
$proc = Start-Process -FilePath 'java' `
    -ArgumentList '-jar', $jar, '--server.port=8090', "--kb.data-dir=$dataDir" `
    -WorkingDirectory (Join-Path $root 'backend') `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try { $null = Invoke-RestMethod 'http://127.0.0.1:8090/api/health' -TimeoutSec 4; $ready = $true; break } catch {}
}
if (-not $ready) { throw "实例未就绪，见 $log" }
Write-Host "  PID=$($proc.Id) 就绪"

Write-Host '=== 4) 跑完整流程验收 ===' -ForegroundColor Cyan
& node (Join-Path $root 'tools\verify\e2e-flow.mjs') 'http://127.0.0.1:8090'
$code = $LASTEXITCODE
Write-Host "`n退出码: $code" -ForegroundColor $(if ($code -eq 0) { 'Green' } else { 'Red' })
exit $code
