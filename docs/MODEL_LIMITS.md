# Model Limits Tracking

FlightDeck now tracks and displays model API limits, rate limits, and constraint discoveries. This helps identify when and why you're hitting model limits during heavy usage.

## Data Captured

### Model Constraints (per model)
- **Context Window**: Maximum tokens the model can handle in a single request (e.g., 128k for Claude)
- **Max Output Tokens**: Maximum tokens the model can generate in a response
- **Requests Per Minute**: Rate limit for the API (e.g., 100 req/min)
- **Concurrent Requests**: Maximum parallel requests allowed
- **Discovered At**: When the limit was first recorded
- **Source**: Where the limit came from (API response, documentation, error discovery)

### Rate Limit Events
Automatically tracked when the API returns rate limit errors:
- **Timestamp**: When the limit was hit
- **Model**: Which model was being called
- **Error Code**: HTTP status (e.g., 429 Too Many Requests)
- **Error Message**: Details from API response
- **Rate Limit Remaining**: Requests remaining before reset (from response header)
- **Rate Limit Reset**: When the limit counter resets (from response header)

### Proxy Request Tracking
Enhanced tracking of all API calls with:
- Token counts (prompt, completion, total)
- Request latency
- Rate limit headers from responses
- Error codes and messages

## Database Schema

```sql
-- Model constraints discovered so far
CREATE TABLE model_limits (
  model_name            TEXT PRIMARY KEY,
  context_window_tokens INTEGER NOT NULL,
  max_output_tokens     INTEGER,
  requests_per_minute   INTEGER,
  concurrent_requests   INTEGER,
  discovered_at         TEXT NOT NULL,
  last_updated_at       TEXT NOT NULL,
  source                TEXT NOT NULL DEFAULT 'api'
);

-- Enhanced proxy request tracking
CREATE TABLE proxy_requests (
  id                    INTEGER PRIMARY KEY,
  ts                    TEXT NOT NULL,
  model                 TEXT NOT NULL,
  prompt_tokens         INTEGER,
  completion_tokens     INTEGER,
  total_tokens          INTEGER,
  latency_ms            INTEGER,
  source                TEXT NOT NULL,
  rate_limit_limit      INTEGER,
  rate_limit_remaining  INTEGER,
  rate_limit_reset_at   TEXT,
  error_code            TEXT,
  error_message         TEXT
);

-- Quota snapshots now include API rate limit info
CREATE TABLE quota_snapshots (
  ...existing fields...,
  api_rate_limit_limit    INTEGER,
  api_rate_limit_remaining INTEGER,
  api_rate_limit_reset_at TEXT
);
```

## API Endpoints

### GET /api/model-limits
Returns all discovered model constraints and recent rate limit errors.

**Response:**
```json
{
  "modelLimits": [
    {
      "modelName": "claude-3.5-sonnet",
      "contextWindowTokens": 200000,
      "maxOutputTokens": 4096,
      "requestsPerMinute": 50,
      "concurrentRequests": 5,
      "discoveredAt": "2026-04-20T10:30:00Z",
      "lastUpdatedAt": "2026-04-20T10:30:00Z",
      "source": "api"
    }
  ],
  "recentRateLimitErrors": [
    {
      "ts": "2026-04-20T12:15:00Z",
      "model": "claude-3.5-sonnet",
      "errorCode": "429",
      "errorMessage": "Too Many Requests",
      "rateLimitRemaining": 0,
      "rateLimitReset": "2026-04-20T12:16:00Z"
    }
  ],
  "lastUpdated": "2026-04-20T13:00:00Z"
}
```

### POST /api/model-limits
Record a discovered model limit.

**Request Body:**
```json
{
  "modelName": "claude-3.5-sonnet",
  "contextWindowTokens": 200000,
  "maxOutputTokens": 4096,
  "requestsPerMinute": 50,
  "concurrentRequests": 5,
  "source": "api"
}
```

### GET /api/proxy-requests
Returns all proxy requests and recent rate limit events.

**Response:**
```json
{
  "total": 142,
  "proxyRequests": [
    {
      "ts": "2026-04-20T12:10:00Z",
      "model": "claude-3.5-sonnet",
      "promptTokens": 500,
      "completionTokens": 200,
      "totalTokens": 700,
      "latencyMs": 1200,
      "source": "vscode",
      "rateLimitLimit": 50,
      "rateLimitRemaining": 23,
      "rateLimitResetAt": "2026-04-20T12:11:00Z",
      "errorCode": null,
      "errorMessage": null
    }
  ],
  "rateLimitErrors": [...],
  "lastUpdated": "2026-04-20T13:00:00Z"
}
```

### POST /api/proxy-requests
Record a proxy request with rate limit tracking.

**Request Body:**
```json
{
  "ts": "2026-04-20T12:10:00Z",
  "model": "claude-3.5-sonnet",
  "promptTokens": 500,
  "completionTokens": 200,
  "totalTokens": 700,
  "latencyMs": 1200,
  "source": "vscode",
  "rateLimitLimit": 50,
  "rateLimitRemaining": 23,
  "rateLimitResetAt": "2026-04-20T12:11:00Z",
  "errorCode": null,
  "errorMessage": null
}
```

## Integration Points

### For the VS Code Extension
When polling the Copilot API, capture response headers:
1. Extract rate limit headers (e.g., `x-ratelimit-*`)
2. Record them via `POST /api/proxy-requests` or `POST /api/model-limits`
3. Include error details if the request fails

**Example (TypeScript):**
```typescript
const response = await fetch(url, options);
const rateLimitLimit = response.headers.get('x-ratelimit-limit');
const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');

if (!response.ok && response.status === 429) {
  // Rate limit hit
  await recordRateLimitError({
    ts: new Date().toISOString(),
    model: 'current-model',
    errorCode: '429',
    errorMessage: 'Too Many Requests',
    rateLimitLimit: parseInt(rateLimitLimit || '0'),
    rateLimitRemaining: 0,
    rateLimitResetAt: response.headers.get('x-ratelimit-reset'),
  });
}
```

### For the MITM Proxy
When intercepting requests, record:
1. Request tokens (from OpenAI API response)
2. Rate limit headers from response
3. Any error responses (especially 429, 400 for context overflow)

### For Dashboard
The `ModelLimitsPanel` component displays:
1. Table of discovered model constraints
2. Timeline of rate limit events with details
3. Trending data on limit hits

Add to `page.tsx`:
```tsx
import { ModelLimitsPanel } from "@/components/ModelLimitsPanel";

export default function Page() {
  return (
    <div>
      {/* ...existing components... */}
      <ModelLimitsPanel />
    </div>
  );
}
```

## When Limits Are Hit

Common scenarios that trigger limit tracking:

1. **Context Window Exceeded** (400 error)
   - Error message: "context_length_exceeded" or similar
   - Action: Record with `contextWindowTokens` from error

2. **Rate Limit** (429 error)
   - Response headers: `x-ratelimit-remaining`, `x-ratelimit-reset`
   - Action: Automatically tracked from response headers

3. **Concurrent Request Limit**
   - Connection refused or 503 Service Unavailable
   - Action: Record discovered limit if detectable

4. **Output Token Limit** (400 error)
   - Error message references max_tokens or output limit
   - Action: Record discovered `maxOutputTokens`

## Data Location

- **Database**: `~/.ai-usage/sessions.db` (tables: `model_limits`, `proxy_requests`)
- **Raw proxy data**: `~/.ai-usage/proxy-requests.jsonl`
- **API Response**: Via dashboard at `/api/model-limits` and `/api/proxy-requests`

## Best Practices

1. **Record limits when discovered**, not speculatively
2. **Include source** (api, documentation, error) for traceability
3. **Keep rate limit headers** from API responses for debugging
4. **Monitor trends** - if rate limit errors spike, workload may have changed
5. **Use context saturation** (from sessions) together with context window limits to predict when overflow will occur

## Future Enhancements

- [ ] Automatic alerts when limits are approached (80% of quota)
- [ ] Predictive warnings based on current burn rate
- [ ] Model comparison chart (context windows, throughput limits)
- [ ] Rate limit projection (when will reset occur?)
- [ ] Integration with Copilot pricing tiers
