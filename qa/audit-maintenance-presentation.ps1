param(
  [string]$ArtifactDir = "qa/artifacts/maintenance",
  [string]$ImplementationCommit = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "maintenance-presentation-audit-helpers.ps1")
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
  8 = "task8-ppt-radius-failure.png"
  9 = "task8-ppt-park-failure.png"
  10 = "task8-ppt-maintenance-map.png"
  11 = "task8-ppt-maintenance-table.png"
  14 = "task8-ppt-summary-failure.png"
  15 = "task8-ppt-general-sources.png"
  16 = "task8-ppt-maintenance-sources.png"
}
$pptSlideCount = 0
$pptRenderedCount = 0
$pptSelectedEvidenceCount = 0

Assert-True (Test-Path -LiteralPath $pptxPath) "missing PPTX: $pptxPath"
New-Item -ItemType Directory -Force -Path $renderDir | Out-Null
$powerPoint = New-Object -ComObject PowerPoint.Application
$presentation = $null
try {
  $presentation = $powerPoint.Presentations.Open($pptxPath, $false, $false, $false)
  Assert-True ($presentation.Slides.Count -eq 16) "expected 16 slides, got $($presentation.Slides.Count)"
  $pptSlideCount = $presentation.Slides.Count
  $presentation.Export($renderDir, "PNG", 1920, 1080)
  $renderedSlides = @{}
  foreach ($file in Get-ChildItem -LiteralPath $renderDir -Filter "*.PNG") {
    if ($file.BaseName -match "(\d+)$") { $renderedSlides[[int]$Matches[1]] = $file.FullName }
  }
  $pptRenderedCount = $renderedSlides.Count
  Assert-True ($pptRenderedCount -eq $pptSlideCount) "rendered PPT slide count: $pptRenderedCount/$pptSlideCount"
  foreach ($entry in $evidenceCopies.GetEnumerator()) {
    Assert-True ($renderedSlides.ContainsKey([int]$entry.Key)) "missing rendered slide $($entry.Key)"
    Copy-Item -LiteralPath $renderedSlides[[int]$entry.Key] -Destination (Join-Path $artifactRoot $entry.Value) -Force
  }
  $pptSelectedEvidenceCount = $evidenceCopies.Count

  $slideTexts = @{}
  $meaningfulMin = @{}
  $editableTextShapeCount = 0
  $controlHits = @()
  $bannerSlides = 0
  $parkLabelShapes = @()
  $insightShapes = @()
  $slideShapes = @{}
  foreach ($slide in $presentation.Slides) {
    $texts = @()
    $minimum = [double]::PositiveInfinity
    $leafShapes = @(Get-LeafShapes $slide.Shapes)
    $slideShapes[[string]$slide.SlideIndex] = $leafShapes
    foreach ($shape in $leafShapes) {
      $text = Get-ShapeText $shape
      if ([string]::IsNullOrWhiteSpace($text)) { continue }
      $editableTextShapeCount++
      $texts += $text
      if ($text -match $controlPattern) { $controlHits += "slide$($slide.SlideIndex):$($shape.Name)" }
      if ($shape.Name -eq "SYNTHETIC_DATA_NOTICE_TEXT") { $bannerSlides++ }
      if ($slide.SlideIndex -eq 6 -and $text -like "*구조검증공원*") { $parkLabelShapes += $shape }
      if ($slide.SlideIndex -eq 6 -and $text -eq "핵심 포인트") { $insightShapes += $shape }
      $inGroup = Test-ShapeInGroup $shape
      $excluded = (-not $inGroup -and ($shape.Top -le 80 -or $shape.Top -ge 475)) -or
        $text.StartsWith("※") -or $shape.Name -like "SYNTHETIC_DATA_NOTICE*"
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
    Assert-True ($null -ne $minimum) "slide $slideNumber has no audited meaningful text"
    Assert-True ($minimum -ge 11) "slide $slideNumber meaningful body below 11pt: $minimum"
  }
  foreach ($slideNumber in @(6, 9, 14)) {
    Assert-True ($slideTexts[[string]$slideNumber].Contains($failureNotice)) "slide $slideNumber missing exact park failure notice"
  }
  foreach ($forbidden in @("생활권 공원", "총 녹지 면적", "최근접 공원 접근거리", "공원 성격별 구성")) {
    Assert-True (-not $slideTexts["9"].Contains($forbidden)) "slide 9 retained park metric: $forbidden"
  }
  Assert-True (-not $slideTexts["8"].Contains("공원 —")) "slide 8 retained failed park metric content"
  Assert-True (@($slideShapes["8"] | Where-Object { (Get-ShapeText $_).Trim() -eq "공원" }).Count -eq 0) "slide 8 retained standalone park metric label"
  Assert-True ($slideTexts["8"].Contains("통학·역세권을 함께 판단")) "slide 8 missing failed-source lifestyle note"
  $allPresentationText = ($slideTexts.Values -join "`n")
  foreach ($forbidden in @("공원 0개", "생활공원 500m", "접근성 0/100", "공원 0개 · 산")) {
    Assert-True (-not $allPresentationText.Contains($forbidden)) "report retained failed-source park metric: $forbidden"
  }
  Assert-True ($slideTexts["9"].Contains($methodText)) "slide 9 missing exact estimation method"
  $methodShape = @($slideShapes["9"] | Where-Object { (Get-ShapeText $_) -eq $methodText })
  Assert-True ($methodShape.Count -eq 1) "estimation method shape count: $($methodShape.Count)"
  Assert-True ($methodShape[0].TextFrame.TextRange.Lines().Count -eq 1) "estimation method split across lines"
  Assert-True ($slideTexts["15"].Contains("16개 POI")) "filtered report POI footer is not 16"
  Assert-True ($parkLabelShapes.Count -eq 0) "stale park label remains on slide 6"
  $overlapCount = 0
  foreach ($label in $parkLabelShapes) { foreach ($card in $insightShapes) { if (Test-Overlap $label $card) { $overlapCount++ } } }
  Assert-True ($overlapCount -eq 0) "slide 6 park label overlaps insight card"

  $slideOneBanner = @($slideShapes["1"] | Where-Object { $_.Name -eq "SYNTHETIC_DATA_NOTICE_TEXT" -and (Get-ShapeText $_).Contains("실데이터 아님") })
  Assert-True ($slideOneBanner.Count -eq 1) "slide 1 synthetic banner shape count: $($slideOneBanner.Count)"
  Assert-True ($slideOneBanner[0].TextFrame.TextRange.Lines().Count -eq 1) "slide 1 synthetic banner split across lines"
  $slideOneTitle = @($slideShapes["1"] | Where-Object { (Get-ShapeText $_) -eq "합성 구조검증" -and (Get-MinFontPt $_) -ge 60 })
  Assert-True ($slideOneTitle.Count -eq 1) "slide 1 short 60pt title count: $($slideOneTitle.Count)"
  Assert-True ($slideOneTitle[0].TextFrame.TextRange.Lines().Count -eq 1) "slide 1 short title split across lines"
  $slideOneNoticeLeaks = @($slideShapes["1"] | Where-Object { $_.Name -ne "SYNTHETIC_DATA_NOTICE_TEXT" -and (Get-ShapeText $_).Contains("실데이터 아님") })
  Assert-True ($slideOneNoticeLeaks.Count -eq 0) "slide 1 leaked synthetic notice outside banner: $($slideOneNoticeLeaks.Count)"
  foreach ($token in @("1.2km권 0곳", "분양예정 2개", "원문 확인 필요")) { Assert-TokenOnOneLine $slideShapes["7"] $token 7 }
  Assert-TokenOnOneLine $slideShapes["10"] "점수에서 제외" 10
  Assert-TokenOnOneLine $slideShapes["10"] "공식 정비구역 경계 · 참고용" 10

  $yearShape = @($slideShapes["12"] | Where-Object { (Get-ShapeText $_) -eq "2018년" })
  $parkingShape = @($slideShapes["12"] | Where-Object { (Get-ShapeText $_) -eq "920대" })
  Assert-True ($yearShape.Count -eq 1 -and $parkingShape.Count -eq 1) "slide 12 missing unit-qualified year/parking values"
  Assert-True (($parkingShape[0].Left - ($yearShape[0].Left + $yearShape[0].Width)) -ge 8) "slide 12 year/parking gutter below 8pt"
  Assert-True (@($slideShapes["12"] | Where-Object { $_.Name -eq "RESIDENTIAL_DETAIL_YEAR_PARKING_DIVIDER" }).Count -eq 1) "slide 12 missing year/parking divider"

  $subwayStatusShapes = @($slideShapes["15"] | Where-Object { (Get-ShapeText $_) -like "지하철 노선:*" })
  Assert-True ($subwayStatusShapes.Count -eq 1) "slide 15 subway status line count: $($subwayStatusShapes.Count)"
  $footerShape = @($slideShapes["15"] | Where-Object { (Get-ShapeText $_) -like "*16개 POI 기준 자동 생성" })
  Assert-True ($footerShape.Count -eq 1) "slide 15 footer shape count: $($footerShape.Count)"
  $statusBottom = ($subwayStatusShapes | ForEach-Object { $_.Top + $_.Height } | Measure-Object -Maximum).Maximum
  Assert-True (($footerShape[0].Top - $statusBottom) -ge 8) "slide 15 source status/footer gap below 8pt"

  $boundaryShapes = @($slideShapes["10"] | Where-Object { $_.Name -like "MAINTENANCE_BOUNDARY|*" })
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
    recursiveGroupTextAudit = "pass"
    invisibleControlAudit = "pass"
    pptXmlInvisibleControlAudit = "pass"
    semanticLineTokens = @("실데이터 아님", "1.2km권 0곳", "분양예정 2개", "원문 확인 필요", "점수에서 제외", "공식 정비구역 경계 · 참고용")
    parkFailureExactText = $failureNotice
    estimationMethodExactText = $methodText
    meaningfulBodyMinPt = $meaningfulMin
    typographyExclusions = @("ungrouped title/eyebrow <=80pt", "ungrouped footer/legal >=475pt", "※ note", "synthetic disclosure >=9pt")
    residentialDetail = [ordered]@{ year = "2018년"; parking = "920대"; minimumGutterPt = 8; divider = "present" }
    sourceStatus = [ordered]@{ subwayRouteLines = $subwayStatusShapes.Count; footerGapPt = [math]::Round($footerShape[0].Top - $statusBottom, 2) }
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
  "task8-canvas-natural-failure.png", "task8-canvas-radius-failure.png", "task8-canvas-park-failure.png", "task8-canvas-maintenance-map.png",
  "task8-canvas-maintenance-table.png", "task8-canvas-summary-failure.png", "task8-canvas-general-sources.png",
  "task8-canvas-maintenance-sources.png", "task8-ppt-natural-failure.png", "task8-ppt-radius-failure.png", "task8-ppt-park-failure.png",
  "task8-ppt-maintenance-map.png", "task8-ppt-maintenance-table.png", "task8-ppt-summary-failure.png",
  "task8-ppt-general-sources.png", "task8-ppt-maintenance-sources.png"
)
$artifacts = [ordered]@{}
foreach ($name in $artifactNames) {
  $file = Get-Item -LiteralPath (Join-Path $artifactRoot $name)
  $artifacts[$name] = [ordered]@{ bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$auditObject = Get-Content -Raw -LiteralPath $auditPath | ConvertFrom-Json
$canvasEvidenceCount = @($artifactNames | Where-Object { $_ -like "task8-canvas-*.png" }).Count
$pptEvidenceCount = @($artifactNames | Where-Object { $_ -like "task8-ppt-*.png" }).Count
Assert-True ($canvasEvidenceCount -eq $pptSelectedEvidenceCount) "Canvas/PPT selected evidence mismatch: $canvasEvidenceCount/$pptSelectedEvidenceCount"
Assert-True ($pptEvidenceCount -eq $pptSelectedEvidenceCount) "PPT selected evidence mismatch: $pptEvidenceCount/$pptSelectedEvidenceCount"
$combinedEvidenceCount = $canvasEvidenceCount + $pptEvidenceCount
$summary = [ordered]@{
  schemaVersion = 7
  qaDate = (Get-Date).ToString("yyyy-MM-dd")
  implementationCommit = $ImplementationCommit
  fixture = [ordered]@{ kind = "synthetic-structural"; inputPoiCount = 17; reportPoiCount = 16; inputParkPoiCount = 1; reportParkPoiCount = 0; parkStatus = "failed" }
  artifacts = $artifacts
  audit = $auditObject
  visual = [ordered]@{
    comFullDeck = "$pptRenderedCount/$pptSlideCount pass"
    canvasSelectedEvidence = "$canvasEvidenceCount/$pptSelectedEvidenceCount pass"
    pptSelectedEvidence = "$pptEvidenceCount/$pptSelectedEvidenceCount pass"
    combinedSelectedEvidence = "$combinedEvidenceCount/$($pptSelectedEvidenceCount * 2) pass"
    humanDirectVisual = "recorded separately; not asserted by automation"
  }
  evidenceScope = "합성 구조검증 fixture의 편집 가능 구조와 supplied GeoJSON 소비만 검증하며 실데이터·공식 경계 증거로 주장하지 않습니다."
}
$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summaryPath -Encoding utf8
$rows = $artifacts.GetEnumerator() | ForEach-Object { "| $($_.Key) | $($_.Value.bytes) | ``$($_.Value.sha256)`` |" }
$report = @"
# Task 8 프레젠테이션 QA 보고서

- 결과: PASS
- COM 전체 장표: $pptRenderedCount/$pptSlideCount
- 선택 증거: Canvas $canvasEvidenceCount/$pptSelectedEvidenceCount + PPT $pptEvidenceCount/$pptSelectedEvidenceCount = $combinedEvidenceCount/$($pptSelectedEvidenceCount * 2)
- 입력 POI: 17개 / 보고서 산출 POI: 16개
- 공원: 입력 stale 1개 / 보고서 0개, 원천 failed, 슬라이드 6·9·14 ``$failureNotice``
- 의미 본문: 그룹 내부 포함 전 $pptSlideCount 장 11pt 이상(예외: ungrouped title/eyebrow, footer/legal, ※ note, synthetic disclosure)
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
