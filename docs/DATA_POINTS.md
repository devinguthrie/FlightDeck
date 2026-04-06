# AI Usage Dashboard — Data Points Reference

This document catalogs every data point that could be meaningful for measuring AI usage ROI.
Organized by: availability, source, and strategic value for answering "does this tool/skill help or hurt?"

---

## Tier 1: Available Today (VS Code Copilot Transcripts)

These are extracted from `.jsonl` transcript files in `AppData\Roaming\Code\User\workspaceStorage\*\GitHub.copilot-chat\transcripts\`.

| Field | Source | Type | Notes |
|---|---|---|---|
| `session_id` | `session.start` event | string | Unique per chat session |
| `session_started_at` | `session.start` timestamp | datetime | When the chat session opened |
| `session_ended_at` | Last event timestamp | datetime | Approximate — last recorded event |
| `session_duration_minutes` | Derived | float | `ended_at - started_at` |
| `copilot_version` | `session.start.data.copilotVersion` | string | Extension version |
| `vscode_version` | `session.start.data.vscodeVersion` | string | IDE version |
| `user_turns` | Count of `user.message` events | int | Number of prompts sent |
| `assistant_turns` | Count of `assistant.turn_start` events | int | **Primary proxy for premium requests** |
| `tool_calls_total` | Count of `tool.execution_start` events | int | All tool uses |
| `tool_calls_by_name` | `tool.execution_start.data.toolName` | map[string]int | e.g., `read_file: 12, semantic_search: 7` |
| `skills_activated` | `tool.execution_start` paths matching `SKILL.md` | string[] | e.g., `["azure-prepare", "plan-ceo-review"]` |
| `estimated_input_tokens` | Sum of all user message + tool arg content / 4 | int | **~Estimate only.** 4 chars/token rule. |
| `estimated_output_tokens` | Sum of all assistant message content / 4 | int | **~Estimate only.** |
| `estimated_total_tokens` | Derived | int | input + output |
| `message_count` | user_turns + assistant_turns | int | Total message volume |
| `tool_calls_per_turn` | tool_calls_total / assistant_turns | float | Agent mode density |

### Why These Matter
- `assistant_turns` ≈ premium requests consumed (most actionable quota metric)
- `tool_calls_per_turn` measures agent mode intensity — higher = more autonomous working
- `skills_activated` is the key variable for testing "does using skill X affect session cost?"
- `session_duration_minutes` captures "how long did this task take?" — combined with requests, gives cost-per-minute

---

## Tier 2: Derived / Calculated Metrics

Computed from Tier 1 data across sessions.

| Metric | Formula | Value |
|---|---|---|
| `daily_premium_requests` | Sum of `assistant_turns` grouped by calendar day | Daily quota burn |
| `requests_this_billing_cycle` | Sum since billing cycle start date | Monthly budget tracking |
| `requests_remaining` | plan_quota - requests_this_billing_cycle | Days until quota hit |
| `daily_burn_rate_Nd` | Average daily requests over last N days | Rolling average for projection |
| `projected_exhaustion_date` | today + (remaining / daily_burn_rate) | **The "when do I run out?" answer** |
| `estimated_cost_per_session` | (assistant_turns / plan_quota) × plan_monthly_cost | Dollar cost proxy per session |
| `tokens_per_request` | estimated_total_tokens / assistant_turns | Efficiency: tokens per premium request |
| `skill_usage_rate` | Sessions with skills / total sessions | What % of work uses skills |
| `tool_calls_per_session` | avg(tool_calls_total) | Baseline for agent intensity |
| `avg_session_duration` | avg(session_duration_minutes) | Time investment per session |

### ROI Metrics (requires quality ratings)
| Metric | Formula | Value |
|---|---|---|
| `quality_per_request` | avg(quality_rating) / avg(assistant_turns) × 100 | Core ROI score |
| `cost_efficiency` | quality_rating / estimated_cost_per_session | $-adjusted ROI |
| `skill_roi_delta` | quality_per_request(with_skill_X) - quality_per_request(without) | Does skill X improve ROI? |
| `tool_overhead_ratio` | tool_calls_total / assistant_turns | Extra requests per turn driven by tools |

---

## Tier 3: Requiring Manual Input (User-Provided)

These require a quick rating at the end of a session. High-value for ROI analysis — without them, quality is unmeasurable.

| Field | Input | Type | Notes |
|---|---|---|---|
| `quality_rating` | 1–5 star UI | int | Subjective output quality. Scale: 1=wasted time, 3=okay, 5=exactly what I needed |
| `task_completed` | Yes/Partial/No toggle | enum | Did the session achieve its goal? |
| `time_saved_estimate` | Minutes saved vs manual | int | Optional; useful for ROI calibration |
| `session_note` | Free text | string | Tag with project type, feature, debugging, etc. |
| `used_skills_intentionally` | Boolean | bool | Did you invoke a skill on purpose? |
| `context_quality` | 1–5 | int | How good was the context you provided? Useful for isolating your input quality from AI quality |

### Why Quality Rating is the Critical Investment
Without ratings, you can only answer "how much did I use it?" With ratings, you can answer:
- "When I use `plan-ceo-review`, does my quality per request go up or down?"
- "Do sessions with 20+ tool calls produce worse quality than sessions with 5?"
- "Is expensive (many requests) work better than cheap work?"

Even 30 days of daily ratings creates statistically meaningful patterns.

---

## Tier 4: Theoretically Available (Not Implemented in MVP)

| Data Point | Source | What's Needed |
|---|---|---|
| **Exact token counts** | VS Code extension intercept | Would require a local HTTPS proxy or VS Code extension that intercepts the Copilot API calls. Complex but exact. |
| **Model name per request** | VS Code extension / API | Can see Claude Sonnet requests vs GPT-4o by intercepting the API; tool_use_ids starting with `toolu_bdrk_` suggest Claude on Bedrock |
| **Suggestion acceptance rate** | VS Code Copilot telemetry | Available in VS Code extension logs but undocumented format; could parse `GitHub Copilot Log.log` files |
| **Inline completion count** | VS Code Copilot logs | VS Code logs show completion events; total completions per session |
| **Per-request latency** | Tool execution start/end timestamps | `tool.execution_start` + `tool.execution_complete` timestamps → tool latency |
| **Context file count** | `tool.execution_start` args for `read_file` | Which files were read → context footprint |
| **Copilot org-level metrics** | GitHub API (Business/Enterprise only) | Requires `read:org` scope on a Business/Enterprise org with 5+ seats |

### Model inference from tool_use_id (heuristic, unverified)
The `toolu_bdrk_` prefix in tool call IDs appears to indicate Claude served via AWS Bedrock, which is how GitHub Copilot serves Claude models. `chatcmpl-*` IDs appear in GPT-4o responses. This is not documented and may change.

---

## Tier 5: Not Accessible (Current Technical Limits)

| Data Point | Why Not Available |
|---|---|
| **Claude.ai Pro token usage** | No API, no local files, no export. Would require a browser extension that intercepts network traffic — out of scope for MVP |
| **Actual Copilot billing data** | GitHub does not expose individual billing via API — only visible at `github.com/settings/billing` |
| **Real-time token streaming counts** | Copilot streams responses; token counts are not written to transcript files. Would need to intercept the SSE stream |
| **Completion context window size** | Not in any accessible log |
| **Which inline completions were accepted** | VS Code telemetry sends this to GitHub but no local copy of acceptance events is kept |

---

## Data Point Priority for ROI Goal

The user's stated goal: *"understand when skills/harness are detrimental vs beneficial to getting the highest quality output for the lowest meaningful input"*

Priority stack:

```
HIGH PRIORITY (implement immediately)
├── assistant_turns          → premium requests proxy (denominator of ROI)
├── skills_activated         → the variable being tested  
├── quality_rating           → output quality (numerator of ROI)
└── task_completed           → binary success signal

MEDIUM PRIORITY (implement in week 2)
├── tool_calls_by_name       → understand what agent spent time on
├── session_duration         → time cost companion to request cost
├── estimated_tokens         → supplemental to requests
└── context_quality          → isolate your input from AI output quality

LOWER PRIORITY (if this project gets traction)
├── model inference          → understand which model is doing the work
├── suggestion_acceptance    → inline completion ROI  
├── latency per tool         → identify which skills/tools are slow
└── time_saved_estimate      → dollar ROI calculation
```

---

## Billing Cycle Reference

| Plan | Monthly Premium Requests | Cost | Cost per Request |
|---|---|---|---|
| Free | 50 | $0 | $0 (opportunity cost only) |
| Pro | 300 | $10/mo | ~$0.033/request |
| Pro+ | 1,500 | $39/mo | ~$0.026/request |
| Business | ~300/user | $19/user/mo | ~$0.063/request |
| Enterprise | ~300/user | $39/user/mo | ~$0.13/request |

**Note**: "Base model" requests (GPT-5 mini equivalent) do not count against the premium request quota. Only requests to premium models (Claude Sonnet, GPT-4o, Claude Opus, etc.) consume quota.

The VS Code Copilot transcript does not explicitly label which requests used premium vs base models. The `assistant_turns` count is an upper bound on premium requests — some turns may have used the base model if you switched models or used fallback.
