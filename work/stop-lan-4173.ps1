param([int]$TargetPid,[long]$StartStamp)
Start-Sleep -Seconds 3600
$process = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
if ($process -and $process.StartTime.ToFileTimeUtc() -eq $StartStamp) { Stop-Process -Id $TargetPid }
