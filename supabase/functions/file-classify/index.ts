const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const REGEX_PATTERNS: { pattern: RegExp; subject: string; type: string; lessonExtract: RegExp | null }[] = [
  { pattern: /SM5.*SG[_\s-]*(\d+)/i, subject: "Math", type: "study_guide", lessonExtract: /SG[_\s-]*(\d+)/i },
  { pattern: /SM5.*AK[_\s-]*(\d+)/i, subject: "Math", type: "answer_key", lessonExtract: /AK[_\s-]*(\d+)/i },
  { pattern: /SM5.*T[_\s-]*(\d+)/i, subject: "Math", type: "test", lessonExtract: /T[_\s-]*(\d+)/i },
  { pattern: /SM5.*L[_\s-]*(\d+)/i, subject: "Math", type: "worksheet", lessonExtract: /L[_\s-]*(\d+)/i },
  { pattern: /RM4.*(SPELL|SPELLING).*?(\d+)/i, subject: "Spelling", type: "test", lessonExtract: /(\d+)/ },
  { pattern: /RM4.*(\d+)/i, subject: "Reading", type: "worksheet", lessonExtract: /(\d+)/ },
  { pattern: /ELA4.*(\d+)/i, subject: "Language Arts", type: "worksheet", lessonExtract: /(\d+)/ },
  { pattern: /SCI4.*(\d+)/i, subject: "Science", type: "resource", lessonExtract: /(\d+)/ },
  { pattern: /HIS4.*(\d+)/i, subject: "History", type: "resource", lessonExtract: /(\d+)/ },
];

function classifyByRegex(filename: string) {
  for (const rule of REGEX_PATTERNS) {
    if (rule.pattern.test(filename)) {
      const match = rule.lessonExtract ? filename.match(rule.lessonExtract) : null;
      return {
        subject: rule.subject,
        type: rule.type,
        lesson_num: match ? match[match.length - 1] ?? "" : "",
      };
    }
  }
  return null;
}

function normalizeFilename(filename: string) {
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function inferSubject(normalized: string) {
  if (/(^| )sm5( |$)|math|saxon/.test(normalized)) return "Math";
  if (/(^| )rm4( |$)|reading mastery|reading/.test(normalized)) return "Reading";
  if (/(^| )ela4( |$)|language arts|(^| )la( |$)|grammar|writing/.test(normalized)) return "Language Arts";
  if (/spelling|spell/.test(normalized)) return "Spelling";
  if (/(^| )his4( |$)|history/.test(normalized)) return "History";
  if (/(^| )sci4( |$)|science/.test(normalized)) return "Science";
  return "Unknown";
}

function inferType(normalized: string) {
  if (/answer key|(^| )ak( |$)| key$/.test(normalized)) return "answer_key";
  if (/study guide|(^| )sg( |$)/.test(normalized)) return "study_guide";
  if (/test|quiz|exam|assessment/.test(normalized)) return "test";
  if (/worksheet|practice|lesson|classwork/.test(normalized)) return "worksheet";
  return "resource";
}

function inferLessonNum(filename: string, normalized: string) {
  const markerMatch =
    filename.match(/SG[_\s-]*(\d+)/i) ||
    filename.match(/AK[_\s-]*(\d+)/i) ||
    filename.match(/T[_\s-]*(\d+)/i) ||
    filename.match(/L[_\s-]*(\d+)/i);

  if (markerMatch?.[1]) return markerMatch[1];

  const digitMatch = normalized.match(/(^| )(\d{1,4})( |$)/);
  return digitMatch?.[2] ?? "";
}

function classifyLocally(filename: string) {
  const regexMatch = classifyByRegex(filename);
  if (regexMatch) return regexMatch;

  const normalized = normalizeFilename(filename);
  return {
    subject: inferSubject(normalized),
    type: inferType(normalized),
    lesson_num: inferLessonNum(filename, normalized),
  };
}

const classifyTool = {
  type: "function" as const,
  function: {
    name: "classify_file",
    description: "Classify an educational file by subject, type, and lesson number.",
    parameters: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          enum: ["Math", "Reading", "Spelling", "Language Arts", "History", "Science"],
        },
        type: {
          type: "string",
          enum: ["worksheet", "test", "study_guide", "answer_key", "resource"],
        },
        lesson_num: {
          type: "string",
          description: "Numeric lesson/test number extracted from the filename (digits only)",
        },
      },
      required: ["subject", "type", "lesson_num"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { filename } = await req.json();
    if (!filename || typeof filename !== "string") {
      return new Response(JSON.stringify({ error: "Missing filename" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const localClassification = classifyLocally(filename);
    if (localClassification.subject !== "Unknown") {
      return new Response(JSON.stringify(localClassification), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify(localClassification), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Classify this educational file based on its filename. The file is from a 4th/5th grade school.

Filename: "${filename}"

Common naming patterns:
- SM5 = Saxon Math 5th grade
- RM4 = Reading Mastery 4th grade  
- ELA4 = English Language Arts 4th grade
- L = Lesson, T = Test, SG = Study Guide

Use the classify_file tool to return your answer.`;

    // Keep the AI path short and best-effort only. If it stalls,
    // return the local classification instead of surfacing a 504.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(AI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableApiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          tools: [classifyTool],
          tool_choice: { type: "function", function: { name: "classify_file" } },
        }),
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      return new Response(JSON.stringify(localClassification), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        return new Response(JSON.stringify(localClassification), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify(localClassification), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI request failed", response.status, errText);
      return new Response(JSON.stringify(localClassification), {
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
        parsed = localClassification;
      }
    } else {
      // Fallback to content parsing
      const content = aiResult.choices?.[0]?.message?.content || "";
      try {
        parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        parsed = localClassification;
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
