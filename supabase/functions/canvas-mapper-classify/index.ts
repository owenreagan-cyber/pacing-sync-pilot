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
    name: "classify_mapper_file",
    description: "Classify educational file metadata and output concise rename and folder mapping.",
    parameters: {
      type: "object",
      properties: {
        resourceType: { type: "string" },
        purpose: { type: "array", items: { type: "string" } },
        snippet: { type: "string", description: "First 200 chars summary/snippet from file content" },
        suggestedName: { type: "string" },
        suggestedFolder: { type: "string" },
      },
      required: ["resourceType", "purpose", "snippet", "suggestedName", "suggestedFolder"],
      additionalProperties: false,
    },
  },
};

interface MapperResult {
  resourceType: string;
  purpose: string[];
  snippet: string;
  suggestedName: string;
  suggestedFolder: string;
  alreadyFormatted?: boolean;
}

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function canonicalizeSuggestedName(name: string, fallback: string): string {
  const raw = (name || "").trim();
  if (!raw) return fallback;
  const withoutVerboseSubtitle = raw.split(" - ")[0]?.trim() || raw;
  return withoutVerboseSubtitle;
}

function parseLessonNumber(source: string): number | null {
  const match = source.match(/(?:lesson|chapter)\s*(\d{1,3})/i) || source.match(/\b(\d{1,3})\b/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function categorizeFolder(name: string, resourceType: string, purpose: string[]): string | null {
  const hay = `${name} ${resourceType} ${purpose.join(" ")}`.toLowerCase();
  if (hay.includes("investigation")) return "Investigations";
  if (hay.includes("assessment") || hay.includes("test") || hay.includes("quiz")) return "Assessments";
  if (hay.includes("reteach")) return "Reteaching";
  if (hay.includes("power up") || hay.includes("powerup")) return "Power Ups";
  if (hay.includes("textbook") || hay.includes("book")) return "Textbooks";
  if (hay.includes("glossary")) return "Glossaries";
  if (hay.includes("classroom practice")) return "Classroom Practices";
  if (hay.includes("answer key")) return "Answer Keys";
  return null;
}

function applyFolderRules(result: MapperResult, originalName: string): MapperResult {
  const conciseName = canonicalizeSuggestedName(result.suggestedName, originalName);
  const categorical = categorizeFolder(conciseName, result.resourceType, result.purpose);
  if (categorical) {
    return { ...result, suggestedName: conciseName, suggestedFolder: categorical };
  }

  const source = `${conciseName} ${originalName}`;
  const lessonNum = parseLessonNumber(source);
  if (lessonNum) {
    const start = Math.floor((lessonNum - 1) / 10) * 10 + 1;
    const end = start + 9;
    const lower = source.toLowerCase();
    const isChapter = lower.includes("chapter");
    const label = isChapter ? "Chapters" : lower.includes("math") ? "Math Lessons" : "Lessons";
    return {
      ...result,
      suggestedName: conciseName,
      suggestedFolder: `${label} ${start}-${end}`,
    };
  }

  return {
    ...result,
    suggestedName: conciseName,
    suggestedFolder: result.suggestedFolder?.trim() || "Resources",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    const displayName = String(orphan.original_name ?? "");
    const alreadyFormatted = displayName.includes(" ") && !displayName.includes("_");

    if (alreadyFormatted) {
      const mapped: MapperResult = {
        resourceType: orphan.ai_resource_type ?? "Already Formatted",
        purpose: orphan.ai_purpose ?? ["Already Formatted"],
        snippet: String(orphan.ai_snippet ?? displayName).slice(0, 200),
        suggestedName: displayName,
        suggestedFolder: orphan.ai_suggested_folder ?? "Already Formatted",
        alreadyFormatted: true,
      };

      await supabase
        .from("canvas_orphan_files")
        .update({
          ai_resource_type: mapped.resourceType,
          ai_purpose: mapped.purpose,
          ai_snippet: mapped.snippet,
          ai_suggested_name: mapped.suggestedName,
          ai_suggested_folder: mapped.suggestedFolder,
          ai_folder_chunked: false,
          updated_at: new Date().toISOString(),
        })
        .eq("canvas_file_id", orphan.canvas_file_id);

      return new Response(JSON.stringify(mapped), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!orphan.canvas_url) {
      return new Response(JSON.stringify({ error: "Orphan file missing canvas_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const prompt = `You are mapping Canvas files for school content operations.

STRICT RULES:
1) Concise naming only. Strip verbose subtitles.
   - Return canonical short names only.
   - Example GOOD: "Saxon Math Book: Lesson 66"
   - Example BAD: "Saxon Math Intermediate 5: Lesson 66 - Reading a Centimeter Scale"
2) Intelligent folder chunking rule-of-10 for sequential content:
   - "Math Lessons 1-10", "Math Lessons 11-20"
   - "Lessons 1-10", "Chapters 1-10" when appropriate
3) Categorical folders when applicable:
   - Investigations, Assessments, Reteaching, Power Ups,
     Textbooks, Glossaries, Classroom Practices, Answer Keys
4) Snippet must be a short textual excerpt from the beginning of the visible content and <= 200 chars.
5) purpose must be an array of concise category tags.

Original file name: "${orphan.original_name ?? ""}".

Use the classify_mapper_file tool.`;

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
        tool_choice: { type: "function", function: { name: "classify_mapper_file" } },
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

    let mapped: MapperResult = {
      resourceType: "Resource",
      purpose: ["General"],
      snippet: displayName.slice(0, 200),
      suggestedName: displayName || orphan.canvas_file_id,
      suggestedFolder: "Resources",
    };

    if (toolCall?.function?.arguments) {
      mapped = JSON.parse(toolCall.function.arguments) as MapperResult;
    }

    mapped = applyFolderRules(
      {
        ...mapped,
        purpose: Array.isArray(mapped.purpose) ? mapped.purpose : ["General"],
        snippet: String(mapped.snippet ?? "").slice(0, 200),
      },
      displayName || orphan.canvas_file_id,
    );

    const aiFolderChunked = /\d+\s*-\s*\d+/.test(mapped.suggestedFolder);

    await supabase
      .from("canvas_orphan_files")
      .update({
        ai_resource_type: mapped.resourceType,
        ai_purpose: mapped.purpose,
        ai_snippet: mapped.snippet,
        ai_suggested_name: mapped.suggestedName,
        ai_suggested_folder: mapped.suggestedFolder,
        ai_folder_chunked: aiFolderChunked,
        updated_at: new Date().toISOString(),
      })
      .eq("canvas_file_id", orphan.canvas_file_id);

    return new Response(JSON.stringify(mapped), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
