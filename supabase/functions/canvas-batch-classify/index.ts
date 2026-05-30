// canvas-batch-classify
// Processes up to 25 PENDING canvas_orphan_files in parallel using Gemini vision.
// Tracks progress in automation_jobs for resumable batch processing.
// Input: { batchSize?: number, jobId?: string, dryRun?: boolean }
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

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Compute a simple SHA-256 hex digest of the file bytes */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface OrphanFileRow {
  canvas_file_id: string;
  course_id: string | null;
  original_name: string | null;
  canvas_url: string | null;
  ai_suggested_name: string | null;
  ai_suggested_folder: string | null;
  ai_lesson_ref: string | null;
  status: string;
  file_hash: string | null;
  is_duplicate: boolean;
}

async function classifySingleFile(
  orphan: OrphanFileRow,
  lovableApiKey: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!orphan.canvas_url) {
      await supabase
        .from("canvas_orphan_files")
        .update({ status: "ERROR", updated_at: new Date().toISOString() })
        .eq("canvas_file_id", orphan.canvas_file_id);
      return { ok: false, error: "Missing canvas_url" };
    }

    // Fetch file bytes
    const fileResp = await fetch(orphan.canvas_url);
    if (!fileResp.ok) {
      return { ok: false, error: `Fetch failed: ${fileResp.status}` };
    }
    const buf = new Uint8Array(await fileResp.arrayBuffer());
    const mime =
      fileResp.headers.get("content-type")?.split(";")[0]?.trim() ||
      mimeFromName(orphan.original_name || "");

    // Compute hash for dedup
    const fileHash = await sha256Hex(buf);
    const base64 = await bytesToBase64(buf);

    // Call Gemini
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
        model: "google/gemini-2.0-flash",
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

    let parsed: { subject: string; type: string; lesson_num: string; suggested_name: string };
    if (!response.ok) {
      parsed = {
        subject: "Unknown",
        type: "resource",
        lesson_num: "",
        suggested_name: orphan.original_name || "unknown.pdf",
      };
    } else {
      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
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
    }

    const aiLessonRef = buildLessonRef(parsed.subject, parsed.type, parsed.lesson_num);

    await supabase
      .from("canvas_orphan_files")
      .update({
        ai_suggested_name: parsed.suggested_name,
        ai_suggested_folder: parsed.subject,
        ai_lesson_ref: aiLessonRef,
        file_hash: fileHash,
        updated_at: new Date().toISOString(),
      })
      .eq("canvas_file_id", orphan.canvas_file_id);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize: number = Math.min(body?.batchSize ?? 25, 25);

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

    // Upsert (or retrieve) an automation_jobs row for batch-classify
    const JOB_NAME = "canvas-batch-classify";
    let { data: job } = await supabase
      .from("automation_jobs")
      .select("*")
      .eq("job_name", JOB_NAME)
      .maybeSingle();

    if (!job) {
      const { data: newJob } = await supabase
        .from("automation_jobs")
        .insert({
          job_name: JOB_NAME,
          status: "running",
          last_run: new Date().toISOString(),
        })
        .select()
        .single();
      job = newJob;
    } else {
      await supabase
        .from("automation_jobs")
        .update({ status: "running", last_run: new Date().toISOString() })
        .eq("job_name", JOB_NAME);
    }

    // Count total PENDING files to track overall progress
    const { count: totalCount } = await supabase
      .from("canvas_orphan_files")
      .select("canvas_file_id", { count: "exact", head: true })
      .eq("status", "PENDING");

    const filesTotal = totalCount ?? 0;

    // Count already analyzed (non-PENDING, non-ERROR)
    const { count: processedCount } = await supabase
      .from("canvas_orphan_files")
      .select("canvas_file_id", { count: "exact", head: true })
      .neq("status", "PENDING")
      .not("ai_suggested_name", "is", null);

    const filesProcessed = processedCount ?? 0;

    // Fetch next batch of PENDING files (using cursor for resume support)
    const cursor: string | null = job?.batch_cursor ?? null;
    let query = supabase
      .from("canvas_orphan_files")
      .select("*")
      .eq("status", "PENDING")
      .is("ai_suggested_name", null) // only unanalyzed files
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (cursor) {
      query = query.gt("created_at", cursor);
    }

    const { data: batch, error: batchErr } = await query;
    if (batchErr) throw batchErr;

    const files = (batch ?? []) as OrphanFileRow[];

    if (files.length === 0) {
      // All analyzed — reset cursor
      await supabase
        .from("automation_jobs")
        .update({
          status: "success",
          batch_cursor: null,
          files_processed: filesProcessed,
          files_total: filesTotal,
          last_result: { message: "All files analyzed", filesProcessed, filesTotal },
        })
        .eq("job_name", JOB_NAME);

      await supabase.from("deploy_log").insert({
        action: JOB_NAME,
        status: "ok",
        message: `Batch complete. ${filesProcessed} of ${filesTotal} files analyzed.`,
      });

      return new Response(
        JSON.stringify({ ok: true, processed: 0, filesProcessed, filesTotal, done: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Process in parallel
    const results = await Promise.allSettled(
      files.map((f) => classifySingleFile(f, lovableApiKey, supabase)),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    const failed = results.length - succeeded;

    // Advance cursor to the last processed file's created_at
    const lastFile = files[files.length - 1];
    const newCursor = lastFile?.created_at ?? cursor;
    const newProcessed = filesProcessed + succeeded;

    await supabase
      .from("automation_jobs")
      .update({
        status: "running",
        batch_cursor: newCursor,
        files_processed: newProcessed,
        files_total: filesTotal,
        last_result: { succeeded, failed, cursor: newCursor, newProcessed, filesTotal },
      })
      .eq("job_name", JOB_NAME);

    await supabase.from("deploy_log").insert({
      action: JOB_NAME,
      status: "ok",
      message: `Batch processed ${succeeded} files (${failed} failed). ${newProcessed}/${filesTotal} total.`,
      payload: { succeeded, failed, cursor: newCursor },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        processed: succeeded,
        failed,
        filesProcessed: newProcessed,
        filesTotal,
        done: false,
        cursor: newCursor,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
