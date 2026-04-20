# Start-CopilotProxy.ps1
# Launches mitmproxy as a transparent upstream proxy that intercepts
# Copilot requests and writes ~\.ai-usage\proxy-requests.jsonl
#
# Usage:
#   .\scripts\Start-CopilotProxy.ps1
#
# Requirements:
#   pip install mitmproxy
#
# Sets HTTPS_PROXY at the Windows User environment scope so every terminal
# (any project, any shell) automatically routes Copilot CLI traffic through
# the proxy. Cleared automatically when the proxy stops.

param(
    [int]$Port = 8877
)

$ErrorActionPreference = "Stop"

# Verify mitmproxy is available
if (-not (Get-Command "mitmdump" -ErrorAction SilentlyContinue)) {
    Write-Error "mitmdump not found. Install with: pip install mitmproxy"
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AddonPath = Join-Path $ScriptDir "copilot_capture.py"

if (-not (Test-Path $AddonPath)) {
    Write-Error "Addon not found: $AddonPath"
    exit 1
}

$ProxyUrl = "http://127.0.0.1:$Port"

# Clear any stale HTTPS_PROXY left by a previously hard-killed proxy session
$staleUrl = [System.Environment]::GetEnvironmentVariable('HTTPS_PROXY', 'User')
if ($staleUrl -eq $ProxyUrl) {
    $stalePidFile = Join-Path $env:USERPROFILE '.ai-usage\proxy.pid'
    $stalePid = Get-Content $stalePidFile -ErrorAction SilentlyContinue
    $staleRunning = $stalePid -and (Get-Process -Id $stalePid -ErrorAction SilentlyContinue)
    if (-not $staleRunning) {
        Write-Host "Clearing stale HTTPS_PROXY from a previous session..." -ForegroundColor DarkYellow
        [System.Environment]::SetEnvironmentVariable('HTTPS_PROXY', $null, 'User')
        [System.Environment]::SetEnvironmentVariable('HTTP_PROXY',  $null, 'User')
    }
}

# Kill the previous FlightDeck proxy instance (tracked by lockfile), not all mitmdump processes
$LockFile = Join-Path $env:USERPROFILE ".ai-usage\proxy.pid"
if (Test-Path $LockFile) {
    $oldPid = Get-Content $LockFile -ErrorAction SilentlyContinue
    if ($oldPid) {
        $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($oldProc -and $oldProc.ProcessName -like "mitmdump*") {
            Write-Host "Stopping previous FlightDeck proxy (PID $oldPid)..." -ForegroundColor DarkYellow
            $oldProc | Stop-Process -Force
            Start-Sleep -Milliseconds 300
        }
    }
    Remove-Item $LockFile -Force
}

# Set HTTPS_PROXY at User scope so every terminal inherits it — run 'gh copilot'
# from any project without needing this specific shell open.
$env:HTTPS_PROXY = $ProxyUrl
$env:HTTP_PROXY  = $ProxyUrl
[System.Environment]::SetEnvironmentVariable('HTTPS_PROXY', $ProxyUrl, 'User')
[System.Environment]::SetEnvironmentVariable('HTTP_PROXY',  $ProxyUrl, 'User')

# Trust mitmproxy CA so TLS interception works
# On first run, browse to http://mitm.it and install the CA cert,
# or ensure ~/.mitmproxy/mitmproxy-ca-cert.pem is trusted.
$env:REQUESTS_CA_BUNDLE = "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem"
$env:NODE_EXTRA_CA_CERTS = $env:REQUESTS_CA_BUNDLE

$LogFile   = Join-Path ([System.IO.Path]::GetTempPath()) "flightdeck-proxy.log"
$LogFileErr = Join-Path ([System.IO.Path]::GetTempPath()) "flightdeck-proxy.err.log"

Write-Host "Starting FlightDeck proxy on port $Port..." -ForegroundColor Cyan

# Only intercept TLS for Copilot domains; all other hosts are passed through as
# plain TCP tunnels so tools like npm never see a substituted certificate.
$CopilotHosts = "copilot-proxy\.githubusercontent\.com|.*\.githubcopilot\.com|api\.github\.com/.*copilot"

$proc = Start-Process `
    -FilePath "mitmdump" `
    -ArgumentList @("--listen-port", $Port, "--ssl-insecure", "--allow-hosts", $CopilotHosts, "-s", $AddonPath, "--quiet") `
    -NoNewWindow `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError $LogFileErr `
    -PassThru

# Brief pause to catch immediate startup failures
Start-Sleep -Milliseconds 600
if ($proc.HasExited) {
    Write-Error "mitmdump exited immediately (exit code $($proc.ExitCode)). Check: $LogFile"
    exit 1
}

Write-Host "Proxy running (PID $($proc.Id))" -ForegroundColor Green
Write-Host "  Intercepting: copilot-proxy.githubusercontent.com" -ForegroundColor Gray
Write-Host "  Writing to:   $env:USERPROFILE\.ai-usage\proxy-requests.jsonl" -ForegroundColor Gray
Write-Host "  Log:          $LogFile (stdout) / $LogFileErr (stderr)" -ForegroundColor Gray
Write-Host ""
Write-Host "HTTPS_PROXY set globally (User scope) — run 'gh copilot' from any terminal." -ForegroundColor Yellow
Write-Host "Cleared automatically when this terminal closes." -ForegroundColor Yellow
Write-Host ""
Write-Host "To stop the proxy:" -ForegroundColor Gray
Write-Host "  Stop-Process -Id $($proc.Id)" -ForegroundColor Gray
Write-Host "  `$env:HTTPS_PROXY = ''" -ForegroundColor Gray

# Keep the process ID accessible in the shell for easy cleanup
Set-Variable -Name FLIGHTDECK_PROXY_PID -Value $proc.Id -Scope Global
$proc.Id | Set-Content $LockFile
Write-Host ""
Write-Host "(PID also saved as `$FLIGHTDECK_PROXY_PID)" -ForegroundColor DarkGray

# Register a cleanup handler that fires when this PowerShell session exits.
# Covers: typing 'exit', closing the terminal tab, window close button.
# Does NOT fire on hard kills (Task Manager / kill -9).
$cleanupProc = $proc
$cleanupLock = $LockFile
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    if ($cleanupProc -and -not $cleanupProc.HasExited) {
        $cleanupProc.Kill()
    }
    if (Test-Path $cleanupLock) { Remove-Item $cleanupLock -Force }
    # Clear from both current session and persistent User scope
    $env:HTTPS_PROXY = ''
    $env:HTTP_PROXY  = ''
    [System.Environment]::SetEnvironmentVariable('HTTPS_PROXY', $null, 'User')
    [System.Environment]::SetEnvironmentVariable('HTTP_PROXY',  $null, 'User')
} | Out-Null
