import { supabase } from '@/integrations/supabase/client';
import { COURSE_IDS } from './course-ids';

export interface SnapshotStats {
  total: number;
  byType: Record<string, number>;
  byCourse: Record<number, number>;
}

export interface LearnedPattern {
  pattern_type: string;
  pattern_key: string;
  pattern_value: { subject?: string; value?: string; count?: number } & Record<string, unknown>;
  confidence: number;
  occurrence_count: number;
  updated_at: string;
}

export async function fetchSnapshotStats(): Promise<SnapshotStats> {
  const { data, error } = await supabase
    .from('canvas_snapshots')
    .select('content_type,course_id');
  if (error) throw error;
  const byType: Record<string, number> = {};
  const byCourse: Record<number, number> = {};
  for (const r of data ?? []) {
    byType[r.content_type] = (byType[r.content_type] ?? 0) + 1;
    byCourse[r.course_id] = (byCourse[r.course_id] ?? 0) + 1;
  }
  return { total: data?.length ?? 0, byType, byCourse };
}

export async function fetchLearnedPatterns(): Promise<LearnedPattern[]> {
  const { data, error } = await supabase
    .from('canvas_patterns')
    .select('*')
    .order('confidence', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as LearnedPattern[];
}

export async function fetchLastSync(): Promise<{ at: string | null; status: string | null }> {
  const { data } = await supabase
    .from('deploy_log')
    .select('created_at,status')
    .eq('action', 'canvas-sync-nightly')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { at: data?.created_at ?? null, status: data?.status ?? null };
}

export async function fetchDetectedChanges(): Promise<
  Array<{ course_id: number; title: string | null; content_type: string; updated_at: string }>
> {
  const { data, error } = await supabase
    .from('canvas_snapshots')
    .select('course_id,title,content_type,updated_at')
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

export function subjectForCourseId(courseId: number): string {
  for (const [s, id] of Object.entries(COURSE_IDS)) {
    if (id === courseId) return s;
  }
  return `Course ${courseId}`;
}

export const CONNECTED_COURSES = Object.entries(COURSE_IDS)
  .filter(([s]) => s !== 'Spelling') // shares Reading id
  .map(([subject, id]) => ({ subject, id: id as number }));
