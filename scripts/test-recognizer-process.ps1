$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'recognizer-process.ps1')
$taskTestRoot = 'C:\test project'
function Get-NetTCPConnection { param($LocalPort,$State,$ErrorAction); if ($script:taskCase -eq 'Empty') { return }; @{OwningProcess=11}; if ($script:taskCase -eq 'Mixed') { @{OwningProcess=22} } }
function Get-CimInstance {
    param($ClassName,$Filter)
    if ($Filter -eq 'ProcessId = 10') {
        return @{ExecutablePath=$(if ($script:taskCase -eq 'Parent') {'C:\other\python.exe'} else {"$taskTestRoot\.venv-recognition\Scripts\python.exe"})}
    }
    $script:taskQueries++
    return @{
        ProcessId=$(if ($Filter -eq 'ProcessId = 22') {22} else {11}); ParentProcessId=10
        CreationDate=$(if ($script:taskCase -eq 'Changed' -and $script:taskQueries -gt 1) {'new'} else {'old'})
        Name=$(if ($script:taskCase -eq 'Foreign' -or $Filter -eq 'ProcessId = 22') {'other.exe'} else {'python.exe'})
        CommandLine=$(if ($script:taskCase -eq 'Unreadable') {''} elseif ($script:taskCase -eq 'WrongProject') {'python C:\other\recognizer\server.py'} else {"python `"$taskTestRoot\recognizer\server.py`""})
    }
}
function Stop-Process { param($Id,[switch]$Force,$ErrorAction); $script:taskStopped += $Id }
foreach ($script:taskCase in @('Empty','Valid','Foreign','Unreadable','Parent','WrongProject','Mixed','Changed')) {
    $script:taskQueries=0; $script:taskStopped=@(); $taskRejected=$false
    try { Stop-VerifiedRecognizer -ProjectRoot $taskTestRoot } catch { $taskRejected=$true }
    $taskExpectReject = $script:taskCase -notin @('Empty','Valid')
    if ($taskRejected -ne $taskExpectReject) { throw "Wrong rejection result: $script:taskCase" }
    $taskExpectStops = if ($script:taskCase -eq 'Valid') {1} else {0}
    if ($script:taskStopped.Count -ne $taskExpectStops) { throw "Unsafe stop in $script:taskCase" }
    Write-Output "PASS $script:taskCase (mock only)"
}
