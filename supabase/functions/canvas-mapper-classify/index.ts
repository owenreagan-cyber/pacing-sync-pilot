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

function normalizeSnippetText(text: string, max = 200): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function decodePdfLiteral(input: string): string {
  return input
    .replace(/\\([nrtbf()\\])/g, (_, c) => {
      if (c === "n") return "\n";
      if (c === "r") return "\r";
      if (c === "t") return "\t";
      if (c === "b") return "\b";
      if (c === "f") return "\f";
      return c;
    })
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function extractPdfSnippet(bytes: Uint8Array): string {
  try {
    const raw = new TextDecoder("latin1").decode(bytes);
    const blocks = raw.match(/BT[\s\S]*?ET/g) ?? [];
    const texts: string[] = [];
    for (const block of blocks) {
      const direct = block.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g);
      for (const m of direct) {
        const value = decodePdfLiteral(m[1] ?? "");
        if (value) texts.push(value);
      }

      const arrays = block.matchAll(/\[(.*?)\]\s*TJ/gs);
      for (const a of arrays) {
        const inner = a[1] ?? "";
        const literals = inner.matchAll(/\(((?:\\.|[^\\()])*)\)/g);
        for (const lit of literals) {
          const value = decodePdfLiteral(lit[1] ?? "");
          if (value) texts.push(value);
        }
      }

      if (normalizeSnippetText(texts.join(" ")).length >= 200) break;
    }
    return normalizeSnippetText(texts.join(" "));
  } catch {
    return "";
  }
}

function extractFileContentSnippet(bytes: Uint8Array, mime: string): string {
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml")) {
    try {
      return normalizeSnippetText(new TextDecoder("utf-8").decode(bytes));
    } catch {
      return "";
    }
  }
  if (mime === "application/pdf") {
    return extractPdfSnippet(bytes);
  }
  return "";
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

function applyFolderRules(result: MapperResult, originalName: string, fileContentSnippet: string): MapperResult {
  const conciseName = canonicalizeSuggestedName(result.suggestedName, originalName);
  const source = `${conciseName} ${originalName} ${fileContentSnippet}`.trim();
  const lessonNum = parseLessonNumber(source);
  if (lessonNum && lessonNum > 20) {
    const start = Math.floor((lessonNum - 1) / 10) * 10 + 1;
    const end = start + 9;
    const lower = source.toLowerCase();
    const isChapter = lower.includes("chapter");
    const label = isChapter ? "Chapters" : "Lessons";
    return {
      ...result,
      suggestedName: conciseName,
      suggestedFolder: `${label} ${start}-${end}`,
    };
  }

  const categorical = categorizeFolder(conciseName, result.resourceType, result.purpose);
  if (categorical) {
    return { ...result, suggestedName: conciseName, suggestedFolder: categorical };
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
    const extractedSnippet = extractFileContentSnippet(buf, mime);
    const fileContentSnippet = normalizeSnippetText(extractedSnippet || displayName);
    const base64 = await bytesToBase64(buf);

    const prompt = `You are mapping Canvas files for school content operations.

STRICT RULES:
1) Identify unknowns using fileContentSnippet.
   - If filename is generic/bad (scan_01, IMG_1234, vendor code), infer true title from snippet.
2) Friendly naming only.
   - Strip Canvas/vendor codes and keep names highly readable.
   - Example GOOD: "Shurley English: Chapter 4"
   - Example BAD: "scan_01.pdf" or "SM5_INT5_CH4_vendorfinal.pdf"
3) Rule of 20 for sequence chunking.
   - If sequence indicates lesson/chapter numbering beyond 20, folder MUST be grouped by tens.
   - Examples: "Lessons 1-10", "Lessons 11-20", "Chapters 21-30".
4) Categorical folders when applicable:
    - Investigations, Assessments, Reteaching, Power Ups,
      Textbooks, Glossaries, Classroom Practices, Answer Keys
5) snippet must be fileContentSnippet (or a strict <=200 char variant of it).
6) purpose must be an array of concise category tags.

Original file name: "${orphan.original_name ?? ""}".
fileContentSnippet: "${fileContentSnippet}".

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
        snippet: normalizeSnippetText(fileContentSnippet || mapped.snippet || displayName),
      },
      displayName || orphan.canvas_file_id,
      fileContentSnippet,
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
