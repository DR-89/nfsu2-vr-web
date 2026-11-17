param([Parameter(Mandatory=$true)][string]$Url)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$release = Join-Path $taskRoot 'out/pcvr-haptics/Release'
$stage = Join-Path $taskRoot ('out/pcvr-haptics/package-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($file in @('haptics-bridge.exe','nfsu2_web_haptics.dll','implicit-layer.json')) { Copy-Item -LiteralPath (Join-Path $release $file) -Destination $stage }
foreach ($file in @('install.ps1','background.ps1','sandbox-access.ps1','uninstall.ps1','Install.cmd','Uninstall.cmd','README.md')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stage }
@{url=$Url} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'site.json') -Encoding UTF8
$source = New-Item -ItemType Directory -Path (Join-Path $stage 'source')
Get-ChildItem -LiteralPath $PSScriptRoot -File | Copy-Item -Destination $source.FullName
Copy-Item -LiteralPath (Join-Path $taskRoot 'LICENSE') -Destination $source.FullName
$checksums = Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($stage.Length + 1).Replace('\','/')
    (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $relative
}
$checksums | Set-Content -LiteralPath (Join-Path $stage 'SHA256SUMS.txt') -Encoding ASCII
$archive = Join-Path $taskRoot 'out/pcvr-haptics/nfsu2-vr-haptics-windows.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -Force
Get-FileHash -LiteralPath $archive -Algorithm SHA256
