/**
 * THALES OS — automation-morning-digest
 *
 * Runs Mon-Fri at 5:00 AM ET. Fetches today's pacing rows, asks Gemini for a
 * short encouraging brief, and emails the digest to ADMIN_EMAIL via Resend.
 */
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? 're_c1tpEyD8_NKFusih9vKVQknRAQfmFcWCv';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'Thales OS <onboarding@resend.dev>';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function todayDayName(): string {
  // ET-ish — relies on cron to fire in ET; weekday is consistent enough for matching pacing rows by `day`.
  return DAY_NAMES[new Date().getDay()];
}

async function generateBrief(rows: Array<Record<string, unknown>>): Promise<string> {
  if (!LOVABLE_API_KEY || rows.length === 0) return '';
  const lines = rows
    .map((r) => `${r.subject}: ${r.type ?? ''} ${r.lesson_num ?? ''} — ${r.in_class ?? ''}`.trim())
    .join('\n');
  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [
          { role: 'system', content: 'You are a warm assistant writing 2-3 encouraging sentences for a 4th-grade teacher about today\'s lessons. No fluff.' },
          { role: 'user', content: `Today's lessons:\n${lines}\n\nWrite a 2-3 sentence encouraging brief.` },
        ],
      }),
    });
    if (!resp.ok) return '';
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (_e) {
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const today = todayDayName();

    // Resolve admin email: env var takes priority, then fall back to system_config
    const { data: cfg } = await sb.from('system_config').select('admin_email').eq('id', 'current').single();
    const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || (cfg as { admin_email?: string } | null)?.admin_email || 'onboarding@resend.dev';

    const { data: rows, error } = await sb
      .from('pacing_rows')
      .select('subject, day, type, lesson_num, in_class, at_home')
      .eq('day', today);
    if (error) throw error;

    const aiSummary = await generateBrief(rows ?? []);

    const lessonsHtml = (rows ?? [])
      .filter((r) => (r.in_class ?? '').trim())
      .map((r) => `<li><b>${r.subject}</b> — ${r.type ?? ''} ${r.lesson_num ?? ''} ${r.in_class ?? ''}</li>`)
      .join('') || '<li><em>No lessons scheduled.</em></li>';

    const homeworkHtml = (rows ?? [])
      .filter((r) => (r.at_home ?? '').trim())
      .map((r) => `<li><b>${r.subject}</b> — ${r.at_home}</li>`)
      .join('') || '<li><em>No homework.</em></li>';

    const html = `
      <h2>Day Ahead — ${today}</h2>
      ${aiSummary ? `<p style="font-style:italic;border-left:3px solid #0065a7;padding-left:12px;color:#555;">${aiSummary}</p>` : ''}
      <h3>Lessons</h3>
      <ul>${lessonsHtml}</ul>
      <h3>Homework</h3>
      <ul>${homeworkHtml}</ul>
    `;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: recipients,
        subject: `🌅 Day Ahead — ${today}`,
        html,
      }),
    });
    const emailed = r.ok;
    if (!r.ok) console.error('Resend error', r.status, await r.text());

    await sb.from('deploy_logs').insert({
      type: 'morning-digest',
      subject: today,
      status: emailed ? 'OK' : 'WARN',
      message: `Morning digest for ${today}: ${(rows ?? []).length} rows, emailed=${emailed}, recipients=${recipients.length}`,
    });

    return new Response(JSON.stringify({ success: true, day: today, rows: rows?.length ?? 0, emailed, recipients: recipients.length, aiSummary }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('morning-digest error', e);
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
