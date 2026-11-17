param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$layerKey = 'HKCU:\SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit'
# Chromium names the XR AppContainer from SHA-1 of the browser executable's
# UTF-8 path. Existing XR profiles cover custom installs and path spellings.
# Grant only these XR identities access to this helper, never all app packages.
if (!(('NFSU2HapticsSandbox' -as [type]))) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NFSU2HapticsSandbox {
    [DllImport("userenv.dll", CharSet=CharSet.Unicode)] public static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("advapi32.dll")] public static extern IntPtr FreeSid(IntPtr sid);
}
'@
}
$sids = @()
$mappings = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppContainer\Mappings'
Get-ChildItem $mappings -ErrorAction SilentlyContinue | ForEach-Object {
    if ((Get-ItemProperty $_.PSPath).Moniker -like 'cr.sb.xr*') { $sids += $_.PSChildName }
}
$browsers = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
foreach ($browser in $browsers) {
    if (!(Test-Path -LiteralPath $browser)) { continue }
    $sha = [Security.Cryptography.SHA1]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($browser))).Replace('-','') } finally { $sha.Dispose() }
    $pointer = [IntPtr]::Zero
    if ([NFSU2HapticsSandbox]::DeriveAppContainerSidFromAppContainerName('cr.sb.xr' + $hash, [ref]$pointer) -ne 0) { throw 'Cannot identify the browser VR process.' }
    try { $sids += [Security.Principal.SecurityIdentifier]::new($pointer).Value } finally { [void][NFSU2HapticsSandbox]::FreeSid($pointer) }
}
$sids = @($sids | Sort-Object -Unique)
if (!$sids.Count) { throw 'Install Chrome or Edge, then run setup again.' }
$channel = Join-Path $Directory 'channel.bin'
if (!(Test-Path -LiteralPath $channel)) {
    $stream = [IO.File]::Open($channel,[IO.FileMode]::CreateNew)
    try { $stream.SetLength(4096) } finally { $stream.Dispose() }
}
$folderAcl = Get-Acl -LiteralPath $Directory
$channelAcl = Get-Acl -LiteralPath $channel
$registryAcl = Get-Acl -Path $layerKey
$record = Join-Path $Directory 'xr-access.json'
$owned = @()
if (Test-Path -LiteralPath $record) { $owned = @(Get-Content -LiteralPath $record -Raw | ConvertFrom-Json) }
foreach ($value in $sids) {
    $sid = [Security.Principal.SecurityIdentifier]::new($value)
    $folderAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))
    $channelAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'Read,Write','Allow'))
    $existing = @($registryAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {
        $_.IdentityReference.Value -eq $value -and $_.AccessControlType -eq 'Allow' -and
        ($_.RegistryRights -band [Security.AccessControl.RegistryRights]::ReadKey) -eq [Security.AccessControl.RegistryRights]::ReadKey
    })
    if (!$existing.Count) {
        $registryAcl.AddAccessRule([Security.AccessControl.RegistryAccessRule]::new($sid,'ReadKey','Allow'))
        $owned += $value
    }
}
Set-Acl -LiteralPath $Directory -AclObject $folderAcl
Set-Acl -LiteralPath $channel -AclObject $channelAcl
Set-Acl -Path $layerKey -AclObject $registryAcl
# Only the data mailbox is writable from the low-integrity XR process. The DLL,
# executable, scripts and registration remain read-only to that process.
& icacls.exe $channel /setintegritylevel 'L' | Out-Null
if ($LASTEXITCODE) { throw 'Cannot prepare the vibration channel for the browser VR process.' }
ConvertTo-Json -InputObject @($owned | Sort-Object -Unique) | Set-Content -LiteralPath $record -Encoding UTF8
