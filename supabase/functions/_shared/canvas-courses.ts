import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const FALLBACK: Record<string, number> = {
  Math: 21957,
  Reading: 21919,
  Spelling: 21919,
  'Language Arts': 21944,
  History: 21934,
  Science: 21970,
  Homeroom: 22254,
};

export async function getCourseIds(): Promise<Record<string, number>> {
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data } = await sb
      .from('system_config')
      .select('course_ids')
      .eq('id', 'current')
      .single();
    const fromDb = (data?.course_ids ?? {}) as Record<string, number>;
    return { ...fromDb, ...FALLBACK };
  } catch {
    return FALLBACK;
  }
}

export function subjectForCourseId(
  courseId: number,
  map: Record<string, number>,
): string | null {
  for (const [subject, id] of Object.entries(map)) {
    if (id === courseId) return subject;
  }
  return null;
}
