param([ValidateSet('Ready', 'Cold', 'ClientRunning')][string]$Scenario = 'Ready')
$ErrorActionPreference = 'Stop'
$script:taskHealthRequests = 0
$script:taskLaunches = @()
$script:taskStopped = @()
$script:taskVersion = [regex]::Match((Get-Content (Join-Path $PSScriptRoot '..\recognizer\server.py') -Raw -Encoding UTF8), '"runtimeVersion"\s*:\s*"([^"]+)"').Groups[1].Value
# Test doubles: do not start GUI, Python or UAC; preserve the real service.
function Invoke-RestMethod {
    param($Uri, $TimeoutSec)
    $script:taskHealthRequests++
    if ($Scenario -eq 'Cold' -and $script:taskHealthRequests -eq 1) { throw 'not started yet' }
    return @{ok=$true;service='vorax-local-recognizer';runtimeVersion=$script:taskVersion}
}
function Start-Process {
    param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError)
    $script:taskLaunches += @{FilePath=$FilePath;WindowStyle=$WindowStyle}
}
function Get-CimInstance {
    param($ClassName,$Filter)
    if ($Filter -like 'Name=*') { if ($Scenario -eq 'ClientRunning') { return @{ProcessId=123} }; return }
    if ($Filter -eq 'ProcessId = 456') { return @{ExecutablePath=(Join-Path $taskRoot '.venv-recognition\Scripts\python.exe')} }
    return @{ProcessId=789;ParentProcessId=456;CreationDate='test';Name='python.exe';CommandLine=('python.exe "{0}\recognizer\server.py"' -f $taskRoot)}
}
function Get-NetTCPConnection { param($State,$LocalPort,$ErrorAction); if ($Scenario -ne 'Cold' -and -not $script:taskStopped.Count) { return @{OwningProcess=789} } }
function Stop-Process { param($Id,[switch]$Force,$ErrorAction); $script:taskStopped += $Id }
function New-Item { param($ItemType,$Path,[switch]$Force) }
function Start-Sleep { param($Milliseconds) }
. (Join-Path $PSScriptRoot 'start-installed.ps1')
$taskExpected = if ($Scenario -eq 'ClientRunning') {1} else {2}
if ($script:taskLaunches.Count -ne $taskExpected) { throw "Unexpected launch count: $($script:taskLaunches.Count)" }
if ($script:taskLaunches[0].WindowStyle -ne 'Hidden') { throw 'Service must be hidden' }
if ($script:taskStopped.Count -ne $(if ($Scenario -eq 'Cold') {0} else {1})) { throw 'Unexpected stop count' }
Write-Output "PASS $Scenario (mock launches=$taskExpected; no real processes started)"
