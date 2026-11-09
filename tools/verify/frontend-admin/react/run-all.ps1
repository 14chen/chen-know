  $results += "mock exit=$LASTEXITCODE"
  if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $HarnessDir 'mock-run.txt') -Encoding utf8 | Select-String -Pattern '^FAIL|^  - ' | ForEach-Object { Write-Output $_.Line } }

  Write-Output ''
  Write-Output '==================== io-images（导入图片 / 文件夹，mock 夹具）===================='
  & $Node (Join-Path $HarnessDir 'drive.mjs') io-images 2>&1 | Tee-Object -FilePath (Join-Path $HarnessDir 'io-images-run.txt')
  $results += "io-images exit=$LASTEXITCODE"
  if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $HarnessDir 'io-images-run.txt') -Encoding utf8 | Select-String -Pattern '^FAIL|^  - ' | ForEach-Object { Write-Output $_.Line } }

/* --- next edit fragment --- */
Write-Output ('node    : ' + $Node)
Write-Output ('harness : ' + $HarnessDir)
Write-Output ('mock    : ' + $MockJs)
Write-Output ('backend : ' + $Backend)
/* --- next edit fragment --- */
$mock = $null
$vite = $null
$results = @()

function Stop-Node([string]$pattern) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match $pattern } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 400
}

function Start-Vite {
  Stop-Node 'vite\.bin|vite\.js'
  $script:vite = Start-Process -FilePath $Node -ArgumentList @($ViteBin, '--config', (Join-Path $HarnessDir 'vite.config.mts')) -WorkingDirectory $HarnessDir -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $HarnessDir 'vite.out') -RedirectStandardError (Join-Path $HarnessDir 'vite.err')
  foreach ($i in 1..30) {
    try { Invoke-WebRequest "http://localhost:$VitePort/index.html" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 400 }
  }
  # 预热：让 Vite 完成依赖预构建，避免首个模式跑到一半被整页重载打断
  try { Invoke-WebRequest "http://localhost:$VitePort/main.tsx" -UseBasicParsing -TimeoutSec 30 | Out-Null } catch { Write-Output ('warmup main.tsx: ' + $_.Exception.Message) }
  Start-Sleep -Milliseconds 800
}

function Start-Mock([string[]]$Extra) {
  if ($script:mock) { Stop-Process -Id $script:mock.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400 }
  else { Stop-Node 'mock\.js' }
  $args = @($MockJs, '--port', '8791') + $Extra
  $script:mock = Start-Process -FilePath $Node -ArgumentList $args -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 900
}

function Stop-Mock {
  if ($script:mock) { Stop-Process -Id $script:mock.Id -Force -ErrorAction SilentlyContinue; $script:mock = $null; Start-Sleep -Milliseconds 400 }
  else { Stop-Node 'mock\.js' }
}

function Invoke-Mode([string]$mode, [string]$file) {
  Write-Output ''
  Write-Output ("==================== " + $mode + " ====================")
  & $Node (Join-Path $HarnessDir 'drive.mjs') $mode 2>&1 | Tee-Object -FilePath (Join-Path $HarnessDir $file)
  $script:results += ($mode + " exit=" + $LASTEXITCODE)
  if ($LASTEXITCODE -ne 0) {
    Get-Content (Join-Path $HarnessDir $file) -Encoding utf8 | Select-String -Pattern '^FAIL|^  - ' | ForEach-Object { Write-Output $_.Line }
  }
}

try {
  # 每个模式独占一个 vite 进程：避免前一个模式遗留的 HMR/预构建状态把下一个模式打断
  Start-Vite
  Start-Mock @('--backend', $Backend, '--cookie', $cookie)
  Invoke-Mode 'main' 'main-run.txt'

  Stop-Mock; Start-Vite
  Start-Mock @()
  Invoke-Mode 'mock' 'mock-run.txt'

  Invoke-Mode 'io-images' 'io-images-run.txt'

  Stop-Mock; Start-Vite
  Start-Mock @('--backend', $Backend, '--cookie', $cookie, '--delay', '1200')
  Invoke-Mode 'states' 'states-run.txt'

  Stop-Mock; Start-Vite
  Invoke-Mode 'error' 'error-run.txt'
}
finally {
  Stop-Mock
  Stop-Node 'vite\.bin|vite\.js'
  Start-Sleep -Milliseconds 500
  $left = Get-NetTCPConnection -LocalPort 8791 -State Listen -ErrorAction SilentlyContinue
  Write-Output ''
  Write-Output ("port 8791 listeners left: " + (@($left).Count) + " (0 = released)")
  Write-Output ("port $VitePort listeners left: " + (@(Get-NetTCPConnection -LocalPort $VitePort -State Listen -ErrorAction SilentlyContinue).Count))
}

Write-Output ''
Write-Output '==================== SUMMARY ===================='
$results | ForEach-Object { Write-Output ('  ' + $_) }

/* --- next edit fragment --- */
Write-Output ''
Write-Output '==================== SUMMARY ===================='
$results | ForEach-Object { Write-Output ('  ' + $_) }

/* --- next edit fragment --- */
function Invoke-Mode([string]$mode, [string]$file) {
  Write-Output ''
  Write-Output ("==================== " + $mode + " ====================")
  # PS 5.1 + $ErrorActionPreference='Stop'：原生命令往 stderr 写一行就会被当成 NativeCommandError
  # 中断整个脚本。这里临时降级为 Continue，stderr 单独落盘，退出码自己判。
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $errFile = Join-Path $HarnessDir ($mode + '-err.txt')
  & $Node (Join-Path $HarnessDir 'drive.mjs') $mode 2>$errFile | Tee-Object -FilePath (Join-Path $HarnessDir $file)
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    $tail = (Get-Content $errFile -Encoding utf8 -ErrorAction SilentlyContinue | Select-Object -Last 3) -join ' / '
    Write-Output ("  -> " + $mode + " 退出码 " + $code + "，重启 vite 后重试一次（stderr: " + $tail + "）")
    Start-Vite
    & $Node (Join-Path $HarnessDir 'drive.mjs') $mode 2>$errFile | Tee-Object -FilePath (Join-Path $HarnessDir $file)
    $code = $LASTEXITCODE
    $script:results += ($mode + " retry exit=" + $code)
  }
  $ErrorActionPreference = $previous
  $script:results += ($mode + " exit=" + $code)
  if ($code -ne 0) {
    Get-Content (Join-Path $HarnessDir $file) -Encoding utf8 | Select-String -Pattern '^FAIL|^  - ' | ForEach-Object { Write-Output $_.Line }
  }
}

/* --- next edit fragment --- */
function Wait-Backend {
  for ($i = 1; $i -le 30; $i++) {
    try { Invoke-WebRequest "$Backend/api/health" -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true } catch {
      if ($i -eq 1) { Write-Output ("  等待测试实例 " + $Backend + " 就绪（可能正被后端实现者重启）...") }
      Start-Sleep -Seconds 2
    }
  }
  Write-Output ("  ⚠ " + $Backend + " 60s 内未就绪：main / states 两个模式会失败")
  return $false
}

function Invoke-Mode([string]$mode, [string]$file) {
/* --- next edit fragment --- */
try {
  # 每个模式独占一个 vite 进程：避免前一个模式遗留的 HMR/预构建状态把下一个模式打断
  Wait-Backend | Out-Null
  Start-Vite
  Start-Mock @('--backend', $Backend, '--cookie', $cookie)
  Invoke-Mode 'main' 'main-run.txt'

  Stop-Mock; Start-Vite
  Start-Mock @()
  Invoke-Mode 'mock' 'mock-run.txt'

  Invoke-Mode 'io-images' 'io-images-run.txt'

  Wait-Backend | Out-Null
  Stop-Mock; Start-Vite
  Start-Mock @('--backend', $Backend, '--cookie', $cookie, '--delay', '1200')
  Invoke-Mode 'states' 'states-run.txt'

  Stop-Mock; Start-Vite
  Invoke-Mode 'error' 'error-run.txt'
}