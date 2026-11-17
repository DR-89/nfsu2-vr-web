param(
    [Parameter(Mandatory = $true)][string]$GameData,
    [ValidateRange(1024, 65535)][int]$Port = 8611,
    [ValidateNotNullOrEmpty()][string]$Distribution = 'Ubuntu',
    [string]$ModSource = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$gameRoot = (Resolve-Path -LiteralPath $GameData).Path
$exe = Join-Path $gameRoot 'SPEED2.EXE'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'SPEED2.EXE fehlt im angegebenen Spielordner.' }
$expected = 'F9DD86C054878CE6276BEB07C1FD61874F7A1E4BF1F241B084C65B73E24168A7'
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $expected) { throw 'Diese SPEED2.EXE passt nicht zur unterstützten PC-Version 1.2 North America.' }
$sourceLinux = (& wsl.exe -d $Distribution --exec wslpath -a $projectRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'WSL konnte den Projektpfad nicht öffnen.' }
$dataLinux = (& wsl.exe -d $Distribution --exec wslpath -a $gameRoot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'WSL konnte die Projektpfade nicht öffnen.' }
Write-Host "nfsu2-vr-web: http://localhost:$Port/"
$modLinux = ''
if ($ModSource) {
    $modRoot = (Resolve-Path -LiteralPath $ModSource).Path
    $modLinux = (& wsl.exe -d $Distribution --exec wslpath -a $modRoot).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'WSL konnte den Mod-Quellordner nicht öffnen.' }
}
& wsl.exe -d $Distribution --exec bash "$sourceLinux/tools/start-vr-web.sh" "$sourceLinux" "$dataLinux" "$Port" "$modLinux"
exit $LASTEXITCODE
