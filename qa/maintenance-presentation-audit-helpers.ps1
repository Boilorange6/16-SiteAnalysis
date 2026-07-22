function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-LeafShapes($Items) {
  $leaves = @()
  for ($index = 1; $index -le $Items.Count; $index++) {
    $shape = $Items.Item($index)
    if ($shape.Type -eq 6) {
      $leaves += @(Get-LeafShapes $shape.GroupItems)
    } else {
      $leaves += $shape
    }
  }
  return $leaves
}

function Get-ShapeText($Shape) {
  if ($Shape.HasTextFrame -ne -1 -or $Shape.TextFrame.HasText -ne -1) { return "" }
  return [string]$Shape.TextFrame.TextRange.Text
}

function Test-ShapeInGroup($Shape) {
  try {
    $parentGroup = $Shape.ParentGroup
    return $null -ne $parentGroup
  } catch {
    return $false
  }
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

function Assert-TokenOnOneLine($Shapes, [string]$Token, [int]$SlideNumber) {
  $matches = @($Shapes | Where-Object { (Get-ShapeText $_).Contains($Token) })
  Assert-True ($matches.Count -gt 0) "slide $SlideNumber missing semantic token: $Token"
  $intact = $false
  foreach ($shape in $matches) {
    $lines = $shape.TextFrame.TextRange.Lines()
    for ($lineIndex = 1; $lineIndex -le $lines.Count; $lineIndex++) {
      if ([string]$shape.TextFrame.TextRange.Lines($lineIndex, 1).Text -like "*$Token*") { $intact = $true }
    }
  }
  Assert-True $intact "slide $SlideNumber split semantic token across COM lines: $Token"
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
