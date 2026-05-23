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

const mapperResponseSchema = {
  name: "mapper_classification",
  strict: true,
  schema: {
    type: "object",
    properties: {
      resourceType: { type: "string" },
      purpose: { type: "array", items: { type: "string" } },
      snippet: { type: "string" },
      suggestedName: { type: "string" },
      suggestedFolder: { type: "string" },
    },
    required: ["resourceType", "purpose", "snippet", "suggestedName", "suggestedFolder"],
    additionalProperties: false,
  },
} as const;

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

function fallbackNeedsReview(displayName: string, fallbackId: string, snippetOverride?: string): MapperResult {
  const safeName = (displayName || fallbackId || "unclassified-file").trim();
  const safeSnippet = normalizeSnippetText(
    snippetOverride || displayName || "No readable text extracted from file content.",
  );
  return {
    resourceType: "Unknown - Needs Visual Review",
    purpose: ["Needs Human Review"],
    snippet: safeSnippet || "No readable text extracted from file content.",
    suggestedName: safeName,
    suggestedFolder: "Needs Visual Review",
  };
}

function toValidatedMapperResult(value: unknown): MapperResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.resourceType !== "string" ||
    typeof candidate.snippet !== "string" ||
    typeof candidate.suggestedName !== "string" ||
    typeof candidate.suggestedFolder !== "string" ||
    !Array.isArray(candidate.purpose) ||
    candidate.purpose.some((item) => typeof item !== "string")
  ) {
    return null;
  }
  return {
    resourceType: candidate.resourceType.trim(),
    purpose: candidate.purpose.map((item) => item.trim()).filter(Boolean),
    snippet: normalizeSnippetText(candidate.snippet),
    suggestedName: candidate.suggestedName.trim(),
    suggestedFolder: candidate.suggestedFolder.trim(),
  };
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
    const normalizedExtractedSnippet = normalizeSnippetText(extractedSnippet);
    const fileContentSnippet = normalizedExtractedSnippet;
    const base64 = await bytesToBase64(buf);

    if (!fileContentSnippet) {
      const mapped = fallbackNeedsReview(
        displayName || orphan.original_name || "",
        orphan.canvas_file_id,
        "No readable text extracted from file content.",
      );
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

    const prompt = `You are a strict academic librarian for Canvas.

STRICT FOLDER RULES:
1. ALWAYS group Math lessons (1-20, 21-40) into "Lessons 1-20", "Lessons 21-40".
2. ALWAYS place Investigations in "Investigations".
3. ALWAYS place Tests/Assessments in "Assessments".
4. If a file is a generic "Lesson", route it to the specific "Lessons X-Y" folder.
5. IF the AI is unsure, use "Resources" as the absolute fallback.

STRICT OUTPUT RULES:
- Friendly naming only (remove scanner/vendor junk codes).
- snippet must use fileContentSnippet (<=200 chars).
- purpose must be an array of concise category tags.

FILE CONTEXT:
Original name: "${orphan.original_name ?? ""}".
Snippet: "${fileContentSnippet}".

Output MUST be a valid JSON object matching the schema.
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
        response_format: {
          type: "json_schema",
          json_schema: mapperResponseSchema,
        },
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

    let mapped = fallbackNeedsReview(displayName, orphan.canvas_file_id, fileContentSnippet);

    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        const validated = toValidatedMapperResult(parsed);
        if (validated) {
          mapped = validated;
        }
      } catch {
        mapped = fallbackNeedsReview(displayName, orphan.canvas_file_id, fileContentSnippet);
      }
    } else {
      try {
        const content = aiResult?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim()) {
          const parsed = JSON.parse(content);
          const validated = toValidatedMapperResult(parsed);
          if (validated) {
            mapped = validated;
          }
        }
      } catch {
        mapped = fallbackNeedsReview(displayName, orphan.canvas_file_id, fileContentSnippet);
      }
    }

    mapped = applyFolderRules(
      {
        ...mapped,
        purpose: Array.isArray(mapped.purpose) && mapped.purpose.length > 0
          ? mapped.purpose
          : ["Needs Human Review"],
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
