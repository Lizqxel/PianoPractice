$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$env:Path = "$userPath;$machinePath;$env:Path"
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCommand) {
    $uvCandidate = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\astral-sh.uv_*\uv.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($uvCandidate) {
        $env:Path = "$(Split-Path -Parent $uvCandidate.FullName);$env:Path"
        $uvCommand = Get-Command uv -ErrorAction SilentlyContinue
    }
}
if (-not $uvCommand) {
    throw 'uv was not found. Run scripts\setup-local.ps1 first.'
}
if (-not (Test-Path (Join-Path $root '.venv'))) {
    throw 'The Python environment is missing. Run scripts\setup-local.ps1 first.'
}

# Hugging Face's Xet downloader can stall on Windows while fetching the gated
# MuScriptor checkpoint. The regular HTTP downloader is slower but reliable and
# still resumes/caches the file in the standard Hugging Face cache.
if (-not $env:HF_HUB_DISABLE_XET) {
    $env:HF_HUB_DISABLE_XET = '1'
}

Write-Host 'Building the web app...'
npm run build

$stdout = Join-Path $root '.local-server.out.log'
$stderr = Join-Path $root '.local-server.err.log'
Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
$uv = $uvCommand.Source
$arguments = @('run', 'uvicorn', 'local_server.app:create_default_app', '--factory', '--host', '127.0.0.1', '--port', '8222')

Write-Host 'Loading MuScriptor. The first run downloads the model and can take a while...' -ForegroundColor Cyan
$server = Start-Process -FilePath $uv -ArgumentList $arguments -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 900; $attempt += 1) {
        if ($server.HasExited) {
            $details = if (Test-Path $stderr) { Get-Content -Raw -Encoding UTF8 $stderr } else { '' }
            throw "The local service stopped unexpectedly.`n$details"
        }
        try {
            $null = Invoke-RestMethod -Uri 'http://127.0.0.1:8222/api/status' -TimeoutSec 2
            $ready = $true
            break
        } catch {
            if ($attempt -gt 0 -and $attempt % 10 -eq 0) { Write-Host '  The model is still loading...' }
            Start-Sleep -Seconds 1
        }
    }
    if (-not $ready) { throw 'Startup timed out after 15 minutes. Check .local-server.err.log.' }
    Write-Host 'PianoPractice is ready: http://127.0.0.1:8222' -ForegroundColor Green
    Start-Process 'http://127.0.0.1:8222'
    Write-Host 'Keep this window open. Press Ctrl+C to stop the local service.'
    Wait-Process -Id $server.Id
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
