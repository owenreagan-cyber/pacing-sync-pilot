// file-vision-classify
// Input: { canvasFileId: string }
// Fetches the file from canvas_orphan_files.canvas_url, sends bytes to Gemini,
// stores ai_suggested_name + ai_lesson_ref on the orphan row, and returns the parsed result.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const classifyTool = {
  type: "function" as const,
  function: {
    name: "classify_file",
    description: "Classify an educational file by subject, type, and lesson number based on its visual content.",
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
          description: "Numeric lesson/test number found in the document (digits only)",
        },
        suggested_name: {
          type: "string",
          description: "A friendly filename like SM5_L078_worksheet.pdf",
        },
      },
      required: ["subject", "type", "lesson_num", "suggested_name"],
      additionalProperties: false,
    },
  },
};

const TYPE_ABBR: Record<string, string> = {
  worksheet: "L",
  test: "T",
  study_guide: "SG",
  answer_key: "AK",
  resource: "R",
};

function buildLessonRef(subject: string, type: string, lessonNum: string): string {
  const subj = (subject || "Unknown").replace(/\s+/g, "");
  const abbr = TYPE_ABBR[type] || "L";
  const padded = String(lessonNum || "").replace(/\D/g, "").padStart(3, "0");
  return `${subj}_Lesson_${padded}_${abbr}`;
}

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

function applyManualRenameOverrides(originalName: string, suggestedName: string): string {
  const original = (originalName || "").trim();
  const proposed = (suggestedName || "").trim();
  const source = proposed || original;
  if (!source) return suggestedName;

  const workbookMatch = source.match(/^reading workbook lesson\s*(\d{1,3})(?:\.pdf)?$/i);
  if (workbookMatch) {
    const lesson = workbookMatch[1];
    const keepPdf = /\.pdf$/i.test(source) || /\.pdf$/i.test(original);
    return `Spelling Workbook Lesson ${lesson}${keepPdf ? ".pdf" : ""}`;
  }

  const compactSource = source.replace(/[\s-]+/g, "_").toUpperCase();
  const glossaryMap: Record<string, string> = {
    R_GL_A: "Reading Glossary: Book A",
    R_GL_B: "Reading Glossary: Book B",
    R_GL_C: "Reading Glossary: Book C",
  };
  const glossaryKey = Object.keys(glossaryMap).find((key) =>
    compactSource === key || compactSource === `${key}.PDF`
  );
  if (glossaryKey) {
    const keepPdf = /\.pdf$/i.test(source) || /\.pdf$/i.test(original);
    return `${glossaryMap[glossaryKey]}${keepPdf ? ".pdf" : ""}`;
  }

  return suggestedName;
}

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  // Chunked to avoid stack overflow on large files
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { canvasFileId } = await req.json();
    if (!canvasFileId) {
      return new Response(JSON.stringify({ error: "Missing canvasFileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Look up the orphan row
    const { data: orphan, error: orphanErr } = await supabase
      .from("canvas_orphan_files")
      .select("*")
      .eq("canvas_file_id", String(canvasFileId))
      .maybeSingle();
    if (orphanErr || !orphan) {
      return new Response(JSON.stringify({ error: "Orphan file not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!orphan.canvas_url) {
      return new Response(JSON.stringify({ error: "Orphan file missing canvas_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch the file bytes from Canvas
    const fileResp = await fetch(orphan.canvas_url);
    if (!fileResp.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch file (${fileResp.status})` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const buf = new Uint8Array(await fileResp.arrayBuffer());
    const mime = fileResp.headers.get("content-type")?.split(";")[0]?.trim() ||
      mimeFromName(orphan.original_name || "");
    const base64 = await bytesToBase64(buf);

    // 3. Call Gemini
    const prompt = `Look at this educational worksheet/document image from a 4th/5th grade school. Identify the subject, type, and lesson number from the visual content.

Common naming patterns for suggested_name:
- Math = SM5, Reading = RM4, Spelling = RM4, Language Arts = ELA4, History = HIS4, Science = SCI4
- worksheet = _L, test = _T, study_guide = _SG, answer_key = _AK
- Format: PREFIX_TYPE + lesson num padded to 3 digits + .pdf
  Example: SM5_L078.pdf, RM4_T012.pdf

Original filename: "${orphan.original_name ?? ""}"

Use the classify_file tool to return your answer.`;

    const response = await fetch(AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.1,
        tools: [classifyTool],
        tool_choice: { type: "function", function: { name: "classify_file" } },
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
    let parsed: { subject: string; type: string; lesson_num: string; suggested_name: string };
    if (toolCall?.function?.arguments) {
      parsed = JSON.parse(toolCall.function.arguments);
    } else {
      const content = aiResult.choices?.[0]?.message?.content || "";
      try {
        parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        parsed = {
          subject: "Unknown",
          type: "resource",
          lesson_num: "",
          suggested_name: orphan.original_name || "unknown.pdf",
        };
      }
    }

    const adjustedSuggestedName = applyManualRenameOverrides(
      String(orphan.original_name ?? ""),
      String(parsed.suggested_name ?? ""),
    );
    parsed.suggested_name = adjustedSuggestedName || parsed.suggested_name;
    const aiLessonRef = buildLessonRef(parsed.subject, parsed.type, parsed.lesson_num);

    // 4. Update the orphan row
    await supabase
      .from("canvas_orphan_files")
      .update({
        ai_suggested_name: parsed.suggested_name,
        ai_suggested_folder: parsed.subject,
        ai_lesson_ref: aiLessonRef,
        updated_at: new Date().toISOString(),
      })
      .eq("canvas_file_id", orphan.canvas_file_id);

    return new Response(
      JSON.stringify({ ...parsed, ai_lesson_ref: aiLessonRef }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
