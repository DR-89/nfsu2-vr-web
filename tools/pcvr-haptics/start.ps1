param([Parameter(Mandatory=$true)][uri]$Url, [string]$Browser = "$env:ProgramFiles/Google/Chrome/Application/chrome.exe")
$ErrorActionPreference='Stop'
if ($Url.Scheme -ne 'https' -and -not ($Url.Scheme -eq 'http' -and $Url.IsLoopback)) { throw 'Use the HTTPS address of the game.' }
if (-not (Test-Path -LiteralPath $Browser)) { throw 'Chrome was not found. Supply -Browser with its full path.' }
$taskProfile=Join-Path $env:LOCALAPPDATA 'NFSU2VR/WebHapticsBrowser'
$taskMutex=[System.Threading.Mutex]::new($false,'Local\NFSU2WebHapticsStarter')
if (-not $taskMutex.WaitOne(0)) { throw 'The browser with vibration is already running.' }
$taskToken=[guid]::NewGuid().ToString('N')
$taskPortFile=Join-Path $env:TEMP "nfsu2-haptics-$taskToken.port"
$taskBridge=$null
$taskNames=@('XR_API_LAYER_PATH','XR_ENABLE_API_LAYERS','NFSU2_WEB_HAPTICS_MAP')
$taskPrevious=@{}
foreach ($key in $taskNames) { $taskPrevious[$key]=[Environment]::GetEnvironmentVariable($key,'Process') }
try {
    # No registry changes: only the browser launched here inherits this layer.
    $env:XR_API_LAYER_PATH=$PSScriptRoot
    $env:XR_ENABLE_API_LAYERS='XR_APILAYER_NFSU2_web_haptics'
    $env:NFSU2_WEB_HAPTICS_MAP="Local\NFSU2WebHaptics-$taskToken"
    $origin=$Url.GetLeftPart([System.UriPartial]::Authority)
    $taskBridge=Start-Process -FilePath (Join-Path $PSScriptRoot 'haptics-bridge.exe') -ArgumentList @($origin,$taskToken,"`"$taskPortFile`"") -PassThru -WindowStyle Hidden
    for ($attempt=0; $attempt -lt 100 -and -not (Test-Path -LiteralPath $taskPortFile); $attempt++) {
        if ($taskBridge.HasExited) { throw 'The vibration connection could not start.' }
        Start-Sleep -Milliseconds 50
    }
    $taskPort=[int](Get-Content -LiteralPath $taskPortFile -Raw)
    $target=[UriBuilder]::new($Url);$target.Fragment="vr-haptics=$taskPort.$taskToken"
    # A dedicated browser profile ensures the XR child process inherits the layer.
    $taskBrowser=Start-Process -FilePath $Browser -ArgumentList @("--user-data-dir=`"$taskProfile`"",'--no-first-run','--disable-background-mode',$target.Uri.AbsoluteUri) -PassThru
    $taskBrowser.WaitForExit()
} finally {
    if ($taskBridge -and -not $taskBridge.HasExited) { Stop-Process -Id $taskBridge.Id }
    if (Test-Path -LiteralPath $taskPortFile) { Remove-Item -LiteralPath $taskPortFile }
    foreach ($key in $taskNames) { [Environment]::SetEnvironmentVariable($key,$taskPrevious[$key],'Process') }
    $taskMutex.ReleaseMutex();$taskMutex.Dispose()
}
