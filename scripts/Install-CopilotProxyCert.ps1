# Install-CopilotProxyCert.ps1
# Generates the mitmproxy CA certificate (if needed) and installs it into the
# Current User Trusted Root store so TLS interception works without errors.
#
# Safe to run multiple times — skips if cert is already trusted.
#
# Usage:
#   .\scripts\Install-CopilotProxyCert.ps1
#
# Called automatically by Start-CopilotProxy.ps1 on each launch.

param(
    [switch]$Force   # re-install even if cert is already present
)

$ErrorActionPreference = "Stop"

$MitmDir  = Join-Path $env:USERPROFILE ".mitmproxy"
$CertPem  = Join-Path $MitmDir "mitmproxy-ca-cert.pem"
$CertCer  = Join-Path $MitmDir "mitmproxy-ca-cert.cer"
$CertP12  = Join-Path $MitmDir "mitmproxy-ca-cert.p12"

# ---------------------------------------------------------------------------
# 1. Already installed?
# ---------------------------------------------------------------------------
if (-not $Force) {
    $existing = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -like "*mitmproxy*" }
    if ($existing) {
        Write-Host "mitmproxy CA already trusted ($($existing[0].Thumbprint))" -ForegroundColor Green
        exit 0
    }
}

# ---------------------------------------------------------------------------
# 2. Generate cert files if ~/.mitmproxy doesn't exist yet
# ---------------------------------------------------------------------------
if (-not (Test-Path $CertCer)) {
    if (-not (Get-Command "mitmdump" -ErrorAction SilentlyContinue)) {
        Write-Error "mitmdump not found. Install with: pip install mitmproxy"
        exit 1
    }

    Write-Host "Generating mitmproxy CA certificate..." -ForegroundColor Cyan

    # Use a throwaway port so we don't conflict with a running proxy
    $genPort = 18877
    $proc = Start-Process `
        -FilePath "mitmdump" `
        -ArgumentList @("--listen-port", $genPort, "--quiet") `
        -NoNewWindow `
        -PassThru

    # Wait up to 5 s for the cert files to appear
    $deadline = (Get-Date).AddSeconds(5)
    while (-not (Test-Path $CertCer) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 200
    }
    $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}

if (-not (Test-Path $CertCer)) {
    Write-Error "Certificate not found at $CertCer after generation attempt. Try running 'mitmdump' once manually to generate keys."
    exit 1
}

# ---------------------------------------------------------------------------
# 3. Import into Current User Trusted Root (no elevation required)
# ---------------------------------------------------------------------------
Write-Host "Installing mitmproxy CA → Cert:\CurrentUser\Root ..." -ForegroundColor Cyan

try {
    $certObj  = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertCer)
    $store    = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        [System.Security.Cryptography.X509Certificates.StoreName]::Root,
        [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
    )
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $store.Add($certObj)
    $store.Close()
    Write-Host "Installed: $($certObj.Subject)  [$($certObj.Thumbprint)]" -ForegroundColor Green
} catch {
    Write-Error "Failed to install cert: $_`nYou can import it manually: $CertP12"
    exit 1
}

# ---------------------------------------------------------------------------
# 4. Verify
# ---------------------------------------------------------------------------
$certThumb = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertCer)).Thumbprint
$installed = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $certThumb }

if ($installed) {
    Write-Host ""
    Write-Host "✓ mitmproxy CA is trusted. TLS interception is ready." -ForegroundColor Green
} else {
    Write-Warning "Cert import ran without error but cert not found in store. Try importing manually: $CertP12"
    exit 1
}
