# Start-CopilotProxy.ps1
# Launches the FlightDeck MITM proxy AND the FlipBuddy BLE bridge daemon.
#
# Usage:
#   .\scripts\Start-CopilotProxy.ps1
#
# Requirements:
#   pip install mitmproxy bleak
#
# Sets HTTPS_PROXY at the Windows User environment scope so every terminal
# automatically routes Copilot CLI traffic through the proxy.
# Both processes are cleaned up automatically when this terminal closes.

param(
    [int]$Port = 8877,
    # Path to bridge.py — defaults to sibling FlipBuddy repo next to this one.
    # Override with: .\Start-CopilotProxy.ps1 -BridgePath C:\path\to\bridge.py
    # Set to empty string "" to skip launching the bridge.
    [string]$BridgePath = ""
)

$ErrorActionPreference = "Stop"

# Verify mitmproxy is available
if (-not (Get-Command "mitmdump" -ErrorAction SilentlyContinue)) {
    Write-Error "mitmdump not found. Install with: pip install mitmproxy"
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AddonPath = Join-Path $ScriptDir "copilot_capture.py"

# Resolve bridge path: default to sibling FlipBuddy repo (../../../FlipBuddy/tools/bridge.py)
if ($BridgePath -eq "") {
    $ReposDir  = Split-Path (Split-Path $ScriptDir)   # FlightDeck/../ == Repos\
    $BridgePath = Join-Path $ReposDir "FlipBuddy\tools\bridge.py"
}

if (-not (Test-Path $AddonPath)) {
    Write-Error "Addon not found: $AddonPath"
    exit 1
}

# Ensure mitmproxy CA cert is generated and trusted before starting the proxy.
# Safe to call every time — exits immediately if already installed.
$CertScript = Join-Path $ScriptDir "Install-CopilotProxyCert.ps1"
if (Test-Path $CertScript) {
    & $CertScript
} else {
    Write-Warning "Install-CopilotProxyCert.ps1 not found — skipping cert check. TLS interception may fail."
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

# Kill the previous FlightDeck proxy instance (tracked by lockfile), not all mitmdump processes.
# On Windows, mitmdump runs as python3.x, so we accept any process at the recorded PID.
$LockFile = Join-Path $env:USERPROFILE ".ai-usage\proxy.pid"
if (Test-Path $LockFile) {
    $oldPid = Get-Content $LockFile -ErrorAction SilentlyContinue
    if ($oldPid) {
        $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($oldProc) {
            Write-Host "Stopping previous FlightDeck proxy (PID $oldPid, $($oldProc.ProcessName))..." -ForegroundColor DarkYellow
            $oldProc | Stop-Process -Force
            Start-Sleep -Milliseconds 300
        }
    }
    Remove-Item $LockFile -Force
} else {
    # No lockfile — also evict anything squatting on the port from a previous hard-kill
    $portOwner = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
                  Select-Object -First 1).OwningProcess
    if ($portOwner) {
        $portProc = Get-Process -Id $portOwner -ErrorAction SilentlyContinue
        if ($portProc) {
            Write-Host "Port $Port held by PID $portOwner ($($portProc.ProcessName)) — stopping it." -ForegroundColor DarkYellow
            $portProc | Stop-Process -Force
            Start-Sleep -Milliseconds 500
        }
    }
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
Write-Host ""

# Keep the process ID accessible in the shell for easy cleanup
Set-Variable -Name FLIGHTDECK_PROXY_PID -Value $proc.Id -Scope Global
$proc.Id | Set-Content $LockFile
Write-Host "(PID saved as `$FLIGHTDECK_PROXY_PID)" -ForegroundColor DarkGray

# --- Start FlipBuddy bridge ---
$BridgeLockFile = Join-Path $env:USERPROFILE ".ai-usage\bridge.pid"
$bridgeProc     = $null

# Kill any existing bridge first
if (Test-Path $BridgeLockFile) {
    $oldBridgePid = Get-Content $BridgeLockFile -ErrorAction SilentlyContinue
    if ($oldBridgePid) {
        $oldBridge = Get-Process -Id $oldBridgePid -ErrorAction SilentlyContinue
        if ($oldBridge) {
            Write-Host "Stopping previous FlipBuddy bridge (PID $oldBridgePid)..." -ForegroundColor DarkYellow
            $oldBridge | Stop-Process -Force
            Start-Sleep -Milliseconds 200
        }
    }
    Remove-Item $BridgeLockFile -Force -ErrorAction SilentlyContinue
}

if ($BridgePath -ne "" -and (Test-Path $BridgePath)) {
    $BridgeLog    = Join-Path ([System.IO.Path]::GetTempPath()) "flipbuddy-bridge.log"
    $BridgeErrLog = Join-Path ([System.IO.Path]::GetTempPath()) "flipbuddy-bridge-err.log"
    Write-Host ""
    Write-Host "Starting FlipBuddy bridge..." -ForegroundColor Cyan
    $bridgeProc = Start-Process `
        -FilePath "python" `
        -ArgumentList @($BridgePath) `
        -NoNewWindow `
        -RedirectStandardOutput $BridgeLog `
        -RedirectStandardError  $BridgeErrLog `
        -PassThru
    Start-Sleep -Milliseconds 400
    if ($bridgeProc.HasExited) {
        Write-Warning "Bridge exited immediately — check log: $BridgeLog"
        $bridgeProc = $null
    } else {
        $bridgeProc.Id | Set-Content $BridgeLockFile
        Write-Host "Bridge running (PID $($bridgeProc.Id)) — scanning for Flipper over BLE" -ForegroundColor Green
        Write-Host "  Log: $BridgeLog  |  Errors: $BridgeErrLog" -ForegroundColor Gray
        Set-Variable -Name FLIPBUDDY_BRIDGE_PID -Value $bridgeProc.Id -Scope Global
    }
} elseif ($BridgePath -ne "") {
    Write-Warning "FlipBuddy bridge not found at: $BridgePath (skipping)"
    Write-Host "  Override with: -BridgePath <path\to\bridge.py>" -ForegroundColor Gray
}

Write-Host ""
Write-Host "To stop everything: .\scripts\Stop-CopilotProxy.ps1" -ForegroundColor Gray

# Register a cleanup handler that fires when this PowerShell session exits.
# Covers: typing 'exit', closing the terminal tab, window close button.
# Does NOT fire on hard kills (Task Manager / kill -9).
$cleanupProc   = $proc
$cleanupBridge = $bridgeProc
$cleanupLock   = $LockFile
$cleanupBridgeLock = $BridgeLockFile
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    if ($cleanupProc -and -not $cleanupProc.HasExited) {
        $cleanupProc.Kill()
    }
    if ($cleanupBridge -and -not $cleanupBridge.HasExited) {
        $cleanupBridge.Kill()
    }
    if (Test-Path $cleanupLock)       { Remove-Item $cleanupLock       -Force }
    if (Test-Path $cleanupBridgeLock) { Remove-Item $cleanupBridgeLock -Force }
    # Clear from both current session and persistent User scope
    $env:HTTPS_PROXY = ''
    $env:HTTP_PROXY  = ''
    [System.Environment]::SetEnvironmentVariable('HTTPS_PROXY', $null, 'User')
    [System.Environment]::SetEnvironmentVariable('HTTP_PROXY',  $null, 'User')
} | Out-Null
