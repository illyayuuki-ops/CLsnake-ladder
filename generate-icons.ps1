Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Convert-Icon {
    param($pngPath, $size)
    
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)
    
    # Background rounded rect
    $radius = [int]($size * 149 / 512)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $radius*2, $radius*2, 180, 90)
    $path.AddArc($size-$radius*2, 0, $radius*2, $radius*2, 270, 90)
    $path.AddArc($size-$radius*2, $size-$radius*2, $radius*2, $radius*2, 0, 90)
    $path.AddArc(0, $size-$radius*2, $radius*2, $radius*2, 90, 90)
    $path.CloseFigure()
    
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(11, 16, 32))
    $graphics.FillPath($brush, $path)
    
    # Snake color
    $snakeColor = [System.Drawing.Color]::FromArgb(110, 168, 254)
    
    # Snake body path points
    $p1 = New-Object System.Drawing.Point([int]($size * 139 / 512), [int]($size * 352 / 512))
    $p2 = New-Object System.Drawing.Point([int]($size * 321 / 512), [int]($size * 352 / 512))
    $p3 = New-Object System.Drawing.Point([int]($size * 353 / 512), [int]($size * 320 / 512))
    $p4 = New-Object System.Drawing.Point([int]($size * 353 / 512), [int]($size * 224 / 512))
    $p5 = New-Object System.Drawing.Point([int]($size * 321 / 512), [int]($size * 192 / 512))
    $p6 = New-Object System.Drawing.Point([int]($size * 193 / 512), [int]($size * 192 / 512))
    $p7 = New-Object System.Drawing.Point([int]($size * 161 / 512), [int]($size * 224 / 512))
    $p8 = New-Object System.Drawing.Point([int]($size * 161 / 512), [int]($size * 320 / 512))
    
    $strokeWidth = [float]([int]($size * 37) / 512.0)
    $pen = New-Object System.Drawing.Pen($snakeColor, $strokeWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawCurve($pen, @($p1, $p2, $p3, $p4, $p5, $p6, $p7, $p8))
    
    # Tail line
    $tailStrokeWidth = [float]([int]($size * 37) / 512.0)
    $tailPen = New-Object System.Drawing.Pen($snakeColor, $tailStrokeWidth)
    $tailPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $tailPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawLine($tailPen, [int]($size * 320 / 512), [int]($size * 96 / 512), [int]($size * 373 / 512), [int]($size * 96 / 512))
    
    # Arrow head on tail
    $ap1 = New-Object System.Drawing.Point([int]($size * 298 / 512), [int]($size * 64 / 512))
    $ap2 = New-Object System.Drawing.Point([int]($size * 320 / 512), [int]($size * 96 / 512))
    $ap3 = New-Object System.Drawing.Point([int]($size * 298 / 512), [int]($size * 128 / 512))
    $graphics.DrawLines($tailPen, @($ap1, $ap2, $ap3))
    
    # Head circle
    $headBrush = New-Object System.Drawing.SolidBrush($snakeColor)
    $headRect = New-Object System.Drawing.Rectangle([int]($size * 257 / 512), [int]($size * 53 / 512), [int]($size * 86 / 512), [int]($size * 86 / 512))
    $graphics.FillEllipse($headBrush, $headRect)
    
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}

function Convert-MaskableIcon {
    param($pngPath, $size)
    
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)
    
    # Background rounded rect
    $radius = [int]($size * 149 / 512)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $radius*2, $radius*2, 180, 90)
    $path.AddArc($size-$radius*2, 0, $radius*2, $radius*2, 270, 90)
    $path.AddArc($size-$radius*2, $size-$radius*2, $radius*2, $radius*2, 0, 90)
    $path.AddArc(0, $size-$radius*2, $radius*2, $radius*2, 90, 90)
    $path.CloseFigure()
    
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(11, 16, 32))
    $graphics.FillPath($brush, $path)
    
    # Snake color
    $snakeColor = [System.Drawing.Color]::FromArgb(110, 168, 254)
    
    # Maskable: smaller snake within safe zone (40% from edges)
    $p1 = New-Object System.Drawing.Point([int]($size * 160 / 512), [int]($size * 352 / 512))
    $p2 = New-Object System.Drawing.Point([int]($size * 310 / 512), [int]($size * 352 / 512))
    $p3 = New-Object System.Drawing.Point([int]($size * 336 / 512), [int]($size * 320 / 512))
    $p4 = New-Object System.Drawing.Point([int]($size * 336 / 512), [int]($size * 248 / 512))
    $p5 = New-Object System.Drawing.Point([int]($size * 310 / 512), [int]($size * 216 / 512))
    $p6 = New-Object System.Drawing.Point([int]($size * 208 / 512), [int]($size * 216 / 512))
    $p7 = New-Object System.Drawing.Point([int]($size * 184 / 512), [int]($size * 248 / 512))
    $p8 = New-Object System.Drawing.Point([int]($size * 184 / 512), [int]($size * 320 / 512))
    
    $strokeWidth = [float]([int]($size * 30) / 512.0)
    $pen = New-Object System.Drawing.Pen($snakeColor, $strokeWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawCurve($pen, @($p1, $p2, $p3, $p4, $p5, $p6, $p7, $p8))
    
    # Tail line
    $tailStrokeWidth = [float]([int]($size * 30) / 512.0)
    $tailPen = New-Object System.Drawing.Pen($snakeColor, $tailStrokeWidth)
    $tailPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $tailPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawLine($tailPen, [int]($size * 305 / 512), [int]($size * 96 / 512), [int]($size * 349 / 512), [int]($size * 96 / 512))
    
    # Arrow head on tail
    $ap1 = New-Object System.Drawing.Point([int]($size * 287 / 512), [int]($size * 70 / 512))
    $ap2 = New-Object System.Drawing.Point([int]($size * 305 / 512), [int]($size * 96 / 512))
    $ap3 = New-Object System.Drawing.Point([int]($size * 287 / 512), [int]($size * 122 / 512))
    $graphics.DrawLines($tailPen, @($ap1, $ap2, $ap3))
    
    # Head circle (smaller for maskable)
    $headBrush = New-Object System.Drawing.SolidBrush($snakeColor)
    $headRect = New-Object System.Drawing.Rectangle([int]($size * 252 / 512), [int]($size * 61 / 512), [int]($size * 70 / 512), [int]($size * 70 / 512))
    $graphics.FillEllipse($headBrush, $headRect)
    
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}

Convert-Icon 'assets/icons/icon-192.png' 192
Convert-Icon 'assets/icons/icon-512.png' 512
Convert-MaskableIcon 'assets/icons/icon-192-maskable.png' 192
Convert-MaskableIcon 'assets/icons/icon-512-maskable.png' 512
Write-Host 'Icons generated successfully'