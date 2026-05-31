/**
 * THALES OS — page-ai-summary
 * Generates a 2-3 sentence parent-friendly preview of the week's agenda
 * using Lovable AI (Gemini). Returns { summary: string }.
 */
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors';

interface RowLite {
  day: string;
  type: string | null;
  lesson_num: string | null;
  in_class: string | null;
  at_home: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { subject, weekLabel, rows } = (await req.json()) as {
      subject: string;
      weekLabel?: string;
      rows: RowLite[];
    };
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const bullets = (rows ?? [])
      .filter((r) => (r.in_class ?? '').trim())
      .map((r) => `${r.day}: ${r.type ?? ''} ${r.lesson_num ?? ''} — ${r.in_class}`.trim())
      .join('\n');

    const prompt = `Write 2-3 sentences (max 60 words) for parents previewing what their 4th grader is learning in ${subject} this week (${weekLabel ?? ''}).
Be warm, specific, and concrete. No marketing fluff. No bullet points.

Lessons:
${bullets || '(no lessons listed)'}`;

    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash',
        messages: [
          { role: 'system', content: 'You write concise, warm parent-facing summaries.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error('AI gateway error', resp.status, t);
      return new Response(JSON.stringify({ success: false, summary: '', error: 'ai_failed' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const data = await resp.json();
    const summary = data?.choices?.[0]?.message?.content?.trim() ?? '';
    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('page-ai-summary error', e);
    return new Response(
      JSON.stringify({ success: false, summary: '', error: e instanceof Error ? e.message : String(e) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
