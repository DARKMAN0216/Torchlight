$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv-recognition\Scripts\python.exe'
$serverPath = Join-Path $projectRoot 'recognizer\server.py'

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw '未找到识别环境，请先运行 .\scripts\setup-recognition.ps1'
}

& $pythonPath $serverPath --host 127.0.0.1 --port 28765
