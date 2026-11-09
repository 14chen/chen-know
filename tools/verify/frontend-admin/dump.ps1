param([string]$Url, [string]$Out, [int]$Budget = 8000, [string]$Profile = 'p1')
$scratch = Join-Path $env:TEMP 'kb-web-admin-verify'
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) {
  $alt = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $alt) { $edge = $alt } else { throw 'Edge not found (tried x86 and x64 default paths)' }
}
if (Test-Path $Out) { Remove-Item $Out -Force }
$err = Join-Path $scratch "edge-$Profile.err.txt"
$args = @('--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-sync', '--mute-audio', "--user-data-dir=$scratch\edge-$Profile",
  "--virtual-time-budget=$Budget", '--dump-dom', $Url)
$p = Start-Process -FilePath $edge -ArgumentList $args -RedirectStandardOutput $Out -RedirectStandardError $err -PassThru -Wait
Write-Output ("exit=" + $p.ExitCode + " out=" + (Get-Item $Out).Length + "B profile=$Profile")
