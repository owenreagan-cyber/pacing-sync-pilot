// Rename a Canvas file via PUT /api/v1/files/:id
// Reads from canvas_orphan_files triage table and links to content_map on success.
// Also creates missing Canvas folders on-demand when ai_suggested_folder is set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

    // 2. If ai_suggested_folder is set, ensure the folder exists in Canvas (create if missing)
    let targetFolderId: number | null = null;
    if (row.ai_suggested_folder && row.course_id) {
      try {
        // Look up existing folders in the course
        const foldersResp = await fetch(
          `${baseUrl}/api/v1/courses/${row.course_id}/folders?per_page=100`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (foldersResp.ok) {
          const folders = await foldersResp.json() as Array<{ id: number; name: string; full_name: string }>;
          const match = folders.find(
            (f) =>
              f.name.toLowerCase() === row.ai_suggested_folder!.toLowerCase() ||
              f.full_name.toLowerCase().endsWith(`/${row.ai_suggested_folder!.toLowerCase()}`),
          );
          if (match) {
            targetFolderId = match.id;
          } else {
            // Create the folder
            const createResp = await fetch(
              `${baseUrl}/api/v1/courses/${row.course_id}/folders`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ name: row.ai_suggested_folder, hidden: false }),
              },
            );
            if (createResp.ok) {
              const newFolder = await createResp.json() as { id: number };
              targetFolderId = newFolder.id;
              await supabase.from("deploy_log").insert({
                action: "canvas-file-rename",
                status: "ok",
                message: `Created missing folder "${row.ai_suggested_folder}" in course ${row.course_id}`,
                payload: { folderId: targetFolderId, folderName: row.ai_suggested_folder, courseId: row.course_id },
              });
            }
          }
        }
      } catch {
        // Non-fatal: folder placement is best-effort
      }
    }

    // Build file update payload
    const filePayload: Record<string, unknown> = {
      name: row.ai_suggested_name,
      on_duplicate: "rename",
    };
    if (targetFolderId !== null) {
      filePayload.parent_folder_id = targetFolderId;
    }

    // 3. PUT to Canvas
    const r = await fetch(`${baseUrl}/api/v1/files/${row.canvas_file_id}`, {
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
        original_name: row.ai_suggested_name,
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
      const subject = inferSubjectFromCourse(cfg?.course_ids ?? {}, row.course_id ?? "");
      const type = inferTypeFromRef(row.ai_lesson_ref);
      if (subject) {
        await supabase.from("content_map").upsert(
          {
            subject,
            lesson_ref: row.ai_lesson_ref,
            type,
            canonical_name: row.ai_suggested_name,
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
      message: `Renamed to ${row.ai_suggested_name}`,
      payload: { fileId, canvasFileId: row.canvas_file_id },
    });

    return new Response(
      JSON.stringify({ ok: true, friendly_name: row.ai_suggested_name, canvas_url: updatedCanvasUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
