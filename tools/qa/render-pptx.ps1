# PPTX를 PowerPoint COM SaveAs PNG(18)로 장별 렌더. Slide.Export는 지도 장에서 멈추므로 쓰지 않는다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File tools/qa/render-pptx.ps1 -Pptx <file.pptx> -Out <dir> [-TimeoutSec 180]
param([Parameter(Mandatory)][string]$Pptx, [Parameter(Mandatory)][string]$Out, [int]$TimeoutSec = 180)
$Pptx = (Resolve-Path $Pptx).Path
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$before = @(Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object Id)
$job = Start-Job -ArgumentList $Pptx, $Out -ScriptBlock {
  param($pptx, $out)
  $app = New-Object -ComObject PowerPoint.Application
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $pres = $app.Presentations.Open($pptx, $true, $false, $false)
  $openMs = $sw.ElapsedMilliseconds
  $pres.SaveAs($out, 18)
  $saveMs = $sw.ElapsedMilliseconds - $openMs
  $n = $pres.Slides.Count
  $pres.Close(); $app.Quit()
  "slides=$n openMs=$openMs saveAsMs=$saveMs"
}
if (Wait-Job $job -Timeout $TimeoutSec) { Receive-Job $job }
else {
  "TIMEOUT after $TimeoutSec s"
  Get-Process POWERPNT -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | Stop-Process -Force
}
Remove-Job $job -Force
"pptxBytes=$((Get-Item $Pptx).Length)"
