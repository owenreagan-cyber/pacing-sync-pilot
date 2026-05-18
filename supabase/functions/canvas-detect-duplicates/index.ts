// canvas-detect-duplicates
// Compares file_hash across canvas_orphan_files and marks duplicates.
// Keeps earliest-created file as canonical; marks rest with is_duplicate=true.
// Input (POST): { deleteDuplicates?: boolean }  — if true, calls Canvas API to delete them.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface OrphanFileRow {
  canvas_file_id: string;
  course_id: string | null;
  original_name: string | null;
  canvas_url: string | null;
  file_hash: string | null;
  is_duplicate: boolean;
  canonical_file_id: string | null;
  created_at: string;
  status: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const deleteDuplicates: boolean = body?.deleteDuplicates === true;

    const baseUrl = (Deno.env.get("CANVAS_BASE_URL") || "").replace(/\/$/, "");
    const token = Deno.env.get("CANVAS_API_TOKEN");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch all files that have a hash computed
    const { data: allFiles, error: fetchErr } = await supabase
      .from("canvas_orphan_files")
      .select("canvas_file_id, course_id, original_name, canvas_url, file_hash, is_duplicate, canonical_file_id, created_at, status")
      .not("file_hash", "is", null)
      .order("created_at", { ascending: true });

    if (fetchErr) throw fetchErr;

    const files = (allFiles ?? []) as OrphanFileRow[];

    // Group files by hash
    const hashGroups: Record<string, OrphanFileRow[]> = {};
    for (const f of files) {
      if (!f.file_hash) continue;
      if (!hashGroups[f.file_hash]) hashGroups[f.file_hash] = [];
      hashGroups[f.file_hash].push(f);
    }

    let duplicatesFound = 0;
    let duplicatesDeleted = 0;
    const duplicatePairs: Array<{
      hash: string;
      canonical: string;
      duplicate: string;
      action: string;
    }> = [];

    for (const [hash, group] of Object.entries(hashGroups)) {
      if (group.length < 2) continue;

      // First by created_at is canonical (already sorted ascending)
      const canonical = group[0];
      const dups = group.slice(1);

      for (const dup of dups) {
        duplicatesFound++;

        // Mark as duplicate in DB
        await supabase
          .from("canvas_orphan_files")
          .update({
            is_duplicate: true,
            canonical_file_id: canonical.canvas_file_id,
            updated_at: new Date().toISOString(),
          })
          .eq("canvas_file_id", dup.canvas_file_id);

        let action = "marked";

        if (deleteDuplicates && baseUrl && token) {
          // Delete via Canvas API
          const r = await fetch(`${baseUrl}/api/v1/files/${dup.canvas_file_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });

          if (r.ok) {
            await supabase
              .from("canvas_orphan_files")
              .update({ status: "DELETED", updated_at: new Date().toISOString() })
              .eq("canvas_file_id", dup.canvas_file_id);

            await supabase.from("deploy_log").insert({
              action: "canvas-detect-duplicates",
              status: "DELETED",
              message: `Deleted duplicate file ${dup.canvas_file_id} (dup of ${canonical.canvas_file_id}, hash=${hash.slice(0, 8)}…)`,
              payload: { hash, canonical: canonical.canvas_file_id, duplicate: dup.canvas_file_id },
            });

            duplicatesDeleted++;
            action = "deleted";
          } else {
            action = "delete_failed";
            await supabase.from("deploy_log").insert({
              action: "canvas-detect-duplicates",
              status: "error",
              message: `Failed to delete duplicate ${dup.canvas_file_id}: Canvas ${r.status}`,
              payload: { hash, duplicate: dup.canvas_file_id },
            });
          }
        }

        duplicatePairs.push({
          hash: hash.slice(0, 16) + "…",
          canonical: canonical.canvas_file_id,
          duplicate: dup.canvas_file_id,
          action,
        });
      }
    }

    await supabase.from("deploy_log").insert({
      action: "canvas-detect-duplicates",
      status: "ok",
      message: `Found ${duplicatesFound} duplicates. Deleted: ${duplicatesDeleted}.`,
      payload: { duplicatesFound, duplicatesDeleted, deleteDuplicates },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        duplicatesFound,
        duplicatesDeleted,
        pairs: duplicatePairs,
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
