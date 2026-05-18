// canvas-cleanup-folders
// Scans Canvas courses for empty folders and deletes them.
// Input (POST): { dryRun?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CanvasFolder {
  id: number;
  name: string;
  full_name: string;
  files_count: number;
  folders_count: number;
  parent_folder_id: number | null;
}

async function fetchAllFolders(baseUrl: string, token: string, courseId: number): Promise<CanvasFolder[]> {
  const out: CanvasFolder[] = [];
  let page = 1;
  while (page < 100) {
    const r = await fetch(
      `${baseUrl}/api/v1/courses/${courseId}/folders?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) break;
    const batch = (await r.json()) as CanvasFolder[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body?.dryRun === true;

    const baseUrl = (Deno.env.get("CANVAS_BASE_URL") || "").replace(/\/$/, "");
    const token = Deno.env.get("CANVAS_API_TOKEN");

    if (!baseUrl || !token) {
      return new Response(JSON.stringify({ error: "Canvas credentials missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load configured course IDs
    const { data: cfg } = await supabase
      .from("system_config")
      .select("course_ids")
      .eq("id", "current")
      .maybeSingle();
    const courseIdMap: Record<string, number> = cfg?.course_ids ?? {};
    const courseIds = [...new Set(Object.values(courseIdMap))];

    const summary = {
      coursesScanned: 0,
      foldersDeleted: 0,
      foldersSkipped: 0,
      folders: [] as Array<{ courseId: number; folderId: number; name: string; action: string }>,
    };

    for (const courseId of courseIds) {
      summary.coursesScanned++;
      const folders = await fetchAllFolders(baseUrl, token, courseId);

      // Delete empty folders — bottom-up (no children) first to avoid conflicts
      // Sort so that deeper folders (longer full_name) come first
      const emptyFolders = folders
        .filter((f) => f.files_count === 0 && f.folders_count === 0 && f.parent_folder_id !== null)
        .sort((a, b) => b.full_name.length - a.full_name.length);

      for (const folder of emptyFolders) {
        if (dryRun) {
          summary.foldersSkipped++;
          summary.folders.push({ courseId, folderId: folder.id, name: folder.full_name, action: "dry_run" });
          continue;
        }

        const r = await fetch(`${baseUrl}/api/v1/folders/${folder.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (r.ok) {
          summary.foldersDeleted++;
          summary.folders.push({ courseId, folderId: folder.id, name: folder.full_name, action: "deleted" });

          await supabase.from("deploy_log").insert({
            action: "canvas-cleanup-folders",
            status: "DELETED",
            message: `Deleted empty folder: ${folder.full_name} (id=${folder.id}, course=${courseId})`,
            payload: { courseId, folderId: folder.id, folderName: folder.full_name },
          });
        } else {
          summary.foldersSkipped++;
          summary.folders.push({ courseId, folderId: folder.id, name: folder.full_name, action: "delete_failed" });

          await supabase.from("deploy_log").insert({
            action: "canvas-cleanup-folders",
            status: "error",
            message: `Failed to delete folder ${folder.id}: Canvas ${r.status}`,
            payload: { courseId, folderId: folder.id },
          });
        }
      }
    }

    await supabase.from("deploy_log").insert({
      action: "canvas-cleanup-folders",
      status: "ok",
      message: `Cleanup complete. Deleted ${summary.foldersDeleted} empty folders across ${summary.coursesScanned} courses.`,
      payload: { dryRun, ...summary },
    });

    return new Response(
      JSON.stringify({ ok: true, dryRun, summary }),
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
