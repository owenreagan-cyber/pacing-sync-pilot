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
  sourceFolder?: {
    courseId: number | null;
    folderId: number;
    fullName: string;
    filesCount: number;
    foldersCount: number;
    parentFolderId: number | null;
    isEmpty: boolean;
  } | null;
}

const MAX_CANVAS_NAME_LENGTH = 120;

interface CanvasFolder {
  id: number;
  full_name: string;
  files_count?: number;
  folders_count?: number;
  parent_folder_id?: number | null;
}

interface CanvasFileDetails {
  id: number;
  display_name?: string;
  folder_id?: number | null;
}

async function writeRollbackLog(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  entry: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("dev_canvas_logs").insert(entry);
  if (error) {
    console.warn("canvas-mapper-execute rollback log failed", error);
  }
}

async function fetchFolderById(
  baseUrl: string,
  token: string,
  folderId: number,
): Promise<CanvasFolder | null> {
  const resp = await fetchCanvasWithRetry(`${baseUrl}/api/v1/folders/${folderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;
  return await resp.json() as CanvasFolder;
}

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

async function ensureFolder(
  baseUrl: string,
  token: string,
  courseId: string,
  folderPath: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rollbackContext: {
    fileId: string;
    originalName: string | null;
    suggestedName: string;
  },
): Promise<number | null> {
  const segments = folderPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  const foldersResp = await fetchCanvasWithRetry(
    `${baseUrl}/api/v1/courses/${courseId}/folders?per_page=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!foldersResp.ok) return null;

  const folders = await foldersResp.json() as Array<{ id: number; full_name: string }>;
  const existingByPath = new Map(
    folders.map((folder) => [folder.full_name.toLowerCase(), folder.id] as const),
  );

  let parentFolderId: number | null = null;
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const key = currentPath.toLowerCase();
    const existing = existingByPath.get(key);
    if (existing) {
      parentFolderId = existing;
      continue;
    }

    await writeRollbackLog(supabase, {
      deployment_mode: "live",
      action: "canvas_folder_create_rollback",
      subject: "File Organizer Execution",
      course_id: Number.parseInt(courseId, 10),
      status: "pending",
      metadata: {
        fileId: rollbackContext.fileId,
        originalName: rollbackContext.originalName,
        suggestedName: rollbackContext.suggestedName,
        folderPath: currentPath,
        parentFolderId,
        rollbackAction: "Delete the created folder if this organization run is reverted and the folder is still unused.",
      },
    });

    const createResp = await fetchCanvasWithRetry(`${baseUrl}/api/v1/courses/${courseId}/folders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: segment,
        hidden: false,
        parent_folder_id: parentFolderId ?? undefined,
      }),
    });

    if (!createResp.ok) return parentFolderId;
    const created = await createResp.json() as { id: number };
    parentFolderId = created.id;
    existingByPath.set(key, created.id);
  }

  return parentFolderId;
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

    const suggestedName = normalizeCanvasFileName(
      String(item.suggestedName ?? row.ai_suggested_name ?? row.original_name ?? "").trim(),
    );
    const suggestedFolder = String(item.suggestedFolder ?? row.ai_suggested_folder ?? "").trim();

    if (!suggestedName) {
      return { fileId: item.fileId, ok: false, error: "Missing suggestedName" };
    }

    const fileResp = await fetchCanvasWithRetry(`${baseUrl}/api/v1/files/${row.canvas_file_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fileDetails = fileResp.ok
      ? await fileResp.json() as CanvasFileDetails
      : null;
    const sourceFolderId = typeof fileDetails?.folder_id === "number" ? fileDetails.folder_id : null;
    const sourceFolder = sourceFolderId !== null
      ? await fetchFolderById(baseUrl, token, sourceFolderId)
      : null;
    const originalCanvasName = fileDetails?.display_name?.trim() || row.original_name || null;

    let targetFolderId: number | null = null;
    if (suggestedFolder && row.course_id) {
      targetFolderId = await ensureFolder(baseUrl, token, String(row.course_id), suggestedFolder, supabase, {
        fileId: String(row.canvas_file_id),
        originalName: originalCanvasName,
        suggestedName,
      });
    }

    const payload: Record<string, unknown> = {
      name: suggestedName,
      on_duplicate: "rename",
    };
    if (targetFolderId !== null) {
      payload.parent_folder_id = targetFolderId;
    }

    await writeRollbackLog(supabase, {
      deployment_mode: "live",
      action: "canvas_file_rename_move_rollback",
      subject: "File Organizer Execution",
      course_id: row.course_id ? Number.parseInt(String(row.course_id), 10) : null,
      status: "pending",
      metadata: {
        fileId: row.canvas_file_id,
        canvasFileId: row.canvas_file_id,
        oldName: originalCanvasName,
        oldFolderId: sourceFolderId,
        oldFolder: sourceFolder?.full_name ?? null,
        newName: suggestedName,
        newFolder: suggestedFolder || null,
        targetFolderId,
        rollbackAction: {
          restoreName: originalCanvasName,
          restoreFolderId: sourceFolderId,
        },
      },
    });

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

    const refreshedSourceFolder = sourceFolderId !== null
      ? await fetchFolderById(baseUrl, token, sourceFolderId)
      : null;

    return {
      fileId: item.fileId,
      ok: true,
      canvasUrl: updatedCanvasUrl,
      sourceFolder: refreshedSourceFolder
        ? {
          courseId: row.course_id ? Number.parseInt(String(row.course_id), 10) : null,
          folderId: refreshedSourceFolder.id,
          fullName: refreshedSourceFolder.full_name,
          filesCount: refreshedSourceFolder.files_count ?? 0,
          foldersCount: refreshedSourceFolder.folders_count ?? 0,
          parentFolderId: refreshedSourceFolder.parent_folder_id ?? null,
          isEmpty: (refreshedSourceFolder.files_count ?? 0) === 0 &&
            (refreshedSourceFolder.folders_count ?? 0) === 0,
        }
        : null,
    };
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
