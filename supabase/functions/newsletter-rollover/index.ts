const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('LOVABLE_API_KEY') ?? '';
    const { previousHtml, newStartDate, newEndDate } = await req.json();
    if (!previousHtml || !newStartDate || !newEndDate) throw new Error('Missing required date/html parameters');

    const newMonth = new Date(newStartDate).getMonth() !== new Date(newEndDate).getMonth()
      || new Date(newStartDate).getMonth() !== new Date(previousHtml.match(/(\w+ \d+)/)?.[0] || newStartDate).getMonth();

    const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const dateLabel = `${formatDate(newStartDate)} - ${formatDate(newEndDate)}`;

    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [
          {
            role: 'system',
            content: `You are a teacher assistant updating a Canvas LMS homeroom newsletter.\nRULES — follow every rule exactly:\n1. Update the date in the gradient header banner to: "${dateLabel}"\n2. Remove any events from "Mark Your Calendars" section whose date is before ${newStartDate}.\n3. If ${newMonth ? 'true' : 'false'} (new month started), replace the entire Birthdays card content with: <p style="margin: 0;">[ INSERT NEW BIRTHDAYS HERE ]</p>\n4. Keep all Homeroom Notes, School News, Points of Contact, and Quick Links exactly as-is.\n5. Return ONLY the complete updated HTML. No markdown. No explanation. No code fences.`
          },
          { role: 'user', content: `Update this newsletter HTML:\n\n${previousHtml}` }
        ]
      })
    });

    const data = await res.json();
    const updatedHtml = data.choices?.[0]?.message?.content?.trim() || '';
    if (!updatedHtml) throw new Error('AI returned empty response');

    return new Response(JSON.stringify({ ok: true, html: updatedHtml }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
