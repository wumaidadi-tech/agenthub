Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot 'icon.png'
$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# 圆角底板
$pad = 46
$rect = New-Object System.Drawing.RectangleF($pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad))
$r = 190
$d = $r * 2
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
$path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
$path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
$path.CloseFigure()
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 13, 16))
$g.FillPath($bg, $path)

$cx = 512; $cy = 505
$nodes = @(
  @(512, 262),
  @(262, 730),
  @(762, 730)
)

# 连线
$lime = [System.Drawing.Color]::FromArgb(255, 215, 255, 75)
$pen = New-Object System.Drawing.Pen($lime, 9)
foreach ($n in $nodes) {
  $g.DrawLine($pen, $cx, $cy, $n[0], $n[1])
}

# 中心光晕
$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowPath.AddEllipse(($cx - 210), ($cy - 210), 420, 420)
$glow = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
$glow.CenterColor = [System.Drawing.Color]::FromArgb(110, 215, 255, 75)
$glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 215, 255, 75))
$g.FillPath($glow, $glowPath)

# 节点
$limeBrush = New-Object System.Drawing.SolidBrush($lime)
$g.FillEllipse($limeBrush, ($cx - 62), ($cy - 62), 124, 124)

$grey = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 208, 208, 208))
foreach ($n in $nodes) {
  $g.FillEllipse($grey, ($n[0] - 40), ($n[1] - 40), 80, 80)
}

$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# 导出各尺寸 PNG，供打包 ICO
$sizes = @(256, 128, 64, 48, 32, 16)
foreach ($s in $sizes) {
  $src = [System.Drawing.Image]::FromFile($out)
  $dst = New-Object System.Drawing.Bitmap($s, $s)
  $gs = [System.Drawing.Graphics]::FromImage($dst)
  $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gs.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gs.DrawImage($src, 0, 0, $s, $s)
  $gs.Dispose()
  $dst.Save((Join-Path $PSScriptRoot ("icon-$s.png")), [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
  $src.Dispose()
}

Write-Output "icon written: $out"