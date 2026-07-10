# Implement all four redesign pillars

Section A (Extract `src/lib/pacing/`) is already shipped. This plan covers the remaining three plus a small hardening pass on A.

## 1. Finish A — pure selectors on top of extracted modules
New file `src/lib/pacing/select.ts`:
- `assignmentPlan(rows, config)` → `Array<{ rowId, subject, day, type, lessonNum, title, points, dueAt?, skipReason? }>` — mirrors what `assignment-build.ts` computes today but as a pure function of DB rows + config. Includes Math Triple synthetic expansion.
- `pageModel(rows, subject)` → subject-filtered rows with Together Logic merge applied.
- `announcementPlan(rows, week)` → derived reminder bodies keyed on Test days.
- `resourceCoverage(rows, contentMap)` → `{ ref, resolved, canvas_url? }[]`, used by the coverage panel.

All four are pure, memoizable, unit-testable. No behavior change to existing pages yet — this just makes the projections addressable.

## 2. Rule-parity vitest
New `src/lib/pacing/rules.test.ts`:
- Import the SQL body of `enforce_friday_rules` from `supabase/migrations/*` (parsed to extract the logic) OR — simpler — encode both the TS rule and the SQL rule as a shared JSON matrix and assert TS matches.
- Approach: introduce `src/lib/pacing/rule-spec.json` — the single spec (subject × day × type → `{ createAssign, atHomeCleared }`). Both `rules.ts` and a new SQL comment block reference it. Vitest walks every cell of the spec and asserts `computeRule(row)` matches.
- Also add a follow-up TODO: regenerate the SQL trigger from the spec (out of scope for this ticket, but the spec unblocks it).

## 3. Resource coverage panel
- Wire `resourceCoverage()` into `PacingEntryPage`'s right sidebar as a collapsible card.
- Shows counts: `12 resolved · 3 missing`. Missing refs render as a list of chips with a "Map…" button that opens a popover with a `content_map` search-and-select, then upserts the mapping.
- Reuses existing `contentMap` state already loaded on the page — no new fetches.

## 4. Real wizard contracts
`src/components/DeploymentWizard.tsx`:
- Step 2 `buildPreview` → `assignmentPlan(rows, config).length` (real count, split by `skipReason`).
- Step 2 `deploySelected` → iterate the plan, `await useDeployAssignment.mutateAsync` per row, accumulate `{deployed, errors, blocked}` and surface them in the summary card.
- Step 3 `buildPreview` → count of subjects that have any non-empty row (`pageModel(rows, s).length > 0`).
- Step 3 `deploySelected` → call the same `canvas-deploy-page` path `PageBuilderPage` uses (extracted to a small helper `deploySubjectPage(subject, week, rows, ...)` so both surfaces share it — no logic duplication).
- Remove the hard-coded `assignments.length` / `SUBJECT_PAGE_KEYS.length` returns.

## Technical details
- Deploy helper extraction: move the FPK-validate → hash → invoke-with-retry sequence from `PageBuilderPage.handleDeploy` into `src/lib/pacing/deploy-page.ts`. `PageBuilderPage` and `DeploymentWizard` both consume it. Same for `deployAssignmentRow` from Assignments.
- No new DB migrations. No schema changes. `day_mode` column and optimistic locking (items C & I from the master plan) remain out of scope — they need dedicated migrations and can ship later without blocking this work.
- Types: reuse `PacingRow` from Supabase generated types; do NOT introduce a parallel shape.
- Tests: add unit tests for each selector; add integration test for `assignmentPlan` matching the current `AssignmentsPage` output on Q4W8 fixture data (guards against behavior drift).

## Order of operations
1. `deploy-page.ts` + `deploy-assignment.ts` helpers extracted from existing pages (pure refactor, no behavior change).
2. `select.ts` selectors + unit tests.
3. `rule-spec.json` + `rules.test.ts` parity matrix; fix any drift it reveals.
4. Coverage panel UI in `PacingEntryPage`.
5. Wire wizard step contracts to selectors + deploy helpers; delete stub returns.

Each step is independently commit-safe and independently reversible.

## Out of scope (deferred, tracked in `.lovable/plan.md`)
- `day_mode` enum column (C)
- Announcement templates driven by `assignmentPlan` (G)
- Canvas ETag drift check (H)
- Optimistic `version` column (I)

These need migrations and product decisions and will be separate tickets.
