$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host 'Setting up PianoPractice Local...' -ForegroundColor Cyan
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'uv was not found. Install it from https://docs.astral.sh/uv/ and run this script again.'
    }
    Write-Host 'Installing uv...'
    winget install --id=astral-sh.uv -e --accept-package-agreements --accept-source-agreements
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $env:Path = "$userPath;$machinePath;$env:Path"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        throw 'uv was installed but is not visible in this session. Reopen PowerShell and run the same command again.'
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20 or later is required. Install it from https://nodejs.org/.'
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
    throw "Node.js 20 or later is required. Current version: $(node --version)"
}

uv python install 3.12
uv sync
npm install

if (-not (Test-Path (Join-Path $root '.env'))) {
    Copy-Item (Join-Path $root '.env.example') (Join-Path $root '.env')
    Write-Host 'Created .env. Set YOUTUBE_API_KEY there to enable title search.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Accept the MuScriptor medium license in the browser.' -ForegroundColor Yellow
Start-Process 'https://huggingface.co/MuScriptor/muscriptor-medium'
Read-Host 'Press Enter after accepting the license'
uvx hf auth login

Write-Host ''
Write-Host 'Setup complete. Run scripts\start-local.ps1 to start the app.' -ForegroundColor Green
