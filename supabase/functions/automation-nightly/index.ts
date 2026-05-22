import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { runWithRetry } from '../_shared/retry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CANVAS_BASE = (Deno.env.get('CANVAS_BASE_URL') ?? '').replace(/\/+$/, '');
const CANVAS_TOKEN = Deno.env.get('CANVAS_API_TOKEN')!;
const JOB_NAME = 'automation-nightly';

async function invokeFn(name: string, body: object) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const result = await runWithRetry(async () => {
    const report: Record<string, unknown> = {};

    // 1. file sync
    try {
      report.fileSync = await invokeFn('canvas-files-sync', {});
    } catch (e) {
      report.fileSync = { error: String(e) };
    }

    // 1b. refresh learned naming/folder patterns
    try {
      report.patternTraining = await invokeFn('canvas-pattern-train', {});
    } catch (e) {
      report.patternTraining = { error: String(e) };
    }

    // 1c. nightly dedup pass (mark only; destructive delete is manual)
    try {
      report.duplicateScan = await invokeFn('canvas-detect-duplicates', { deleteDuplicates: false });
    } catch (e) {
      report.duplicateScan = { error: String(e) };
    }

    // 1d. folder cleanup dry-run for safe scheduled visibility
    try {
      report.folderCleanupDryRun = await invokeFn('canvas-cleanup-folders', { dryRun: true });
    } catch (e) {
      report.folderCleanupDryRun = { error: String(e) };
    }

    // 2. repair mappings — verify auto-linked content_map files still exist
    let repaired = 0;
    const { data: maps } = await sb
      .from('content_map')
      .select('id, canvas_file_id, canvas_url')
      .eq('auto_linked', true)
      .not('canvas_file_id', 'is', null);
    for (const m of maps ?? []) {
      try {
        const r = await fetch(`${CANVAS_BASE}/api/v1/files/${m.canvas_file_id}`, {
          headers: { Authorization: `Bearer ${CANVAS_TOKEN}` },
        });
        await r.text();
        if (r.status === 404) {
          await sb.from('content_map').update({
            auto_linked: false,
            canvas_url: null,
            canvas_file_id: null,
          }).eq('id', m.id);
          repaired++;
        }
      } catch { /* skip */ }
    }
    report.mappingsRepaired = repaired;

    // 3. train memory — bump confidence on repeated patterns
    const { data: feedback } = await sb
      .from('teacher_feedback_log')
      .select('entity_type, action, after')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const counts = new Map<string, number>();
    for (const f of feedback ?? []) {
      const key = `${f.entity_type}:${f.action}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let trained = 0;
    for (const [key, count] of counts) {
      if (count < 2) continue;
      const { data: existing } = await sb.from('teacher_memory')
        .select('id, confidence, usage_count')
        .eq('category', 'feedback_pattern')
        .eq('key', key)
        .maybeSingle();
      if (existing) {
        const newConf = Math.min(1, Number(existing.confidence) + (1 - Number(existing.confidence)) * 0.3);
        await sb.from('teacher_memory').update({
          confidence: newConf,
          usage_count: existing.usage_count + count,
          last_used: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        await sb.from('teacher_memory').insert({
          category: 'feedback_pattern',
          key,
          value: { count },
          confidence: 0.3,
          usage_count: count,
          last_used: new Date().toISOString(),
        });
      }
      trained++;
    }
    report.memoryTrained = trained;

    // 4. health check
    const [{ count: orphans }, { count: failed }, { count: pending }] = await Promise.all([
      sb.from('files').select('*', { count: 'exact', head: true }).is('canvas_url', null),
      sb.from('deploy_log').select('*', { count: 'exact', head: true }).eq('status', 'ERROR').gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      sb.from('pacing_rows').select('*', { count: 'exact', head: true }).eq('deploy_status', 'PENDING'),
    ]);

    let score = 100;
    score -= Math.min(30, (orphans ?? 0) * 2);
    score -= Math.min(40, (failed ?? 0) * 5);
    score -= Math.min(20, (pending ?? 0));
    score = Math.max(0, score);

    await sb.from('system_health_snapshots').insert({
      score,
      orphan_files: orphans ?? 0,
      failed_deploys: failed ?? 0,
      pending_assignments: pending ?? 0,
      canvas_status: 'OK',
      details: report,
    });

    if (score < 70) {
      await sb.from('deploy_notifications').insert({
        level: 'warning',
        title: `Health score low: ${score}`,
        message: `${orphans} orphans, ${failed} failed deploys, ${pending} pending assignments.`,
      });
    }

    report.healthScore = score;
    return report;
  }, { jobName: JOB_NAME });

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: result.success ? 200 : 500,
  });
});
