# Pacing → Canvas Pipeline: Developer README, Audit & Redesign Proposal

This is a documentation deliverable (no code changes). It covers:
1. **How the 4 systems work today** (developer README)
2. **Strengths / weaknesses / failure modes** (audit)
3. **A ground-up redesign** for a lesson-data input system that reliably drives pages, assignments, resources, and announcements.

---

## Part 1 — Developer README (current architecture)

### 1.1 Data model (source of truth)

```text
weeks (1) ──< pacing_rows (30/week = 6 subjects × 5 days)
                │
                ├── synthetic children (Fact Test, Study Guide) via is_synthetic + parent_row_id
                ├── deploy_log rows      (per action: page_deploy, assignment_deploy)
                └── announcements        (week_id FK)
content_map / content_map_registry  ── canonical lesson_ref → canvas_url / canonical_name
annual_pacing_master                ── year-level source of scope & sequence
system_config                       ── autoLogic flags, course IDs, quarter colors
teacher_memory / teacher_patterns   ── edit-capture used by memory-resolver
```

The `enforce_friday_rules` DB trigger is the last line of defense: it forces `create_assign=false` and clears `at_home` for Friday non-Test rows, blocks LA `Lesson` rows, blocks History/Science assignments. Synthetics bypass.

### 1.2 PacingEntryPage — the input surface
`src/pages/PacingEntryPage.tsx` (~1,400 LOC)

- **State**: `WeekData = Record<subject, Record<day, DayData>>` in local React state; risk score recomputed on every keystroke via `evaluateWeekRisk`.
- **Auto-derivation** on save (`buildInClass`, `buildAtHome`, `buildResourceRefs`):
  - `in_class` inferred from `subject + type + lesson_num` (e.g. Math Test → "Written Test 12").
  - `at_home` inferred with Math evens/odds parity, Reading workbook default; suppressed on Friday and for History/Science/LA/Spelling.
  - `resources` = generated lesson_refs (`Math_Lesson_117`, `HW_Evens`, `Math_PowerUp_{ch}`, reteaching bucket, etc.) joined against `content_map` → stored as JSON array `[{label,url,group}]`.
- **Persistence**: `weeks` upsert on `(quarter, week_num)`, then `pacing_rows` upsert on `(week_id, subject, day)`. Business rules re-applied client-side before the upsert, then re-enforced by the DB trigger.
- **Smart Paste**: Gemini via `pacing-parse` edge function converts pasted shorthand/photos to `WeekData`.
- **Ancillary**: subject reminders, subject resources (per-subject JSON), Homeroom/Newsletter feed pulled separately.

### 1.3 PacingViewerPage — the read model
`src/pages/PacingViewerPage.tsx` (211 LOC)

Read-only grid keyed on `useSystemStore().selectedMonth/selectedWeek`. Renders subject × day, joins latest `deploy_log(action=page_deploy)` for "page live" badges, exposes canvas_url links per cell. No writes.

### 1.4 PageBuilderPage — HTML generation & page deploy
`src/pages/PageBuilderPage.tsx` (~790 LOC)

- Pulls `pacing_rows` + `content_map` + latest `newsletters` row.
- **Together Logic**: Reading tab merges Reading + Spelling rows via `usePageBuilder.mergeReadingSpellingRows` (Reading is canonical owner; Spelling appended with `<br/>`).
- **HTML generation** (`src/lib/canvas-html.ts`): `generateCanvasPageHtml`, `generateHomeroomPageHtml`, `generateRedirectPageHtml` — deterministic DesignPLUS containers.
- **FPK validator** blocks deploy on critical schema issues.
- **Deploy path**: `sha256Hex(html)` → `canvas-deploy-page` edge function with `contentHash` (edge short-circuits with `NO_CHANGE` when hash matches last deploy). `deployWithRetry` gives 3 attempts with 1s/3s/8s backoff. Test mode fakes a Canvas URL. `logDeployHabit` writes to teacher memory.
- **Homepage guarantee**: every page deploy sends `setFrontPage: true, published: true`.

### 1.5 DeploymentWizard — the coordination layer
`src/components/DeploymentWizard.tsx` (~610 LOC)

Four sequential steps: (1) File Organizer, (2) Assignments, (3) Pages, (4) Announcements. Each has a `StepContract { load, validate, buildPreview, deploySelected, hasPendingChanges }`. `SafetyDiffModal` gates the deploy steps. Steps 2/3 embed `AssignmentsPage` / `PageBuilderPage` panels — the wizard is a shell, not a re-implementation.

### 1.6 Three-layer rule enforcement (mem://business-rules/three-layer-enforcement)
Builder (`assignment-build.ts` sets `skipReason`) → Edge function (`canvas-deploy-assignment` re-hydrates from DB, returns `BLOCKED`) → DB trigger (`enforce_friday_rules`). Every gated rule must pass all three; synthetics bypass via `is_synthetic=true`.

---

## Part 2 — Audit

### Strengths
- **Defense-in-depth** for Friday/LA/History/Science rules is genuine and correct.
- **Deterministic HTML + content hashing** makes page deploys idempotent and cheap (NO_CHANGE short-circuit).
- **Together Logic** cleanly preserves both Reading and Spelling lesson strings — no overwrite bug.
- **Retry with backoff** at both edge functions and `deployWithRetry` covers Canvas flakiness.
- **DB trigger** means even a rogue SQL insert can't produce a forbidden assignment.
- **Content-map decoupling** — pacing rows carry `lesson_ref` tokens, resolved to Canvas URLs at generation time, so file swaps don't require touching pacing rows.
- **Read/write separation**: Viewer is genuinely read-only; edits funnel through one entry surface.

### Weaknesses
1. **PacingEntryPage is a 1,400-line component** — state, derivation, autosave, smart-paste, calendar, risk, and DB shape are colocated. Testable units (`buildInClass`, `buildAtHome`, `buildResourceRefs`) are hidden inside the page file instead of `src/lib/`.
2. **Derivation runs at save time, not display time.** The UI shows what the user typed; the server stores a transformed version. Round-tripping (load → edit → save) can silently rewrite `in_class` because the "keep explicit values" heuristic is a regex (`/^\d+(\.\d+)?$/`).
3. **`content_map` matching is fragile.** `buildResourceRefs` emits hand-built tokens (`Math_Reteaching_L${pad}`, `HW_Evens`), and if `content_map` is missing that exact `lesson_ref` the row silently loses a resource. There's no "unresolved refs" diagnostic in the entry UI.
4. **Two overlapping systems select the active week**: `useSystemStore().selectedMonth/selectedWeek` (viewer/wizard) and the `PacingEntryPage` prop-driven `activeQuarter/activeWeek`. Drift is possible when the user is on `/pacing` vs `/viewer`.
5. **DeploymentWizard is aspirational.** Its "deploy" contract for Steps 2/3 currently returns hard-coded counts (`generated: assignments.length`) and only Step 4 actually mutates DB rows. Real deployment still happens on the embedded pages, so success/error state in the wizard summary can lie.
6. **`WeekData` shape is not the DB shape.** The page has to translate both directions and re-apply Friday/LA rules client-side before the trigger does. Two code paths for the same rule = drift risk (already visible: builder+edge+trigger have all three had to be edited historically to add a rule).
7. **No optimistic locking.** Two tabs saving the same week both call upsert on `(week_id, subject, day)`; last write wins with no version check. Not urgent for a single-user app, but automation writes to the same rows.
8. **Auto-derived `at_home` for Math** flips evens/odds by lesson-number parity — but if the teacher swaps HW day-to-day, the parity guess overwrites the explicit value only when the field is blank. It's correct today but subtle; a plain "auto" pill would help.
9. **Synthetic rows are generated in the builder, not the entry surface.** The teacher never sees the Study Guide row in `/pacing` — only in Assignments. This is fine, but audit/repair tooling has to know two shapes.
10. **CLT / No Class / holidays** all short-circuit different code paths (`instructional`, `create_assign`, `type='CLT Testing'`, `type='No Class'`, `type='-'`). A single "day mode" enum would be cleaner.
11. **Announcements aren't derived from pacing.** They're maintained in a parallel table, kept in sync by migrations and cron jobs, not by the entry flow. A teacher who changes a Math Test day in Pacing Entry doesn't automatically shift the "Midweek Reminder" phrasing.

### Potential failure points
| Failure | Trigger | Blast radius |
|---|---|---|
| Silent resource drop | `content_map` missing a `lesson_ref` the builder emits | Canvas page renders "resource not linked" |
| Round-trip rewrite | User types "Chapter 5" in `in_class`, saves, reloads — regex retains, but "5" alone would be replaced | Cell content changes on save |
| Wizard status lies | Step 2/3 stubbed contract | Teacher thinks deploy succeeded when it didn't |
| Trigger vs builder drift | Rule added to builder, not to trigger (or vice versa) | Forbidden assignment slips through, or valid one blocked |
| `selectedWeek` desync | Store vs prop double source | Viewer shows a different week than Entry |
| Canvas hash false-positive | `contentHash` matches but Canvas page was manually edited on Canvas | Deploy skipped, drift persists |
| Newsletter join staleness | PageBuilder always pulls the latest 1 newsletter row | Deploying a past week uses this-week's homeroom notes |

---

## Part 3 — Redesign proposal

**Goal:** one input surface produces one canonical sanitized dataset; every downstream artifact (pages, assignments, resources, announcements) is a *pure projection* of that dataset.

### 3.1 Guiding principles
1. **One shape, one direction.** UI edits a struct that IS the DB row — no `WeekData` ↔ `pacing_rows` translation.
2. **Derive at read time, not write time.** Store user intent; compute rendered fields in memoized selectors so reloads never mutate what the user typed.
3. **Rules live in exactly one place.** SQL trigger is authoritative; TS mirrors it via a *generated* module (or a shared JSON rule spec), not hand-copied logic.
4. **Every derived artifact is addressable and diffable.** Assignments, pages, announcements are views over `pacing_rows` + `content_map` + `newsletters` + `school_calendar` — never independently authored except newsletter prose.
5. **Resource resolution is explicit.** UI shows "3 refs resolved, 1 missing → click to map" instead of failing silently.

### 3.2 Proposed data flow

```text
                   ┌───────────────────────────┐
     user typing → │ PacingEntry (row editor)  │ ── writes rows 1:1 ──┐
                   └───────────────────────────┘                      │
                                                                       ▼
                                                          ┌────────────────────────┐
                                                          │ pacing_rows (canonical)│
                                                          │ + trigger enforcement  │
                                                          └────────────┬───────────┘
                                                                       │
       ┌────────────── selectors (pure, memoized) ────────────────────┤
       │                       │                    │                 │
       ▼                       ▼                    ▼                 ▼
 assignmentPlan()        pageModel()        announcementPlan()   resourceCoverage()
       │                       │                    │                 │
       ▼                       ▼                    ▼                 ▼
 canvas-deploy-        canvas-deploy-      canvas-post-         UI badges +
 assignment            page                announcement        content_map repair
```

### 3.3 Concrete changes

**A. Extract pure logic → `src/lib/pacing/`**
```
src/lib/pacing/
  types.ts          // PacingRow, DayMode, Subject, Type unions
  derive.ts         // buildInClass, buildAtHome, buildResourceRefs (from PacingEntryPage)
  rules.ts          // isAssignable(row) — mirrors SQL trigger, tested against it
  refs.ts           // token generators + resolver against content_map
  synthetic.ts      // math triple expansion (Fact Test + Study Guide)
  select.ts         // assignmentPlan / pageModel / announcementPlan / coverage
```
Each function is unit-testable and imported by both the entry page and the edge functions (via `_shared/pacing/*` duplicated file, kept in sync by a lint check — the existing `pacing-sanitize` comment already documents this pattern).

**B. Row-shaped UI state**
Replace `WeekData = Record<subject, Record<day, DayData>>` with `PacingRow[]` in state. The DaySubjectCard already edits per-cell; the parent just needs to key by `(subject, day)`. Save becomes `upsert(rows)` — no reshape.

**C. `day_mode` column**
Add `day_mode ENUM('instructional','clt','holiday','workday','no_class')` on `pacing_rows` and derive `instructional`, `create_assign` defaults, and calendar rendering from it. Collapses the current `type='CLT Testing'` / `type='-'` / `type='No Class'` scatter.

**D. Resource coverage panel**
In `/pacing` sidebar, render `resourceCoverage(week)` → list of `{ref, resolved: boolean, canvas_url?}` with a one-click "map this ref" that inserts into `content_map`. Missing refs stop being invisible.

**E. Selectors, not stubs, in DeploymentWizard**
Step contracts call the selectors above and return real counts. `buildPreview()` returns `assignmentPlan(week).length`; `deploySelected()` iterates and awaits real edge calls. Wizard becomes the *only* deploy path; PageBuilder/AssignmentsPage stay as focused editors, not deploy launchers.

**F. Rule parity check (CI)**
A vitest test that loads `rules.ts` and `enforce_friday_rules` SQL, feeds a matrix of `(subject, day, type)` combinations to both, and fails if outputs disagree. This kills the three-layer drift risk permanently.

**G. Announcement templates derive from plan**
Announcement bodies are Handlebars-style templates that receive `assignmentPlan(week)`. Changing a Math Test day in Pacing Entry automatically shifts the "Midweek Reminder" body on next render. Human editorial notes stay separate (newsletter prose).

**H. Content hash + Canvas ETag**
Extend the `contentHash` short-circuit to fetch Canvas `updated_at` before deploying — if the Canvas page has been edited since our last recorded deploy (drift), warn instead of NO_CHANGE. Prevents silent divergence from manual Canvas edits.

**I. Optimistic locking**
Add `pacing_rows.version int not null default 0`; upsert bumps it; UI reads it and refuses a write if the server version is newer. Protects automation vs user race.

### 3.4 What this buys
- **One canonical shape** eliminates the `WeekData` ↔ row translation and the client-side rule reapplication.
- **Selectors** make every downstream deploy a pure function of the DB — reproducible, testable, and diff-friendly.
- **Coverage panel** turns silent resource drops into a visible, one-click fix.
- **Rule parity test** collapses three sources of truth into one specification.
- **Real wizard contracts** make the deploy flow observable end-to-end.
- **Announcements-as-projection** eliminates the manual sync between pacing changes and reminder wording.

### 3.5 Migration path (non-breaking)
1. Introduce `src/lib/pacing/` and move existing helpers with re-exports; no behavior change.
2. Add `pacing_rows.day_mode` and `version` columns (nullable); backfill from `type`.
3. Add the rule-parity vitest; fix any current drift it surfaces.
4. Rewrite `PacingEntryPage` state to `PacingRow[]` behind a feature flag; keep the old page reachable until confirmed.
5. Wire `DeploymentWizard` Step 2/3 contracts to real selectors; delete stub returns.
6. Ship coverage panel; then announcement projection; then Canvas ETag drift check.

Each step is independently shippable and reversible.

---

*This plan is a documentation deliverable — approving it does not modify code. If you'd like, on approval I can proceed to implement any specific section (e.g. "extract to `src/lib/pacing/`" or "rule-parity vitest") as a follow-up build.*
