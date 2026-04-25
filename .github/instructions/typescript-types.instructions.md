---
description: "Use when creating new components, adding types, refactoring interfaces, or working with TypeScript in this project. Covers the canonical type hierarchy, import conventions, and component prop patterns."
applyTo: "src/**/*.ts,src/**/*.tsx"
---

# TypeScript Type Conventions

## Canonical Type Locations

All shared types live in `src/lib/`. Components **import** from there — they never redefine the same shape.

| Type | Source |
|------|--------|
| `DailyBucket`, `StatsResponse`, `SkillStats`, `MarginalQualityBucket`, `ToolCount`, `ToolLatency`, `ProxyStats`, `ProjectionPoint` | `@/lib/statsEngine` |
| `QuotaDataPoint`, `QuotaSummary`, `QuotaSnapshotRecord` | `@/lib/snapshotParser` |
| `ParsedSession`, `IntradayActivityBucket` | `@/lib/transcriptParser` |
| `Config` | `@/lib/storage` |
| `QualityRating`, `ModelLimit`, `SessionWithRating`, `RateLimitErrorSummary` | `@/lib/db` |

## Component Prop Rules

1. **Import, don't redefine.** If a shape exists in `lib/`, import it — don't copy it into the component.

2. **Use `Pick<>` when a component only needs a subset.** Keeps props honest about what's actually consumed and prevents test fixtures from needing unnecessary fields:
   ```typescript
   // Good — component only renders 4 fields of DailyBucket
   dailyBuckets: Pick<DailyBucket, "date" | "requests" | "sessions" | "toolCalls">[];

   // Bad — imports full type when only a subset is used
   dailyBuckets: DailyBucket[];
   ```

3. **Keep UI-only types local.** Types that only represent presentation state (`TimeWindow`, `RangeKey`, tab state, etc.) stay in the component file. Only push to `lib/` if two or more files need the same shape.

4. **Alias imports when renaming at the boundary:**
   ```typescript
   import type { IntradayActivityBucket as HourlyBucket } from "@/lib/transcriptParser";
   ```
   Prefer the canonical name in new code; alias only to avoid churning internal usages.

## Adding New Shared Types

- Add to the most specific `lib/` module (e.g., DB-layer types → `db.ts`, computation results → `statsEngine.ts`).
- Export with `export interface` or `export type`.
- Update this file's table above.

## Import Style

Always use `import type` for type-only imports:
```typescript
import type { DailyBucket, ProjectionPoint } from "@/lib/statsEngine";
import type { QuotaDataPoint } from "@/lib/snapshotParser";
```

## Type-Check

Run `npx tsc --noEmit` after any structural change. The project uses strict mode — zero errors is the bar.
