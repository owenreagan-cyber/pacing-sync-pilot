/**
 * THALES OS — usePageBuilder
 *
 * Helper hook + pure utilities that the Page Builder screen uses to merge
 * pacing rows for the Reading + Spelling shared agenda page.
 *
 * MERGE CONTRACT (do NOT regress):
 *   - Reading and Spelling rows for the same day are NEVER overwritten.
 *   - Their lesson text is concatenated with a literal `<br/>` between them
 *     so specific strings like "Lesson 102" are preserved verbatim on the
 *     deployed Canvas page.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  filterTogetherPageRows,
  isTogetherSubject,
  TOGETHER_PAGE_OWNER,
} from '@/lib/together-logic';
import { callEdge } from '@/lib/edge';

export interface MergeableRow {
  day: string;
  subject: string;
  in_class: string | null;
  at_home: string | null;
  lesson_num: string | null;
  type: string | null;
  resources: string | null;
  canvas_url: string | null;
  canvas_assignment_id: string | null;
  object_id: string | null;
}

/** Concatenate two cell strings with `<br/>` — never overwrites either side. */
export function concatWithBr(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  if (left && right) return `${left}<br/>${right}`;
  return left || right || null;
}

/**
 * Merge Reading + Spelling rows for the same day into a single row whose
 * `in_class` and `at_home` fields are concatenated with `<br/>`. Reading
 * is the canonical owner — its metadata (canvas_url, type) wins on conflict
 * so the shared page stays linked to the Reading course.
 */
export function mergeReadingSpellingRows<T extends MergeableRow>(rows: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    if (!isTogetherSubject(r.subject)) continue;
    const list = buckets.get(r.day) ?? [];
    list.push(r);
    buckets.set(r.day, list);
  }

  const merged: T[] = [];
  // Pass-through rows for any non-Together subjects.
  for (const r of rows) {
    if (!isTogetherSubject(r.subject)) merged.push(r);
  }

  // Merge per-day. Reading row is ALWAYS the canonical base — its
  // lesson_num, canvas_url, type, and subject win. Spelling content is
  // appended to in_class / at_home via <br/>, but Spelling's lesson_num
  // must NEVER bleed onto the merged row (that would mislabel Reading
  // homework with Spelling's lesson number).
  for (const [_day, dayRows] of buckets) {
    if (dayRows.length === 0) continue;

    const reading = dayRows.find((r) => r.subject === TOGETHER_PAGE_OWNER);
    if (!reading) {
      // No Reading row for this day — pass Spelling rows through untouched
      // rather than promoting Spelling's lesson_num into a "Reading" slot.
      for (const r of dayRows) merged.push(r);
      continue;
    }

    // Only merge rows that share the same day as the Reading row.
    const sameDay = dayRows.filter((r) => r.day === reading.day);
    const others = sameDay.filter((r) => r !== reading);

    // In Class: bold subject labels
    const readingIC = reading.in_class?.trim()
      ? `<strong>Reading:</strong> ${reading.in_class.trim()}`
      : null;
    const spellingIC = others
      .map(r => r.in_class?.trim()
        ? `<strong>Spelling:</strong> ${r.in_class.trim()}`
        : null)
      .filter(Boolean).join('<br/>') || null;
    const inClass = [readingIC, spellingIC].filter(Boolean).join('<br/>') || null;

    // At Home: Spelling first, Reading second, both bold
    const spellingAH = others
      .map(r => {
        if (!r.in_class && !r.at_home && !r.lesson_num) return null;
        const content = r.at_home?.trim() ||
          (r.lesson_num ? `Spelling Lesson ${r.lesson_num}` : null);
        return content ? `<strong>Spelling:</strong> ${content}` : null;
      })
      .filter(Boolean).join('<br/>') || null;
    const readingAH = (() => {
      const content = reading.at_home?.trim() ||
        (reading.lesson_num ? `Lesson ${reading.lesson_num} Workbook and Comprehension` : null);
      return content ? `<strong>Reading:</strong> ${content}` : null;
    })();
    const atHome = [spellingAH, readingAH].filter(Boolean).join('<br/>') || null;
    // Spread reading FIRST, then explicitly re-assert lesson_num + day from
    // the Reading row so no later spread/field can overwrite them.
    merged.push({
      ...reading,
      in_class: inClass,
      at_home: atHome,
      lesson_num: reading.lesson_num,
      day: reading.day,
    });
  }
  return merged;
}

/**
 * Hook variant — memoizes the merged rows for the active subject.
 * For the Reading tab it merges Reading + Spelling using `<br/>`.
 */
export function usePageBuilder<T extends MergeableRow>(
  rows: T[],
  activeSubject: string,
) {
  return useMemo(() => {
    const filtered = filterTogetherPageRows(rows, activeSubject);
    if (activeSubject === TOGETHER_PAGE_OWNER) {
      return mergeReadingSpellingRows(filtered);
    }
    return filtered;
  }, [rows, activeSubject]);
}

/**
 * AI agenda enrichment — generates a 2-3 sentence parent-friendly preview
 * of the week's lessons using Gemini. Returns `''` while loading or on error.
 *
 * Pass the resulting `aiSummary` into `generateCanvasPageHtml(...)` so the
 * Canvas page renders the italic blue-bordered summary block under the banner.
 */
export function useAgendaSummary(
  subject: string,
  weekLabel: string | undefined,
  rows: MergeableRow[],
): { aiSummary: string; loading: boolean } {
  const [aiSummary, setAiSummary] = useState('');
  const [loading, setLoading] = useState(false);

  // Stable signature so we only refetch when meaningful content changes.
  const signature = useMemo(
    () =>
      JSON.stringify(
        rows
          .filter((r) => (r.in_class ?? '').trim())
          .map((r) => [r.day, r.type, r.lesson_num, r.in_class]),
      ),
    [rows],
  );

  useEffect(() => {
    let cancelled = false;
    if (!subject || !rows.length) {
      setAiSummary('');
      return;
    }
    setLoading(true);
    const lite = rows.map((r) => ({
      day: r.day,
      type: r.type,
      lesson_num: r.lesson_num,
      in_class: r.in_class,
      at_home: r.at_home,
    }));
    callEdge<{ summary: string }>('page-ai-summary', {
      subject,
      weekLabel,
      rows: lite,
    })
      .then((res) => {
        if (!cancelled) setAiSummary(res?.summary ?? '');
      })
      .catch(() => {
        if (!cancelled) setAiSummary('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, weekLabel, signature]);

  return { aiSummary, loading };
}
