/**
 * Pure selectors over pacing_rows.
 *
 * These functions are the canonical bridge between what the teacher entered
 * (the DB rows) and what downstream surfaces need to render or deploy:
 *
 *   assignmentPlan     — which rows will produce Canvas assignments
 *   pageModel          — subject-filtered rows for the Canvas page renderer
 *   announcementPlan   — Test days per subject, used to derive reminder bodies
 *   resourceCoverage   — content_map coverage report for the current week
 *
 * All four are pure, memoizable, and unit-testable. Callers pass raw DB rows
 * in and get plain objects out — no fetches, no side effects.
 *
 * Introduced as part of the "Extract src/lib/pacing/" refactor
 * (see .lovable/plan.md).
 */

import type { ContentMapEntry } from '@/lib/auto-link';
import { filterTogetherPageRows } from '@/lib/together-logic';
import { buildAllResourceRefs } from './derive';

/** Minimal shape shared across selectors — matches `pacing_rows`. */
export interface PacingRowLike {
  id?: string;
  subject: string;
  day: string;
  type: string | null;
  lesson_num: string | null;
  is_synthetic?: boolean | null;
  create_assign?: boolean | null;
}

// ── assignmentPlan ──────────────────────────────────────────────────────────

export interface AssignmentPlanItem {
  rowId: string | undefined;
  subject: string;
  day: string;
  type: string;
  lessonNum: string;
  willDeploy: boolean;
  skipReason: string | null;
}

/**
 * Shallow, synchronous preview of which rows will result in Canvas
 * assignments. Mirrors the assignment-build.ts guards but without building
 * the full payload (no title / description / hash). Use this for counts
 * and gating in the wizard; use `buildAssignmentForCell` when you need
 * an actual deploy payload.
 */
export function assignmentPlan(rows: PacingRowLike[]): AssignmentPlanItem[] {
  return rows.map((r) => {
    const type = (r.type ?? '').trim();
    const lessonNum = (r.lesson_num ?? '').trim();
    const { subject, day } = r;

    let willDeploy = true;
    let skipReason: string | null = null;

    if (!type || type === '-' || type === 'No Class') {
      willDeploy = false; skipReason = 'No class';
    } else if (type === 'CLT Testing') {
      willDeploy = false; skipReason = 'CLT Testing';
    } else if (day === 'Friday' && type !== 'Test') {
      willDeploy = false; skipReason = 'Friday — Tests only';
    } else if (subject === 'History' || subject === 'Science') {
      willDeploy = false; skipReason = `${subject} — no assignments`;
    } else if (subject === 'Language Arts' && !['CP', 'Classroom Practice', 'Test'].includes(type)) {
      willDeploy = false; skipReason = 'LA — CP/Test only';
    } else if (subject === 'Spelling' && !type.toLowerCase().includes('test')) {
      willDeploy = false; skipReason = 'Spelling — Test only';
    }

    // create_assign=false on a non-synthetic row is authoritative — the DB
    // trigger sets it whenever a rule fires, so honor it here too.
    if (r.create_assign === false && !r.is_synthetic) {
      willDeploy = false;
      skipReason = skipReason ?? 'create_assign=false';
    }

    return { rowId: r.id, subject, day, type, lessonNum, willDeploy, skipReason };
  });
}

// ── pageModel ───────────────────────────────────────────────────────────────

/**
 * Subject-filtered rows for the Canvas page renderer. Delegates to
 * `filterTogetherPageRows` so Reading pulls in Spelling under Together Logic.
 */
export function pageModel<T extends { subject: string }>(rows: T[], subject: string): T[] {
  return filterTogetherPageRows(rows, subject);
}

// ── announcementPlan ────────────────────────────────────────────────────────

export interface AnnouncementPlanItem {
  day: string;
  subject: string;
  type: string;
  lessonNum: string;
  label: string;
}

/**
 * Every Test in the week, in day order. Announcement bodies are built by
 * downstream templates over this list.
 */
export function announcementPlan(rows: PacingRowLike[]): AnnouncementPlanItem[] {
  const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  return rows
    .filter((r) => (r.type ?? '').toLowerCase().includes('test'))
    .map((r) => ({
      day: r.day,
      subject: r.subject,
      type: r.type ?? '',
      lessonNum: r.lesson_num ?? '',
      label: `${r.subject} ${r.type}${r.lesson_num ? ` ${r.lesson_num}` : ''}`,
    }))
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.subject.localeCompare(b.subject));
}

// ── resourceCoverage ────────────────────────────────────────────────────────

export interface ResourceCoverageItem {
  ref: string;
  resolved: boolean;
  canvas_url: string | null;
  canonical_name: string | null;
  subject: string | null;
}

/**
 * Per-week content_map coverage report. Every lesson_ref emitted by the
 * derivation helpers is checked against the loaded content_map — resolved
 * entries have a canvas_url; missing ones show up in the coverage panel
 * so the teacher can map them before deploy.
 */
export function resourceCoverage(
  rows: PacingRowLike[],
  contentMap: ContentMapEntry[],
): ResourceCoverageItem[] {
  const refs = buildAllResourceRefs(
    rows.map((r) => ({ subject: r.subject, type: r.type, lesson_num: r.lesson_num })),
  );
  const byRef = new Map<string, ContentMapEntry>();
  for (const c of contentMap) {
    if (c.lesson_ref) byRef.set(c.lesson_ref, c);
  }
  return Array.from(refs)
    .sort()
    .map((ref) => {
      const match = byRef.get(ref);
      return {
        ref,
        resolved: Boolean(match?.canvas_url),
        canvas_url: match?.canvas_url ?? null,
        canonical_name: match?.canonical_name ?? null,
        subject: match?.subject ?? null,
      };
    });
}
