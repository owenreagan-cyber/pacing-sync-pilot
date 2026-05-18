import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { runWithRetry } from '../_shared/retry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JOB_NAME = 'automation-friday-deploy';
const COURSE_IDS: Record<string, number> = {
  Math: 21957,
  Reading: 21919,
  Spelling: 21919,
  LA: 21944,
  'Language Arts': 21944,
  History: 21934,
  Science: 21970,
  Homeroom: 22254,
};

const QUARTER_ORDER = ['Q1', 'Q2', 'Q3', 'Q4'];

interface PacingRowRecord {
  id: string;
  week_id: string;
  subject: string;
  day: string;
  date: string;
  type: string | null;
  lesson_num: number | null;
  lesson_title: string | null;
  in_class: string | null;
  create_assign: boolean;
  assignment_title: string | null;
  assignment_group: string | null;
  points: number | null;
  grading_type: string | null;
}

function buildTitle(row: PacingRowRecord): string {
  if (row.assignment_title?.trim()) return row.assignment_title.trim();
  const lessonLabel = row.lesson_num ?? row.lesson_title ?? '';
  return `${row.subject} ${lessonLabel}`.trim();
}

function previousSchoolDueDate(row: PacingRowRecord): string {
  if (row.day === 'Monday') return row.date;
  const d = new Date(`${row.date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getNextWeek(weeks: { id: string; quarter: string; week_num: number }[], currentId?: string) {
  const sorted = [...weeks].sort((a, b) => {
    const q = QUARTER_ORDER.indexOf(a.quarter) - QUARTER_ORDER.indexOf(b.quarter);
    return q !== 0 ? q : a.week_num - b.week_num;
  });
  if (!currentId) return sorted[0];
  const idx = sorted.findIndex((w) => w.id === currentId);
  if (idx === -1 || idx + 1 >= sorted.length) return null;
  return sorted[idx + 1];
}

async function invokeFn(name: string, body: object) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  let targetWeekId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    targetWeekId = body.weekId ?? null;
  } catch { /* ignore */ }

  const result = await runWithRetry(async () => {
    // pick next week
    const { data: weeks, error: wErr } = await sb.from('weeks').select('id, quarter, week_num');
    if (wErr) throw wErr;

    let nextWeek;
    if (targetWeekId) {
      nextWeek = weeks?.find((w) => w.id === targetWeekId);
    } else {
      // assume "current" is the most recently updated week
      let { data: cur } = await sb.from('weeks').select('id').eq('is_active', true).maybeSingle();
      if (!cur?.id) {
        const fb = await sb.from('weeks').select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
        cur = fb.data ?? null;
      }
      nextWeek = getNextWeek(weeks ?? [], cur?.id);
    }
    if (!nextWeek) throw new Error('No next week found');

    // load pacing rows
    const { data: rows, error: rErr } = await sb
      .from('pacing_rows')
      .select('*')
      .eq('week_id', nextWeek.id);
    if (rErr) throw rErr;

    const pacingRows = (rows ?? []) as PacingRowRecord[];
    const subjects = Array.from(new Set(pacingRows.map((r) => r.subject)));
    const log: Record<string, unknown> = { weekId: nextWeek.id, subjects: {} };

    for (const subject of subjects) {
      const subjectLog: Record<string, unknown> = { page: null, assignments: [], announcements: 0 };
      try {
        // deploy page
        subjectLog.page = await invokeFn('canvas-deploy-page', { weekId: nextWeek.id, subject });

        // deploy assignments
        const subjectRows = pacingRows.filter((r) => r.subject === subject && r.create_assign);
        for (const row of subjectRows) {
          const rowType = String(row.type || '').toLowerCase();
          const isTest = rowType.includes('test');
          const courseId = COURSE_IDS[row.subject];

          if (!courseId) {
            (subjectLog.assignments as unknown[]).push({ rowId: row.id, ok: false, error: `Unknown course for subject ${row.subject}` });
            continue;
          }

          if (row.subject === 'History' || row.subject === 'Science') continue;
          if (row.subject === 'Spelling' && !isTest) continue;
          if (row.subject === 'Language Arts' || row.subject === 'LA') {
            const upper = String(row.type || '').toUpperCase();
            if (!upper.includes('CP') && !upper.includes('TEST') && !upper.includes('CLASSROOM PRACTICE')) continue;
          }

          const payloads: Array<Record<string, unknown>> = [];
          const baseTitle = buildTitle(row);
          const baseDescription = `<p>${row.in_class || baseTitle}</p>`;

          if (row.subject === 'Math' && isTest) {
            payloads.push({
              rowId: row.id,
              weekId: row.week_id,
              subject: row.subject,
              courseId,
              title: `Math Lesson ${row.lesson_num ?? ''} Written Test`.trim(),
              description: `<p>Math Lesson <strong>${row.lesson_num ?? ''}</strong> Written Test. Show all work.</p>`,
              points: 100,
              gradingType: 'points',
              assignmentGroup: 'Written Assessments',
              dueDate: row.date,
              day: row.day,
              type: 'Test',
              isSynthetic: false,
            });
            payloads.push({
              weekId: row.week_id,
              subject: row.subject,
              courseId,
              title: `Math Fact Test ${row.lesson_num ?? ''}`.trim(),
              description: `<p>Math Fact Test <strong>${row.lesson_num ?? ''}</strong>. Complete in class.</p>`,
              points: 100,
              gradingType: 'points',
              assignmentGroup: 'Fact Assessments',
              dueDate: row.date,
              day: row.day,
              type: 'Fact Test',
              isSynthetic: true,
            });
            payloads.push({
              weekId: row.week_id,
              subject: row.subject,
              courseId,
              title: `Math Study Guide ${row.lesson_num ?? ''}`.trim(),
              description: `<p>Study Guide for Lesson <strong>${row.lesson_num ?? ''}</strong>. Bring to class.</p>`,
              points: 0,
              gradingType: 'pass_fail',
              assignmentGroup: 'Homework/Class Work',
              dueDate: previousSchoolDueDate(row),
              day: row.day,
              type: 'Study Guide',
              isSynthetic: true,
              omitFromFinal: true,
            });
          } else {
            payloads.push({
              rowId: row.id,
              weekId: row.week_id,
              subject: row.subject,
              courseId,
              title: baseTitle,
              description: baseDescription,
              points: row.points ?? undefined,
              gradingType: row.grading_type ?? undefined,
              assignmentGroup: row.assignment_group ?? undefined,
              dueDate: row.date,
              day: row.day,
              type: row.type ?? undefined,
              isSynthetic: false,
            });
          }

          for (const payload of payloads) {
            try {
              const a = await invokeFn('canvas-deploy-assignment', payload);
              (subjectLog.assignments as unknown[]).push({ rowId: row.id, ok: true, result: a, title: String(payload.title || '') });
            } catch (e) {
              (subjectLog.assignments as unknown[]).push({ rowId: row.id, ok: false, error: String(e), title: String(payload.title || '') });
            }
          }
        }

        // schedule announcements (Mon 7AM, Wed 4PM, Fri 4PM ET defaults)
        const now = new Date();
        const announcements = [
          { type: 'WEEK_AHEAD', dayOffset: 0, hour: 21 },   // Fri 4PM ET (deploy day)
          { type: 'MIDWEEK',    dayOffset: 5, hour: 21 },   // Wed 4PM ET
          { type: 'WEEKEND',    dayOffset: 7, hour: 21 },   // Fri 4PM ET
        ];
        for (const a of announcements) {
          const scheduled = new Date(now);
          scheduled.setDate(scheduled.getDate() + a.dayOffset);
          scheduled.setUTCHours(a.hour, 0, 0, 0);
          await sb.from('announcements').insert({
            week_id: nextWeek.id,
            subject,
            type: a.type,
            status: 'DRAFT',
            scheduled_post: scheduled.toISOString(),
            title: `${subject} — ${a.type}`,
            content: `Auto-generated ${a.type} announcement for ${subject}.`,
          });
          subjectLog.announcements = (subjectLog.announcements as number) + 1;
        }
      } catch (e) {
        subjectLog.error = String(e);
      }
      (log.subjects as Record<string, unknown>)[subject] = subjectLog;
    }

    await sb.from('deploy_log').insert({
      action: JOB_NAME,
      status: 'DEPLOYED',
      week_id: nextWeek.id,
      message: `Deployed ${subjects.length} subjects for week ${nextWeek.quarter}W${nextWeek.week_num}`,
      payload: log,
    });

    await sb.from('deploy_notifications').insert({
      level: 'info',
      title: 'Next week deployed',
      message: `${nextWeek.quarter}W${nextWeek.week_num}: ${subjects.length} subjects, pages + assignments + announcements scheduled.`,
      entity_ref: nextWeek.id,
    });

    // ===== Flush QUEUED newsletters → Homeroom course (22254) =====
    const newsletterResults: Array<{ id: string; ok: boolean; error?: string }> = [];
    try {
      const { data: queued, error: nErr } = await sb
        .from('newsletters')
        .select('id, date_range, html_content')
        .eq('status', 'QUEUED');
      if (nErr) throw nErr;

      for (const n of queued ?? []) {
        try {
          if (!n.html_content) {
            newsletterResults.push({ id: n.id, ok: false, error: 'empty html_content' });
            continue;
          }
          const slug = `newsletter-${(n.date_range ?? 'latest').replace(/\s+/g, '-').toLowerCase()}`;
          await invokeFn('canvas-deploy-page', {
            subject: 'Homeroom',
            courseId: 22254,
            pageUrl: slug,
            pageTitle: `Newsletter — ${n.date_range ?? 'Latest'}`,
            bodyHtml: n.html_content,
            published: true,
          });
          await sb
            .from('newsletters')
            .update({ status: 'DEPLOYED', posted_at: new Date().toISOString() })
            .eq('id', n.id);
          newsletterResults.push({ id: n.id, ok: true });
        } catch (e) {
          newsletterResults.push({ id: n.id, ok: false, error: String(e) });
        }
      }
      (log as Record<string, unknown>).newsletters = newsletterResults;
    } catch (nErr) {
      console.error('newsletter flush error', nErr);
      (log as Record<string, unknown>).newsletters_error = String(nErr);
    }

    // ===== Admin email summary via Resend =====
    try {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? 'onboarding@resend.dev';
      const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'Pacing Bot <onboarding@resend.dev>';

      if (RESEND_API_KEY) {
        const succeeded: string[] = [];
        const failed: { subject: string; error: string }[] = [];
        for (const [subj, info] of Object.entries(log.subjects as Record<string, unknown>)) {
          const infoRecord = (info && typeof info === 'object') ? (info as Record<string, unknown>) : null;
          if (infoRecord?.error) failed.push({ subject: subj, error: String(infoRecord.error) });
          else succeeded.push(subj);
        }

        const html = `
          <h2>Friday Sync — ${nextWeek.quarter}W${nextWeek.week_num}</h2>
          <p><strong>Succeeded (${succeeded.length}):</strong> ${succeeded.join(', ') || '—'}</p>
          <p><strong>Failed (${failed.length}):</strong></p>
          <ul>${failed.map(f => `<li><b>${f.subject}</b>: ${f.error}</li>`).join('') || '<li>None</li>'}</ul>
        `;

        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [ADMIN_EMAIL],
            subject: `Friday Sync ${nextWeek.quarter}W${nextWeek.week_num} — ${succeeded.length} ok / ${failed.length} failed`,
            html,
          }),
        });
        if (!r.ok) console.error('Resend email failed:', r.status, await r.text());
      } else {
        console.warn('RESEND_API_KEY not set — skipping admin notification');
      }
    } catch (mailErr) {
      console.error('Admin email error:', mailErr);
    }

    return log;
  }, { jobName: JOB_NAME });

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: result.success ? 200 : 500,
  });
});
