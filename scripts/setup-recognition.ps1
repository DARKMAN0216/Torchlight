$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $projectRoot '.venv-recognition'
$requirementsPath = Join-Path $projectRoot 'recognizer\requirements.txt'

function Find-Python311 {
    $candidates = @(
        (Join-Path $env:LocalAppData 'Programs\Python\Python311\python.exe'),
        (Get-Command py -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
        (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    foreach ($candidate in $candidates) {
        $version = & $candidate --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $version -match '^Python 3\.11\.') {
            return $candidate
        }
    }

    throw '未找到 Python 3.11。请安装 64 位 Python 3.11 后重新运行此脚本。'
}

if (-not (Test-Path -LiteralPath $venvPath)) {
    $pythonPath = Find-Python311
    & $pythonPath -m venv $venvPath
}

$pythonPath = Join-Path $venvPath 'Scripts\python.exe'
& $pythonPath -m pip install --upgrade pip
& $pythonPath -m pip install -r $requirementsPath

Write-Host ''
Write-Host '屏幕识别环境已就绪。启动方式：'
Write-Host '.\scripts\start-recognition.ps1'
