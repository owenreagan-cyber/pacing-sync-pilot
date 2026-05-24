/**
 * THALES OS — Frontend Canvas API guard
 *
 * Global DEV/LIVE safety switch. If `VITE_SYSTEM_MODE === 'DEV'`, all
 * write requests (PUT/POST/DELETE) to Canvas are intercepted and return a
 * mocked successful response. Reads pass through normally.
 *
 * NOTE: most Canvas writes in this app go through edge functions, which
 * have their own DEV guard in `supabase/functions/_shared/canvas-api.ts`.
 * This client-side guard catches any direct browser → Canvas calls.
 */

import { fetchWithRetry } from './retry-fetch';
import { callEdge } from './edge';
import { COURSE_IDS } from './course-ids';

const SYSTEM_MODE =
  (import.meta.env.VITE_SYSTEM_MODE as string | undefined)?.toUpperCase() ?? 'LIVE';

export const IS_DEV_MODE = SYSTEM_MODE === 'DEV';

const WRITE_METHODS = new Set(['PUT', 'POST', 'DELETE', 'PATCH']);

export interface MockedCanvasResponse {
  ok: true;
  status: 200;
  mocked: true;
  mode: 'DEV';
}

/**
 * Wrap any fetch() call to Canvas. In DEV mode, write methods are aborted
 * silently and return a mocked OK response. All real requests funnel
 * through the shared `fetchWithRetry` primitive (see src/lib/retry-fetch.ts).
 */
export async function canvasFetch(
  url: string,
  init?: RequestInit,
): Promise<Response | MockedCanvasResponse> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (IS_DEV_MODE && WRITE_METHODS.has(method)) {
    // eslint-disable-next-line no-console
    console.log('DEV MODE: Canvas Write Aborted', { method, url });
    return { ok: true, status: 200, mocked: true, mode: 'DEV' };
  }
  return fetchWithRetry(url, init);
}

/**
 * A Canvas file as returned by the `canvas-fetch-folder-files` edge function,
 * optionally enriched with course and folder context by `fetchAllCourseFiles`.
 */
export interface CanvasFile {
  id: number;
  display_name: string;
  filename: string;
  url?: string;
  html_url?: string;
  content_type?: string;
  updated_at?: string;
  /** Populated by fetchAllCourseFiles */
  course_id?: number;
  /** Populated by fetchAllCourseFiles */
  subject?: string;
  /** Populated by fetchAllCourseFiles */
  folder_name?: string;
}

interface FolderFilesResponse {
  ok: boolean;
  folder: { id: number; name: string };
  files: Array<Omit<CanvasFile, 'course_id' | 'subject' | 'folder_name'>>;
}

/**
 * Fetch every file from every Canvas course defined in `COURSE_IDS`.
 * Calls the `canvas-fetch-folder-files` edge function for the root
 * "course files" folder of each unique course, then flattens the results
 * into a single `CanvasFile[]` enriched with `course_id`, `subject`, and
 * `folder_name` fields.
 *
 * Courses that share the same Canvas course ID (e.g. Spelling → Reading)
 * are deduplicated so each course is only fetched once.
 */
export async function fetchAllCourseFiles(): Promise<CanvasFile[]> {
  // Deduplicate by course ID — Spelling shares the Reading course
  const seen = new Set<number>();
  const courseEntries: [string, number][] = [];
  for (const [subject, courseId] of Object.entries(COURSE_IDS) as [string, number][]) {
    if (!seen.has(courseId)) {
      seen.add(courseId);
      courseEntries.push([subject, courseId]);
    }
  }

  const results = await Promise.allSettled(
    courseEntries.map(async ([subject, courseId]) => {
      const data = await callEdge<FolderFilesResponse>('canvas-fetch-folder-files', {
        courseId,
        folderName: 'course files',
      });
      const folderName = data.folder?.name ?? 'course files';
      return data.files.map((f) => ({
        ...f,
        course_id: courseId,
        subject,
        folder_name: folderName,
      } as CanvasFile));
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<CanvasFile[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);
}

