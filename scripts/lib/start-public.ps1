# ============================================================================
# start-public.ps1 —— 公网启动：本机服务 + Cloudflare 隧道（由 scripts\start-public.cmd 调用）
# 用法：  scripts\start-public.cmd                启动应用 + 公网隧道
#         scripts\start-public.cmd -SkipApp      复用已在运行的服务，只开隧道
#         scripts\start-public.cmd -Port 8081    换端口（8080 被占用时）
# ============================================================================
param(
    [switch]$SkipApp,
    [int]$HealthTimeoutSeconds = 180,
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'kb-common.ps1')
if ($Port -gt 0) { Set-KbPort $Port }

$port = Get-KbPort
$runtime = Get-KbRuntimeDir
$app = $null
$tunnel = $null
$publicUrl = $null

Write-KbTitle '个人知识库 —— 公网启动（Cloudflare 临时隧道）'

$cloudflared = Get-KbCloudflaredPath
if (-not (Test-Path $cloudflared)) {
    Exit-KbWithError "找不到 $cloudflared。" @(
        '公网访问需要 tools\cloudflared.exe（约 55 MB）。',
        '请从 https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe 下载并放到 tools\ 目录。'
    )
}

try {
    # 进程守门：本脚本一退出（含关窗口、被强制结束），下面登记的进程会被系统一并杀掉
    $jobGuard = Initialize-KbJobGuard
    if ($jobGuard -ne [IntPtr]::Zero) {
        Write-KbNote '已启用进程守门（窗口关闭/脚本退出时，应用与隧道都会被回收）。'
    } else {
        Write-KbWarn '进程守门不可用，只使用常规清理（Ctrl+C / 正常退出仍会回收进程）。'
        Write-KbNote ('原因：' + (Get-KbJobGuardReason))
    }

    if ($SkipApp) {
        Write-KbStep '-SkipApp：跳过启动应用，复用已在运行的服务。'
        if (-not (Test-KbPortInUse $port)) {
            Exit-KbWithError "端口 $port 上没有检测到服务，无法复用。" @(
                '去掉 -SkipApp 参数重新运行，让脚本自己启动知识库。'
            )
        }
    } else {
        Assert-KbPortFree $port
        $javaExe = Assert-KbJava
        $jar = Build-KbIfNeeded

        Write-KbStep '启动应用 ...'
        $app = Start-KbChild -FilePath $javaExe -ArgumentList @('-jar', $jar, "--server.port=$port") `
                -OutLog (Join-Path $runtime 'app.log') -ErrLog (Join-Path $runtime 'app.err.log')
        [void](Add-KbProcessToJobGuard -Process $app -JobHandle $jobGuard)
        Write-KbOk "应用已启动（PID $($app.Id)），日志：$(Join-Path $runtime 'app.log')"
    }

    # 健康检查通过后才开隧道（轮询，不盲等固定秒数）
    if (-not (Wait-KbHealth -Port $port -TimeoutSeconds $HealthTimeoutSeconds)) {
        Write-Host ''
        Write-KbError "等待服务就绪超时（$HealthTimeoutSeconds 秒内 /api/health 没有返回 200）。"
        if (-not $SkipApp -and (Test-Path (Join-Path $runtime 'app.err.log'))) {
            Write-KbNote "应用错误日志最后几行：$(Join-Path $runtime 'app.err.log')"
            Get-Content (Join-Path $runtime 'app.err.log') -Tail 10 -ErrorAction SilentlyContinue |
                    ForEach-Object { Write-KbNote $_ }
        }
        throw '服务未就绪，已放弃建立隧道。'
    }
    Write-KbOk "服务就绪：http://127.0.0.1:$port/api/health 返回 200"

    # 启动隧道
    Write-KbStep '启动 Cloudflare 隧道 ...'
    $outLog = Join-Path $runtime 'tunnel.out.log'
    $errLog = Join-Path $runtime 'tunnel.err.log'
    Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue
    $tunnel = Start-KbChild -FilePath $cloudflared `
            -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$port", '--no-autoupdate') `
            -OutLog $outLog -ErrLog $errLog
    [void](Add-KbProcessToJobGuard -Process $tunnel -JobHandle $jobGuard)

    # 从 cloudflared 的输出里提取临时公网地址
    Write-Host '    正在申请临时公网地址' -NoNewline
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        foreach ($logFile in @($errLog, $outLog)) {
            if (Test-Path $logFile) {
                $text = Get-Content -LiteralPath $logFile -Raw -ErrorAction SilentlyContinue
                if ($text) {
                    $match = [regex]::Match($text, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
                    if ($match.Success) {
                        $publicUrl = $match.Value
                        break
                    }
                }
            }
        }
        if ($publicUrl) { break }
        if ($tunnel.HasExited) { break }
        Write-Host '.' -NoNewline
        Start-Sleep -Milliseconds 1000
    }
    Write-Host ''

    if (-not $publicUrl) {
        Write-KbError '没有从 cloudflared 的输出里拿到公网地址。'
        Write-KbNote "隧道日志：$(Join-Path $runtime 'tunnel.err.log')"
        Get-Content $errLog -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-KbNote $_ }
        throw '隧道建立失败。'
    }

    # 醒目打印
    Write-Host ''
    Write-Host ('#' * 70) -ForegroundColor Green
    Write-Host '#  公网地址（把这个地址发给别人，他们就能访问）：' -ForegroundColor Green
    Write-Host "#      $publicUrl" -ForegroundColor Yellow
    Write-Host ('#' * 70) -ForegroundColor Green
    Write-Host ''
    Write-Host '  请记住：' -ForegroundColor White
    Write-Host '    1) 这个临时地址每次重启都会变，本窗口关掉就失效；' -ForegroundColor White
    Write-Host '    2) 任何人拿到这个地址都能打开登录页 —— 请务必设置强密码（12 位以上，别用姓名/生日）；' -ForegroundColor White
    Write-Host '    3) 第一个注册的账号会自动成为管理员，之后注册必须由管理员发邀请码；' -ForegroundColor White
    Write-Host '    4) 保持本窗口打开服务才在线；按 Ctrl+C 停止（应用和隧道会一起关掉）。' -ForegroundColor White
    Write-Host ''
    Write-KbNote "本地地址（自己用）：http://127.0.0.1:$port"
    Write-KbNote "隧道日志：$errLog"
    Write-Host ''
    Write-KbStep '服务运行中（Ctrl+C 停止）...'

    # 保持运行：隧道退出或应用退出都收摊
    while ($true) {
        if ($tunnel.HasExited) {
            Write-KbWarn '隧道进程已退出。'
            break
        }
        if (-not $SkipApp -and $app -and $app.HasExited) {
            Write-KbWarn "应用进程已退出（退出码 $($app.ExitCode)）。"
            break
        }
        Start-Sleep -Seconds 1
    }
} catch {
    Write-Host ''
    Write-KbError $_.Exception.Message
} finally {
    Write-KbStep '清理进程 ...'
    Stop-KbProcess $tunnel
    if (-not $SkipApp) { Stop-KbProcess $app }
    Write-KbOk '已停止：应用与隧道都已关闭。'
}

Write-Host ''
Write-Host '按回车键关闭窗口...' -ForegroundColor DarkGray
[void](Read-Host)
