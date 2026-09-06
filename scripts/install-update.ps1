param(
    [string]$InstallDirectory = ('D:\' + [string][char]0x6E34 + [string][char]0x763E + [string][char]0x51B3 + [string][char]0x7B56 + [string][char]0x5668),
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskInstallers = @(Get-ChildItem -LiteralPath (Join-Path $taskProject 'src-tauri\target\release\bundle\nsis') -Filter '*_x64-setup.exe' -File)
if ($taskInstallers.Count -ne 1) { throw 'Expected exactly one NSIS installer.' }
$taskClient = @(Get-Process -Name 'vorax-decision-assistant' -ErrorAction SilentlyContinue)
if ($taskClient.Count) { throw 'Close ALL decision assistant clients before updating. No process was stopped.' }
$taskInstallPath = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
if ([IO.Path]::GetPathRoot($taskInstallPath).TrimEnd('\') -eq $taskInstallPath) { throw 'Refusing a drive-root installation target.' }
$taskDataRoot = Join-Path $env:LOCALAPPDATA 'VoraxDecisionAssistant'
$taskProfile = Join-Path $env:LOCALAPPDATA 'com.darkman0216.vorax-decision-assistant\EBWebView\Default\Local Storage'
$taskUserData = Join-Path $taskDataRoot 'user-data'
if ($CheckOnly) {
    [pscustomobject]@{ Installer=$taskInstallers[0].FullName; Target=$taskInstallPath; LegacyData=$taskProfile; UserData=$taskUserData; Mode='/S /UPDATE'; Ready=$true }
    exit 0
}
$taskBackup = Join-Path $taskDataRoot ('backups\upgrade-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskBackup | Out-Null
$taskCopies = @()
foreach ($taskSource in @($taskProfile, $taskUserData)) {
    if (-not (Test-Path -LiteralPath $taskSource)) { continue }
    $taskDestination = Join-Path $taskBackup (Split-Path -Leaf $taskSource)
    Copy-Item -LiteralPath $taskSource -Destination $taskDestination -Recurse -ErrorAction Stop
    foreach ($taskFile in (Get-ChildItem -LiteralPath $taskSource -File -Recurse)) {
        $taskRelative = $taskFile.FullName.Substring($taskSource.Length).TrimStart('\')
        $taskHash = (Get-FileHash -LiteralPath $taskFile.FullName).Hash
        if ($taskHash -ne (Get-FileHash -LiteralPath (Join-Path $taskDestination $taskRelative)).Hash) { throw 'Backup verification failed; installer was not started.' }
        $taskCopies += [pscustomobject]@{ Path=$taskFile.FullName; Hash=$taskHash }
    }
}
# /UPDATE avoids uninstalling the old client and deleting application data.
$taskInstaller = Start-Process -FilePath $taskInstallers[0].FullName -ArgumentList '/S','/UPDATE',"/D=$taskInstallPath" -WindowStyle Hidden -Wait -PassThru
if ($taskInstaller.ExitCode -ne 0) { throw "Installer failed. Exit=$($taskInstaller.ExitCode). Backup=$taskBackup" }
foreach ($taskCopy in $taskCopies) {
    if (-not (Test-Path -LiteralPath $taskCopy.Path) -or (Get-FileHash -LiteralPath $taskCopy.Path).Hash -ne $taskCopy.Hash) {
        throw "Data verification failed after update. Do not start the client. Recover from $taskBackup"
    }
}
Write-Output "Update completed; all saved-data hashes unchanged. Backup=$taskBackup"
