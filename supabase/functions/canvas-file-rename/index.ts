// Rename a Canvas file via PUT /api/v1/files/:id
// Reads from canvas_orphan_files triage table and links to content_map on success.
// Also creates missing Canvas folders on-demand when ai_suggested_folder is set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchCanvasWithRetry } from "../_shared/canvas-api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function inferSubjectFromCourse(courseIds: Record<string, number>, courseId: string): string | null {
  for (const [subject, id] of Object.entries(courseIds || {})) {
    if (String(id) === String(courseId)) return subject;
  }
  return null;
}

function inferTypeFromRef(ref: string | null | undefined): string {
  if (!ref) return "resource";
  const r = ref.toUpperCase();
  if (r.startsWith("SG")) return "study_guide";
  if (r.startsWith("T")) return "test";
  if (r.startsWith("AK")) return "answer_key";
  if (r.startsWith("L")) return "worksheet";
  return "resource";
}

const MAX_CANVAS_NAME_LENGTH = 120;

function normalizeCanvasFileName(name: string): string {
  const sanitized = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s._()\-:]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();
  if (!sanitized) return "untitled-file";
  if (sanitized.length <= MAX_CANVAS_NAME_LENGTH) return sanitized;
  const dot = sanitized.lastIndexOf(".");
  if (dot > 0) {
    const ext = sanitized.slice(dot);
    const base = sanitized.slice(0, dot).slice(0, Math.max(1, MAX_CANVAS_NAME_LENGTH - ext.length));
    return `${base}${ext}`;
  }
  return sanitized.slice(0, MAX_CANVAS_NAME_LENGTH);
}

async function ensureFolderPath(
  baseUrl: string,
  token: string,
  courseId: string,
  rawFolderPath: string,
): Promise<number | null> {
  const segments = rawFolderPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  const allFolders: Array<{ id: number; full_name: string }> = [];
  let folderPage = 1;
  while (true) {
    const foldersResp = await fetchCanvasWithRetry(
      `${baseUrl}/api/v1/courses/${courseId}/folders?per_page=100&page=${folderPage}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!foldersResp.ok) break;
    const batch = await foldersResp.json() as Array<{ id: number; full_name: string }>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    allFolders.push(...batch);
    if (batch.length < 100) break;
    folderPage++;
    if (folderPage > 20) break; // safety cap
  }
  const existing = new Map(
    allFolders.map((folder) => [folder.full_name.toLowerCase(), folder.id] as const),
  );

  let parentFolderId: number | null = null;
  let currentPath = "";

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const key = currentPath.toLowerCase();
    const known = existing.get(key);
    if (known) {
      parentFolderId = known;
      continue;
    }

    const createResp = await fetchCanvasWithRetry(
      `${baseUrl}/api/v1/courses/${courseId}/folders`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: segment,
          hidden: false,
          parent_folder_id: parentFolderId ?? undefined,
        }),
      },
    );
    if (!createResp.ok) return parentFolderId;

    const created = await createResp.json() as { id: number };
    parentFolderId = created.id;
    existing.set(key, created.id);
  }

  return parentFolderId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { fileId } = await req.json();
    if (!fileId) {
      return new Response(JSON.stringify({ error: "Missing fileId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = (Deno.env.get("CANVAS_BASE_URL") || "").replace(/\/$/, "");
    const token = Deno.env.get("CANVAS_API_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!baseUrl || !token) throw new Error("Canvas credentials missing");

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Read from canvas_orphan_files
    const { data: row, error } = await supabase
      .from("canvas_orphan_files")
      .select("*")
      .eq("canvas_file_id", String(fileId))
      .maybeSingle();
    if (error || !row) throw new Error("Orphan file row not found");
    if (!row.ai_suggested_name) throw new Error("No ai_suggested_name to rename to");
    const normalizedName = normalizeCanvasFileName(String(row.ai_suggested_name));

    // 2. If ai_suggested_folder is set, ensure the folder exists in Canvas (create if missing)
    let targetFolderId: number | null = null;
    if (row.ai_suggested_folder && row.course_id) {
      try {
        targetFolderId = await ensureFolderPath(
          baseUrl,
          token,
          String(row.course_id),
          String(row.ai_suggested_folder),
        );
      } catch {
        // Non-fatal: folder placement is best-effort
      }
    }

    // Build file update payload
    const filePayload: Record<string, unknown> = {
      name: normalizedName,
      on_duplicate: "rename",
    };
    if (targetFolderId !== null) {
      filePayload.parent_folder_id = targetFolderId;
    }

    // 3. PUT to Canvas
    const r = await fetchCanvasWithRetry(`${baseUrl}/api/v1/files/${row.canvas_file_id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(filePayload),
    });

    const respText = await r.text();
    if (!r.ok) {
      await supabase.from("deploy_log").insert({
        action: "canvas-file-rename", status: "error",
        message: `Rename failed: ${r.status}`,
        payload: { fileId, response: respText.slice(0, 500) },
      });
      throw new Error(`Canvas ${r.status}: ${respText.slice(0, 200)}`);
    }

    // Parse Canvas response for updated URL
    let updatedCanvasUrl = row.canvas_url;
    try {
      const j = JSON.parse(respText);
      if (j?.url) updatedCanvasUrl = j.url;
    } catch { /* ignore */ }

    const now = new Date().toISOString();

    // 4. Mark orphan APPROVED
    await supabase
      .from("canvas_orphan_files")
      .update({
        status: "APPROVED",
        ai_suggested_name: normalizedName,
        original_name: normalizedName,
        canvas_url: updatedCanvasUrl,
        updated_at: now,
      })
      .eq("canvas_file_id", row.canvas_file_id);

    // 5. Upsert into content_map so Pacing Entry UI sees it
    if (row.ai_lesson_ref) {
      const { data: cfg } = await supabase
        .from("system_config")
        .select("course_ids")
        .eq("id", "current")
        .maybeSingle();
      let subject = inferSubjectFromCourse(cfg?.course_ids ?? {}, row.course_id ?? "");
      // Fallback: infer subject from lesson ref prefix if course ID lookup failed
      if (!subject && row.ai_lesson_ref) {
        const ref = (row.ai_lesson_ref || "").toUpperCase();
        if (ref.startsWith("M_") || ref.startsWith("SM5") || /^SG\d|^T\d/.test(ref)) subject = "Math";
        else if (ref.startsWith("RM4") || ref.startsWith("R_") || ref.startsWith("WB")) subject = "Reading";
        else if (ref.startsWith("SP") || ref.startsWith("SPELL")) subject = "Spelling";
        else if (ref.startsWith("ELA") || ref.startsWith("LA_") || ref.startsWith("CH")) subject = "Language Arts";
        else if (ref.startsWith("HIST") || ref.startsWith("EP_")) subject = "History";
        else if (ref.startsWith("SCI") || ref.startsWith("SC_")) subject = "Science";
      }
      const type = inferTypeFromRef(row.ai_lesson_ref);
      if (subject) {
        await supabase.from("content_map").upsert(
          {
            subject,
            lesson_ref: row.ai_lesson_ref,
            type,
            canonical_name: normalizedName,
            canvas_file_id: row.canvas_file_id,
            canvas_url: updatedCanvasUrl,
            confidence: "ai",
            auto_linked: true,
            last_synced: now,
            updated_at: now,
          },
          { onConflict: "subject,lesson_ref,type" },
        );
      }
    }

    await supabase.from("deploy_log").insert({
      action: "canvas-file-rename", status: "ok",
      message: `Renamed to ${normalizedName}`,
      payload: { fileId, canvasFileId: row.canvas_file_id, folderPath: row.ai_suggested_folder ?? null },
    });

    return new Response(
      JSON.stringify({ ok: true, friendly_name: normalizedName, canvas_url: updatedCanvasUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
