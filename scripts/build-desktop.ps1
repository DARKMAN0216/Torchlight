$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$cargoPath = Join-Path $cargoBin 'cargo.exe'

if (-not (Test-Path -LiteralPath $cargoPath)) {
    throw '未找到 Rust 工具链。请运行：winget install --id Rustlang.Rustup'
}

$env:Path = "$cargoBin;$env:Path"
Set-Location $projectRoot
& pnpm exec tauri build
