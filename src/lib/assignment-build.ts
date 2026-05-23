/**
 * THALES OS — Assignment Payload Builder
 * Resolves a pacing cell into a deployable Canvas assignment payload.
 * Encapsulates: prefix lookup, course routing (Together Logic), group/points,
 * Friday + History/Science skip rules, due date mapping, description HTML
 * with auto-linked content_map references.
 */
import type { AppConfig } from './config';
import type { PacingCell } from '@/store/useSystemStore';
import { generateAssignmentTitle, resolveAssignmentGroup } from './assignment-logic';
import { injectFileLinks, type ContentMapEntry } from './auto-link';
import { getCourseId } from './course-ids';
import { isFridayHomeworkBlocked, FRIDAY_SKIP_REASON } from './friday-rules';
import { resolve as resolveMemory } from './memory-resolver';

export interface BuiltAssignment {
  rowKey: string;
  subject: string;
  day: string;
  dayIndex: number;
  lessonNum: string;
  type: string;
  title: string;
  description: string;
  points: number;
  gradingType: 'percent' | 'pass_fail';
  assignmentGroup: string;
  courseId: number;
  dueDate: string | null; // YYYY-MM-DD
  omitFromFinal: boolean;
  contentHash: string;
  isSynthetic: boolean;
  skipReason: string | null;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

interface CanvasPayloadMatrix {
  points: number;
  gradingType: 'percent' | 'pass_fail';
  omitFromFinal: boolean;
}

function resolveCanvasPayloadMatrix(subject: string, type: string): CanvasPayloadMatrix {
  if (subject === 'Math' && type === 'Study Guide') {
    return {
      points: 0,
      gradingType: 'pass_fail',
      omitFromFinal: true,
    };
  }

  return {
    points: 100,
    gradingType: 'percent',
    omitFromFinal: false,
  };
}

/**
 * SHA-256 hash of canonical assignment fields for change detection.
 */
export async function hashAssignment(parts: {
  title: string;
  description: string;
  points: number;
  group: string;
  dueDate: string | null;
}): Promise<string> {
  const raw = `${parts.title}|${parts.points}|${parts.group}|${parts.dueDate || ''}|${parts.description}`;
  const data = new TextEncoder().encode(raw);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Route subject → Canvas course id, applying Reading+Spelling Together Logic.
 */
export function resolveCourseId(subject: string, _config: AppConfig): number | null {
  // Hardcoded canonical IDs — Spelling routes to Reading via Together Logic
  return getCourseId(subject);
}

function buildDescription(
  subject: string,
  type: string,
  lessonNum: string,
  inClass: string,
  atHome: string,
  contentMap: ContentMapEntry[],
  options?: { isMondayTestStudyGuide?: boolean; readingTestPhrases?: string[]; hintOverride?: import('@/store/useSystemStore').HintOverride },
): string {
  const lines: string[] = [];

  if (subject === 'Math') {
    if (type === 'Test') {
      lines.push(`<p>Math Lesson <strong>${lessonNum}</strong> Written Test. Show all work.</p>`);
    } else if (type === 'Fact Test') {
      lines.push(`<p>Math Fact Test <strong>${lessonNum}</strong>. Complete in class.</p>`);
    } else if (type === 'Study Guide') {
      lines.push(`<p>Study Guide for Lesson <strong>${lessonNum}</strong>. Bring to class.</p>`);
      // Always link the canonical Study Guides folder (Math course 21957)
      const folderUrl = 'https://thalesacademy.instructure.com/courses/21957/files/folder/Study%20Guides';
      lines.push(
        `<p>📁 <a href="${folderUrl}" target="_blank" rel="noopener">Open Study Guides folder</a> — find <strong>Lesson ${lessonNum}</strong>.</p>`,
      );
      if (options?.isMondayTestStudyGuide) {
        lines.push(`<p><em>Note: distribute Friday prior so students can study over the weekend.</em></p>`);
      }
    } else {
      const hint = options?.hintOverride;
      let parityWord = '';
      if (hint === 'none') {
        parityWord = '';
      } else if (hint === 'evens') {
        parityWord = 'Evens';
      } else if (hint === 'odds') {
        parityWord = 'Odds';
      } else {
        parityWord = lessonNum && parseInt(lessonNum) % 2 === 0 ? 'Evens' : 'Odds';
      }
      lines.push(
        parityWord
          ? `<p>Complete Lesson <strong>${lessonNum}</strong> ${parityWord}. Show all work.</p>`
          : `<p>Complete Lesson <strong>${lessonNum}</strong>. Show all work.</p>`,
      );
    }
  } else if (subject === 'Reading') {
    if (type === 'Test') {
      lines.push(`<p>Reading Mastery Test <strong>${lessonNum}</strong>.</p>`);
      const phrases = options?.readingTestPhrases ?? [];
      if (phrases.length > 0) {
        lines.push(
          `<ul>${phrases.map((p) => `<li>${p}</li>`).join('')}</ul>`,
        );
      }
    } else {
      lines.push(`<p>Reading Lesson <strong>${lessonNum}</strong> homework.</p>`);
    }
  } else if (subject === 'Spelling') {
    lines.push(`<p>Spelling Test <strong>${lessonNum}</strong>.</p>`);
  } else if (subject === 'Language Arts') {
    lines.push(
      type === 'Test'
        ? `<p>Shurley English Test.</p>`
        : `<p>Shurley English Classroom Practice <strong>${lessonNum}</strong>.</p>`,
    );
  }

  if (inClass) lines.push(`<p><em>In class:</em> ${inClass}</p>`);
  if (atHome) lines.push(`<p><em>At home:</em> ${atHome}</p>`);

  let html = lines.join('\n');
  html = injectFileLinks(html, contentMap, subject);
  return html;
}

export interface BuildContext {
  config: AppConfig;
  contentMap: ContentMapEntry[];
  weekDates: string[]; // length 5, YYYY-MM-DD per day
}

/**
 * Math Triple Logic — expand a single Math row into deployable assignments.
 *
 * Contract:
 *  - Test row → 3 items: Written Test (same day), Fact Test (same day, synthetic),
 *    Study Guide (due previous day, synthetic, omit from final).
 *  - Lesson row → 1 item with auto-derived "Evens HW" / "Odds HW" title.
 *  - Monday Test edge case: Study Guide cannot fall on Sunday — clamps to same
 *    day (index 0) with note that it should have been distributed Friday prior.
 */
export async function expandMathRow(
  dayIndex: number,
  cell: PacingCell,
  ctx: BuildContext,
): Promise<BuiltAssignment[]> {
  const out: BuiltAssignment[] = [];

  if (cell.isTest) {
    const test = await buildAssignmentForCell('Math', dayIndex, cell, ctx, { type: 'Test' });
    if (test) out.push(test);

    const fact = await buildAssignmentForCell('Math', dayIndex, cell, ctx, {
      type: 'Fact Test',
      isSynthetic: true,
    });
    if (fact) out.push(fact);

    // Study Guide due previous weekday. If Monday Test, clamp to same day.
    const sgOffset = dayIndex > 0 ? -1 : 0;
    const sg = await buildAssignmentForCell('Math', dayIndex, cell, ctx, {
      type: 'Study Guide',
      isSynthetic: true,
      dayOffset: sgOffset,
    });
    if (sg) out.push(sg);

    return out;
  }

  // Standard Math homework — title auto-resolves to Evens/Odds via parity
  const hw = await buildAssignmentForCell('Math', dayIndex, cell, ctx);
  if (hw) out.push(hw);
  return out;
}

export async function buildAssignmentForCell(
  subject: string,
  dayIndex: number,
  cell: PacingCell,
  ctx: BuildContext,
  options?: { type?: string; titleOverride?: string; isSynthetic?: boolean; dayOffset?: number },
): Promise<BuiltAssignment | null> {
  const { config, contentMap, weekDates } = ctx;
  const auto = config.autoLogic;
  const lessonNum = cell.lessonNum || '';
  const type = options?.type || (cell.isTest ? 'Test' : 'Lesson');
  const isSynthetic = options?.isSynthetic ?? false;
  const day = DAYS[dayIndex];
  const effectiveDayIndex = dayIndex + (options?.dayOffset ?? 0);
  const dueDate = weekDates[effectiveDayIndex] || null;

  const courseId = resolveCourseId(subject, config);
  if (!courseId) return null;

  const prefix = config.assignmentPrefixes[subject] || '';
  const hintOverride = cell.hint_override ?? null;
  const title =
    options?.titleOverride ||
    (await resolveMemory(
      'assignment_name',
      `${subject}:${type}:${hintOverride ?? 'auto'}`,
      () => generateAssignmentTitle(subject, type, lessonNum, prefix, hintOverride),
      { lessonNum },
    ));
  const groupInfo = resolveAssignmentGroup(subject, type);
  const payloadMatrix = resolveCanvasPayloadMatrix(subject, type);

  // Skip rules — Friday rule is MANDATORY (not gated by config flag)
  let skipReason: string | null = null;
  if (isFridayHomeworkBlocked(day, type)) {
    skipReason = FRIDAY_SKIP_REASON;
  }
  // History/Science: never create assignments (mandatory rule, not flag-gated)
  if (subject === 'History' || subject === 'Science') {
    skipReason = `${subject} — no assignments`;
  }
  // Language Arts — only CP / Classroom Practice / Test produce assignments
  if (subject === 'Language Arts' && !['CP', 'Classroom Practice', 'Test'].includes(type)) {
    skipReason = 'LA — only CP and Test create assignments';
  }
  if (cell.isNoClass) skipReason = 'No class';

  const isMondayTestStudyGuide =
    subject === 'Math' && type === 'Study Guide' && dayIndex === 0 && (options?.dayOffset ?? 0) === 0;
  const description = buildDescription(
    subject,
    type,
    lessonNum,
    cell.value || '',
    '',
    contentMap,
    {
      isMondayTestStudyGuide,
      readingTestPhrases: config.autoLogic?.readingTestPhrases ?? [],
      hintOverride,
    },
  );

  const contentHash = await hashAssignment({
    title,
    description,
    points: payloadMatrix.points,
    group: groupInfo.groupName,
    dueDate,
  });

  return {
    rowKey: `${subject}_${dayIndex}_${type}_${lessonNum}_${isSynthetic ? 'syn' : 'org'}`,
    subject,
    day,
    dayIndex,
    lessonNum,
    type,
    title,
    description,
    points: payloadMatrix.points,
    gradingType: payloadMatrix.gradingType,
    assignmentGroup: groupInfo.groupName,
    courseId,
    dueDate,
    omitFromFinal: payloadMatrix.omitFromFinal,
    contentHash,
    isSynthetic,
    skipReason,
  };
}

/**
 * Format YYYY-MM-DD into ET-friendly "Mon, Apr 14 · 11:59 PM ET"
 */
export function formatDueET(date: string | null): string {
  if (!date) return '—';
  try {
    const d = new Date(`${date}T23:59:00-05:00`);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return `${fmt.format(d)} · 11:59 PM ET`;
  } catch {
    return date;
  }
}
