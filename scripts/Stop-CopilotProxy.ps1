# Stop-CopilotProxy.ps1
# Stops the FlightDeck proxy AND the FlipBuddy bridge daemon, and clears HTTPS_PROXY.
#
# Safe to run even when neither is running.
#
# Usage:
#   .\scripts\Stop-CopilotProxy.ps1

$ErrorActionPreference = "Stop"

$LockFile = Join-Path $env:USERPROFILE ".ai-usage\proxy.pid"
$ProxyUrl = "http://127.0.0.1:8877"
$stopped  = $false

# --- Stop the tracked proxy process ---
# On Windows, mitmdump runs as python3.x (not "mitmdump"), so we accept any
# process at the recorded PID rather than filtering by name.
if (Test-Path $LockFile) {
    $proxyPid = Get-Content $LockFile -ErrorAction SilentlyContinue
    if ($proxyPid) {
        $proc = Get-Process -Id $proxyPid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Stopping FlightDeck proxy (PID $proxyPid, $($proc.ProcessName))..." -ForegroundColor Cyan
            $proc | Stop-Process -Force
            Start-Sleep -Milliseconds 300
            $stopped = $true
        } else {
            Write-Host "Proxy process (PID $proxyPid) is not running." -ForegroundColor Gray
        }
    }
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
} else {
    # No lockfile — fall back to killing any process listening on the proxy port
    $portOwner = (Get-NetTCPConnection -LocalPort 8877 -State Listen -ErrorAction SilentlyContinue |
                  Select-Object -First 1).OwningProcess
    if ($portOwner) {
        $proc = Get-Process -Id $portOwner -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "No lockfile, but found process on port 8877 (PID $portOwner, $($proc.ProcessName)) — stopping it." -ForegroundColor Yellow
            $proc | Stop-Process -Force
            Start-Sleep -Milliseconds 300
            $stopped = $true
        }
    } else {
        Write-Host "No proxy lockfile found — proxy may not be running." -ForegroundColor Gray
    }
}

# --- Clear HTTPS_PROXY from current session and user scope ---
$currentProxy = [System.Environment]::GetEnvironmentVariable('HTTPS_PROXY', 'User')
if ($currentProxy -eq $ProxyUrl) {
    [System.Environment]::SetEnvironmentVariable('HTTPS_PROXY', $null, 'User')
    [System.Environment]::SetEnvironmentVariable('HTTP_PROXY',  $null, 'User')
    Write-Host "Cleared HTTPS_PROXY from User environment." -ForegroundColor Cyan
}
$env:HTTPS_PROXY = ''
$env:HTTP_PROXY  = ''

# --- Stop the FlipBuddy bridge ---
$BridgeLockFile = Join-Path $env:USERPROFILE ".ai-usage\bridge.pid"
if (Test-Path $BridgeLockFile) {
    $bridgePid = Get-Content $BridgeLockFile -ErrorAction SilentlyContinue
    if ($bridgePid) {
        $bridgeProc = Get-Process -Id $bridgePid -ErrorAction SilentlyContinue
        if ($bridgeProc) {
            Write-Host "Stopping FlipBuddy bridge (PID $bridgePid, $($bridgeProc.ProcessName))..." -ForegroundColor Cyan
            $bridgeProc | Stop-Process -Force
            $stopped = $true
        } else {
            Write-Host "Bridge process (PID $bridgePid) is not running." -ForegroundColor Gray
        }
    }
    Remove-Item $BridgeLockFile -Force -ErrorAction SilentlyContinue
}

if ($stopped) {
    Write-Host "Done." -ForegroundColor Green
} else {
    Write-Host "Done (nothing was running)." -ForegroundColor Gray
}
