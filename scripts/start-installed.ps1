param(
    [switch]$AsAdmin,
    [switch]$CheckOnly,
    [string]$ClientPath = ''
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $taskRoot '.venv-recognition\Scripts\python.exe'
$taskServer = Join-Path $taskRoot 'recognizer\server.py'
$taskServiceStarter = Join-Path $PSScriptRoot 'start-recognition.ps1'
. (Join-Path $PSScriptRoot 'recognizer-process.ps1')
# Unicode path is constructed explicitly so Windows PowerShell 5.1 needs no UTF-8 BOM.
if (-not $ClientPath) {
    $taskFolder = -join ([char[]](0x6E34,0x763E,0x51B3,0x7B56,0x5668))
    $ClientPath = Join-Path (Join-Path 'D:\' $taskFolder) 'vorax-decision-assistant.exe'
}

function Get-RecognizerHealth {
    try { return Invoke-RestMethod 'http://127.0.0.1:28765/health' -TimeoutSec 2 } catch { return $null }
}

function Assert-Recognizer($Health) {
    if ($Health.service -ne 'vorax-local-recognizer' -or -not $Health.ok) {
        throw 'Port 28765 is not serving the expected recognizer. No process was stopped.'
    }
    $taskVersionMatch = [regex]::Match((Get-Content -LiteralPath $taskServer -Raw -Encoding UTF8), '"runtimeVersion"\s*:\s*"([^"]+)"')
    if ($taskVersionMatch.Success -and $Health.runtimeVersion -ne $taskVersionMatch.Groups[1].Value) {
        throw 'An older recognizer is running. Close its window, then launch again. No process was stopped.'
    }
}

$taskMutex = $null
$taskLockHeld = $false
try {
    foreach ($taskRequired in @($ClientPath, $taskPython, $taskServer, $taskServiceStarter)) {
        if (-not (Test-Path -LiteralPath $taskRequired -PathType Leaf)) { throw "Missing file: $taskRequired" }
    }
    if ($CheckOnly) {
        $taskVerified = @(Get-VerifiedRecognizerListeners -ProjectRoot $taskRoot)
        $taskHealth = Get-RecognizerHealth
        Write-Output "CHECK OK: client=$ClientPath; verifiedListeners=$($taskVerified.Count); serviceRunning=$([bool]$taskHealth); no processes stopped or started."
        exit 0
    }
    $taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $taskPrincipal = New-Object Security.Principal.WindowsPrincipal($taskIdentity)
    if ($AsAdmin -and -not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $taskArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -AsAdmin -ClientPath "{1}"' -f $PSCommandPath, $ClientPath
        $taskElevated = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList $taskArgs -Verb RunAs -WindowStyle Hidden -PassThru -Wait
        exit $taskElevated.ExitCode
    }
    $taskMutex = New-Object System.Threading.Mutex($false, 'Local\VoraxInstalledQuickLaunch')
    try { $taskLockHeld = $taskMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $taskLockHeld = $true }
    if (-not $taskLockHeld) { Write-Output 'Another launcher is already starting the app.'; exit 0 }

    Stop-VerifiedRecognizer -ProjectRoot $taskRoot
    $taskReleaseDeadline = (Get-Date).AddSeconds(5)
    while ((Get-NetTCPConnection -State Listen -LocalPort 28765 -ErrorAction SilentlyContinue) -and (Get-Date) -lt $taskReleaseDeadline) {
        Start-Sleep -Milliseconds 200
    }
        if (Get-NetTCPConnection -State Listen -LocalPort 28765 -ErrorAction SilentlyContinue) {
            throw 'Port 28765 is still occupied. No new service was started.'
        }
        $taskLogDirectory = Join-Path $env:LOCALAPPDATA 'VoraxDecisionAssistant\logs'
        New-Item -ItemType Directory -Path $taskLogDirectory -Force | Out-Null
        $taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $taskLog = Join-Path $taskLogDirectory "recognizer-$taskStamp.log"
        $taskErrorLog = Join-Path $taskLogDirectory "recognizer-$taskStamp-error.log"
        $env:PYTHONUNBUFFERED = '1'
        $env:PYTHONIOENCODING = 'utf-8'
        $taskServiceArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $taskServiceStarter
        Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $taskServiceArgs -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $taskLog -RedirectStandardError $taskErrorLog | Out-Null
        $taskDeadline = (Get-Date).AddSeconds(40)
        do {
            Start-Sleep -Milliseconds 500
            $taskHealth = Get-RecognizerHealth
        } while (-not $taskHealth -and (Get-Date) -lt $taskDeadline)
        if (-not $taskHealth) { throw "Recognizer did not become ready. Logs: $taskErrorLog" }
        Assert-Recognizer $taskHealth
        Write-Output "Recognizer ready. Logs: $taskLogDirectory"
    $taskClients = @(Get-CimInstance Win32_Process -Filter "Name='vorax-decision-assistant.exe'")
    if ($taskClients.Count -eq 0) {
        # This is the interactive GUI explicitly requested by the user, not a background helper.
        Start-Process -FilePath $ClientPath -WorkingDirectory (Split-Path -Parent $ClientPath) -WindowStyle Normal | Out-Null
        Write-Output 'Client opened. Switch to Torchlight and press F8 once.'
    } else {
        Write-Output 'Client is already running; no duplicate instance started.'
    }
} catch {
    $taskMessage = $_.Exception.Message
    Write-Host $taskMessage -ForegroundColor Red
    if (-not $CheckOnly) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($taskMessage, 'Vorax launcher error') | Out-Null
    }
    exit 1
} finally {
    if ($taskLockHeld) { $taskMutex.ReleaseMutex() }
    if ($taskMutex) { $taskMutex.Dispose() }
}
