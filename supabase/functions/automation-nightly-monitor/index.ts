/**
 * THALES OS — automation-nightly-monitor
 *
 * Runs nightly. Scans deploy_logs for ERROR/CRITICAL entries from the last
 * 24 hours and emails an alert via Resend if any are found.
 */
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'Thales OS <onboarding@resend.dev>';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Resolve admin email: env var takes priority, then fall back to system_config
    const { data: cfg } = await sb.from('system_config').select('admin_email').eq('id', 'current').single();
    const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || (cfg as { admin_email?: string } | null)?.admin_email || 'onboarding@resend.dev';

    const { data: logs, error } = await sb
      .from('deploy_logs')
      .select('id, type, subject, status, message, created_at')
      .in('status', ['ERROR', 'CRITICAL'])
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const failures = logs ?? [];
    let emailed = false;

    if (failures.length > 0 && RESEND_API_KEY) {
      const rows = failures
        .map((l) => `<tr><td>${new Date(l.created_at).toISOString()}</td><td>${l.status}</td><td>${l.type}</td><td>${l.subject ?? ''}</td><td>${(l.message ?? '').slice(0, 240)}</td></tr>`)
        .join('');
      const html = `
        <h2>🚨 Nightly Error Report — ${failures.length} failure(s) in last 24h</h2>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px;">
          <thead><tr><th>When</th><th>Status</th><th>Type</th><th>Subject</th><th>Message</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [ADMIN_EMAIL],
          subject: `🚨 Thales OS — ${failures.length} error(s) in last 24h`,
          html,
        }),
      });
      emailed = r.ok;
      if (!r.ok) console.error('Resend error', r.status, await r.text());
    }

    await sb.from('deploy_logs').insert({
      type: 'nightly-monitor',
      subject: null,
      status: failures.length > 0 ? 'WARN' : 'OK',
      message: `Nightly monitor: ${failures.length} critical failures in last 24h, emailed=${emailed}`,
    });

    return new Response(JSON.stringify({ success: true, failures: failures.length, emailed }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('nightly-monitor error', e);
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
