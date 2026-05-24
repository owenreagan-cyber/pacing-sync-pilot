/**
 * Canvas Brain — Suggestion Resolver
 * Read-only helpers that surface learned patterns to generators.
 * Generators MUST treat these as suggestions — hard business rules
 * (Friday, Together Logic, LA-only-CP/Test, etc.) always win.
 */
import { supabase } from '@/integrations/supabase/client';

export type PatternType =
  | 'assignment_naming'
  | 'page_section_order'
  | 'announcement_opener'
  | 'announcement_closer'
  | 'due_day_pattern'
  | 'file_naming';

export interface Suggestion {
  value: string;
  confidence: number; // 0..100
  count: number;
}

export async function getSuggestions(
  type: PatternType,
  subject: string,
  limit = 5,
): Promise<Suggestion[]> {
  const { data, error } = await supabase
    .from('canvas_patterns')
    .select('pattern_value,confidence,occurrence_count')
    .eq('pattern_type', type)
    .order('confidence', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data
    .map((row) => {
      const v = row.pattern_value as { subject?: string; value?: string };
      return {
        value: String(v?.value ?? ''),
        confidence: row.confidence,
        count: row.occurrence_count,
        _subject: v?.subject ?? '',
      };
    })
    .filter((s) => s._subject === subject && s.value.length > 0)
    .slice(0, limit)
    .map(({ value, confidence, count }) => ({ value, confidence, count }));
}

/**
 * Aggregate confidence: weighted average of top-confidence pattern per type.
 * Returns 0..100. Used by the dashboard "Style Confidence" stat.
 */
export async function getStyleConfidence(): Promise<{
  overall: number;
  byType: Record<string, number>;
}> {
  const { data } = await supabase
    .from('canvas_patterns')
    .select('pattern_type,confidence');
  if (!data || data.length === 0) return { overall: 0, byType: {} };
  const byType: Record<string, number[]> = {};
  for (const r of data) {
    (byType[r.pattern_type] ||= []).push(r.confidence);
  }
  const avgs: Record<string, number> = {};
  for (const [t, list] of Object.entries(byType)) {
    avgs[t] = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  }
  const all = Object.values(avgs);
  const overall = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : 0;
  return { overall, byType: avgs };
}
