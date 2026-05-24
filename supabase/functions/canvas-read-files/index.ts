import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { listFiles } from '../_shared/canvas-api.ts';
import { getCourseIds } from '../_shared/canvas-courses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));
    const map = await getCourseIds();
    const requestedCourseId = body?.courseId;
    let courseIds: number[] = [];
    if (requestedCourseId !== undefined && requestedCourseId !== null && String(requestedCourseId).trim() !== "") {
      const parsed = Number(requestedCourseId);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return new Response(JSON.stringify({ ok: false, error: `Invalid courseId: ${requestedCourseId}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      courseIds = [Math.trunc(parsed)];
    } else {
      courseIds = Array.from(
        new Set(
          Object.values(map)
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      );
    }

    let total = 0;
    const errors: string[] = [];
    const results: Array<{
      courseId: number;
      count: number;
      files: Array<{
        id: number;
        display_name: string | null;
        filename: string | null;
        url: string | null;
        content_type: string | null;
        size: number | null;
        updated_at: string | null;
      }>;
      error?: string;
    }> = [];
    for (const courseId of courseIds) {
      try {
        const items = await listFiles(courseId);
        const courseFiles = items.map((f) => ({
          id: f.id,
          display_name: f.display_name ?? null,
          filename: f.filename ?? null,
          url: f.url ?? null,
          content_type: f.content_type ?? null,
          size: f.size ?? null,
          updated_at: f.updated_at ?? null,
        }));
        for (const f of items) {
          await sb.from('canvas_snapshots').upsert(
            {
              course_id: courseId,
              content_type: 'file',
              canvas_id: String(f.id),
              title: f.display_name ?? f.filename ?? null,
              body: null,
              metadata: {
                filename: f.filename,
                url: f.url,
                content_type: f.content_type,
                size: f.size,
                updated_at: f.updated_at,
              },
            },
            { onConflict: 'course_id,content_type,canvas_id' },
          );
          total++;
        }
        results.push({
          courseId,
          count: courseFiles.length,
          files: courseFiles,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`course ${courseId}: ${message}`);
        results.push({
          courseId,
          count: 0,
          files: [],
          error: message,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, total, courses: courseIds.length, errors, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
