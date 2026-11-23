Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedPath {
  param([float]$X, [float]$Y, [float]$W, [float]$H, [float]$R)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $R * 2
  $path.AddArc($X, $Y, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-AppIcon {
  param(
    [string]$Name,
    [string]$Background,
    [string]$Accent,
    [int]$Size
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($Background))

  $accentColor = [System.Drawing.ColorTranslator]::FromHtml($Accent)
  $softAccent = [System.Drawing.Color]::FromArgb(92, $accentColor.R, $accentColor.G, $accentColor.B)
  $white = [System.Drawing.Color]::White

  $docX = [float]($Size * 0.205)
  $docY = [float]($Size * 0.145)
  $docW = [float]($Size * 0.590)
  $docH = [float]($Size * 0.710)
  $docR = [float]($Size * 0.060)

  $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(48, 0, 0, 0))
  $shadow = New-RoundedPath ($docX + $Size * 0.018) ($docY + $Size * 0.025) $docW $docH $docR
  $graphics.FillPath($shadowBrush, $shadow)

  $paperPath = New-RoundedPath $docX $docY $docW $docH $docR
  $paperBrush = New-Object System.Drawing.SolidBrush($white)
  $graphics.FillPath($paperBrush, $paperPath)

  $linePen = New-Object System.Drawing.Pen($softAccent, [float]($Size * 0.035))
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($linePen, $Size * 0.335, $Size * 0.285, $Size * 0.665, $Size * 0.285)
  $graphics.DrawLine($linePen, $Size * 0.335, $Size * 0.380, $Size * 0.625, $Size * 0.380)
  $graphics.DrawLine($linePen, $Size * 0.335, $Size * 0.475, $Size * 0.565, $Size * 0.475)

  $checkPen = New-Object System.Drawing.Pen($accentColor, [float]($Size * 0.068))
  $checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $checkPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $points = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF(($Size * 0.345), ($Size * 0.625))),
    (New-Object System.Drawing.PointF(($Size * 0.455), ($Size * 0.725))),
    (New-Object System.Drawing.PointF(($Size * 0.675), ($Size * 0.560)))
  )
  $graphics.DrawLines($checkPen, $points)

  $file = Join-Path $outDir $Name
  $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)

  $checkPen.Dispose()
  $linePen.Dispose()
  $paperBrush.Dispose()
  $shadowBrush.Dispose()
  $paperPath.Dispose()
  $shadow.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$profiles = @(
  @{ Name = 'app'; Background = '#1b5f8f'; Accent = '#1b5f8f' },
  @{ Name = 'teacher'; Background = '#1b5f8f'; Accent = '#1b5f8f' },
  @{ Name = 'student'; Background = '#237451'; Accent = '#237451' }
)

foreach ($profile in $profiles) {
  New-AppIcon "$($profile.Name)-192.png" $profile.Background $profile.Accent 192
  New-AppIcon "$($profile.Name)-512.png" $profile.Background $profile.Accent 512
  New-AppIcon "$($profile.Name)-maskable-512.png" $profile.Background $profile.Accent 512
  New-AppIcon "$($profile.Name)-180.png" $profile.Background $profile.Accent 180
}

Write-Output "Icons written to $outDir"
