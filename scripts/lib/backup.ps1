# ============================================================================
# backup.ps1 —— 备份 data\ 目录（由 scripts\backup.cmd 调用）
#
# 为什么整目录复制（kb.db + kb.db-wal + kb.db-shm + uploads\）：
#   数据库跑在 WAL 模式，最近提交的事务可能还只在 kb.db-wal 里，
#   只拷 kb.db 会丢数据；把 kb.db / -wal / -shm 一起拷走，SQLite 打开备份时
#   会自动回放 WAL，得到一个完整可用的库。所以这里用 robocopy /E 整目录复制，
#   并且在服务运行中（热备份）时给出提示。
# ============================================================================

param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'kb-common.ps1')

Write-KbTitle '个人知识库 —— 备份'

$dataDir = Get-KbDataDir
$dbFile = Join-Path $dataDir 'kb.db'

if (-not (Test-Path $dataDir)) {
    Exit-KbWithError "找不到数据目录：$dataDir" @('服务从未启动过，目前没有数据需要备份。')
}
if (-not (Test-Path $dbFile)) {
    Exit-KbWithError "找不到数据库文件：$dbFile" @('服务从未启动过，目前没有数据需要备份。')
}

$running = Test-KbPortInUse (Get-KbPort)
if ($running) {
    Write-KbWarn '服务正在运行：本次是「热备份」。'
    Write-KbNote '已连同 kb.db-wal / kb.db-shm 一起复制；正在写入的那一瞬间的事务可能不在备份里。'
    Write-KbNote '要求 100% 精确的话，请先停止服务（关掉启动窗口）再备份。'
} else {
    Write-KbOk '服务未运行，本次是「冷备份」。'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Get-KbBackupRoot
if (-not (Test-Path $backupRoot)) { New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null }
$dest = Join-Path $backupRoot "kb-$stamp"

Write-KbStep "复制 $dataDir  ->  $dest"
$watch = [System.Diagnostics.Stopwatch]::StartNew()
& robocopy.exe $dataDir $dest /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
$robocopyExit = $LASTEXITCODE
$watch.Stop()

if ($robocopyExit -ge 8) {
    Exit-KbWithError "复制失败（robocopy 退出码 $robocopyExit）。" @(
        "源目录：$dataDir",
        "目标目录：$dest",
        '请检查目标磁盘空间与权限后重试。'
    )
}

# 完整性最低校验：备份出来的 kb.db 必须是 SQLite 文件且非空
$copiedDb = Join-Path $dest 'kb.db'
if (-not (Test-Path $copiedDb)) {
    Exit-KbWithError "备份目录里没有 kb.db：$dest" @('复制过程不完整，请重试。')
}
$dbLength = (Get-Item -LiteralPath $copiedDb).Length
if ($dbLength -eq 0) {
    Exit-KbWithError "备份出来的 kb.db 是 0 字节：$copiedDb" @('复制过程不完整，请重试。')
}
$stream = [System.IO.File]::OpenRead($copiedDb)
$headerBytes = New-Object byte[] 15
try { [void]$stream.Read($headerBytes, 0, 15) } finally { $stream.Close() }
$header = [System.Text.Encoding]::ASCII.GetString($headerBytes)
if ($header -ne 'SQLite format 3') {
    Exit-KbWithError "备份出来的 kb.db 不是有效的 SQLite 文件（文件头：$header）。" @(
        '说明：文件可能在复制过程中被占用/损坏。',
        '请停止服务后重新运行本脚本。'
    )
}

# ---------------------------------------------------------------- 轮转
# 每天自动备份如果不清理，一年就是 365 份目录。这里只按「保留天数」清理自动备份目录，
# 名字不符的一律不动（手工备份、取证备份都是 user-data-* 之类的名字）。
#
# 日期必须从目录名解析，不能看目录 mtime：robocopy 复制会整批刷新 mtime，
# 实测 16 份备份的 mtime 全是同一天 —— 按 mtime 判过期，会把「今天这份」
# 和一年前的备份一起判成过期，一次性删光。
$keepDays = 30
if ($env:KB_BACKUP_KEEP_DAYS) {
    $parsedDays = 0
    if ([int]::TryParse($env:KB_BACKUP_KEEP_DAYS, [ref]$parsedDays) -and $parsedDays -ge 1) {
        $keepDays = $parsedDays
    }
}
$removed = @()
$cutoff = (Get-Date).AddDays(-$keepDays)
foreach ($dir in (Get-ChildItem -LiteralPath $backupRoot -Directory -Filter 'kb-*' -ErrorAction SilentlyContinue)) {
    if ($dir.FullName -eq $dest) { continue }
    $st = [regex]::Match($dir.Name, '(\d{8})-(\d{6})')
    if ($st.Success) {
        $made = [datetime]::ParseExact($st.Groups[1].Value + $st.Groups[2].Value, 'yyyyMMddHHmmss', $null)
    } else {
        # 名字里没有日期（手工改名）才退回 mtime，并明确提示这条判断不可靠
        $made = $dir.LastWriteTime
        Write-KbWarn "无法从名字解析日期，按 mtime 判断：$($dir.Name)"
    }
    if ($made -ge $cutoff) { continue }
    if ($DryRun) {
        Write-KbNote "（dry-run）本应删除 $($dir.Name)（备份日期 $($made.ToString('yyyy-MM-dd HH:mm'))）"
        $removed += $dir.Name
        continue
    }
    try {
        Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction Stop
        $removed += $dir.Name
    } catch {
        Write-KbWarn "旧备份清理失败（可手动删）：$($dir.Name)"
    }
}

$files = Get-ChildItem -Path $dest -Recurse -File
$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
if (-not $totalBytes) { $totalBytes = 0 }

Write-Host ''
Write-KbOk "备份完成，用时 $([math]::Round($watch.Elapsed.TotalSeconds, 2)) 秒"
if ($removed.Count -gt 0) {
    $verb = if ($DryRun) { '本应清理（dry-run，未删任何文件）' } else { '已清理' }
    Write-KbNote "$verb $($removed.Count) 份超过 $keepDays 天的旧备份：$($removed -join ', ')"
} else {
    Write-KbNote "旧备份轮转：保留最近 $keepDays 天，本次无需清理"
}
Write-KbNote "备份目录：$dest"
Write-KbNote "文件数：$($files.Count)    总大小：$([math]::Round($totalBytes / 1MB, 2)) MB"
Write-Host ''
Write-Host '  备份内容：' -ForegroundColor White
foreach ($file in $files) {
    $relative = $file.FullName.Substring($dest.Length).TrimStart('\')
    Write-Host ("    {0,-46} {1,10:N0} 字节" -f $relative, $file.Length)
}
Write-Host ''
Write-Host '  怎么恢复：' -ForegroundColor White
Write-Host '    1) 关闭知识库（关掉启动窗口）；' -ForegroundColor White
Write-Host "    2) 把备份目录里的内容（kb.db、kb.db-wal、kb.db-shm、uploads\）拷回 $dataDir；" -ForegroundColor White
Write-Host '    3) 重新运行 scripts\start.cmd。' -ForegroundColor White
Write-Host ''
Write-Host '  怎么迁移到另一台电脑：' -ForegroundColor White
Write-Host '    1) 把整个仓库目录（或至少 backend\ + scripts\ + tools\ + data\）拷过去；' -ForegroundColor White
Write-Host '    2) 目标电脑装好 JDK 21；' -ForegroundColor White
Write-Host '    3) 运行 scripts\start.cmd（首次会自动构建）。' -ForegroundColor White
Write-Host ''
