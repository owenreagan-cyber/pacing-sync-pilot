const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const extractTool = {
  type: "function" as const,
  function: {
    name: "extract_newsletter",
    description: "Extract structured data from newsletter text.",
    parameters: {
      type: "object",
      properties: {
        date_range: { type: "string", description: "e.g. 'Jan 13–17'" },
        homeroom_notes: { type: "string", description: "General notes for parents" },
        birthdays: { type: "string", description: "Birthday mentions" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
            required: ["title", "body"],
            additionalProperties: false,
          },
          description: "Distinct sections like field trips, events, reminders",
        },
      },
      required: ["date_range", "homeroom_notes", "birthdays", "sections"],
      additionalProperties: false,
    },
  },
};

const polishTool = {
  type: "function" as const,
  function: {
    name: "polish_newsletter",
    description: "Return polished newsletter content.",
    parameters: {
      type: "object",
      properties: {
        homeroom_notes: { type: "string" },
        birthdays: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
            required: ["title", "body"],
            additionalProperties: false,
          },
        },
      },
      required: ["homeroom_notes", "birthdays", "sections"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, action } = body;

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Branch: polish existing content
    if (action === "polish") {
      const { homeroom_notes, birthdays, sections } = body;
      const prompt = `You are a friendly elementary school teacher writing a parent newsletter. Polish and rewrite this newsletter content to be warm, engaging, and professional. Keep all factual [...]

Homeroom Notes: ${homeroom_notes || "N/A"}
Birthdays: ${birthdays || "N/A"}
Sections: ${JSON.stringify(sections || [])}

Use the polish_newsletter tool to return the polished content.`;

      const response = await fetch(AI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          tools: [polishTool],
          tool_choice: { type: "function", function: { name: "polish_newsletter" } },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return new Response(JSON.stringify({ error: `AI request failed: ${errText}` }), {
          status: response.status === 429 ? 429 : response.status === 402 ? 402 : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      let parsed;
      if (toolCall?.function?.arguments) {
        parsed = JSON.parse(toolCall.function.arguments);
      } else {
        const content = aiResult.choices?.[0]?.message?.content || "";
        parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      }

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: extract from raw text
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Extract structured data from this school newsletter text. Use the extract_newsletter tool.

Text:
${text}`;

    const response = await fetch(AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-1.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        tools: [extractTool],
        tool_choice: { type: "function", function: { name: "extract_newsletter" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(JSON.stringify({ error: `AI request failed: ${errText}` }), {
        status: response.status === 429 ? 429 : response.status === 402 ? 402 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];

    let parsed;
    if (toolCall?.function?.arguments) {
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch {
        parsed = { date_range: "", homeroom_notes: "", birthdays: "", sections: [] };
      }
    } else {
      const content = aiResult.choices?.[0]?.message?.content || "";
      try {
        parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        parsed = { date_range: "", homeroom_notes: content, birthdays: "", sections: [] };
      }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
