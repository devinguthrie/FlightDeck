# Remove-CopilotProxy.ps1
# Uninstalls the mitmproxy CA certificate and removes all FlightDeck proxy data.
#
# Usage:
#   .\scripts\Remove-CopilotProxy.ps1
#
# What this removes:
#   - mitmproxy CA cert from Trusted Root Certification Authorities (Current User)
#   - ~/.mitmproxy/   (mitmproxy keys and certs)
#   - ~/.ai-usage/proxy-requests.jsonl  (captured proxy data)
#
# What this does NOT remove:
#   - mitmproxy itself (pip uninstall mitmproxy)
#   - FlightDeck's sessions.db proxy_requests table rows
#     (those will stop syncing once the JSONL is gone)

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Confirm-Step([string]$Message) {
    if ($Force) { return $true }
    $answer = Read-Host "$Message [y/N]"
    return $answer -match "^[Yy]"
}

$removed = @()
$skipped = @()

# --- 1. Remove CA cert from certificate store ---
$certs = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like "*mitmproxy*" }

if ($certs) {
    Write-Host ""
    Write-Host "Found mitmproxy CA certificate(s):" -ForegroundColor Yellow
    $certs | ForEach-Object { Write-Host "  $($_.Subject)  [$($_.Thumbprint)]" }

    if (Confirm-Step "Remove from Trusted Root Certification Authorities?") {
        $certs | Remove-Item
        $removed += "CA certificate (Current User store)"
    } else {
        $skipped += "CA certificate"
    }
} else {
    Write-Host "No mitmproxy CA cert found in Current User store." -ForegroundColor Gray
}

# Also check Local Machine store (requires elevation)
$certsLM = Get-ChildItem Cert:\LocalMachine\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -like "*mitmproxy*" }

if ($certsLM) {
    Write-Host ""
    Write-Host "Found mitmproxy CA certificate(s) in Local Machine store:" -ForegroundColor Yellow
    $certsLM | ForEach-Object { Write-Host "  $($_.Subject)  [$($_.Thumbprint)]" }

    if (Confirm-Step "Remove from Local Machine Trusted Root (requires elevation)?") {
        try {
            $certsLM | Remove-Item
            $removed += "CA certificate (Local Machine store)"
        } catch {
            Write-Warning "Could not remove Local Machine cert (run as Administrator): $_"
        }
    } else {
        $skipped += "CA certificate (Local Machine)"
    }
}

# --- 2. Remove ~/.mitmproxy directory ---
$mitmDir = Join-Path $env:USERPROFILE ".mitmproxy"
if (Test-Path $mitmDir) {
    Write-Host ""
    if (Confirm-Step "Delete $mitmDir (mitmproxy keys and certs)?") {
        Remove-Item $mitmDir -Recurse -Force
        $removed += $mitmDir
    } else {
        $skipped += $mitmDir
    }
}

# --- 3. Remove proxy-requests.jsonl ---
$jsonlPath = Join-Path $env:USERPROFILE ".ai-usage\proxy-requests.jsonl"
if (Test-Path $jsonlPath) {
    Write-Host ""
    if (Confirm-Step "Delete $jsonlPath (captured proxy data)?") {
        Remove-Item $jsonlPath -Force
        $removed += $jsonlPath
    } else {
        $skipped += $jsonlPath
    }
}

# --- Summary ---
Write-Host ""
if ($removed.Count -gt 0) {
    Write-Host "Removed:" -ForegroundColor Green
    $removed | ForEach-Object { Write-Host "  - $_" }
}
if ($skipped.Count -gt 0) {
    Write-Host "Skipped:" -ForegroundColor Gray
    $skipped | ForEach-Object { Write-Host "  - $_" }
}

Write-Host ""
Write-Host "Done. The proxy is fully uninstalled." -ForegroundColor Cyan
Write-Host "To remove mitmproxy itself: pip uninstall mitmproxy" -ForegroundColor Gray
