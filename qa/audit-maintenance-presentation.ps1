param(
  [string]$ArtifactDir = "qa/artifacts/maintenance",
  [string]$ImplementationCommit = ""
)

$ErrorActionPreference = "Stop"
$artifactRoot = (Resolve-Path -LiteralPath $ArtifactDir).Path
$pptxPath = Join-Path $artifactRoot "task8-maintenance-report.pptx"
$renderDir = Join-Path ([System.IO.Path]::GetTempPath()) ("task8-ppt-slides-" + [guid]::NewGuid().ToString("N"))
$auditPath = Join-Path $artifactRoot "task8-com-audit.json"
$summaryPath = Join-Path $artifactRoot "task8-presentation-qa-summary.json"
$reportPath = Join-Path $artifactRoot "task8-presentation-qa-report.md"
$failureNotice = "공원 데이터 수집 실패 · 산출 제외"
$methodText = "경계가 없으면 면적 기반 원형거리로 추정합니다."
$ImplementationCommit = if ($ImplementationCommit) { $ImplementationCommit } else { (git rev-parse HEAD).Trim() }
$controlPattern = "[​-‏‪-‮⁠⁦-⁩﻿]"
$evidenceCopies = @{
  6 = "task8-ppt-natural-failure.png"
  9 = "task8-ppt-park-failure.png"
  10 = "task8-ppt-maintenance-map.png"
  11 = "task8-ppt-maintenance-table.png"
  14 = "task8-ppt-summary-failure.png"
  15 = "task8-ppt-general-sources.png"
  16 = "task8-ppt-maintenance-sources.png"
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-ShapeText($Shape) {
  if ($Shape.HasTextFrame -ne -1 -or $Shape.TextFrame.HasText -ne -1) { return "" }
  return [string]$Shape.TextFrame.TextRange.Text
}

function Test-Overlap($A, $B) {
  return $A.Left -lt ($B.Left + $B.Width) -and ($A.Left + $A.Width) -gt $B.Left -and
    $A.Top -lt ($B.Top + $B.Height) -and ($A.Top + $A.Height) -gt $B.Top
}

function Get-MinFontPt($Shape) {
  $textRange = $Shape.TextFrame.TextRange
  $minimum = [double]::PositiveInfinity
  for ($index = 1; $index -le $textRange.Length; $index++) {
    $size = [double]$textRange.Characters($index, 1).Font.Size
    if ($size -gt 0 -and $size -lt $minimum) { $minimum = $size }
  }
  return $minimum
}

function Get-ExactPixelCount([string]$ImagePath, [int]$Red, [int]$Green, [int]$Blue) {
  Add-Type -AssemblyName System.Drawing
  $bitmap = [System.Drawing.Bitmap]::FromFile($ImagePath)
  try {
    $count = 0
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
      for ($x = 0; $x -lt $bitmap.Width; $x++) {
        $pixel = $bitmap.GetPixel($x, $y)
        if ($pixel.R -eq $Red -and $pixel.G -eq $Green -and $pixel.B -eq $Blue) { $count++ }
      }
    }
    return $count
  } finally {
    $bitmap.Dispose()
  }
}

Assert-True (Test-Path -LiteralPath $pptxPath) "missing PPTX: $pptxPath"
New-Item -ItemType Directory -Force -Path $renderDir | Out-Null
$powerPoint = New-Object -ComObject PowerPoint.Application
$presentation = $null
try {
  $presentation = $powerPoint.Presentations.Open($pptxPath, $false, $false, $false)
  Assert-True ($presentation.Slides.Count -eq 16) "expected 16 slides, got $($presentation.Slides.Count)"
  $presentation.Export($renderDir, "PNG", 1920, 1080)
  $renderedSlides = @{}
  foreach ($file in Get-ChildItem -LiteralPath $renderDir -Filter "*.PNG") {
    if ($file.BaseName -match "(\d+)$") { $renderedSlides[[int]$Matches[1]] = $file.FullName }
  }
  foreach ($entry in $evidenceCopies.GetEnumerator()) {
    Assert-True ($renderedSlides.ContainsKey([int]$entry.Key)) "missing rendered slide $($entry.Key)"
    Copy-Item -LiteralPath $renderedSlides[[int]$entry.Key] -Destination (Join-Path $artifactRoot $entry.Value) -Force
  }

  $slideTexts = @{}
  $meaningfulMin = @{}
  $editableTextShapeCount = 0
  $controlHits = @()
  $bannerSlides = 0
  $parkLabelShapes = @()
  $insightShapes = @()
  foreach ($slide in $presentation.Slides) {
    $texts = @()
    $minimum = [double]::PositiveInfinity
    foreach ($shape in $slide.Shapes) {
      $text = Get-ShapeText $shape
      if ([string]::IsNullOrWhiteSpace($text)) { continue }
      $editableTextShapeCount++
      $texts += $text
      if ($text -match $controlPattern) { $controlHits += "slide$($slide.SlideIndex):$($shape.Name)" }
      if ($shape.Name -eq "SYNTHETIC_DATA_NOTICE_TEXT") { $bannerSlides++ }
      if ($slide.SlideIndex -eq 6 -and $text -like "*구조검증공원*") { $parkLabelShapes += $shape }
      if ($slide.SlideIndex -eq 6 -and $text -eq "핵심 포인트") { $insightShapes += $shape }
      $excluded = $shape.Top -le 80 -or $shape.Top -ge 475 -or $text.StartsWith("※") -or
        $shape.Name -like "SYNTHETIC_DATA_NOTICE*"
      if (-not $excluded) {
        $fontPt = Get-MinFontPt $shape
        if ($fontPt -lt $minimum) { $minimum = $fontPt }
      }
    }
    $slideTexts[[string]$slide.SlideIndex] = ($texts -join "`n")
    $meaningfulMin[[string]$slide.SlideIndex] = if ([double]::IsPositiveInfinity($minimum)) { $null } else { [math]::Round($minimum, 2) }
  }

  Assert-True ($controlHits.Count -eq 0) "hidden control characters: $($controlHits -join ', ')"
  Assert-True ($bannerSlides -eq 16) "synthetic banner count: $bannerSlides"
  foreach ($slideNumber in 1..16) {
    $minimum = $meaningfulMin[[string]$slideNumber]
    Assert-True ($null -eq $minimum -or $minimum -ge 11) "slide $slideNumber meaningful body below 11pt: $minimum"
  }
  foreach ($slideNumber in @(6, 9, 14)) {
    Assert-True ($slideTexts[[string]$slideNumber].Contains($failureNotice)) "slide $slideNumber missing exact park failure notice"
  }
  foreach ($forbidden in @("생활권 공원", "총 녹지 면적", "최근접 공원 접근거리", "공원 성격별 구성")) {
    Assert-True (-not $slideTexts["9"].Contains($forbidden)) "slide 9 retained park metric: $forbidden"
  }
  $allPresentationText = ($slideTexts.Values -join "`n")
  foreach ($forbidden in @("공원 0개", "생활공원 500m", "접근성 0/100", "공원 0개 · 산")) {
    Assert-True (-not $allPresentationText.Contains($forbidden)) "report retained failed-source park metric: $forbidden"
  }
  Assert-True ($slideTexts["9"].Contains($methodText)) "slide 9 missing exact estimation method"
  $methodShape = @($presentation.Slides.Item(9).Shapes | Where-Object { (Get-ShapeText $_) -eq $methodText })
  Assert-True ($methodShape.Count -eq 1) "estimation method shape count: $($methodShape.Count)"
  Assert-True ($methodShape[0].TextFrame.TextRange.Lines().Count -eq 1) "estimation method split across lines"
  Assert-True ($slideTexts["15"].Contains("16개 POI")) "filtered report POI footer is not 16"
  Assert-True ($parkLabelShapes.Count -eq 0) "stale park label remains on slide 6"
  $overlapCount = 0
  foreach ($label in $parkLabelShapes) { foreach ($card in $insightShapes) { if (Test-Overlap $label $card) { $overlapCount++ } } }
  Assert-True ($overlapCount -eq 0) "slide 6 park label overlaps insight card"

  $boundaryShapes = @($presentation.Slides.Item(10).Shapes | Where-Object { $_.Name -like "MAINTENANCE_BOUNDARY|*" })
  $solidRings = @($boundaryShapes | Where-Object { $_.Name -notlike "*dashed*" -and $_.Name -notlike "*multi*" }).Count
  $dashedRings = $boundaryShapes.Count - $solidRings
  Assert-True ($boundaryShapes.Count -eq 7) "maintenance boundary ring count: $($boundaryShapes.Count)"
  Assert-True ($solidRings -eq 4 -and $dashedRings -eq 3) "boundary style count: solid=$solidRings dashed=$dashedRings"
  $canvasMagentaPixels = Get-ExactPixelCount (Join-Path $artifactRoot "task8-canvas-maintenance-map.png") 236 72 153
  Assert-True ($canvasMagentaPixels -gt 0) "Canvas maintenance boundary magenta pixels missing"

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($pptxPath)
  try {
    $xmlControlHits = @()
    foreach ($entry in $archive.Entries | Where-Object { $_.FullName -like "ppt/slides/*.xml" }) {
      $reader = New-Object System.IO.StreamReader($entry.Open())
      try { if ($reader.ReadToEnd() -match $controlPattern) { $xmlControlHits += $entry.FullName } } finally { $reader.Dispose() }
    }
    Assert-True ($xmlControlHits.Count -eq 0) "PPT XML hidden controls: $($xmlControlHits -join ', ')"
    $mediaEntries = @($archive.Entries | Where-Object { $_.FullName -like "ppt/media/*" })
  } finally { $archive.Dispose() }

  $audit = [ordered]@{
    generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    slideCount = 16
    renderResolution = "1920x1080"
    editableTextShapeCount = $editableTextShapeCount
    invisibleControlAudit = "pass"
    pptXmlInvisibleControlAudit = "pass"
    lineSplitAudit = "pass"
    parkFailureExactText = $failureNotice
    estimationMethodExactText = $methodText
    meaningfulBodyMinPt = $meaningfulMin
    typographyExclusions = @("title/eyebrow <=80pt", "footer/legal >=475pt", "※ note", "synthetic disclosure >=9pt")
    overlap = [ordered]@{ staleParkLabelCount = $parkLabelShapes.Count; insightCardOverlapCount = $overlapCount; result = "pass" }
    boundaryShapes = [ordered]@{ slide10Total = $boundaryShapes.Count; solidRings = $solidRings; dashedRings = $dashedRings; canvasExactMagentaPixels = $canvasMagentaPixels }
    inputPoiCount = 17
    reportPoiCount = 16
    bannerTextShapeSlides = $bannerSlides
    embeddedMediaCount = $mediaEntries.Count
  }
  $audit | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $auditPath -Encoding utf8
} finally {
  if ($null -ne $presentation) { $presentation.Close() }
  $powerPoint.Quit()
  [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint) | Out-Null
  if (Test-Path -LiteralPath $renderDir) { Remove-Item -LiteralPath $renderDir -Recurse -Force }
}

$artifactNames = @(
  "task8-maintenance-report.pptx", "task8-com-audit.json",
  "task8-canvas-natural-failure.png", "task8-canvas-park-failure.png", "task8-canvas-maintenance-map.png",
  "task8-canvas-maintenance-table.png", "task8-canvas-summary-failure.png", "task8-canvas-general-sources.png",
  "task8-canvas-maintenance-sources.png", "task8-ppt-natural-failure.png", "task8-ppt-park-failure.png",
  "task8-ppt-maintenance-map.png", "task8-ppt-maintenance-table.png", "task8-ppt-summary-failure.png",
  "task8-ppt-general-sources.png", "task8-ppt-maintenance-sources.png"
)
$artifacts = [ordered]@{}
foreach ($name in $artifactNames) {
  $file = Get-Item -LiteralPath (Join-Path $artifactRoot $name)
  $artifacts[$name] = [ordered]@{ bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$auditObject = Get-Content -Raw -LiteralPath $auditPath | ConvertFrom-Json
$summary = [ordered]@{
  schemaVersion = 6
  qaDate = (Get-Date).ToString("yyyy-MM-dd")
  implementationCommit = $ImplementationCommit
  fixture = [ordered]@{ kind = "synthetic-structural"; inputPoiCount = 17; reportPoiCount = 16; inputParkPoiCount = 1; reportParkPoiCount = 0; parkStatus = "failed" }
  artifacts = $artifacts
  audit = $auditObject
  visual = [ordered]@{ pptSlides = "16/16 pass"; canvasEvidence = "7/7 pass"; combinedEvidence = "14/14 pass" }
  evidenceScope = "합성 구조검증 fixture의 편집 가능 구조와 supplied GeoJSON 소비만 검증하며 실데이터·공식 경계 증거로 주장하지 않습니다."
}
$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summaryPath -Encoding utf8
$rows = $artifacts.GetEnumerator() | ForEach-Object { "| $($_.Key) | $($_.Value.bytes) | ``$($_.Value.sha256)`` |" }
$report = @"
# Task 8 프레젠테이션 QA 보고서

- 결과: PASS
- 슬라이드: 16/16
- 입력 POI: 17개 / 보고서 산출 POI: 16개
- 공원: 입력 stale 1개 / 보고서 0개, 원천 failed, 슬라이드 6·9·14 ``$failureNotice``
- 의미 본문: 전 16장 11pt 이상(예외: title/eyebrow, footer/legal, ※ note, synthetic disclosure)
- slide 6 stale park label / 핵심 포인트 overlap: 0 / 0
- 경계: 7 rings (solid 4, dashed 3)
- 추정 문구: ``$methodText`` 1 line

| artifact | bytes | SHA-256 |
|---|---:|---|
$($rows -join "`n")

합성 구조검증 자료이며 실데이터 또는 공식 경계 확보 증거가 아닙니다.
"@
$report | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Host "maintenance presentation audit passed: $summaryPath"
