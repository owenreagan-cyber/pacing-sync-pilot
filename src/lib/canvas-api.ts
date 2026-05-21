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

const SYSTEM_MODE =
  (import.meta.env.VITE_SYSTEM_MODE as string | undefined)?.toUpperCase() ?? 'LIVE';

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

export interface MockedCanvasResponse {
  ok: true;
  status: 200;
  mocked: true;
  mode: 'DEV';
}

/**
 * Wrap any fetch() call to Canvas. In DEV mode, write methods are aborted
 * silently and return a mocked OK response.
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
  const response = await fetch(url, init);
  if (!RETRYABLE_STATUS_CODES.has(response.status)) {
    return response;
  }

  for (let attempt = 0; attempt < MAX_CANVAS_RETRIES; attempt += 1) {
    await sleep(getRetryDelayMs(attempt));
    const retryResponse = await fetch(url, init);
    if (!RETRYABLE_STATUS_CODES.has(retryResponse.status)) {
      return retryResponse;
    }
    if (attempt === MAX_CANVAS_RETRIES - 1) {
      return retryResponse;
    }
  }

  return response;
}
