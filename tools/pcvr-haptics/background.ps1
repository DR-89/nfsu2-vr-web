param([Parameter(Mandatory=$true)][string]$Origin)
$ErrorActionPreference = 'Stop'
# Run only our installed helper, hidden. Its named mutex makes repeated logons
# and setup runs harmless. The bridge accepts only this site's exact origin.
$env:NFSU2_WEB_HAPTICS_MAP = $null
Start-Process -FilePath (Join-Path $PSScriptRoot 'haptics-bridge.exe') -ArgumentList @('--background', $Origin) -WindowStyle Hidden
