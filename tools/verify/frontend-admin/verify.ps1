#requires -version 5
<#
  Frontend admin views (trash / io / stats / admin) acceptance harness.

  What it does
    1. static checks on the four deliverables (line count, node --check, no CDN, no innerHTML)
    2. driven browser test: headless Edge against a mock backend that replays the
       frozen docs/API.md contract, with 100+ interaction assertions
    3. real app shell smoke: index.html + main.js + hash routing, one view at a time
    4. XSS checks: payload injected into every server-provided string surface

  Usage (from anywhere; the repo root is derived from this script location)
    powershell -File tools\verify\frontend-admin\verify.ps1
    powershell -File tools\verify\frontend-admin\verify.ps1 -Neg
    powershell -File tools\verify\frontend-admin\verify.ps1 -Clean
    powershell -File tools\verify\frontend-admin\verify.ps1 -Port 8801

  Real backend smoke (once the Spring Boot app serves :8080):
    powershell -File tools\verify\frontend-admin\verify.ps1 -Backend http://127.0.0.1:8080 -User admin -Password <pwd>
    -> read-only API contract probe + all four views rendered from real data.
       The mock-driven assertion suite is intentionally skipped in this mode
       because its fixtures are mock data.

  Requires: node on PATH, Microsoft Edge installed, a free local port.
#>
param(
  [int]$Port = 8791,
  [string]$HarnessDir = '',
  [string]$Root = '',
  [string]$Backend = '',
  [string]$User = 'admin',
  [string]$Password = 'admin12345',
  [switch]$Neg,
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
$script:failLines = @()

if (-not $HarnessDir) {
  $HarnessDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
}
$HarnessDir = (Resolve-Path $HarnessDir).Path

function Resolve-RepoRoot([string]$start) {
  $dir = (Resolve-Path $start).Path
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-Path (Join-Path $dir 'docs\SCHEMA.md')) { return $dir }
    $parent = Split-Path $dir -Parent
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  throw "repo root not found: no docs\SCHEMA.md above $start"
}
if (-not $Root) { $Root = Resolve-RepoRoot $HarnessDir }

$STATIC = Join-Path $Root 'backend\src\main\resources\static'
$VIEWS = Join-Path $STATIC 'assets\js\views'
$MOCK = Join-Path $HarnessDir 'mock.js'
$DUMP = Join-Path $HarnessDir 'dump.ps1'
$SCRATCH = Join-Path $env:TEMP 'kb-web-admin-verify'
$Origin = "http://127.0.0.1:$Port"

function Head($t) { Write-Output ""; Write-Output ("=" * 72); Write-Output $t; Write-Output ("=" * 72) }
function Check($name, $ok, $extra) {
  if ($ok) { $script:pass++ } else { $script:fail++; $script:failLines += "$name >> $extra" }
  Write-Output ("  [{0}] {1}{2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $(if ($ok -or -not $extra) { '' } else { '  >> ' + $extra }))
}
function CountOf($text, $needle) { return ([regex]::Matches($text, [regex]::Escape($needle))).Count }

Head '0) environment'
Write-Output ("harness dir : " + $HarnessDir)
Write-Output ("repo root   : " + $Root)
Write-Output ("static root : " + $STATIC)
Write-Output ("port        : " + $Port)
Write-Output ("mode        : " + $(if ($Backend) { "backend smoke -> $Backend" } else { 'mock backend (direct)' }))
foreach ($f in @('mock.js', 'drive.html', 'dump.ps1', 'verify.ps1', 'README.md')) {
  $p = Join-Path $HarnessDir $f
  Write-Output ('  {0,-12} {1}' -f $f, $(if (Test-Path $p) { 'present ' + (Get-Item $p).Length + ' B' } else { 'MISSING' }))
}
if (-not (Test-Path $MOCK)) { throw "harness file missing: $MOCK" }
if (-not (Test-Path $DUMP)) { throw "harness file missing: $DUMP" }
if (-not (Test-Path $SCRATCH)) { New-Item -ItemType Directory -Force -Path $SCRATCH | Out-Null }

Head '1) deliverable files'
$files = @(
  @{p = "$VIEWS\trash.js"; n = 'views/trash.js'},
  @{p = "$VIEWS\io.js"; n = 'views/io.js'},
  @{p = "$VIEWS\stats.js"; n = 'views/stats.js'},
  @{p = "$VIEWS\admin.js"; n = 'views/admin.js'},
  @{p = "$STATIC\assets\css\features-admin.css"; n = 'css/features-admin.css'}
)
foreach ($f in $files) {
  if (-not (Test-Path $f.p)) { Check ($f.n + ' exists') $false 'missing'; continue }
  $raw = [System.IO.File]::ReadAllText($f.p)
  Check ($f.n + ' present') $true ''
  Write-Output ('      {0,5} lines {1,7} B  CRLF={2}' -f (Get-Content $f.p -Encoding utf8).Count, (Get-Item $f.p).Length, ([regex]::Matches($raw, "`r`n")).Count)
}

Head '2) ESM syntax check: node --check'
foreach ($f in @('trash', 'io', 'stats', 'admin')) {
  Copy-Item "$VIEWS\$f.js" (Join-Path $SCRATCH 'chk.mjs') -Force
  $o = (& node --check (Join-Path $SCRATCH 'chk.mjs') 2>&1) -join ' '
  Check ("views/$f.js node --check") ($LASTEXITCODE -eq 0) $o
}

Head '3) no external links, no unsafe rendering'
$scan = $files | ForEach-Object { $_.p }
$hits = Select-String -Path $scan -Pattern 'http://', 'https://', '//cdn', 'unpkg', 'jsdelivr', '@import'
Check 'no CDN / external URLs in the four views or their stylesheet' (-not $hits) (($hits | ForEach-Object { $_.Filename + ':' + $_.LineNumber }) -join ', ')
$hits2 = Select-String -Path $scan -Pattern 'innerHTML', "html\s*:"
Check 'no innerHTML / html: sink (all server strings render via text)' (-not $hits2) (($hits2 | ForEach-Object { $_.Filename + ':' + $_.LineNumber }) -join ', ')

Head '4) port housekeeping'
# recycle only the port this script needs; never sweep by process name (in -Backend mode the real backend may be node too)
$stale = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($stale) {
  $stale | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Write-Output ("  killing stale listener pid " + $_ + " on port " + $Port)
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 400
} else {
  Write-Output ("  port " + $Port + " already free")
}
if ($Backend) { Write-Output ("  backend " + $Backend + " is never touched (no process sweep, no reset)") }

function Invoke-ShellSmoke([string]$origin, [bool]$strict) {
  Head 'real app shell smoke: each view loaded through index.html + main.js'
  if ($strict) { Write-Output '  (strict mode: mock fixture reset before each view, data-specific counts expected)' }
  else { Write-Output '  (lenient mode: real backend data is unknown, only structural markers asserted)' }
  foreach ($v in @('trash', 'io', 'stats', 'admin')) {
    if ($strict) { Invoke-WebRequest "$origin/__init" -Method POST -Body '{}' -UseBasicParsing | Out-Null }
    $out = Join-Path $SCRATCH ("shell-" + $v + ".html")
    & powershell -File $DUMP -Url "$origin/#/$v" -Out $out -Budget 12000 -Profile ("s-" + $v) | Out-Null
    $dom = Get-Content $out -Raw -Encoding utf8
    $ed = [regex]::Match($dom, '(?s)<main id="editor-pane".*?</main>').Value
    $errs = [regex]::Match($dom, '(?s)<pre id="__errs"[^>]*>(.*?)</pre>').Groups[1].Value.Trim()
    $boot = [regex]::Match($dom, '<div id="boot-overlay"[^>]*>').Value
    $noError = -not $dom.Contains([string][char]0x89C6 + [string][char]0x56FE + [string][char]0x52A0 + [string][char]0x8F7D + [string][char]0x5931 + [string][char]0x8D25)
    $noStub = -not $dom.Contains([string][char]0x5F85 + [string][char]0x63A5)

    # count elements by exact class token (substring counting would also hit trash-row-main etc.)
    $tokens = New-Object System.Collections.Generic.List[string]
    foreach ($m in [regex]::Matches($ed, 'class="([^"]*)"')) {
      foreach ($t in ($m.Groups[1].Value -split '\s+')) { if ($t) { $tokens.Add($t) } }
    }
    $cls = @($tokens)
    $groups = @($cls | Where-Object { $_ -eq 'trash-group' }).Count
    $rows = @($cls | Where-Object { $_ -eq 'trash-row' }).Count
    $empty = $ed.Contains('class="empty"')
    $drop = @($cls | Where-Object { $_ -eq 'dropzone' }).Count
    $cards = @($cls | Where-Object { $_ -eq 'stat-card' }).Count
    $bars = @($cls | Where-Object { $_ -eq 'chart-bar' }).Count
    $tables = @($cls | Where-Object { $_ -eq 'admin-table' }).Count
    $trs = ([regex]::Matches($ed, '<tr')).Count

    $desc = ''
    $ok = switch ($v) {
      'trash' {
        # An empty trash is a legal backend state, so the lenient branch must be a DISJUNCTION
        # (proper empty state) OR (at least one group with at least one row).
        # errorBox also renders .empty, so exclude it -- an API 500 must not read as "legally empty".
        $errorBoxed = $ed.Contains([string][char]0x52A0 + [string][char]0x8F7D + [string][char]0x5931 + [string][char]0x8D25)
        $trashEmptyOk = $empty -and -not $errorBoxed
        $desc = if ($strict) { "trash-group=2, trash-row=4 (groups=$groups rows=$rows)" }
          else { "empty state OR (trash-group>=1 and trash-row>=1) (groups=$groups rows=$rows empty=$empty errorBox=$errorBoxed)" }
        if ($strict) { $groups -eq 2 -and $rows -eq 4 }
        else { $trashEmptyOk -or ($groups -ge 1 -and $rows -ge 1) }
      }
      'io' {
        # the dropzone/cards are unconditional; the note list may legitimately be empty,
        # but "note list failed to load" means the API call failed -- that must not pass.
        $notesFailed = $ed.Contains([string][char]0x7B14 + [string][char]0x8BB0 + [string][char]0x5217 + [string][char]0x8868 + [string][char]0x52A0 + [string][char]0x8F7D + [string][char]0x5931 + [string][char]0x8D25)
        $desc = "export/import cards + dropzone (dropzone=$drop noteListFailed=$notesFailed)"
        $drop -ge 1 -and $ed.Contains('mgmt-card') -and -not $notesFailed
      }
      'stats' {
        $desc = if ($strict) { "7 stat cards + 14 chart bars (cards=$cards bars=$bars)" } else { "7 stat cards + chart bars (cards=$cards bars=$bars)" }
        if ($strict) { $cards -eq 7 -and $bars -eq 14 } else { $cards -eq 7 -and $bars -ge 2 }
      }
      'admin' {
        if ($strict) { $desc = "users + invites tables (tables=$tables rows=$trs)" } else { $desc = "users table rendered (tables=$tables rows=$trs)" }
        if ($strict) { $tables -eq 2 -and $trs -ge 2 } else { $tables -ge 1 -and $trs -ge 2 }
      }
      default { $false }
    }

    Write-Output ("  #/{0,-6} editor={1,6}B consoleError=[{2}] whiteScreen={3} stub={4} viewLoadError={5}" -f $v, $ed.Length, $errs, ($boot -notmatch 'hidden'), (-not $noStub), (-not $noError))
    Check ("#/$v rendered with no console error") ($ed.Length -gt 0 -and $errs -eq '' -and $noError -and $noStub) "editor=$($ed.Length)B errs=$errs"
    Check ("#/$v markers: " + $desc) $ok 'see numbers above'
  }
}

try {
  if ($Backend) {
    Head "5) login to real backend $Backend"
    $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $cookie = ''
    $body = @{ username = $User; password = $Password } | ConvertTo-Json
    try {
      Invoke-WebRequest "$Backend/api/auth/login" -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -WebSession $sess | Out-Null
      $cookie = 'KB_SESSION=' + $sess.Cookies.GetCookies($Backend)['KB_SESSION'].Value
      Write-Output ("  login ok as '" + $User + "' (cookie captured)")
    } catch {
      Write-Output ("  login failed (" + ($_.Exception.Message -split "`n")[0] + ") -> trying first-run register")
      $reg = @{ username = $User; displayName = $User; password = $Password } | ConvertTo-Json
      try {
        Invoke-WebRequest "$Backend/api/auth/register" -Method POST -Body $reg -ContentType 'application/json' -UseBasicParsing -WebSession $sess | Out-Null
        Invoke-WebRequest "$Backend/api/auth/login" -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -WebSession $sess | Out-Null
        $cookie = 'KB_SESSION=' + $sess.Cookies.GetCookies($Backend)['KB_SESSION'].Value
        Write-Output '  register + login ok (cookie captured)'
      } catch {
        Check 'authenticate against real backend' $false ($_.Exception.Message -split "`n")[0]
      }
    }
    if ($cookie) { Check 'authenticate against real backend' $true '' }

    Head '6) read-only API contract probe (docs/API.md frozen shapes)'
    $probeArgs = @($MOCK, '--probe', $Backend)
    if ($cookie) { $probeArgs += @('--cookie', $cookie) }
    $raw = (& node @probeArgs 2>&1) -join "`n"
    try {
      $pr = $raw | ConvertFrom-Json
      Write-Output ("  probe passed " + $pr.passed + "/" + $pr.total)
      foreach ($c in $pr.checks) { Check ('probe ' + $c.name) $c.ok $c.extra }
    } catch {
      Check 'API contract probe returned JSON' $false $raw
    }

    Head "7) render the four views from the real backend (local proxy on $Port)"
    $srv = Start-Process -FilePath (Get-Command node).Source -ArgumentList @($MOCK, '--port', "$Port", '--backend', $Backend, '--cookie', $cookie) -PassThru -WindowStyle Hidden
    $ready = $false
    foreach ($i in 1..40) {
      try { Invoke-WebRequest "$Origin/api/health" -UseBasicParsing -TimeoutSec 1 | Out-Null; $ready = $true; break } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw "proxy on port $Port did not become ready (backend $Backend)" }
    Write-Output ("  proxy up (pid " + $srv.Id + "), backend=" + $Backend)
    Invoke-ShellSmoke $Origin
    $lg = (Invoke-WebRequest "$Origin/__log" -UseBasicParsing).Content | ConvertFrom-Json
    Head '8) endpoints actually requested while rendering each view'
    $lg.requests | ForEach-Object { Write-Output ('  ' + $_.method + ' ' + $_.url) }
    Write-Output '  NOTE: the 100+ mock-driven interaction assertions are skipped in -Backend mode'
    Write-Output '        (their fixtures are mock data). The API contract probe above covers shapes.'
  }
  else {
    Head '5) real backend probe on :8080 (informational)'
    try { $r = Invoke-WebRequest 'http://127.0.0.1:8080/api/health' -UseBasicParsing -TimeoutSec 3; Write-Output ('  health ' + $r.StatusCode + ' ' + $r.Content + '  -> rerun with -Backend http://127.0.0.1:8080 for the real smoke') }
    catch { Write-Output ('  UNREACHABLE: ' + ($_.Exception.Message -split "`n")[0] + '  -> mock backend used') }

    Head "6) start mock backend on $Port"
    $srv = Start-Process -FilePath (Get-Command node).Source -ArgumentList @($MOCK, '--port', "$Port", '--static', $STATIC) -PassThru -WindowStyle Hidden
    $ready = $false
    foreach ($i in 1..40) {
      try { Invoke-WebRequest "$Origin/api/health" -UseBasicParsing -TimeoutSec 1 | Out-Null; $ready = $true; break } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw "mock server did not become ready on port $Port" }
    Write-Output ("  mock up (pid " + $srv.Id + "), /api/health ok")

    Head '7) driven browser test (headless Edge + contract mock + interaction assertions)'
    Invoke-WebRequest "$Origin/__init" -Method POST -Body '{}' -UseBasicParsing | Out-Null
    $url = "$Origin/__test/drive.html" + $(if ($Neg) { '?neg=1' } else { '' })
    & powershell -File $DUMP -Url $url -Out (Join-Path $SCRATCH 'drive-dom.html') -Budget 60000 -Profile 'drive' | Out-Null
    $j = (Invoke-WebRequest "$Origin/__report" -UseBasicParsing).Content | ConvertFrom-Json
    if ($Neg) { Write-Output '  MODE: negative control (?neg=1) -- exactly one intentional FAIL is expected' }
    Write-Output ("  assertions passed {0}/{1}" -f $j.passed, $j.total)
    if ($j.failed.Count) { $j.failed | ForEach-Object { Write-Output ('    FAIL ' + $_.name + ' >> ' + $_.extra) } }
    $script:pass += $j.passed
    $script:fail += $j.failed.Count
    if ($j.failed.Count) { $script:failLines += ($j.failed | ForEach-Object { $_.name }) }
    Write-Output '  --- captured HTTP request trace ---'
    $j.trace | ForEach-Object { Write-Output ('    ' + $_) }
    Write-Output '  --- assertion list ---'
    $j.tests | ForEach-Object { Write-Output ('    [{0}] {1}' -f $(if ($_.ok) { 'PASS' } else { 'FAIL' }), $_.name) }

    Invoke-ShellSmoke $Origin

    Head '8) XSS: payload serialization in the real DOM'
    foreach ($v in @('trash', 'io', 'stats', 'admin')) {
      $dom = Get-Content (Join-Path $SCRATCH "shell-$v.html") -Raw -Encoding utf8
      $escaped = ([regex]::Matches($dom, [regex]::Escape('&lt;img src=x onerror=alert(1)&gt;')).Count)
      $live = ([regex]::Matches($dom, '<img src=x onerror=').Count)
      Check ("#/$v injected payload stays escaped text") ($live -eq 0) "escaped=$escaped live=$live"
      Write-Output ("    #/{0,-6} escapedText x{1} ; live <img> x{2}" -f $v, $escaped, $live)
    }

    Head '9) non-admin opens #/admin (real shell)'
    Invoke-WebRequest "$Origin/__init" -Method POST -Body '{}' -UseBasicParsing | Out-Null
    Invoke-WebRequest "$Origin/__scenario" -Method POST -Body '{"admin":false}' -UseBasicParsing | Out-Null
    $out = Join-Path $SCRATCH 'shell-nonadmin.html'
    & powershell -File $DUMP -Url "$Origin/#/admin" -Out $out -Budget 12000 -Profile 's-nonadmin' | Out-Null
    $dom = Get-Content $out -Raw -Encoding utf8
    $lg = Invoke-RestMethod "$Origin/__log"
    $forbidden = $dom.Contains([string][char]0x65E0 + [string][char]0x6743 + [string][char]0x8BBF + [string][char]0x95EE)
    $adminCalls = @($lg.requests | Where-Object { $_.url -like '/api/admin*' }).Count
    Check 'non-admin sees the forbidden state' $forbidden 'text missing'
    Check 'non-admin triggers zero /api/admin/* requests' ($adminCalls -eq 0) ("count=" + $adminCalls)
  }
}
finally {
  Head '10) stop mock backend'
  if ($srv) {
    Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
  }
  $left = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  Write-Output ("  port " + $Port + " listeners left: " + (@($left).Count) + " (0 = released)")
  if ($Clean) {
    Get-ChildItem $SCRATCH -Directory -Filter 'edge-*' -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue; Write-Output ('  removed browser profile ' + $_.Name) }
    Remove-Item (Join-Path $SCRATCH '*.html'), (Join-Path $SCRATCH '*.err.txt'), (Join-Path $SCRATCH 'chk.mjs') -Force -ErrorAction SilentlyContinue
    Write-Output '  removed generated DOM dumps and browser logs'
  } else {
    Write-Output '  (rerun with -Clean to also delete edge-* browser profiles and generated DOM dumps)'
  }
}

Head 'RESULT'
Write-Output ("  passed: " + $script:pass)
Write-Output ("  failed: " + $script:fail)
if ($script:fail) {
  Write-Output '  failures:'
  $script:failLines | ForEach-Object { Write-Output ('    - ' + $_) }
  exit 1
}
exit 0
