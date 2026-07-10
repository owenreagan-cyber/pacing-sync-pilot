/**
 * Client-side mirror of the assignment-creation rules enforced by the
 * `enforce_friday_rules` DB trigger and the canvas-deploy-assignment
 * edge function. See mem://business-rules/three-layer-enforcement —
 * these three sources must stay in sync.
 *
 * A vitest parity harness (`rules.test.ts`) enumerates the fixture
 * matrix in `rule-spec.json` and fails if `computeRule` output disagrees
 * with the expected SQL trigger behavior. If you edit the trigger, edit
 * the spec first; if you edit the spec, make sure `computeRule` still
 * matches.
 */

export const LA_ASSIGNABLE_TYPES = new Set(['CP', 'Classroom Practice', 'Test']);

export function isLanguageArtsAssignable(type: string | null | undefined): boolean {
  return LA_ASSIGNABLE_TYPES.has(type ?? '');
}

export interface RuleInput {
  subject: string;
  day: string;
  type: string | null;
  is_synthetic?: boolean | null;
}

export interface RuleOutput {
  /** Whether the DB trigger would leave `create_assign` true. */
  create_assign: boolean;
  /** Whether the DB trigger would blank `at_home`. */
  clear_at_home: boolean;
}

/**
 * Pure function form of `enforce_friday_rules`.
 *
 * Order of precedence (matches the SQL trigger exactly):
 *   1. `is_synthetic=true` short-circuits every rule (Math Triple children).
 *   2. `type = 'CLT Testing'` — always blocks, clears at_home.
 *   3. `day = 'Friday'` AND `type != 'Test'` — blocks, clears at_home.
 *   4. `subject = 'Language Arts'` AND type NOT IN (CP, Classroom Practice, Test) — blocks.
 *   5. `subject IN ('History','Science')` — blocks (pages/announcements still render).
 */
export function computeRule(row: RuleInput): RuleOutput {
  if (row.is_synthetic) {
    return { create_assign: true, clear_at_home: false };
  }
  const type = row.type ?? '';

  if (type === 'CLT Testing') {
    return { create_assign: false, clear_at_home: true };
  }

  let create_assign = true;
  let clear_at_home = false;

  if (row.day === 'Friday' && type !== 'Test') {
    create_assign = false;
    clear_at_home = true;
  }
  if (row.subject === 'Language Arts' && !LA_ASSIGNABLE_TYPES.has(type)) {
    create_assign = false;
  }
  if (row.subject === 'History' || row.subject === 'Science') {
    create_assign = false;
  }

  return { create_assign, clear_at_home };
}
