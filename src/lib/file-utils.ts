/**
 * file-utils.ts
 * Shared utilities for advanced file management in the File Organizer.
 */

export const BATCH_CLASSIFY_JOB_NAME = 'canvas-batch-classify';
export const BATCH_SIZE = 25;
export const PAGE_SIZE = 10;
export const BATCH_MODE_THRESHOLD = 50;

/** Progress info returned from the automation_jobs table */
export interface BatchJobProgress {
  filesProcessed: number;
  filesTotal: number;
  cursor: string | null;
  status: 'idle' | 'running' | 'success' | 'failed';
}

/** Parse the automation_jobs row for batch-classify progress */
// deno-lint-ignore no-explicit-any
export function parseBatchProgress(job: any): BatchJobProgress {
  return {
    filesProcessed: job?.files_processed ?? 0,
    filesTotal: job?.files_total ?? 0,
    cursor: job?.batch_cursor ?? null,
    status: job?.status ?? 'idle',
  };
}

/** Format progress as "23/200 analyzed (12% complete)" */
export function formatBatchProgress(progress: BatchJobProgress): string {
  const { filesProcessed, filesTotal } = progress;
  if (filesTotal === 0) return 'No files to process';
  const pct = Math.round((filesProcessed / filesTotal) * 100);
  return `${filesProcessed}/${filesTotal} analyzed (${pct}% complete)`;
}

/** Group files by their status field */
export function groupByStatus<T extends { status: string }>(files: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const f of files) {
    const key = f.status || 'UNKNOWN';
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  return groups;
}

/** Paginate an array, returning one page */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/** Total number of pages for an array */
export function totalPages(itemCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

/** Smart resume heuristic: already formatted names use spaces and no underscores */
export function isAlreadyFormattedDisplayName(displayName: string | null | undefined): boolean {
  const value = displayName ?? '';
  return value.includes(' ') && !value.includes('_');
}
