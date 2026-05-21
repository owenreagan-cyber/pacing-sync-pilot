// Shared Canvas REST API client (read-only).
// Handles base URL normalization, pagination via Link headers, and 429/5xx retry.

const RAW_BASE = Deno.env.get('CANVAS_BASE_URL') ?? 'https://thalesacademy.instructure.com';
const TOKEN = Deno.env.get('CANVAS_API_TOKEN') ?? '';
const SYSTEM_MODE = (Deno.env.get('SYSTEM_MODE') ?? 'LIVE').toUpperCase();

export const CANVAS_BASE = RAW_BASE.replace(/\/+$/, '');
export const IS_DEV_MODE = SYSTEM_MODE === 'DEV';

const WRITE_METHODS = new Set(['PUT', 'POST', 'DELETE', 'PATCH']);
const RETRYABLE_STATUS_CODES = new Set([429, 503]);
const MAX_CANVAS_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number): number {
  const base = 1000;
  const cap = 12000;
  const expo = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 400);
  return expo + jitter;
}

/**
 * Mocked OK response used when DEV mode intercepts a Canvas write.
 * Shape mirrors a tiny subset of `Response` so callers using `.ok` / `.status`
 * / `.json()` / `.text()` continue to work without code changes.
 */
function mockedOkResponse(): Response {
  return new Response(
    JSON.stringify({ ok: true, status: 200, mocked: true, mode: 'DEV' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Global write guard. Any module in this project that performs Canvas
 * mutations should funnel through `canvasWrite` instead of raw `fetch`.
 * In DEV mode, writes are silently aborted and return a 200 mock.
 */
export async function canvasWrite(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (IS_DEV_MODE && WRITE_METHODS.has(method)) {
    console.log('DEV MODE: Canvas Write Aborted', { method, url });
    return mockedOkResponse();
  }
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export interface CanvasPage {
  page_id: number;
  url: string;
  title: string;
  body?: string;
  front_page?: boolean;
  published?: boolean;
  updated_at?: string;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description?: string;
  due_at?: string | null;
  points_possible?: number;
  assignment_group_id?: number;
  published?: boolean;
  html_url?: string;
}

export interface CanvasAnnouncement {
  id: number;
  title: string;
  message?: string;
  posted_at?: string;
  delayed_post_at?: string | null;
  html_url?: string;
}

export interface CanvasFile {
  id: number;
  display_name: string;
  filename: string;
  url?: string;
  content_type?: string;
  size?: number;
  updated_at?: string;
}

export async function fetchCanvasWithRetry(url: string, init?: RequestInit, attempt = 0): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (IS_DEV_MODE && WRITE_METHODS.has(method)) {
    console.log('DEV MODE: Canvas Write Aborted', { method, url });
    return mockedOkResponse();
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (RETRYABLE_STATUS_CODES.has(res.status) && attempt < MAX_CANVAS_RETRIES) {
    await sleep(getRetryDelayMs(attempt));
    return fetchCanvasWithRetry(url, init, attempt + 1);
  }
  return res;
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export async function fetchPaginated<T>(path: string): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  let url = `${CANVAS_BASE}/api/v1${path}${sep}per_page=100`;
  const out: T[] = [];
  let safety = 0;
  while (url && safety < 50) {
    const res = await fetchCanvasWithRetry(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Canvas GET ${url} -> ${res.status}: ${body.slice(0, 200)}`);
    }
    const page = (await res.json()) as T[];
    out.push(...page);
    url = parseNextLink(res.headers.get('link')) ?? '';
    safety++;
  }
  return out;
}

export async function fetchOne<T>(path: string): Promise<T> {
  const url = `${CANVAS_BASE}/api/v1${path}`;
  const res = await fetchCanvasWithRetry(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Canvas GET ${url} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const listPages = (courseId: number) =>
  fetchPaginated<CanvasPage>(`/courses/${courseId}/pages`);
export const getPage = (courseId: number, urlSlug: string) =>
  fetchOne<CanvasPage>(`/courses/${courseId}/pages/${urlSlug}`);
export const listAssignments = (courseId: number) =>
  fetchPaginated<CanvasAssignment>(`/courses/${courseId}/assignments?per_page=100`);
export const listAnnouncements = (courseId: number) =>
  fetchPaginated<CanvasAnnouncement>(
    `/courses/${courseId}/discussion_topics?only_announcements=true`,
  );
export const listFiles = (courseId: number) =>
  fetchPaginated<CanvasFile>(`/courses/${courseId}/files`);

export interface CanvasFolder {
  id: number;
  name: string;
  full_name: string;
  files_count?: number;
  parent_folder_id?: number | null;
}

export const listFolders = (courseId: number) =>
  fetchPaginated<CanvasFolder>(`/courses/${courseId}/folders`);

export const listFolderFiles = (folderId: number) =>
  fetchPaginated<CanvasFile>(`/folders/${folderId}/files`);
