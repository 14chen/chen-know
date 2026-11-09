# ============================================================================
# check.ps1 —— 知识库只读体检（PowerShell 5.1 兼容，UTF-8 带 BOM 保存）
# 调用链：scripts\check.cmd -> lib\check.ps1
# 只读：不写文件、不改配置、不启动服务。退出码 0=无 FAIL，1=有 FAIL。
# ============================================================================

param([int]$Port = 0)

. (Join-Path $PSScriptRoot 'kb-common.ps1')

if ($Port -le 0) { $Port = if ($env:KBPORT) { [int]$env:KBPORT } else { 8080 } }

$script:OK = 0; $script:Warn = 0; $script:Fail = 0

function Result {
    param([string]$Level, [string]$Text)
    switch ($Level) {
        'OK'   { Write-Host ('  [ OK ] ' + $Text) -ForegroundColor Green;  $script:OK++ }
        'WARN' { Write-Host ('  [WARN] ' + $Text) -ForegroundColor Yellow; $script:Warn++ }
        'FAIL' { Write-Host ('  [FAIL] ' + $Text) -ForegroundColor Red;    $script:Fail++ }
        default { Write-Host ('  [ -- ] ' + $Text) -ForegroundColor Gray }
    }
}

function Section([string]$Name) {
    Write-Host ''
    Write-Host $Name -ForegroundColor Cyan
}

function Size-MB([long]$Bytes) { '{0:N1} MB' -f ($Bytes / 1MB) }

Write-Host ''
Write-Host '=== 知识库体检（只读） ===' -ForegroundColor White
Write-Host ('  仓库: ' + $script:KbRepoRoot)

# ---------------------------------------------------------------- 1. 版本控制
Section '1. 版本控制'
$isRepo = (& git rev-parse --is-inside-work-tree 2>$null) -eq 'true'
if (-not $isRepo) {
    Result FAIL '不是 git 仓库，改动无法回滚 —— 执行 git init 并提交基线'
} else {
    $head = (& git log --oneline -1 2>$null)
    $count = (& git rev-list --count HEAD 2>$null)
    Result OK ('git 仓库正常，共 ' + $count + ' 次提交，HEAD: ' + $head)
    $dirty = @(& git status --porcelain 2>$null).Count
    if ($dirty -eq 0) { Result OK '工作区干净，无未提交改动' }
    elseif ($dirty -le 20) { Result WARN ('工作区有 ' + $dirty + ' 处未提交改动，可 git diff 后决定提交或丢弃') }
    else { Result FAIL ('工作区有 ' + $dirty + ' 处未提交改动，先确认没有误改再继续') }

    $leak = (& git ls-files --error-unmatch '.kb-local.env' 2>$null)
    if ($leak) { Result FAIL '.kb-local.env（含密钥）已被 git 跟踪，立即 git rm --cached' }
    else { Result OK '.kb-local.env 未被跟踪（含密钥，必须留在版本控制外）' }
}

# ---------------------------------------------------------------- 2. 运行时
Section '2. 运行时'
$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
    Result FAIL 'PATH 里找不到 java，无法启动后端（需要 JDK 21）'
} else {
    $jv = (& java -version 2>&1 | Select-Object -First 1)
    if ($jv -match '"(\d+)') {
        if ([int]$Matches[1] -ge 21) { Result OK ('java: ' + $jv) }
        else { Result FAIL ('java 版本过低，需要 21+：' + $jv) }
    } else { Result WARN ('java 已安装但版本无法识别：' + $jv) }
    if ($env:JAVA_HOME) { Result INFO ('JAVA_HOME=' + $env:JAVA_HOME) }
    else { Result WARN 'JAVA_HOME 未设置，部分构建工具可能选错 JDK' }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Result OK ('node: ' + (& node --version 2>$null)) }
else { Result WARN 'node 不在 PATH，前端无法构建（仅后端运行时不受影响）' }

$listening = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listening.Count -eq 0) {
    Result OK ('端口 ' + $Port + ' 空闲，知识库当前未运行')
} else {
    $owner = $listening[0].OwningProcess
    $pname = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
    Result WARN ('端口 ' + $Port + ' 已被占用：PID ' + $owner + '（' + $pname + '）—— 若知识库已在运行属正常，否则换端口 start.cmd -Port 8081')
}

# ---------------------------------------------------------------- 3. 数据与备份
Section '3. 数据与备份'
$db = Join-Path $script:KbDataDir 'kb.db'
if (Test-Path $db) {
    Result OK ('数据库: ' + (Size-MB (Get-Item $db).Length) + '  ' + $db)
    foreach ($sfx in @('-wal', '-shm')) {
        $f = $db + $sfx
        if (Test-Path $f) { Result INFO ('kb.db' + $sfx + ': ' + (Size-MB (Get-Item $f).Length)) }
    }
} else {
    Result WARN ('数据库不存在：' + $db + '（首次启动会新建，历史数据是否已迁走？）')
}

$uploads = Join-Path $script:KbDataDir 'uploads'
if (Test-Path $uploads) {
    $m = Get-ChildItem $uploads -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum
    Result INFO ('附件目录: ' + $m.Count + ' 个文件 / ' + (Size-MB ($m.Sum)))
}

$backups = @(Get-ChildItem $script:KbBackupRoot -Directory -ErrorAction SilentlyContinue)
if ($backups.Count -eq 0) {
    Result WARN '没有任何备份 —— 先跑一次 scripts\backup.cmd'
} else {
    # 备份目录的 mtime 不可靠（robocopy 整批刷新），日期一律从目录名解析：
    # 名字有 kb-/pre-opt-/pre-read-/pre-ui-/user-data- 多种前缀，统一抓 yyyyMMdd-HHmmss。
    $stamped = foreach ($b in $backups) {
        $st = [regex]::Match($b.Name, '(\d{8})-(\d{6})')
        if ($st.Success) {
            $made = [datetime]::ParseExact($st.Groups[1].Value + $st.Groups[2].Value, 'yyyyMMddHHmmss', $null)
        } else {
            $made = $b.LastWriteTime
        }
        [pscustomobject]@{ Dir = $b; Made = $made }
    }
    $newest = $stamped | Sort-Object Made -Descending | Select-Object -First 1
    $ageDays = [int]((Get-Date) - $newest.Made).TotalDays
    if ($ageDays -le 7) { Result OK ('备份 ' + $backups.Count + ' 份，最新 ' + $newest.Dir.Name + '（' + $ageDays + ' 天前）') }
    else { Result WARN ('备份 ' + $backups.Count + ' 份，但最新一份 ' + $newest.Dir.Name + ' 已 ' + $ageDays + ' 天前 —— 数据有丢失窗口') }
    $totalBytes = 0
    foreach ($b in $backups) { $totalBytes += (Get-ChildItem $b.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum }
    Result INFO ('备份总占用: ' + (Size-MB $totalBytes) + '（backup.ps1 只按 30 天轮转，无上限）')
}

$drive = Get-PSDrive -Name $script:KbRepoRoot.Substring(0, 1) -ErrorAction SilentlyContinue
if ($drive) {
    $freeGB = $drive.Free / 1GB
    $msg = '磁盘剩余 ' + ('{0:N1}' -f $freeGB) + ' GB（' + $drive.Name + ':）'
    if ($freeGB -lt 2) { Result FAIL ($msg + ' —— 低于 2 GB，写入随时失败') }
    elseif ($freeGB -lt 10) { Result WARN ($msg + ' —— 建议清理 backend\target 与旧备份') }
    else { Result OK $msg }
}

# ---------------------------------------------------------------- 4. 构建产物
Section '4. 构建产物'
$jars = @(Get-ChildItem (Join-Path $script:KbBackendDir 'target') -Filter '*.jar' -File -ErrorAction SilentlyContinue)
if ($jars.Count -eq 0) {
    Result WARN 'backend\target 下没有 jar，需要先构建（见 docs\README.md）'
} else {
    foreach ($j in ($jars | Sort-Object Length -Descending)) { Result INFO ($j.Name + '  ' + (Size-MB $j.Length)) }
    Result OK ('共 ' + $jars.Count + ' 个 jar')
}

$staticDir = Join-Path $script:KbBackendDir 'src\main\resources\static'
$staticIndex = Join-Path $staticDir 'index.html'
if (Test-Path $staticIndex) {
    $assets = @(Get-ChildItem (Join-Path $staticDir 'assets') -File -ErrorAction SilentlyContinue)
    Result OK ('前端产物已就位：assets ' + $assets.Count + ' 个文件（' + (Size-MB (($assets | Measure-Object Length -Sum).Sum)) + '）')
} else {
    Result FAIL 'static\index.html 缺失：后端能起来但打开是白屏 —— 先 pnpm build'
}

$feModules = Join-Path $script:KbRepoRoot 'frontend\node_modules'
if (Test-Path $feModules) { Result OK 'frontend\node_modules 存在' }
else { Result WARN 'frontend\node_modules 缺失，pnpm build / lint 会失败' }

# ---------------------------------------------------------------- 5. 配置
Section '5. 配置'
$envFile = Join-Path $script:KbRepoRoot '.kb-local.env'
if (Test-Path $envFile) {
    $keys = @(Get-Content $envFile -Encoding UTF8 | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') }).Count
    Result OK ('.kb-local.env 存在，' + $keys + ' 项私有配置（内容不打印）')
} else {
    Result WARN '.kb-local.env 不存在：简报/周报抓取所需的 key 只能靠环境变量提供'
}

$props = Join-Path $script:KbBackendDir 'src\main\resources\application.properties'
if (Test-Path $props) {
    $cfgPort = Select-String -Path $props -Pattern '^server\.port\s*=\s*(\d+)' | Select-Object -First 1
    if ($cfgPort) {
        $configured = $cfgPort.Matches[0].Groups[1].Value
        if ([int]$configured -eq $Port) { Result OK ('application.properties: server.port=' + $configured + '，与体检端口一致') }
        else { Result WARN ('application.properties: server.port=' + $configured + '，但本次体检按 ' + $Port + ' 检查') }
    }
} else {
    Result FAIL ('找不到 ' + $props)
}

# ---------------------------------------------------------------- 汇总
Write-Host ''
Write-Host ('=== 结果: OK ' + $script:OK + ' / WARN ' + $script:Warn + ' / FAIL ' + $script:Fail + ' ===') -ForegroundColor White
if ($script:Fail -gt 0) {
    Write-Host '  有 FAIL 项，先按上面的提示处理；体检本身未改动任何文件。' -ForegroundColor Red
    exit 1
}
if ($script:Warn -gt 0) {
    Write-Host '  无阻断问题；WARN 项按需处理。体检本身未改动任何文件。' -ForegroundColor Yellow
    exit 0
}
Write-Host '  全部通过。体检本身未改动任何文件。' -ForegroundColor Green
exit 0
