"""
copilot_capture.py — mitmproxy addon for FlightDeck

Intercepts requests to copilot-proxy.githubusercontent.com, extracts token usage
from the response, and appends one JSON record per request to
~/.ai-usage/proxy-requests.jsonl.

Usage:
    mitmdump -s scripts/copilot_capture.py --mode upstream:https://copilot-proxy.githubusercontent.com --listen-port 8877
  OR use the provided Start-CopilotProxy.ps1 launcher.

Requirements:
    pip install mitmproxy
"""

import json
import os
import re
import time
from pathlib import Path

from mitmproxy import http


# Hosts used by different Copilot clients:
#   copilot-proxy.githubusercontent.com  — old gh copilot extension
#   api.individual.githubcopilot.com     — standalone copilot.exe CLI (individual plan)
#   api.githubcopilot.com                — standalone copilot.exe CLI (business/enterprise)
CAPTURE_HOSTS = {
    "copilot-proxy.githubusercontent.com",
    "api.individual.githubcopilot.com",
    "api.githubcopilot.com",
}
OUTPUT_DIR = Path.home() / ".ai-usage"
OUTPUT_FILE = OUTPUT_DIR / "proxy-requests.jsonl"

# Endpoints to capture
CAPTURE_PATHS = {"/v1/chat/completions", "/chat/completions"}


def _detect_source(flow: http.HTTPFlow) -> str:
    ua = (flow.request.headers.get("user-agent") or "").lower()
    # CLI check first: standalone copilot.exe uses "copilot-cli" or "copilot/x.y.z (...) term/..."
    # The term/vscode suffix means it's running in a VS Code *terminal*, not the VS Code extension
    if "copilot-cli" in ua or "gh-copilot" in ua or "copilot_cli" in ua:
        return "cli"
    if "term/" in ua and ua.startswith("copilot/"):
        return "cli"
    # VS Code extension uses "copilot-chat" in its UA
    if "copilot-chat" in ua or ("vscode" in ua and "term/" not in ua):
        return "vscode"
    return "unknown"


def _extract_model(flow: http.HTTPFlow) -> str:
    """Try to get the model from the request body first, then fall back to response."""
    try:
        body = json.loads(flow.request.content)
        return body.get("model") or ""
    except Exception:
        return ""


def _parse_usage(body: bytes) -> dict | None:
    """
    Extract token usage from an OpenAI-compatible response.

    The Copilot proxy returns Server-Sent Events (SSE). mitmproxy's response()
    hook receives the fully-buffered body, so we can scan for the last data
    chunk that contains a 'usage' key before the [DONE] sentinel.
    """
    # Try direct JSON first (non-streaming)
    try:
        parsed = json.loads(body)
        usage = parsed.get("usage")
        if usage:
            return usage
    except Exception:
        pass

    # SSE streaming: find the last 'data: {...}' line that has usage
    usage = None
    for line in body.split(b"\n"):
        line = line.strip()
        if not line.startswith(b"data:"):
            continue
        raw = line[len(b"data:"):].strip()
        if raw == b"[DONE]":
            continue
        try:
            chunk = json.loads(raw)
            if chunk.get("usage"):
                usage = chunk["usage"]
        except Exception:
            continue

    return usage


class CopilotCapture:
    def __init__(self):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        if flow.request.host not in CAPTURE_HOSTS:
            return
        if flow.request.path.split("?")[0] not in CAPTURE_PATHS:
            return
        # Enable streaming: each chunk is forwarded to the client immediately
        # while we accumulate a copy for usage extraction after the stream ends.
        flow.metadata["capture_chunks"] = []

        def _stream_chunk(chunk: bytes) -> bytes:
            flow.metadata["capture_chunks"].append(chunk)
            return chunk  # pass through unmodified

        flow.response.stream = _stream_chunk

    def response(self, flow: http.HTTPFlow) -> None:
        if flow.request.host not in CAPTURE_HOSTS:
            return
        if flow.request.path.split("?")[0] not in CAPTURE_PATHS:
            return
        if flow.response is None:
            return

        t_start = getattr(flow.request, "timestamp_start", None) or time.time()
        t_end = getattr(flow.response, "timestamp_start", None) or time.time()
        latency_ms = int((t_end - t_start) * 1000)

        model = _extract_model(flow)
        source = _detect_source(flow)

        if "capture_chunks" in flow.metadata:
            body = b"".join(flow.metadata["capture_chunks"])
        else:
            body = flow.response.content
        usage = _parse_usage(body)

        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model": model,
            "prompt_tokens": usage.get("prompt_tokens") if usage else None,
            "completion_tokens": usage.get("completion_tokens") if usage else None,
            "total_tokens": usage.get("total_tokens") if usage else None,
            "latency_ms": latency_ms,
            "source": source,
        }

        with OUTPUT_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")


addons = [CopilotCapture()]
