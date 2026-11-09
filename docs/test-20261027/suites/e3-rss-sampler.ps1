param([Parameter(Mandatory=$true)][int]$TargetPid, [Parameter(Mandatory=$true)][string]$Out, [int]$IntervalMs=1000)
$ErrorActionPreference='SilentlyContinue'
"epoch_ms,rss_mb,priv_mb,threads,cpu_s" | Set-Content -Encoding utf8 $Out
while ($true) {
  $p = Get-Process -Id $TargetPid
  if (-not $p) { break }
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $rss = [math]::Round($p.WorkingSet64/1MB,1)
  $priv = [math]::Round($p.PrivateMemorySize64/1MB,1)
  $cpu = [math]::Round($p.TotalProcessorTime.TotalSeconds,1)
  "$t,$rss,$priv,$($p.Threads.Count),$cpu" | Add-Content -Encoding utf8 $Out
  Start-Sleep -Milliseconds $IntervalMs
}
