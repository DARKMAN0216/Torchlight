$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $projectRoot '.venv-recognition'
$requirementsPath = Join-Path $projectRoot 'recognizer\requirements.txt'

if (-not (Test-Path -LiteralPath $venvPath)) {
    python -m venv $venvPath
}

$pythonPath = Join-Path $venvPath 'Scripts\python.exe'
& $pythonPath -m pip install --upgrade pip
& $pythonPath -m pip install -r $requirementsPath

Write-Host ''
Write-Host '屏幕识别环境已就绪。启动方式：'
Write-Host '.\scripts\start-recognition.ps1'
