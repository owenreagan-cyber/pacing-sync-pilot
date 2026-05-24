import { supabase } from '@/integrations/supabase/client';
import type { PacingData } from '@/store/useSystemStore';
import { shouldDefaultCreateAssign } from './friday-rules';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

export interface UpsertResult {
  weekId: string;
  rowsUpserted: number;
}

/**
 * Persist a GAS pacing payload into Supabase (`weeks` + `pacing_rows`).
 * Finds or creates the matching week row, then upserts a row per
 * subject × day cell with conflict on (week_id, subject, day).
 */
export async function upsertPacingFromGAS(
  quarter: string,
  weekNum: number,
  pacing: PacingData,
): Promise<UpsertResult> {
  // 1) Find or create week
  const { data: weekRow, error: weekErr } = await supabase
    .from('weeks')
    .upsert(
      { quarter, week_num: weekNum } as any,
      { onConflict: 'quarter,week_num' },
    )
    .select('id')
    .single();

  if (weekErr || !weekRow) {
    throw new Error(weekErr?.message || 'Failed to upsert week');
  }
  const weekId = weekRow.id;

  // 2) Build pacing rows
  const rows: any[] = [];
  for (const [subject, cells] of Object.entries(pacing.subjects || {})) {
    if (!Array.isArray(cells)) continue;
    cells.forEach((cell, idx) => {
      const day = DAYS[idx];
      if (!day) return;
      const type = cell.isTest ? 'Test' : cell.isReview ? 'Review' : 'Lesson';
      rows.push({
        week_id: weekId,
        subject,
        day,
        lesson_num: cell.lessonNum || null,
        in_class: cell.value || null,
        type,
        create_assign: shouldDefaultCreateAssign(day, type),
        deploy_status: 'PENDING',
      });
    });
  }

  if (rows.length === 0) {
    return { weekId, rowsUpserted: 0 };
  }

  const { error: rowsErr } = await supabase
    .from('pacing_rows')
    .upsert(rows, { onConflict: 'week_id,subject,day' });

  if (rowsErr) throw new Error(rowsErr.message);

  return { weekId, rowsUpserted: rows.length };
}
