# ============================================================================
# kb-common.ps1 —— 知识库脚本共用函数（PowerShell 5.1 兼容，UTF-8 带 BOM 保存）
# 被 scripts/start.cmd、start-public.cmd、backup.cmd 间接调用
# ============================================================================

$script:KbRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:KbBackendDir = Join-Path $script:KbRepoRoot 'backend'
$script:KbDataDir = Join-Path $script:KbRepoRoot 'data'
$script:KbBackupRoot = Join-Path $script:KbRepoRoot 'backups'
$script:KbToolsDir = Join-Path $script:KbRepoRoot 'tools'
$script:KbRuntimeDir = Join-Path $PSScriptRoot '..\.runtime'

# 加载本地私有配置（不含在源码里，避免 API key 跟着项目外传）。
# 只在环境变量尚未设置时写入，这样命令行上显式给的优先。
$script:KbLocalEnvPath = Join-Path $script:KbRepoRoot '.kb-local.env'
if (Test-Path $script:KbLocalEnvPath) {
    foreach ($line in (Get-Content -LiteralPath $script:KbLocalEnvPath -Encoding UTF8)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $eq = $trimmed.IndexOf('=')
        if ($eq -lt 1) { continue }
        $key = $trimmed.Substring(0, $eq).Trim()
        $value = $trimmed.Substring($eq + 1).Trim()
        if ($key -and -not [Environment]::GetEnvironmentVariable($key, 'Process')) {
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}
# 默认端口。可用 `start.cmd -Port 8081` 覆盖 —— 8080 常被别的服务占用，
# 硬编码会让知识库根本起不来（优先读 $env:KBPORT，其次 -Port，最后 8080）。
$script:KbPort = 8080
if ($env:KBPORT) {
    $parsed = 0
    if ([int]::TryParse($env:KBPORT, [ref]$parsed) -and $parsed -ge 1 -and $parsed -le 65535) {
        $script:KbPort = $parsed
    }
}

function Get-KbRepoRoot { return $script:KbRepoRoot }
function Get-KbBackendDir { return $script:KbBackendDir }
function Get-KbDataDir { return $script:KbDataDir }
function Get-KbBackupRoot { return $script:KbBackupRoot }
function Get-KbPort { return $script:KbPort }

# 由 start.ps1 / start-public.ps1 在 param 块里调用，覆盖端口
function Set-KbPort([int]$Port) {
    if ($Port -ge 1 -and $Port -le 65535) { $script:KbPort = $Port }
}

function Get-KbRuntimeDir {
    if (-not (Test-Path $script:KbRuntimeDir)) {
        New-Item -ItemType Directory -Force -Path $script:KbRuntimeDir | Out-Null
    }
    return (Resolve-Path $script:KbRuntimeDir).Path
}

function Get-KbCloudflaredPath {
    return (Join-Path $script:KbToolsDir 'cloudflared.exe')
}

# ------------------------------------------------------------------ 输出

function Write-KbTitle([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 68) -ForegroundColor DarkCyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ('=' * 68) -ForegroundColor DarkCyan
}

function Write-KbStep([string]$Text) { Write-Host "[*] $Text" -ForegroundColor Cyan }
function Write-KbOk([string]$Text) { Write-Host "[OK] $Text" -ForegroundColor Green }
function Write-KbNote([string]$Text) { Write-Host "    $Text" -ForegroundColor Gray }
function Write-KbWarn([string]$Text) { Write-Host "[!] $Text" -ForegroundColor Yellow }
function Write-KbError([string]$Text) { Write-Host "[x] $Text" -ForegroundColor Red }

# 出错退出：打印提示后暂停（双击运行时窗口不会一闪而过）
function Exit-KbWithError([string]$Message, [string[]]$Hints) {
    Write-Host ''
    Write-KbError $Message
    if ($Hints) {
        foreach ($hint in $Hints) { Write-KbNote $hint }
    }
    Write-Host ''
    Write-Host '按回车键关闭窗口...' -ForegroundColor DarkGray
    [void](Read-Host)
    exit 1
}

# ------------------------------------------------------------------ 环境检查

# 返回可用的 java.exe 路径；找不到返回 $null
function Get-KbJavaExe {
    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME 'bin\java.exe'
        if (Test-Path $candidate) { return $candidate }
    }
    $command = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $command = Get-Command java -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

# 解析 java -version 的主版本号；解析不出来返回 0
function Get-KbJavaMajorVersion([string]$JavaExe) {
    try {
        $output = (& $JavaExe -version 2>&1) | Out-String
    } catch {
        return 0
    }
    $match = [regex]::Match($output, 'version "?(\d+)')
    if (-not $match.Success) { return 0 }
    return [int]$match.Groups[1].Value
}

# 检查 JDK 是否满足要求（>= 21），不满足直接给出中文提示并退出
function Assert-KbJava {
    Write-KbStep '检查 JDK ...'
    $javaExe = Get-KbJavaExe
    if (-not $javaExe) {
        Exit-KbWithError '没有找到 Java（JDK 21）。' @(
            '请先安装 JDK 21：https://adoptium.net/zh-CN/temurin/releases/?version=21',
            '安装时勾选 “Set JAVA_HOME variable”，装完后重新打开本窗口再试。',
            '已安装但提示找不到？可以手动设置环境变量 JAVA_HOME 指向 JDK 安装目录。',
            '查看当前是否可用：在命令行执行  java -version'
        )
    }
    $major = Get-KbJavaMajorVersion $javaExe
    if ($major -ne 0 -and $major -lt 21) {
        Exit-KbWithError "当前 Java 版本是 $major，本项目需要 JDK 21 或更高。" @(
            "正在使用的 java：$javaExe",
            '请安装 JDK 21：https://adoptium.net/zh-CN/temurin/releases/?version=21',
            '安装后确认  java -version  输出 21 及以上，再重新运行本脚本。'
        )
    }
    Write-KbOk "Java 就绪：$javaExe（版本 $major）"
    return $javaExe
}

# 端口是否已被占用
function Test-KbPortInUse([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(1000)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# 占用端口的进程（拿不到就返回空字符串）
function Get-KbPortOwner([int]$Port) {
    try {
        $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
                Select-Object -First 1
        if (-not $connection) { return '' }
        $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
        if (-not $process) { return "PID $($connection.OwningProcess)" }
        return "$($process.ProcessName) (PID $($process.Id))"
    } catch {
        return ''
    }
}

# 8080 被占用时给出明确中文提示并退出
function Assert-KbPortFree([int]$Port) {
    if (-not (Test-KbPortInUse $Port)) { return }
    $owner = Get-KbPortOwner $Port
    $detail = ''
    if ($owner) { $detail = "，占用进程：$owner" }
    Exit-KbWithError "端口 $Port 已被占用$detail。" @(
        "说明：可能已经有一个知识库在运行，或者别的程序占用了 $Port。",
        "先访问 http://127.0.0.1:$Port 看看是不是已经开着了；",
        "如果确实要重新启动，先关掉那个窗口，或在任务管理器里结束占用 $Port 的进程。",
        "确认占用的进程：在 PowerShell 里执行  Get-NetTCPConnection -LocalPort $Port -State Listen"
    )
}

# 本机可用的 IPv4 地址（含网卡名），用于打印局域网访问地址
function Get-KbIPv4Addresses {
    $result = @()
    try {
        $result = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
                Where-Object {
                    $_.IPAddress -notlike '127.*' -and
                    $_.IPAddress -notlike '169.254.*' -and
                    $_.PrefixOrigin -ne 'WellKnown'
                } |
                Select-Object -Property IPAddress, InterfaceAlias
    } catch {
        $result = @()
    }
    if ($result.Count -eq 0) {
        try {
            $result = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
                    Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notlike '127.*' } |
                    ForEach-Object { New-Object psobject -Property @{ IPAddress = $_.IPAddressToString; InterfaceAlias = '' } }
        } catch {
            $result = @()
        }
    }
    return $result
}

# ------------------------------------------------------------------ 构建与启动

# 校验是不是**可运行的 Spring Boot fat jar**。
# 为什么需要它：一次失败的 repackage 会先被 jar:jar 写成一个普通库 jar（没有 BOOT-INF/），
# 随后 repackage 重命名失败并中断 —— 磁盘上留下一个约 1 MB 的「假 jar」。
# 若只按文件名判断存在性，它会被当成「已有可执行 jar」直接拿去 java -jar，
# 直到启动时才报「没有主清单属性」，用户无从判断原因。
function Test-KbRunnableJar {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path $Path)) { return $false }
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
        try {
            foreach ($entry in $zip.Entries) {
                if ($entry.FullName -eq 'BOOT-INF/') { return $true }
            }
            return $false
        } finally {
            $zip.Dispose()
        }
    } catch {
        return $false
    }
}

# 找到可运行的 jar（排除 sources/javadoc，并**跳过损坏的 jar**）
# 跳过损坏的 jar 会让 Build-KbIfNeeded 走构建分支，从而自愈。
function Get-KbJarPath {
    $target = Join-Path $script:KbBackendDir 'target'
    if (-not (Test-Path $target)) { return $null }
    $candidates = Get-ChildItem -Path $target -Filter 'knowledge-base-*.jar' -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notlike '*sources*' -and $_.Name -notlike '*javadoc*' } |
            Sort-Object LastWriteTime -Descending
    $broken = @()
    foreach ($candidate in $candidates) {
        if (Test-KbRunnableJar $candidate.FullName) { return $candidate.FullName }
        $broken += $candidate.Name
    }
    if ($broken.Count -gt 0) {
        Write-KbWarn "发现不可运行的 jar（缺少 BOOT-INF/，通常是上次构建中途失败留下的）："
        Write-KbNote "  $($broken -join ', ')"
        Write-KbWarn '已忽略它，接下来会重新构建。'
    }
    return $null
}

# 收集可用的 Maven 入口，按优先级排列。
# 为什么要回落：mvnw.cmd 首次运行要下载 Maven 发行包，网络受限时会失败；
# 而 ~/.m2/wrapper/dists 里往往已经有一份完整的 Maven，直接用它更可靠。
function Get-KbMavenCandidates {
    $list = @()

    $mvnw = Join-Path $script:KbBackendDir 'mvnw.cmd'
    if (Test-Path $mvnw) { $list += $mvnw }

    $dists = Join-Path $env:USERPROFILE '.m2\wrapper\dists'
    if (Test-Path $dists) {
        Get-ChildItem -Path $dists -Recurse -Filter 'mvn.cmd' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\bin\\mvn\.cmd$' } |
            Sort-Object FullName -Descending |
            ForEach-Object { $list += $_.FullName }
    }

    $onPath = Get-Command 'mvn.cmd' -ErrorAction SilentlyContinue
    if ($onPath) { $list += $onPath.Source }

    return $list
}

# 依次尝试各 Maven 入口，第一个成功的即为结果
function Invoke-KbMaven {
    param([Parameter(Mandatory = $true)][string[]]$MavenArgs)

    $candidates = Get-KbMavenCandidates
    if ($candidates.Count -eq 0) {
        Exit-KbWithError '找不到可用的 Maven。' @(
            '请确认 backend\mvnw.cmd 存在，或安装 Maven 后把 mvn 加入 PATH。',
            '本机 ~/.m2/wrapper/dists 下若已有 Maven 发行版，也会被自动使用。'
        )
    }

    $buildExit = 1
    foreach ($exe in $candidates) {
        Push-Location $script:KbBackendDir
        try {
            # 必须 Out-Host：直接 `& $exe` 会把构建输出混进函数返回值，
            # 调用方拿到的 $buildExit 就变成了「输出字符串数组」而不是退出码。
            & $exe @MavenArgs | Out-Host
            $buildExit = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        if ($buildExit -eq 0) { return 0 }
        Write-KbNote "这个 Maven 入口没成功（退出码 $buildExit），换下一个：$exe"
    }
    return $buildExit
}

# 需要时用 Maven 构建（首次会下载依赖，耗时几分钟）
function Build-KbIfNeeded {
    $jar = Get-KbJarPath
    if ($jar) {
        Write-KbOk "已有可执行 jar：$jar"
        return $jar
    }
    Write-KbStep '没有找到可执行 jar，开始构建（首次构建需要几分钟下载依赖，请耐心等待）...'
    $buildExit = Invoke-KbMaven -MavenArgs @('-B', '-DskipTests', 'package')
    if ($buildExit -ne 0) {
        Exit-KbWithError "构建失败（退出码 $buildExit）。" @(
            '请把上面最后几十行错误信息发给管理员。',
            '常见原因：网络不通导致依赖下载失败；可重试一次。'
        )
    }
    $jar = Get-KbJarPath
    if (-not $jar) {
        Exit-KbWithError '构建结束但仍未找到 jar 文件。' @("请检查 $script:KbBackendDir\target 目录。")
    }
    Write-KbOk "构建完成：$jar"
    return $jar
}

# 启动子进程（共用当前控制台，关闭窗口时会一起结束），输出重定向到日志文件
function Start-KbChild {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$OutLog,
        [Parameter(Mandatory = $true)][string]$ErrLog
    )
    $quoted = @()
    foreach ($argument in $ArgumentList) {
        if ($argument -match '[\s"]') {
            $quoted += '"' + ($argument -replace '"', '\"') + '"'
        } else {
            $quoted += $argument
        }
    }
    $process = Start-Process -FilePath $FilePath -ArgumentList ($quoted -join ' ') `
            -NoNewWindow -PassThru `
            -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
    return $process
}

# 结束进程及其子进程；进程不存在则忽略
function Stop-KbProcess($Process) {
    if ($null -eq $Process) { return }
    try {
        if ($Process.HasExited) { return }
        & taskkill.exe /PID $Process.Id /T /F 2>&1 | Out-Null
    } catch {
        try { $Process.Kill() } catch { }
    }
}

# ------------------------------------------------------------------ 进程守门（Job Object）

$script:KbJobNativeType = @'
using System;
using System.Runtime.InteropServices;

public static class KbJobNative
{
    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public IntPtr MinimumWorkingSetSize;
        public IntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public IntPtr ProcessMemoryLimit;
        public IntPtr JobMemoryLimit;
        public IntPtr PeakProcessMemoryUsed;
        public IntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    // 创建「句柄一关就杀掉组内所有进程」的作业对象
    public static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) { return IntPtr.Zero; }
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)length))
            {
                return IntPtr.Zero;
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        return job;
    }

    public static bool Assign(IntPtr job, IntPtr process)
    {
        if (job == IntPtr.Zero || process == IntPtr.Zero) { return false; }
        return AssignProcessToJobObject(job, process);
    }
}
'@

$script:KbJobHandle = [IntPtr]::Zero
$script:KbJobGuardReason = ''

# 建立一个「本脚本一退出（正常退出、Ctrl+C、被强制结束、关窗口都算），
# 组内进程一律被系统杀掉」的作业对象。失败返回 Zero，调用方退回普通清理逻辑。
function Initialize-KbJobGuard {
    if ($script:KbJobHandle -ne [IntPtr]::Zero) { return $script:KbJobHandle }
    $savedLib = $env:LIB
    $savedInclude = $env:INCLUDE
    $savedLibPath = $env:LIBPATH
    try {
        # 有些机器残留了指向不存在目录的旧 VC 环境变量（例如 LIB=F:\VC98\mfc\lib），
        # 会让 Add-Type 的编译按「警告即错误」直接失败，这里临时清掉。
        $env:LIB = $null
        $env:INCLUDE = $null
        $env:LIBPATH = $null
        if (-not ('KbJobNative' -as [type])) {
            Add-Type -TypeDefinition $script:KbJobNativeType -ErrorAction Stop
        }
        $script:KbJobHandle = [KbJobNative]::CreateKillOnCloseJob()
        if ($script:KbJobHandle -eq [IntPtr]::Zero) {
            $script:KbJobGuardReason = 'CreateJobObject / SetInformationJobObject 返回失败'
        }
    } catch {
        $script:KbJobGuardReason = $_.Exception.Message
        $script:KbJobHandle = [IntPtr]::Zero
    } finally {
        $env:LIB = $savedLib
        $env:INCLUDE = $savedInclude
        $env:LIBPATH = $savedLibPath
    }
    return $script:KbJobHandle
}

function Get-KbJobGuardReason { return $script:KbJobGuardReason }

# 把进程登记进守门作业；失败只是少一层保险，不影响正常流程
function Add-KbProcessToJobGuard {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [IntPtr]$JobHandle
    )
    if ($null -eq $Process -or $JobHandle -eq [IntPtr]::Zero) { return $false }
    try {
        return [KbJobNative]::Assign($JobHandle, $Process.Handle)
    } catch {
        return $false
    }
}

# 轮询 /api/health 直到返回 200（带总超时）
function Wait-KbHealth {
    param(
        [int]$Port = 8080,
        [int]$TimeoutSeconds = 180,
        [switch]$Quiet
    )
    $url = "http://127.0.0.1:$Port/api/health"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    if (-not $Quiet) { Write-Host '    等待服务就绪（/api/health 返回 200）' -NoNewline }
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                if (-not $Quiet) { Write-Host ' 就绪' -ForegroundColor Green }
                return $true
            }
        } catch {
            # 服务还没起来，继续等
        }
        if (-not $Quiet) { Write-Host '.' -NoNewline }
        Start-Sleep -Milliseconds 1500
    }
    if (-not $Quiet) { Write-Host ' 超时' -ForegroundColor Red }
    return $false
}

function Show-KbAccessUrls([int]$Port) {
    Write-Host ''
    Write-Host '  在浏览器里打开下面的地址：' -ForegroundColor White
    Write-Host "    本机：    http://127.0.0.1:$Port" -ForegroundColor White
    $addresses = Get-KbIPv4Addresses
    if ($addresses.Count -gt 0) {
        Write-Host '    局域网：  （同一路由器的手机/电脑可用）' -ForegroundColor White
        foreach ($address in $addresses) {
            $alias = ''
            if ($address.InterfaceAlias) { $alias = "  [$($address.InterfaceAlias)]" }
            Write-Host "              http://$($address.IPAddress):$Port$alias" -ForegroundColor White
        }
        Write-Host '    提示：局域网访问不通时，检查 Windows 防火墙是否放行了 8080 端口。' -ForegroundColor DarkYellow
    } else {
        Write-KbWarn '没有探测到局域网 IPv4 地址（可能未联网或只有虚拟网卡）。'
    }
    Write-Host ''
}
