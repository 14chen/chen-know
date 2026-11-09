# kb-harness.ps1 — 启停隔离实例（所有测试流共用）
# 用法：
#   .\kb-harness.ps1 -Action start -Port 8501 -DataDir 'F:\work\test\kb\d1'
#   .\kb-harness.ps1 -Action stop  -Port 8501
param(
  [Parameter(Mandatory=$true)][ValidateSet('start','stop','health')][string]$Action,
  [Parameter(Mandatory=$true)][int]$Port,
  [string]$DataDir = '',
  [string]$LogDir  = 'F:\work\test\kb\logs'
)
$ErrorActionPreference = 'Stop'
$JAR = 'D:\work\知识库\backend\target\knowledge-base-0.0.1-SNAPSHOT.jar'
$pidFile = Join-Path $LogDir ("kb-$Port.pid")
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if ($Action -eq 'health') {
  try { $r = Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5; return $r.Content } catch { return 'DOWN' }
}
if ($Action -eq 'stop') {
  if (Test-Path $pidFile) {
    $p = Get-Content $pidFile
    try { Stop-Process -Id $p -Force -ErrorAction Stop; 'stopped ' + $p } catch { 'no such process ' + $p }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  } else { 'no pidfile for ' + $Port }
  return
}

if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Force -Path $DataDir | Out-Null }
$stdout = Join-Path $LogDir ("kb-$Port.out.log")
$stderr = Join-Path $LogDir ("kb-$Port.err.log")
$args = @('-jar', $JAR, "--server.port=$Port", "--kb.data-dir=$DataDir", '--kb.briefing.enabled=false', '--kb.weekly.enabled=false', '--server.error.include-stacktrace=never')
$p = Start-Process -FilePath (Join-Path $env:JAVA_HOME 'bin\java.exe') -ArgumentList $args -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden
Set-Content -Path $pidFile -Value $p.Id -Encoding ascii
$ok = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 500
  try { $r = Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { }
  if ($p.HasExited) { break }
}
'pid=' + $p.Id + ' ready=' + $ok + ' port=' + $Port
if (-not $ok) { '--- stderr tail ---'; Get-Content $stderr -Tail 25 -ErrorAction SilentlyContinue }