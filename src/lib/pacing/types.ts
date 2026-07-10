/**
 * Canonical pacing types + shared constants.
 * Extracted from PacingEntryPage.tsx as part of the Step 1 refactor
 * ("Extract src/lib/pacing/"). Behavior is unchanged — this module
 * only relocates shapes so they can be imported by the entry page,
 * selectors, and edge-function-facing helpers.
 */

export const SUBJECTS = [
  'Math',
  'Reading',
  'Spelling',
  'Language Arts',
  'History',
  'Science',
] as const;

export type Subject = (typeof SUBJECTS)[number];

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
export type Day = (typeof DAYS)[number];

/**
 * The set of `type` values each subject exposes in the pacing entry UI.
 * Keep in sync with `SUBJECT_TYPES` originally declared inline in
 * PacingEntryPage.tsx.
 */
export const SUBJECT_TYPES: Record<Subject, string[]> = {
  Math:            ['Lesson', 'Investigation', 'Test', 'Fact Test', 'Study Guide', 'CLT Testing', 'No Class', '-'],
  Reading:         ['Lesson', 'Test', 'Checkout', 'CLT Testing', 'No Class', '-'],
  Spelling:        ['Lesson', 'Test', 'CLT Testing', 'No Class', '-'],
  'Language Arts': ['Lesson', 'CP', 'Test', 'CLT Testing', 'No Class', '-'],
  History:         ['Lesson', 'Test', 'CLT Testing', 'No Class', '-'],
  Science:         ['Lesson', 'Test', 'CLT Testing', 'No Class', '-'],
};

/**
 * DayData is the per-cell shape edited in the pacing entry grid.
 * It is NOT the DB row shape (that's `pacing_rows`) — the entry page
 * translates DayData → row at save time. The redesign proposal
 * eventually collapses these into one; for now we keep the existing
 * shape verbatim so this extraction is behavior-preserving.
 */
export interface DayData {
  type: string;
  lesson_num: string;
  in_class: string;
  at_home: string;
  resources: string;
  create_assign: boolean;
  hint_override?: 'evens' | 'odds' | 'none' | null;
}

export type WeekData = Record<string, Record<string, DayData>>;

export function emptyDay(): DayData {
  return {
    type: '',
    lesson_num: '',
    in_class: '',
    at_home: '',
    resources: '',
    create_assign: true,
    hint_override: null,
  };
}

export function initWeekData(): WeekData {
  const data: WeekData = {};
  for (const subj of SUBJECTS) {
    data[subj] = {};
    for (const day of DAYS) data[subj][day] = emptyDay();
  }
  return data;
}
