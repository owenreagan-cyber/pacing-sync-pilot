/**
 * THALES OS — Assignment Logic Engine
 * FIX 6: Language Arts CP Rule
 * FIX 8: Spelling Test Only Rule
 * 
 * Assignment Grading Rules (2025–2026):
 *  • ALL assignments: 100 points possible (viewed as percentage)
 *  • Grading type: 'points' by default, EXCEPT Study Guides → 'pass_fail'
 *  • Submission: 'on_paper' (all subjects)
 *  • Math Study Guide: 0 points, pass_fail, omit_from_final_grade
 *  • Grading weight: calculated by points_possible (100pts) and group weights
 */

/**
 * Optional override for auto-derived hints on a row.
 * - 'evens' / 'odds' force the parity suffix on Math HW titles regardless of lesson number parity.
 * - 'none' suppresses the parity suffix entirely (title becomes "HW — Lesson N").
 * - undefined / null falls back to lesson_num parity.
 */
export type HintOverride = 'evens' | 'odds' | 'none' | null | undefined;

function spellingTestNum(lessonNum: string): string {
  const n = parseInt(lessonNum);
  if (isNaN(n)) return lessonNum;
  // Each test covers 5 lessons: Test 1 = L1-5, Test 22 = L106-110, etc.
  return String(Math.ceil(n / 5));
}

export function generateAssignmentTitle(
  subject: string,
  type: string,
  lessonNum: string | null,
  prefix: string,
  hintOverride?: HintOverride,
): string {
  const num = lessonNum || '';

  switch (subject) {
    case 'Math':
      // Canonical 2025-2026 Math title formats:
      //   SM5: Lesson N Evens / Odds / Test / Fact Test / Study Guide / Investigation
      if (type === 'Test') return `${prefix} Lesson ${num} Test`;
      if (type === 'Fact Test') return `${prefix} Lesson ${num} Fact Test`;
      if (type === 'Study Guide') return `${prefix} Lesson ${num} Study Guide`;
      if (type === 'Investigation') return `${prefix} Lesson ${num} Investigation`;
      if (hintOverride === 'none') return `${prefix} Lesson ${num}`;
      if (hintOverride === 'evens') return `${prefix} Lesson ${num} Evens`;
      if (hintOverride === 'odds') return `${prefix} Lesson ${num} Odds`;
      if (num && parseInt(num) % 2 === 0) return `${prefix} Lesson ${num} Evens`;
      return `${prefix} Lesson ${num} Odds`;

    case 'Reading':
      if (type === 'Test') return `${prefix} Mastery Test ${num}`;
      if (type === 'Checkout') return `${prefix} Reading Checkout ${num}`;
      return `${prefix} Reading HW ${num}`;

    case 'Spelling':
      if (type === 'Test') return `${prefix} Spelling Test ${spellingTestNum(num)}`;
      return `${prefix} Spelling ${num}`;

    case 'Language Arts':
      if (type === 'Test') return `${prefix} Shurley Test`;
      if (type === 'CP' || type === 'Classroom Practice') return `${prefix} Shurley English Classroom Practice ${num}`;
      return `${prefix} English ${num}`;

    default:
      return `${subject} ${type} ${num}`.trim();
  }
}

export interface AssignmentGroupInfo {
  groupName: string;
  points: number;
  gradingType: string;
  omitFromFinal: boolean;
}

/**
 * Resolve assignment group metadata: title, points, grading type, and final grade inclusion.
 * 
 * UNIVERSAL GRADING RULES (2025–2026):
 *  • points_possible: 100 (ALL assignments)
 *  • grading_type: 'points' (default) | 'pass_fail' (Math Study Guide only)
 *  • omit_from_final_grade: true (Math Study Guide) | false (all others)
 * 
 * Math Special Cases:
 *  • Written Test: 100pts, points, Written Assessments, not omitted
 *  • Fact Test: 100pts, points, Fact Assessments, not omitted
 *  • Study Guide: 0pts (displayed as pass/fail), pass_fail, Homework/Class Work, OMITTED FROM FINAL
 *  • Lesson HW: 100pts, points, Homework/Class Work, not omitted
 */
export function resolveAssignmentGroup(subject: string, type: string): AssignmentGroupInfo {
  const isTest = type.toLowerCase().includes('test');

  switch (subject) {
    case 'Math':
      if (type === 'Study Guide') {
        // Math Study Guide: 0 points displayed, pass_fail grading, omit_from_final_grade
        return {
          groupName: 'Homework/Class Work',
          points: 0,
          gradingType: 'pass_fail',
          omitFromFinal: true,
        };
      }
      if (type === 'Fact Test') {
        return {
          groupName: 'Fact Assessments',
          points: 100,
          gradingType: 'points',
          omitFromFinal: false,
        };
      }
      if (isTest) {
        return {
          groupName: 'Written Assessments',
          points: 100,
          gradingType: 'points',
          omitFromFinal: false,
        };
      }
      // Regular Math lesson homework: 100pts
      return {
        groupName: 'Homework/Class Work',
        points: 100,
        gradingType: 'points',
        omitFromFinal: false,
      };

    case 'Reading':
      if (isTest) {
        return {
          groupName: 'Assessments',
          points: 100,
          gradingType: 'points',
          omitFromFinal: false,
        };
      }
      if (type === 'Checkout') {
        return {
          groupName: 'Check Out',
          points: 100,
          gradingType: 'points',
          omitFromFinal: false,
        };
      }
      return {
        groupName: 'Homework',
        points: 100,
        gradingType: 'points',
        omitFromFinal: false,
      };

    case 'Spelling':
      if (isTest) {
        return {
          groupName: 'Assessments',
          points: 100,
          gradingType: 'points',
          omitFromFinal: false,
        };
      }
      return {
        groupName: 'Homework',
        points: 100,
        gradingType: 'points',
        omitFromFinal: false,
      };

    case 'Language Arts':
      if (isTest) {
        return {
          groupName: 'Assessments',
          points: 100,
          gradingType: 'points',
          omitFromFinal: false,
        };
      }
      return {
        groupName: 'Classwork/Homework',
        points: 100,
        gradingType: 'points',
        omitFromFinal: false,
      };

    default:
      return {
        groupName: 'Assignments',
        points: 100,
        gradingType: 'points',
        omitFromFinal: false,
      };
  }
}

export function applyBrevity(subject: string, lessonNum: string | null, inClass: string): string {
  // Brevity Mandate: strip the verbose "Saxon Math" prefix from any input.
  const stripped = (inClass || '').replace(/saxon\s*math/gi, '').replace(/\s{2,}/g, ' ').trim();

  if (subject === 'Math') return `Lesson ${lessonNum || ''}`.trim();
  if (subject === 'Reading') return `Reading Lesson ${lessonNum || ''}`.trim();
  if (subject === 'Language Arts') {
    const chMatch = stripped.match(/Chapter\s*(\d+)/i);
    const lesMatch = stripped.match(/Lesson\s*(\d+)/i);
    if (chMatch && lesMatch) return `Chapter ${chMatch[1]}, Lesson ${lesMatch[1]}`;
    if (lesMatch) return `Lesson ${lesMatch[1]}`;
  }
  return stripped;
}

export async function computeContentHash(
  subject: string,
  day: string,
  type: string,
  lessonNum: string,
  inClass: string,
  atHome: string
): Promise<string> {
  const raw = `${subject}|${day}|${type}|${lessonNum}|${inClass}|${atHome}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getDriveDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export function getDrivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Returns true when a Math Investigation row sits on the school day immediately before a Math Test
 * in the same week. Used by the pacing UI to show a "Pre-Test SG will deploy" hint. The actual
 * Study Guide deployment is owned by Math Triple Logic in assignment-build.ts (keyed off the Test
 * row), so no extra build-time work is needed here — this helper is informational only.
 */
const SCHOOL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export function isInvestigationBeforeTest(
  day: string,
  rows: Array<{ subject: string; day: string; type: string | null }>,
): boolean {
  const idx = SCHOOL_DAYS.indexOf(day);
  if (idx < 0 || idx >= SCHOOL_DAYS.length - 1) return false;
  const nextDay = SCHOOL_DAYS[idx + 1];
  return rows.some(
    (r) => r.subject === 'Math' && r.day === nextDay && (r.type ?? '').toLowerCase() === 'test',
  );
}

// ============================================================================
// CANONICAL CANVAS ASSIGNMENT PAYLOAD BUILDER
// Enforces 2025-2026 universal rules:
//   • submission_types = ['on_paper']
//   • points_possible = 100 (ALL assignments, viewed as %)
//   • grading_type = 'points' (default) | 'pass_fail' (Math Study Guide only)
//   • due_at = 11:59 PM Eastern Time on the assignment's date
// ============================================================================

export interface CanvasAssignmentPayload {
  name: string;
  description: string;
  points_possible: number;
  grading_type: 'points' | 'pass_fail';
  submission_types: ['on_paper'];
  due_at: string; // ISO 8601 with ET offset
  assignment_group_name: string;
  omit_from_final_grade: boolean;
  published: boolean;
}

export interface BuildAssignmentInput {
  subject: string;
  type: string;
  lessonNum: string | null;
  prefix: string;          // e.g. "SM5:", "RM4:", "ELA4:"
  /** ISO date "YYYY-MM-DD" for the day this assignment is due */
  date: string;
  description?: string;
  hintOverride?: HintOverride;
}

/**
 * Convert a YYYY-MM-DD date into an ISO timestamp for 11:59 PM Eastern Time.
 * Honors EST (UTC-5) vs EDT (UTC-4) using a simple US DST window
 * (2nd Sun Mar → 1st Sun Nov), which is sufficient for K-12 scheduling.
 */
export function dueAt1159ET(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  // Compute whether this date falls inside US DST.
  const isDST = (() => {
    const dstStart = nthSundayOfMonth(y, 3, 2); // 2nd Sunday of March
    const dstEnd = nthSundayOfMonth(y, 11, 1);  // 1st Sunday of November
    const ymd = y * 10000 + m * 100 + d;
    const startYmd = y * 10000 + 3 * 100 + dstStart;
    const endYmd = y * 10000 + 11 * 100 + dstEnd;
    return ymd >= startYmd && ymd < endYmd;
  })();
  const offset = isDST ? '-04:00' : '-05:00';
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}T23:59:00${offset}`;
}

function nthSundayOfMonth(year: number, month: number, n: number): number {
  // month is 1-12
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstSunday = ((7 - firstDow) % 7) + 1;
  return firstSunday + (n - 1) * 7;
}

/**
 * Build a single Canvas assignment payload with universal rules enforced.
 * 
 * CRITICAL: Study Guide assignments have 0 points displayed (shown as pass/fail in Canvas).
 * All other assignments: 100 points, viewed as percentage.
 */
export function buildAssignmentPayload(input: BuildAssignmentInput): CanvasAssignmentPayload {
  const { subject, type, lessonNum, prefix, date, description = '', hintOverride } = input;
  const name = generateAssignmentTitle(subject, type, lessonNum, prefix, hintOverride);
  const group = resolveAssignmentGroup(subject, type);

  return {
    name,
    description,
    points_possible: group.points, // 0 for Study Guide, 100 for all others
    grading_type: group.gradingType, // 'pass_fail' for Study Guide, 'points' for all others
    submission_types: ['on_paper'],
    due_at: dueAt1159ET(date),
    assignment_group_name: group.groupName,
    omit_from_final_grade: group.omitFromFinal,
    published: true,
  };
}

/**
 * Build the deploy array for a single pacing row, applying Synthetic Sibling
 * logic for Math Tests:
 *   1. Math Written Test (100 pts, points)
 *   2. Math Fact Test (100 pts, points) — same date, synthetic
 *   3. Math Study Guide (0 pts, pass_fail, omit_from_final) — day before, synthetic
 *
 * Non-Math-Test rows return a single-element array.
 */
export function buildAssignmentBatch(input: BuildAssignmentInput): CanvasAssignmentPayload[] {
  const primary = buildAssignmentPayload(input);

  if (input.subject === 'Math' && input.type === 'Test') {
    const factTest = buildAssignmentPayload({ ...input, type: 'Fact Test' });
    const studyGuide = buildAssignmentPayload({ ...input, type: 'Study Guide' });
    return [primary, factTest, studyGuide];
  }

  return [primary];
}
