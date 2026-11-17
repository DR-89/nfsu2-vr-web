param([Parameter(Mandatory=$true)][string]$OpenXRHeaders)
$ErrorActionPreference='Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskBuild = Join-Path $taskRoot 'out/pcvr-haptics'
cmake -S $PSScriptRoot -B $taskBuild -A x64 "-DOPENXR_INCLUDE_DIR=$OpenXRHeaders"
if ($LASTEXITCODE) { throw 'Haptics configuration failed' }
cmake --build $taskBuild --config Release --parallel 4
if ($LASTEXITCODE) { throw 'Haptics build failed' }
ctest --test-dir $taskBuild -C Release --output-on-failure
if ($LASTEXITCODE) { throw 'Haptics tests failed' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start.ps1') -Destination (Join-Path $taskBuild 'Release/start.ps1')
Write-Output "Built browser haptics. Run package.ps1 with the game website URL to create the downloadable installer ZIP."
