# ============================================================================
# start.ps1 —— 本机 / 局域网启动（由 scripts\start.cmd 调用）
# 用法：  scripts\start.cmd                  正常启动（默认端口 8080）
#         scripts\start.cmd -Rebuild         强制重新构建后再启动
#         scripts\start.cmd -Port 8081       换端口启动（8080 被别的程序占用时用）
#         set KBPORT=8081 && scripts\start.cmd   同上，用环境变量
# ============================================================================
param(
    [switch]$Rebuild,
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'kb-common.ps1')
if ($Port -gt 0) { Set-KbPort $Port }

Write-KbTitle '个人知识库 —— 本机 / 局域网启动'
Write-KbNote "端口：$(Get-KbPort)（可用 -Port 或环境变量 KBPORT 改）"

# 1) 端口先查：被占用时不要浪费几分钟去构建
Assert-KbPortFree (Get-KbPort)

# 2) JDK 检查
$javaExe = Assert-KbJava

# 3) 需要时构建
if ($Rebuild) {
    $existing = Get-KbJarPath
    if ($existing) {
        Write-KbStep "按 -Rebuild 要求删除旧 jar 后重新构建：$existing"
        Remove-Item -LiteralPath $existing -Force
    }
}
$jar = Build-KbIfNeeded

# 4) 打印访问地址
Show-KbAccessUrls (Get-KbPort)

# 5) 前台启动（窗口里能直接看到日志，Ctrl+C 或关闭窗口即停止）
Write-KbStep '正在启动服务 ...'
Write-KbNote '（保持本窗口打开；停止服务请按 Ctrl+C 或直接关闭窗口）'
Write-Host ''
# 必须显式传端口：application.properties 里的默认值固定是 8080，
# 不传的话 -Port 只会影响「显示出来的地址」，服务仍监听 8080。
#
# 翻译 key 也显式传：Spring 的环境变量宽松绑定会把 KB_BRIEFING_DEEPL_KEY
# 解析成 kb.briefing.deepl.key（下划线→点），跟实际的 kb.briefing.deepl-key
# 对不上，所以不依赖环境变量映射，直接作为属性传进去。
$javaArgs = @('-jar', $jar, "--server.port=$(Get-KbPort)")
if ($env:KB_BRIEFING_DEEPL_KEY) {
    $javaArgs += "--kb.briefing.deepl-key=$($env:KB_BRIEFING_DEEPL_KEY)"
    Write-KbNote '已带上 DeepL 翻译 key（来自 .kb-local.env）'
}
& $javaExe @javaArgs
$exitCode = $LASTEXITCODE

Write-Host ''
if ($exitCode -ne 0) {
    Write-KbError "服务已退出，退出码 $exitCode（上面通常有原因）。"
    Write-Host '按回车键关闭窗口...' -ForegroundColor DarkGray
    [void](Read-Host)
    exit $exitCode
}
Write-KbOk '服务已停止。'
