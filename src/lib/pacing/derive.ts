/**
 * Pure derivations for pacing-row fields.
 *
 * These take a DayData (user intent + hints) and produce the sanitized
 * strings stored in `pacing_rows` — `in_class`, `at_home`, and the
 * `resources` lesson_ref tokens that get resolved against `content_map`.
 *
 * Extracted from PacingEntryPage.tsx as part of the Step 1 refactor.
 * Behavior is identical to the previous inline implementations.
 */

import { POWER_UP_MAP } from '@/lib/power-up-map';
import type { DayData } from './types';

/** Build the "In Class" cell — infers from subject + type + lesson_num. */
export function buildInClass(subject: string, d: DayData): string | null {
  const explicit = (d.in_class || '').trim();
  // Keep explicit values that aren't bare numbers
  if (explicit && !/^\d+(\.\d+)?$/.test(explicit)) return explicit;
  const n = (d.lesson_num || '').trim();
  if (!n) return explicit || null;
  switch (subject) {
    case 'Math': {
      const t = (d.type || '').toLowerCase();
      if (t === 'test') return `Written Test ${n}`;
      if (t === 'fact test') return `Fact Test ${n}`;
      if (t === 'study guide') return `Study Guide ${n}`;
      if (t === 'investigation') return `Investigation ${n}`;
      return `Lesson ${n}`;
    }
    case 'Reading': return `Reading Lesson ${n}`;
    case 'Spelling': return `Spelling Lesson ${n}`;
    case 'Language Arts': {
      const dot = n.match(/^(\d+)\.(\d+)$/);
      if (dot) return `Chapter ${dot[1]}, Lesson ${dot[2]}`;
      return explicit || `Chapter ${n}`;
    }
    case 'History':
    case 'Science': return explicit || `Chapter ${n}`;
    default: return explicit || `Lesson ${n}`;
  }
}

/** Build the "At Home" cell — Friday and select subjects always null. */
export function buildAtHome(subject: string, d: DayData, isFriday: boolean): string | null {
  if (isFriday) return null;
  const explicit = (d.at_home || '').trim();
  if (explicit) return explicit;
  // No at_home for these (History, Science, ELA, Spelling handled via page)
  if (['History', 'Science', 'Language Arts', 'Spelling'].includes(subject)) return null;
  const type = (d.type || '').toLowerCase();
  if (!type || type === '-' || type === 'no class' || type.includes('test') ||
      type.includes('review') || type.includes('study guide')) return null;
  const n = (d.lesson_num || '').trim();
  if (!n) return null;
  if (subject === 'Math') {
    const hint = d.hint_override;
    if (hint === 'none') return `Lesson ${n}`;
    if (hint === 'evens') return `Lesson ${n} Evens`;
    if (hint === 'odds') return `Lesson ${n} Odds`;
    const num = parseInt(n);
    return `Lesson ${n} ${isNaN(num) ? '' : num % 2 === 0 ? 'Evens' : 'Odds'}`.trim();
  }
  if (subject === 'Reading') return `Lesson ${n} Workbook`;
  return null;
}

/**
 * Build the list of `lesson_ref` tokens for a single day/subject cell.
 * Tokens are resolved against `content_map` at save time (by the entry
 * page) and at page-render time (by canvas-html).
 */
export function buildResourceRefs(subject: string, d: DayData): string[] {
  const n = (d.lesson_num || '').trim();
  const num = parseInt(n);
  const refs: string[] = [];
  if (!n || isNaN(num)) return refs;
  const pad3 = String(num).padStart(3, '0');
  const pad2 = String(num).padStart(2, '0');
  if (subject === 'Math' && d.type !== 'Test') {
    refs.push('HW_Evens', 'HW_Odds', 'Math_Textbook', `Math_Lesson_${pad3}`);
    if (POWER_UP_MAP[num]) refs.push(`Math_PowerUp_${POWER_UP_MAP[num]}`);
    const rStart = Math.floor((num - 1) / 10) * 10 + 1;
    refs.push(`Math_Reteaching_L${String(rStart).padStart(3, '0')}`);
  }
  if (subject === 'Math' && d.type === 'Test') {
    refs.push(`Math_StudyGuide_${pad2}_Blank`, `Math_StudyGuide_${pad2}_Completed`);
  }
  if (subject === 'Reading') {
    const chunk = Math.floor((num - 1) / 25) * 25 + 1;
    refs.push(
      `Reading_Book_L${String(chunk).padStart(3, '0')}`,
      'Reading_Workbook_Part1', 'Reading_Workbook_Part2',
      'Reading_Glossary_A', 'Reading_Glossary_B', 'Reading_Glossary_C',
      'Spelling_Master_List',
    );
  }
  if (subject === 'Language Arts' &&
      (d.type === 'CP' || d.type === 'Classroom Practice')) {
    refs.push(`Classroom_Practice_${pad3}`);
  }
  return refs;
}

/**
 * Aggregate helper — returns the union of every `lesson_ref` token across
 * a set of persisted row-like objects. Used by the entry page's
 * "sync resources" flow to know which content_map entries are relevant.
 */
export function buildAllResourceRefs(
  rows: Array<{ subject?: string; type?: string | null; lesson_num?: string | null }>,
): Set<string> {
  const refs = new Set<string>();
  for (const row of rows) {
    const n = row.lesson_num;
    if (!n) continue;
    const num = parseInt(n);
    if (isNaN(num)) continue;
    const pad3 = String(num).padStart(3, '0');
    if (row.subject === 'Math' && row.type !== 'Test') {
      refs.add('HW_Evens'); refs.add('HW_Odds'); refs.add('Math_Textbook');
      refs.add(`Math_Lesson_${pad3}`);
      if (POWER_UP_MAP[num]) refs.add(`Math_PowerUp_${POWER_UP_MAP[num]}`);
      const reteachStart = Math.floor((num - 1) / 10) * 10 + 1;
      refs.add(`Math_Reteaching_L${String(reteachStart).padStart(3, '0')}`);
    }
    if (row.subject === 'Math' && row.type === 'Test') {
      const pad2 = String(num).padStart(2, '0');
      refs.add(`Math_StudyGuide_${pad2}_Blank`);
      refs.add(`Math_StudyGuide_${pad2}_Completed`);
    }
    if (row.subject === 'Reading') {
      const chunkStart = Math.floor((num - 1) / 25) * 25 + 1;
      refs.add(`Reading_Book_L${String(chunkStart).padStart(3, '0')}`);
      refs.add('Reading_Workbook_Part1'); refs.add('Reading_Workbook_Part2');
      refs.add('Reading_Glossary_A'); refs.add('Reading_Glossary_B'); refs.add('Reading_Glossary_C');
      refs.add('Spelling_Master_List');
    }
    if (row.subject === 'Language Arts' && row.type === 'CP') {
      refs.add(`Classroom_Practice_${pad3}`);
    }
  }
  return refs;
}
