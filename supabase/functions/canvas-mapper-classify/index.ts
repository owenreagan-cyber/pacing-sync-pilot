import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const SNIPPET_MAX_CHARS = 300;

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
        snippet: { type: "string", description: "First 300 chars summary/snippet from file content" },
        suggestedName: { type: "string" },
        suggestedFolder: { type: "string" },
        confidence: {
          type: "integer",
          description: "Classification confidence score 0–100. Use 100 when certain, lower when ambiguous.",
        },
      },
      required: ["resourceType", "purpose", "snippet", "suggestedName", "suggestedFolder", "confidence"],
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
  confidence: number;
  alreadyFormatted?: boolean;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function tokenSet(input: string): Set<string> {
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
  return new Set(tokens);
}

function textSimilarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface DuplicateMatchResult {
  isDuplicate: boolean;
  canonicalFileId: string | null;
}

async function detectDuplicateMatch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orphan: { canvas_file_id: string; course_id: string | null },
  fileHash: string,
  snippet: string,
): Promise<DuplicateMatchResult> {
  const { data: exactMatches } = await supabase
    .from("canvas_orphan_files")
    .select("canvas_file_id, created_at")
    .eq("file_hash", fileHash)
    .neq("canvas_file_id", orphan.canvas_file_id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (Array.isArray(exactMatches) && exactMatches.length > 0) {
    return { isDuplicate: true, canonicalFileId: String(exactMatches[0].canvas_file_id) };
  }

  if (!snippet || snippet.length < 40) {
    return { isDuplicate: false, canonicalFileId: null };
  }

  let nearDupQuery = supabase
    .from("canvas_orphan_files")
    .select("canvas_file_id, ai_snippet, created_at")
    .neq("canvas_file_id", orphan.canvas_file_id)
    .not("ai_snippet", "is", null)
    .order("created_at", { ascending: true })
    .limit(200);

  if (orphan.course_id) {
    nearDupQuery = nearDupQuery.eq("course_id", orphan.course_id);
  }

  const { data: nearCandidates } = await nearDupQuery;
  let bestMatchId: string | null = null;
  let bestSimilarity = 0;
  for (const candidate of nearCandidates ?? []) {
    const similarity = textSimilarity(
      normalizeSnippetText(String(candidate.ai_snippet ?? ""), SNIPPET_MAX_CHARS),
      snippet,
    );
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatchId = String(candidate.canvas_file_id);
    }
  }

  if (bestMatchId && bestSimilarity >= 0.92) {
    return { isDuplicate: true, canonicalFileId: bestMatchId };
  }

  return { isDuplicate: false, canonicalFileId: null };
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
      confidence: { type: "integer" },
    },
    required: ["resourceType", "purpose", "snippet", "suggestedName", "suggestedFolder", "confidence"],
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

async function shouldChunkCourseLessons(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  courseId: string | null,
  currentFileSource: string,
): Promise<boolean> {
  if (!courseId) return false;

  const { data: courseRows } = await supabase
    .from("canvas_orphan_files")
    .select("original_name, ai_suggested_name, ai_lesson_ref")
    .eq("course_id", courseId)
    .limit(1000);

  let maxLesson = 0;
  let lessonFileCount = 0;
  for (const row of courseRows ?? []) {
    const source = `${row.original_name ?? ""} ${row.ai_suggested_name ?? ""} ${row.ai_lesson_ref ?? ""}`.trim();
    const lessonNum = parseLessonNumber(source);
    if (lessonNum) {
      lessonFileCount += 1;
      if (lessonNum > maxLesson) {
        maxLesson = lessonNum;
      }
    }
  }

  const currentLesson = parseLessonNumber(currentFileSource);
  if (currentLesson && currentLesson > maxLesson) {
    maxLesson = currentLesson;
    lessonFileCount += 1;
  }
  // Apply Rule of 20: chunk if more than 20 lesson-type files exist in the course,
  // or if the max lesson number itself exceeds 20.
  return lessonFileCount > 20 || maxLesson > 20;
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
  const withoutDateTokens = withoutVerboseSubtitle
    .replace(/\b(19|20)\d{2}[-_ ]?(0[1-9]|1[0-2])[-_ ]?(0[1-9]|[12]\d|3[01])\b/g, " ")
    .replace(/\b(0[1-9]|1[0-2])[-_ ](0[1-9]|[12]\d|3[01])[-_ ]((19|20)\d{2})\b/g, " ")
    .replace(/\b\d{8}\b/g, " ");
  const withoutVendorTokens = withoutDateTokens.replace(
    /\b(v\d+(?:\.\d+)*|final|draft|copy|scan(?:ned)?|ocr|vendor|export|rev\d*|ver(?:sion)?\d*)\b/gi,
    " ",
  );
  const normalized = withoutVendorTokens
    .replace(/[_-]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return normalized || fallback;
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

function normalizeSnippetText(text: string, max = SNIPPET_MAX_CHARS): string {
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
    confidence: 0,
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
  const rawConfidence = candidate.confidence;
  const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
    ? Math.min(100, Math.max(0, Math.round(rawConfidence)))
    : 50;
  return {
    resourceType: candidate.resourceType.trim(),
    purpose: candidate.purpose.map((item) => item.trim()).filter(Boolean),
    snippet: normalizeSnippetText(candidate.snippet),
    suggestedName: candidate.suggestedName.trim(),
    suggestedFolder: candidate.suggestedFolder.trim(),
    confidence,
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

      if (normalizeSnippetText(texts.join(" ")).length >= SNIPPET_MAX_CHARS) break;
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
  if (hay.includes("study guide") || hay.includes("studyguide") || hay.includes("sg")) return "Study Guides";
  if (hay.includes("workbook") || hay.includes("worksheet") || hay.includes("practice")) return "Workbooks";
  if (hay.includes("reteach")) return "Reteaching";
  if (hay.includes("power up") || hay.includes("powerup")) return "Power Ups";
  if (hay.includes("textbook") || hay.includes("book")) return "Textbooks";
  if (hay.includes("glossary")) return "Glossaries";
  if (hay.includes("classroom practice")) return "Classroom Practices";
  if (hay.includes("answer key")) return "Answer Keys";
  return null;
}

function normalizeSuggestedFolder(rawFolder: string | null | undefined): string | null {
  const clean = String(rawFolder ?? "").trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  const chunkMatch = clean.match(/^(?:lessons?|chapters?)\s*(\d{1,3})\s*[-–]\s*(\d{1,3})$/i);
  if (chunkMatch) {
    const label = /^chapter/i.test(clean) ? "Chapters" : "Lessons";
    return `${label} ${chunkMatch[1]}-${chunkMatch[2]}`;
  }
  if (/study\s*guides?|(^|[\s/_-])sg([\s/_-]|$)/i.test(lower)) return "Study Guides";
  if (/assessments?|tests?|quizzes?/i.test(lower)) return "Assessments";
  if (/workbooks?|worksheets?|practice|classwork/i.test(lower)) return "Workbooks";
  if (/textbooks?|reading\s*book|math\s*book/i.test(lower)) return "Textbooks";
  if (/answer\s*keys?|keys?\b/i.test(lower)) return "Answer Keys";
  if (/glossar(y|ies)/i.test(lower)) return "Glossaries";
  if (/power\s*ups?|powerup/i.test(lower)) return "Power Ups";
  if (/reteach(ing)?/i.test(lower)) return "Reteaching";
  if (/investigations?/i.test(lower)) return "Investigations";
  if (/classroom\s*practices?/i.test(lower)) return "Classroom Practices";
  if (/resources?/i.test(lower)) return "Resources";
  return "Resources";
}

function applyFolderRules(
  result: MapperResult,
  originalName: string,
  fileContentSnippet: string,
  chunkLessonsByTen: boolean,
): MapperResult {
  const conciseName = canonicalizeSuggestedName(result.suggestedName, originalName);
  const source = `${conciseName} ${originalName} ${fileContentSnippet}`.trim();
  const lessonNum = parseLessonNumber(source);
  if (lessonNum && chunkLessonsByTen) {
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

  const categorical = categorizeFolder(conciseName, result.resourceType, result.purpose)
    || normalizeSuggestedFolder(result.suggestedFolder);
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
    const fileHash = await sha256Hex(buf);
    const base64 = await bytesToBase64(buf);
    const duplicateMatch = await detectDuplicateMatch(supabase, orphan, fileHash, fileContentSnippet);

    let mapped: MapperResult = fallbackNeedsReview(displayName, orphan.canvas_file_id, fileContentSnippet);
    if (alreadyFormatted) {
      mapped = {
        resourceType: orphan.ai_resource_type ?? "Already Formatted",
        purpose: orphan.ai_purpose ?? ["Already Formatted"],
        snippet: normalizeSnippetText(String(orphan.ai_snippet ?? fileContentSnippet ?? displayName)),
        suggestedName: displayName,
        suggestedFolder: orphan.ai_suggested_folder ?? "Already Formatted",
        confidence: 100,
        alreadyFormatted: true,
      };
    } else {
      const fileSnippet = normalizeSnippetText(fileContentSnippet).slice(0, SNIPPET_MAX_CHARS);
      const prompt = `You are a strict academic librarian for Canvas LMS. Classify the educational file below.

RULE OF 20 — FOLDER CHUNKING:
If a course folder would contain more than 20 lesson files, you MUST split them into ten-lesson sub-folders:
  "Lessons 1-10", "Lessons 11-20", "Lessons 21-30", etc.
Apply this rule whenever the lesson number is known and the course likely has > 20 lessons.

SUBJECT-SPECIFIC NAMING CONVENTIONS (apply strictly):
- Math files:             suggestedName format → "[SM5]: Lesson N"   (e.g., "[SM5]: Lesson 14")
- Reading/Spelling files: suggestedName format → "[RM4]: Lesson N"   (e.g., "[RM4]: Lesson 7")
- ELA files:              suggestedName format → "[ELA4]: Chapter N" (e.g., "[ELA4]: Chapter 3")
- Other subjects: use the clearest descriptive title without subject codes.

STRICT FOLDER RULES:
1. Apply Rule of 20 chunking ("Lessons 1-10", "Lessons 11-20", …) whenever lesson count > 20.
2. NEVER create one-off file-specific folder names.
3. ALWAYS use one canonical folder bucket: "Textbooks", "Workbooks", "Study Guides", "Assessments", "Answer Keys", "Power Ups", "Reteaching", "Glossaries", "Investigations", "Classroom Practices", or "Resources".
4. ALWAYS place Tests/Assessments in "Assessments".
5. ALWAYS place Study Guides in "Study Guides".
6. ALWAYS place workbook/worksheet/classroom practice files in "Workbooks" unless already mapped to "Classroom Practices".
7. If unsure, use "Resources" as the absolute fallback.

STRICT OUTPUT RULES:
- suggestedName: remove version numbers, dates, and vendor noise (e.g., "v2_final", "scan_export").
- snippet: copy the file_snippet verbatim (≤300 chars).
- purpose: array of concise category tags.
- confidence: integer 0–100 reflecting how certain you are about the classification.
  Use 90–100 when the subject code, lesson number and folder are all unambiguous.
  Use 50–89 when some context is inferred.
  Use 0–49 when the file is very ambiguous or unreadable.

FILE CONTEXT:
original_name: "${orphan.original_name ?? ""}"
file_snippet: "${fileSnippet}"

Use the classify_mapper_file tool. Output MUST match the schema exactly.`;

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
    }

    const shouldChunkLessons = await shouldChunkCourseLessons(
      supabase,
      orphan.course_id ? String(orphan.course_id) : null,
      `${mapped.suggestedName} ${displayName} ${fileContentSnippet}`,
    );

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
      shouldChunkLessons,
    );
    mapped = {
      ...mapped,
      suggestedName: applyManualRenameOverrides(displayName, mapped.suggestedName),
    };

    if (duplicateMatch.isDuplicate) {
      mapped = {
        ...mapped,
        purpose: Array.from(new Set([...(mapped.purpose ?? []), "DUPLICATE"])),
        suggestedFolder: "DUPLICATE",
      };
    }

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
        ai_confidence: mapped.confidence,
        file_hash: fileHash,
        is_duplicate: duplicateMatch.isDuplicate,
        canonical_file_id: duplicateMatch.canonicalFileId,
        updated_at: new Date().toISOString(),
      })
      .eq("canvas_file_id", orphan.canvas_file_id);

    return new Response(JSON.stringify({
      ...mapped,
      fileHash,
      isDuplicate: duplicateMatch.isDuplicate,
      canonicalFileId: duplicateMatch.canonicalFileId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
