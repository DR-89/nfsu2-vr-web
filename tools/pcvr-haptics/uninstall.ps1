$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'NFSU2VR/WebHaptics'
$binary = Join-Path $destination 'haptics-bridge.exe'
$manifest = Join-Path $destination 'implicit-layer.json'
$layerKey = 'HKCU:\SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ((Test-Path -LiteralPath (Join-Path $destination 'xr-access.json')) -and (Test-Path $layerKey)) {
    $acl = Get-Acl -Path $layerKey
    foreach ($value in @(Get-Content -LiteralPath (Join-Path $destination 'xr-access.json') -Raw | ConvertFrom-Json)) {
        $sid = [Security.Principal.SecurityIdentifier]::new($value)
        $acl.RemoveAccessRuleSpecific([Security.AccessControl.RegistryAccessRule]::new($sid,'ReadKey','Allow'))
    }
    Set-Acl -Path $layerKey -AclObject $acl
}
Remove-ItemProperty -Path $layerKey -Name $manifest -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $runKey -Name 'NFSU2VR Web Haptics' -ErrorAction SilentlyContinue
Get-Process -Name haptics-bridge -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $binary } | Stop-Process
# Leave files until browsers have released the DLL. No game saves, browser data
# or unrelated OpenXR registrations are removed.
Write-Output 'Vibration helper disabled and removed from Windows startup. Restart Chrome/Edge to unload it.'
Write-Output "You can then delete this folder: $destination"
