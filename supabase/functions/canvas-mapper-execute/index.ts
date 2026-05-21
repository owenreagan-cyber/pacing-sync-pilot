import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchCanvasWithRetry } from "../_shared/canvas-api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExecuteItem {
  fileId: string;
  suggestedName?: string | null;
  suggestedFolder?: string | null;
}

interface ExecuteResult {
  fileId: string;
  ok: boolean;
  error?: string;
  canvasUrl?: string | null;
}

async function ensureFolder(
  baseUrl: string,
  token: string,
  courseId: string,
  folderName: string,
): Promise<number | null> {
  const foldersResp = await fetchCanvasWithRetry(
    `${baseUrl}/api/v1/courses/${courseId}/folders?per_page=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!foldersResp.ok) return null;

  const folders = await foldersResp.json() as Array<{ id: number; name: string; full_name: string }>;
  const loweredFolder = folderName.toLowerCase();
  const existing = folders.find(
    (f) =>
      f.name.toLowerCase() === loweredFolder ||
      f.full_name.toLowerCase().endsWith(`/${loweredFolder}`),
  );
  if (existing) return existing.id;

  const createResp = await fetchCanvasWithRetry(`${baseUrl}/api/v1/courses/${courseId}/folders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, hidden: false }),
  });

  if (!createResp.ok) return null;
  const created = await createResp.json() as { id: number };
  return created.id;
}

async function executeOne(
  item: ExecuteItem,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  baseUrl: string,
  token: string,
): Promise<ExecuteResult> {
  try {
    const { data: row, error } = await supabase
      .from("canvas_orphan_files")
      .select("*")
      .eq("canvas_file_id", String(item.fileId))
      .maybeSingle();

    if (error || !row) {
      return { fileId: item.fileId, ok: false, error: "Orphan file row not found" };
    }

    const suggestedName = String(item.suggestedName ?? row.ai_suggested_name ?? row.original_name ?? "").trim();
    const suggestedFolder = String(item.suggestedFolder ?? row.ai_suggested_folder ?? "").trim();

    if (!suggestedName) {
      return { fileId: item.fileId, ok: false, error: "Missing suggestedName" };
    }

    let targetFolderId: number | null = null;
    if (suggestedFolder && row.course_id) {
      targetFolderId = await ensureFolder(baseUrl, token, String(row.course_id), suggestedFolder);
    }

    const payload: Record<string, unknown> = {
      name: suggestedName,
      on_duplicate: "rename",
    };
    if (targetFolderId !== null) {
      payload.parent_folder_id = targetFolderId;
    }

    const renameResp = await fetchCanvasWithRetry(`${baseUrl}/api/v1/files/${row.canvas_file_id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await renameResp.text();
    if (!renameResp.ok) {
      return {
        fileId: item.fileId,
        ok: false,
        error: `Canvas ${renameResp.status}: ${text.slice(0, 200)}`,
      };
    }

    let updatedCanvasUrl = row.canvas_url;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.url) updatedCanvasUrl = parsed.url;
    } catch {
      // ignore
    }

    await supabase
      .from("canvas_orphan_files")
      .update({
        ai_suggested_name: suggestedName,
        ai_suggested_folder: suggestedFolder || null,
        original_name: suggestedName,
        canvas_url: updatedCanvasUrl,
        status: "APPROVED",
        updated_at: new Date().toISOString(),
      })
      .eq("canvas_file_id", row.canvas_file_id);

    return { fileId: item.fileId, ok: true, canvasUrl: updatedCanvasUrl };
  } catch (e) {
    return {
      fileId: item.fileId,
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    const baseUrl = (Deno.env.get("CANVAS_BASE_URL") || "").replace(/\/$/, "");
    const token = Deno.env.get("CANVAS_API_TOKEN");
    if (!baseUrl || !token) throw new Error("Canvas credentials missing");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const items: ExecuteItem[] = Array.isArray(body?.items)
      ? body.items
      : body?.fileId
        ? [{ fileId: String(body.fileId), suggestedName: body.suggestedName, suggestedFolder: body.suggestedFolder }]
        : [];

    if (items.length === 0) {
      return new Response(JSON.stringify({ error: "Missing fileId or items[]" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: ExecuteResult[] = [];
    for (const item of items) {
      results.push(await executeOne(item, supabase, baseUrl, token));
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    return new Response(JSON.stringify({ ok: failCount === 0, okCount, failCount, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
