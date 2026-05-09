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

import asyncio
import json
import os
import re
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from mitmproxy import ctx, http

# ---------------------------------------------------------------------------
# FlipBuddy IPC — same STATE_DIR contract as pretool.py / bridge.py
# ---------------------------------------------------------------------------
_FB_STATE_DIR  = Path(os.environ.get("FLIPBUDDY_STATE_DIR", "")) or Path(tempfile.gettempdir()) / "flipbuddy"
_FB_STALE_SECS = 15.0
_FB_TIMEOUT    = 120.0
_FB_POLL       = 0.25


def _fb_bridge_alive() -> bool:
    p = _FB_STATE_DIR / "alive"
    if not p.exists():
        return False
    try:
        return time.time() - float(p.read_text()) < _FB_STALE_SECS
    except Exception:
        return False


def _fb_hint(name: str, arguments: dict) -> str:
    if name == "shell":
        return (arguments.get("command") or arguments.get("description", ""))[:80]
    for v in arguments.values():
        if isinstance(v, str):
            return v[:80]
    return name


def _extract_tool_calls(body: bytes) -> list[dict]:
    """Assemble tool calls from an SSE stream or plain JSON response body."""
    # Non-streaming JSON
    try:
        parsed = json.loads(body)
        calls = []
        for choice in parsed.get("choices", []):
            for tc in (choice.get("message") or {}).get("tool_calls", []):
                fn = tc.get("function", {})
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except Exception:
                    args = {}
                calls.append({"id": tc.get("id", ""), "name": fn.get("name", ""), "arguments": args})
        if calls:
            return calls
    except Exception:
        pass

    # SSE stream — accumulate argument fragments per tool-call index
    assembled: dict[int, dict] = {}
    for line in body.split(b"\n"):
        line = line.strip()
        if not line.startswith(b"data:"):
            continue
        raw = line[5:].strip()
        if raw == b"[DONE]":
            continue
        try:
            chunk = json.loads(raw)
        except Exception:
            continue
        for choice in chunk.get("choices", []):
            for tc in choice.get("delta", {}).get("tool_calls", []):
                idx = tc.get("index", 0)
                if idx not in assembled:
                    assembled[idx] = {"id": "", "name": "", "arguments": ""}
                if tc.get("id"):
                    assembled[idx]["id"] = tc["id"]
                fn = tc.get("function", {})
                if fn.get("name"):
                    assembled[idx]["name"] = fn["name"]
                assembled[idx]["arguments"] += fn.get("arguments", "")

    result = []
    for tc in assembled.values():
        try:
            args = json.loads(tc["arguments"]) if tc["arguments"] else {}
        except Exception:
            args = {}
        result.append({"id": tc["id"], "name": tc["name"], "arguments": args})
    return result


def _denial_sse_body(tool_name: str) -> bytes:
    """Return a well-formed SSE body that tells copilot the tool was denied."""
    content = f"[FlipBuddy] '{tool_name}' denied by hardware gate."
    text_chunk = json.dumps({
        "choices": [{"index": 0, "delta": {"role": "assistant", "content": content}, "finish_reason": None}]
    })
    stop_chunk = json.dumps({
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
    })
    return (f"data: {text_chunk}\n\ndata: {stop_chunk}\n\ndata: [DONE]\n\n").encode()


async def _fb_gate(call_id: str, name: str, arguments: dict) -> bool:
    """Async gate: write pending.json, poll decision.json. Returns True=approve."""
    _FB_STATE_DIR.mkdir(parents=True, exist_ok=True)
    req_id = (call_id or "")[:36] or uuid.uuid4().hex[:16]
    hint   = _fb_hint(name, arguments)

    pend = _FB_STATE_DIR / "pending.json"
    dec  = _FB_STATE_DIR / "decision.json"
    dec.unlink(missing_ok=True)
    try:
        pend.write_text(json.dumps({"id": req_id, "tool": name, "hint": hint}))
    except Exception:
        return True

    loop     = asyncio.get_event_loop()
    deadline = loop.time() + _FB_TIMEOUT
    while loop.time() < deadline:
        if dec.exists():
            try:
                data = json.loads(dec.read_text())
                if data.get("id") == req_id:
                    pend.unlink(missing_ok=True)
                    dec.unlink(missing_ok=True)
                    return data.get("decision") == "once"
            except Exception:
                pass
        if not _fb_bridge_alive():
            break
        await asyncio.sleep(_FB_POLL)

    pend.unlink(missing_ok=True)
    return True  # timeout / bridge died → auto-approve


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


def _extract_rate_limit(flow: http.HTTPFlow) -> tuple[int | None, int | None, str | None]:
    """Read common rate-limit headers and normalize reset time to ISO when possible."""
    headers = flow.response.headers
    limit_raw = headers.get("x-ratelimit-limit") or headers.get("ratelimit-limit")
    remaining_raw = headers.get("x-ratelimit-remaining") or headers.get("ratelimit-remaining")
    reset_raw = headers.get("x-ratelimit-reset") or headers.get("ratelimit-reset")

    def _to_int(value: str | None) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except Exception:
            return None

    def _to_iso_reset(value: str | None) -> str | None:
        if value is None:
            return None

        # Unix seconds or milliseconds are common in rate-limit headers.
        try:
            numeric = int(value)
            if numeric > 10_000_000_000:
                dt = datetime.fromtimestamp(numeric / 1000, tz=timezone.utc)
            else:
                dt = datetime.fromtimestamp(numeric, tz=timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")
        except Exception:
            pass

        # Fall back to raw value (some providers return RFC1123 strings).
        return value

    return _to_int(limit_raw), _to_int(remaining_raw), _to_iso_reset(reset_raw)


def _extract_error(body: bytes) -> tuple[str | None, str | None]:
    """Extract error code/message from JSON or SSE error payloads."""
    try:
        parsed = json.loads(body)
        err = parsed.get("error")
        if isinstance(err, dict):
            code = err.get("code") or err.get("type")
            message = err.get("message")
            return str(code) if code is not None else None, str(message) if message is not None else None
        if isinstance(err, str):
            return None, err
    except Exception:
        pass

    # SSE error frames often look like: data: {"error": {...}}
    for line in body.split(b"\n"):
        line = line.strip()
        if not line.startswith(b"data:"):
            continue
        raw = line[len(b"data:"):].strip()
        if raw == b"[DONE]":
            continue
        try:
            chunk = json.loads(raw)
        except Exception:
            continue
        err = chunk.get("error") if isinstance(chunk, dict) else None
        if isinstance(err, dict):
            code = err.get("code") or err.get("type")
            message = err.get("message")
            return str(code) if code is not None else None, str(message) if message is not None else None
        if isinstance(err, str):
            return None, err

    return None, None


class CopilotCapture:
    def __init__(self):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        if flow.request.host not in CAPTURE_HOSTS:
            return
        if flow.request.path.split("?")[0] not in CAPTURE_PATHS:
            return

        # Stream ALL responses (CLI and VS Code) — forward chunks to the client
        # immediately while accumulating a copy for post-stream analysis.
        # NOTE: Streaming means we cannot block tool calls mid-stream; the
        # FlipBuddy gate below is for logging only until a non-streaming
        # interception architecture is implemented.
        flow.metadata["capture_chunks"] = []

        def _stream_chunk(chunk: bytes) -> bytes:
            flow.metadata["capture_chunks"].append(chunk)
            return chunk  # pass through unmodified

        flow.response.stream = _stream_chunk

    async def response(self, flow: http.HTTPFlow) -> None:
        if flow.request.host not in CAPTURE_HOSTS:
            return
        if flow.request.path.split("?")[0] not in CAPTURE_PATHS:
            return
        if flow.response is None:
            return

        source = _detect_source(flow)
        status = flow.response.status_code or 0
        body   = b"".join(flow.metadata.get("capture_chunks", []))

        # --- FlipBuddy gate (logging only while streaming is active) ---
        # Streaming is always enabled (see responseheaders), so chunks have
        # already been forwarded to the client by the time response() fires.
        # Tool call detection here is for observability; blocking requires a
        # different architecture (e.g. pause streaming at the tool_call chunk).
        if source == "cli" and status == 200 and _fb_bridge_alive():
            tool_calls = _extract_tool_calls(body)
            if tool_calls:
                tc = tool_calls[0]
                ctx.log.info(f"[FB] tool_call detected (stream already sent): name={tc.get('name')}")

        t_start = getattr(flow.request, "timestamp_start", None) or time.time()
        t_end = getattr(flow.response, "timestamp_start", None) or time.time()
        latency_ms = int((t_end - t_start) * 1000)

        model = _extract_model(flow)
        # body and source already set above
        usage = _parse_usage(body)
        rate_limit_limit, rate_limit_remaining, rate_limit_reset_at = _extract_rate_limit(flow)

        status = flow.response.status_code or 0
        error_code = None
        error_message = None
        if status >= 400:
            parsed_code, parsed_message = _extract_error(body)
            error_code = parsed_code or str(status)
            error_message = parsed_message or flow.response.reason

        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model": model,
            "prompt_tokens": usage.get("prompt_tokens") if usage else None,
            "completion_tokens": usage.get("completion_tokens") if usage else None,
            "total_tokens": usage.get("total_tokens") if usage else None,
            "latency_ms": latency_ms,
            "source": source,
            "rate_limit_limit": rate_limit_limit,
            "rate_limit_remaining": rate_limit_remaining,
            "rate_limit_reset_at": rate_limit_reset_at,
            "error_code": error_code,
            "error_message": error_message,
        }

        with OUTPUT_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")


addons = [CopilotCapture()]
