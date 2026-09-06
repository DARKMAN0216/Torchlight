function Get-VerifiedRecognizerListeners {
    param([string]$ProjectRoot)
    $taskExpectedPython = Join-Path $ProjectRoot '.venv-recognition\Scripts\python.exe'
    $taskExpectedServer = Join-Path $ProjectRoot 'recognizer\server.py'
    $taskPattern = '(?:^|\s)"?' + [regex]::Escape($taskExpectedServer) + '"?(?:\s|$)'
    $taskListeners = @(Get-NetTCPConnection -LocalPort 28765 -State Listen -ErrorAction SilentlyContinue)
    foreach ($taskServiceId in ($taskListeners.OwningProcess | Select-Object -Unique)) {
        if (-not $taskServiceId) { continue }
        $taskService = Get-CimInstance Win32_Process -Filter "ProcessId = $taskServiceId"
        if (-not $taskService -or -not $taskService.ParentProcessId) {
            throw 'Cannot verify the port owner. No unverified process will be stopped.'
        }
        $taskParent = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskService.ParentProcessId)"
        $taskCommand = [string]$taskService.CommandLine
        if ($taskService.Name -ne 'python.exe' -or
            $taskCommand.Replace('/', '\') -notmatch $taskPattern -or
            -not $taskParent -or $taskParent.ExecutablePath -ne $taskExpectedPython) {
            throw 'Port 28765 owner does not match this project/Python environment (or permissions prevent inspection). Retry as administrator; no unverified process will be stopped.'
        }
        $taskService
    }
}

function Stop-VerifiedRecognizer {
    param([string]$ProjectRoot)
    # Validate ALL listeners before stopping any, then recheck identity against PID reuse.
    $taskVerified = @(Get-VerifiedRecognizerListeners -ProjectRoot $ProjectRoot)
    foreach ($taskService in $taskVerified) {
        $taskCurrent = @(Get-VerifiedRecognizerListeners -ProjectRoot $ProjectRoot) |
            Where-Object { $_.ProcessId -eq $taskService.ProcessId }
        if (-not $taskCurrent -or $taskCurrent.CreationDate -ne $taskService.CreationDate -or
            $taskCurrent.ParentProcessId -ne $taskService.ParentProcessId) {
            throw 'Port owner changed during validation. Restart aborted.'
        }
        Stop-Process -Id $taskService.ProcessId -Force -ErrorAction Stop
        Write-Output "Stopped verified recognizer PID $($taskService.ProcessId)."
    }
}
