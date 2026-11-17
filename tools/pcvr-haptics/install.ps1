param([string]$Url, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
if (!$Url) { $Url = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'site.json') -Raw | ConvertFrom-Json).url }
$site = [Uri]$Url
if (!$site.IsAbsoluteUri -or $site.Scheme -ne 'https' -or $site.UserInfo -or $site.Fragment -or $site.Query -or $site.AbsolutePath -ne '/') { throw 'Setup requires the HTTPS address of the game website.' }
if (![Environment]::Is64BitOperatingSystem) { throw 'Windows 64-bit is required.' }
$origin = $site.GetLeftPart([UriPartial]::Authority)
$destination = Join-Path $env:LOCALAPPDATA 'NFSU2VR/WebHaptics'
$binary = Join-Path $destination 'haptics-bridge.exe'
$manifest = Join-Path $destination 'implicit-layer.json'
$layerKey = 'HKCU:\SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$files = @('haptics-bridge.exe', 'nfsu2_web_haptics.dll', 'implicit-layer.json', 'background.ps1', 'sandbox-access.ps1', 'uninstall.ps1', 'Uninstall.cmd', 'README.md')
foreach ($file in $files) { if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot $file) -PathType Leaf)) { throw "Missing setup file: $file. Extract the whole ZIP first." } }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-Process -Name haptics-bridge -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $binary } | Stop-Process
# Copy before registration. If a browser has the DLL loaded, stop with a useful
# error; never terminate the user's browser or overwrite its profile.
try {
    foreach ($file in $files) {
        $sourceFile = Join-Path $PSScriptRoot $file
        $targetFile = Join-Path $destination $file
        if ((Test-Path -LiteralPath $targetFile) -and (Get-FileHash -LiteralPath $sourceFile).Hash -eq (Get-FileHash -LiteralPath $targetFile).Hash) { continue }
        Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
    }
} catch { throw "Close Chrome and Edge completely, then run Install.cmd again. $($_.Exception.Message)" }
@{url = "$origin/"} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'site.json') -Encoding UTF8
New-Item -Path $layerKey -Force | Out-Null
New-ItemProperty -Path $layerKey -Name $manifest -PropertyType DWord -Value 0 -Force | Out-Null
& (Join-Path $destination 'sandbox-access.ps1') -Directory $destination
New-Item -Path $runKey -Force | Out-Null
$command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $destination 'background.ps1') + '" -Origin "' + $origin + '"'
New-ItemProperty -Path $runKey -Name 'NFSU2VR Web Haptics' -PropertyType String -Value $command -Force | Out-Null
& (Join-Path $destination 'background.ps1') -Origin $origin
$connected = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $state = Invoke-RestMethod -Uri 'http://127.0.0.1:28765/connect' -Headers @{Origin=$origin;'X-NFSU2-Connect'='1'} -TimeoutSec 2
        if ($state.version -eq 1 -and $state.token -match '^[a-f0-9]{32}$') { $connected = $true; break }
    } catch { Start-Sleep -Milliseconds 100 }
}
if (!$connected) { throw 'The local vibration helper did not start. Check whether port 28765 is already in use, then run setup again.' }
Write-Output 'Installed for your Windows account. The helper starts automatically when you sign in.'
Write-Output 'Close Chrome/Edge completely once, reopen your normal game website, and click Connect vibration. Allow local connections when asked.'
Write-Output "Remove it with: $destination\Uninstall.cmd"
if (!$NoBrowser) { Start-Process "$origin/#vr-haptics=auto" }
