# MITM Proxy Setup

FlightDeck can intercept Copilot API traffic to capture **exact token counts** and **CLI sessions** (including `gh copilot` multi-agent commands, which write no transcript files).

Without the proxy, CLI usage is completely invisible to FlightDeck.

---

## How it works

```
gh copilot / VS Code
        │
        ▼  (HTTPS_PROXY)
  mitmdump :8877   ◄── copilot_capture.py writes ~/.ai-usage/proxy-requests.jsonl
        │  (regular proxy — all traffic passes through, addon filters to Copilot only)
        ▼
copilot-proxy.githubusercontent.com  (and any other HTTPS destinations)
```

`copilot_capture.py` is a [mitmproxy](https://mitmproxy.org/) addon. It buffers the full SSE response, extracts the `usage` object from the last chunk, and appends one JSON record per request to `~/.ai-usage/proxy-requests.jsonl`. FlightDeck ingests that file incrementally on each page load.

---

## One-time setup

### 1. Install mitmproxy

```powershell
pip install mitmproxy
```

### 2. Trust the mitmproxy CA certificate

Run `mitmdump` once briefly to generate keys:

```powershell
mitmdump --listen-port 8877
# Ctrl+C after a second
```

Then trust the CA so TLS interception works:

- Open `%USERPROFILE%\.mitmproxy\`
- Double-click `mitmproxy-ca-cert.p12` → install to **Trusted Root Certification Authorities** (Local Machine or Current User)
- Or visit `http://mitm.it` in a browser while the proxy is running and follow the instructions for your OS

You only need to do this once per machine.

---

## Daily usage

Open a terminal and run:

```powershell
.\scripts\Start-CopilotProxy.ps1
```

The script starts `mitmdump` as a background process and sets `HTTPS_PROXY` at the **Windows User environment scope** — so every terminal you open (any project, any shell) automatically routes Copilot CLI traffic through the proxy. No need to run `gh copilot` from a specific terminal.

`HTTPS_PROXY` is cleared automatically when you close the terminal running the proxy script.

To stop the proxy when you're done:

```powershell
Stop-Process -Id $FLIGHTDECK_PROXY_PID
$env:HTTPS_PROXY = ''
```

---

## VS Code traffic

Because `HTTPS_PROXY` is set at the User environment scope, VS Code will pick it up automatically **the next time it starts**. If VS Code is already running, restart it once after starting the proxy.

VS Code requests are tagged `source: "vscode"` and CLI requests are tagged `source: "cli"` in the captured data.

---

## What gets captured

Each intercepted request produces one JSONL record:

```json
{
  "ts": "2026-04-07T14:23:01Z",
  "model": "claude-sonnet-4-5",
  "prompt_tokens": 8241,
  "completion_tokens": 412,
  "total_tokens": 8653,
  "latency_ms": 3104,
  "source": "cli"
}
```

FlightDeck uses this data to show:

- **Proxy status badge** — green dot in the header when requests were captured in the last 24h
- **Token Estimate Accuracy** — exact proxy tokens vs transcript-estimated tokens for the current billing cycle
- **CLI Requests Captured** — count of CLI vs VS Code requests
- **Proxy Capture panel** — per-model request counts and average latency

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `mitmdump not found` | `pip install mitmproxy` or add Python Scripts to PATH |
| TLS handshake errors | Re-trust the CA cert (step 2 above) |
| No records appearing | Make sure `gh copilot` is run from the same terminal as the proxy script |
| VS Code traffic not captured | Start VS Code from the proxy terminal, or set `HTTPS_PROXY` as a system env var |
| File not created | Check `%USERPROFILE%\.ai-usage\` exists; the script creates it automatically |

---

## Stopping the proxy

The PID is stored in `$FLIGHTDECK_PROXY_PID` when the script runs:

```powershell
Stop-Process -Id $FLIGHTDECK_PROXY_PID
$env:HTTPS_PROXY = ''
```

Or to stop all mitmdump instances: `Get-Process mitmdump | Stop-Process`

The `HTTPS_PROXY` env var is shell-session-scoped and disappears when you close the terminal.

---

## Uninstalling

To remove everything the proxy setup touched, run:

```powershell
.\scripts\Remove-CopilotProxy.ps1
```

This will prompt before each step and remove:

| What | Where |
|---|---|
| mitmproxy CA certificate | `Cert:\CurrentUser\Root` (and Local Machine if present) |
| mitmproxy keys & certs | `%USERPROFILE%\.mitmproxy\` |
| Captured proxy data | `%USERPROFILE%\.ai-usage\proxy-requests.jsonl` |

Pass `-Force` to skip all prompts:

```powershell
.\scripts\Remove-CopilotProxy.ps1 -Force
```

To also remove mitmproxy itself:

```powershell
pip uninstall mitmproxy
```
