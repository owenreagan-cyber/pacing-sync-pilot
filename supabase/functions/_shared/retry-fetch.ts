/**
 * Shared retry-fetch primitive (edge function / Deno side).
 *
 * Mirror of `src/lib/retry-fetch.ts`. Keep both files in sync.
 */

export const DEFAULT_RETRY_STATUS = new Set<number>([429, 503]);
export const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const CAP_DELAY_MS = 12000;

export interface RetryFetchOptions {
  maxRetries?: number;
  retryStatus?: Set<number>;
  onRetry?: (attempt: number, status: number, url: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRetryDelayMs(attempt: number): number {
  const expo = Math.min(CAP_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 400);
  return expo + jitter;
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts: RetryFetchOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryStatus = opts.retryStatus ?? DEFAULT_RETRY_STATUS;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!retryStatus.has(res.status) || attempt === maxRetries) {
        return res;
      }
      opts.onRetry?.(attempt, res.status, url);
      await sleep(getRetryDelayMs(attempt));
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) throw err;
      await sleep(getRetryDelayMs(attempt));
    }
  }
  throw lastErr ?? new Error('fetchWithRetry: exhausted without response');
}
