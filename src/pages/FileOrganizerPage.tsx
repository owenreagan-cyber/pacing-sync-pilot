import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sparkles,
  RefreshCw,
  FileText,
  CheckCircle2,
  ExternalLink,
  Inbox,
  Loader2,
  Layers,
  Trash2,
  FolderX,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import {
  BATCH_MODE_THRESHOLD,
  BATCH_CLASSIFY_JOB_NAME,
  PAGE_SIZE,
  formatBatchProgress,
  isAlreadyFormattedDisplayName,
  parseBatchProgress,
  paginate,
  totalPages,
  type BatchJobProgress,
} from '@/lib/file-utils';
import { useVirtualizer } from '@tanstack/react-virtual';

interface OrphanFile {
  canvas_file_id: string;
  course_id: string | null;
  original_name: string | null;
  canvas_url: string | null;
  ai_suggested_name: string | null;
  ai_suggested_folder: string | null;
  ai_lesson_ref: string | null;
  ai_purpose: string[] | null;
  ai_snippet: string | null;
  ai_resource_type: string | null;
  ai_folder_chunked: boolean | null;
  ai_confidence: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  // New columns (Task 2)
  file_hash: string | null;
  is_duplicate: boolean;
  canonical_file_id: string | null;
  batch_job_id: string | null;
}

interface MapperResult {
  resourceType: string;
  purpose: string[];
  snippet: string;
  suggestedName: string;
  suggestedFolder: string;
  confidence?: number;
  alreadyFormatted?: boolean;
  fileHash?: string | null;
  isDuplicate?: boolean;
  canonicalFileId?: string | null;
}

const GLOBAL_MAPPER_SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'] as const;
const MAPPER_MAX_CONCURRENCY = 5;
const EXECUTE_CHUNK_SIZE = 25;
const MASS_ORG_CHUNK_SIZE = 5;
const PAUSE_POLL_MS = 150;
const UNTITLED_SCAN_PATTERN = /^(untitled|scan)/i;

function getCurrentPath(row: OrphanFile): string {
  return (row.original_name ?? row.canvas_file_id).trim();
}

function getProposedPath(row: OrphanFile): string {
  const proposedName = row.ai_suggested_name?.trim() || row.original_name?.trim() || row.canvas_file_id;
  const proposedFolder = row.ai_suggested_folder?.trim();
  return proposedFolder ? `${proposedFolder}/${proposedName}` : proposedName;
}

function getCurrentPath(row: OrphanFile): string {
  return (row.original_name ?? row.canvas_file_id).trim();
}

function getProposedPath(row: OrphanFile): string {
  const proposedName = row.ai_suggested_name?.trim() || row.original_name?.trim() || row.canvas_file_id;
  const proposedFolder = row.ai_suggested_folder?.trim();
  return proposedFolder ? `${proposedFolder}/${proposedName}` : proposedName;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSingleLevelFolder(folder: string | null | undefined): string | null {
  if (!folder) return null;
  const firstSegment = folder
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean)[0];
  return firstSegment ?? null;
}

function inferWorkflowSubject(courseLabel: string): WorkflowSubject | null {
  const value = courseLabel.toLowerCase();
  if (value.includes('math')) return 'math';
  if (value.includes('reading')) return 'reading';
  if (value.includes('language art') || value.includes('language arts') || value.includes('spelling')) return 'language_art';
  if (value.includes('history')) return 'history';
  if (value.includes('science')) return 'science';
  return null;
}

export default function FileOrganizerPage() {
  const [files, setFiles] = useState<OrphanFile[]>([]);
  const [approvedFiles, setApprovedFiles] = useState<OrphanFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [inboxTab, setInboxTab] = useState<'pending' | 'approved'>('pending');

  // Local editable fields for the selected file
  const [editName, setEditName] = useState('');
  const [editLessonRef, setEditLessonRef] = useState('');

  // Task 1: Batch processing state
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchJobProgress | null>(null);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Task 2: Duplicate detection state
  const [detectingDuplicates, setDetectingDuplicates] = useState(false);
  const [deletingDuplicates, setDeletingDuplicates] = useState(false);

  // Task 3: Folder cleanup state
  const [cleaningFolders, setCleaningFolders] = useState(false);

  // Task 4: Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  const [mapperCourseId, setMapperCourseId] = useState<string>('');
  const [courseOptions, setCourseOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [mapperRows, setMapperRows] = useState<OrphanFile[]>([]);
  const [mapperLoading, setMapperLoading] = useState(false);
  const [mapperRunning, setMapperRunning] = useState(false);
  const [mapperExecuting, setMapperExecuting] = useState(false);
  const [mapperProgress, setMapperProgress] = useState({ current: 0, total: 0 });
  const [mapperProgressLabel, setMapperProgressLabel] = useState<string>('Processing files');
  const [rowExecutingId, setRowExecutingId] = useState<string | null>(null);
  const [isDryRun, setIsDryRun] = useState(false);
  const [collisionIds, setCollisionIds] = useState<Set<string>>(new Set());
  const [mapperPaused, setMapperPaused] = useState(false);
  const [mapperCancelRequested, setMapperCancelRequested] = useState(false);
  const [mapperInFlightCount, setMapperInFlightCount] = useState(0);
  const [massOrganizing, setMassOrganizing] = useState(false);
  const [cleanupUntitled, setCleanupUntitled] = useState(false);
  const [globalSweepRunning, setGlobalSweepRunning] = useState(false);
  const [globalSweepProgress, setGlobalSweepProgress] = useState<{
    current: number;
    total: number;
    label: string;
    scanned: number;
    upserted: number;
    failedCourses: number;
  } | null>(null);
  const mapperPausedRef = useRef(false);
  const mapperCancelRequestedRef = useRef(false);
  const mapperTableContainerRef = useRef<HTMLDivElement | null>(null);

  const selected =
    files.find((f) => f.canvas_file_id === selectedId) ??
    approvedFiles.find((f) => f.canvas_file_id === selectedId) ??
    null;
  const isSelectedApproved = selected?.status === 'APPROVED';
  const isBatchMode = files.length >= BATCH_MODE_THRESHOLD;
  const visibleFiles = isBatchMode
    ? paginate(files, currentPage, PAGE_SIZE)
    : files;
  const numPages = isBatchMode ? totalPages(files.length, PAGE_SIZE) : 1;
  const mapperRowVirtualizer = useVirtualizer({
    count: mapperRows.length,
    getScrollElement: () => mapperTableContainerRef.current,
    estimateSize: () => 112,
    overscan: 8,
  });
  const virtualMapperRows = mapperRowVirtualizer.getVirtualItems();
  const mapperPaddingTop = virtualMapperRows.length > 0 ? virtualMapperRows[0].start : 0;
  const mapperPaddingBottom =
    virtualMapperRows.length > 0
      ? mapperRowVirtualizer.getTotalSize() - virtualMapperRows[virtualMapperRows.length - 1].end
      : 0;
  const strategyPreviewRows = useMemo(
    () =>
      mapperRows.map((row) => {
        const currentPath = getCurrentPath(row);
        const proposedPath = getProposedPath(row);
        return {
          fileId: row.canvas_file_id,
          currentPath,
          proposedPath,
          changed: currentPath !== proposedPath,
        };
      }),
    [mapperRows],
  );

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('canvas_orphan_files')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Failed to load files', { description: error.message });
    } else {
      setFiles((data ?? []) as OrphanFile[]);
      setCurrentPage(1);
    }
    setLoading(false);
  }, []);

  const loadApprovedFiles = useCallback(async () => {
    const { data, error } = await supabase
      .from('canvas_orphan_files')
      .select('*')
      .eq('status', 'APPROVED')
      .order('updated_at', { ascending: false });
    if (error) {
      toast.error('Failed to load approved files', { description: error.message });
    } else {
      setApprovedFiles((data ?? []) as OrphanFile[]);
    }
  }, []);

  const loadCourseOptions = useCallback(async () => {
    const { data, error } = await supabase
      .from('system_config')
      .select('course_ids')
      .eq('id', 'current')
      .maybeSingle();

    if (error) {
      toast.error('Failed to load course IDs', { description: error.message });
      return;
    }

    const courseIds = (data?.course_ids ?? {}) as Record<string, number | string>;
    const nextOptions = Object.entries(courseIds).map(([label, value]) => ({
      label,
      value: String(value),
    }));
    setCourseOptions(nextOptions);
    if (!mapperCourseId && nextOptions.length > 0) {
      setMapperCourseId(nextOptions[0].value);
    }
  }, [mapperCourseId]);

  const loadMapperRows = useCallback(async () => {
    if (!mapperCourseId) return;
    setMapperLoading(true);
    const { data, error } = await supabase
      .from('canvas_orphan_files')
      .select('*')
      .eq('status', 'PENDING')
      .eq('course_id', mapperCourseId)
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('Failed to load course files', { description: error.message });
    } else {
      setMapperRows((data ?? []) as OrphanFile[]);
    }
    setMapperLoading(false);
  }, [mapperCourseId]);

  const updateMapperRowField = useCallback(
    (fileId: string, patch: Partial<OrphanFile>) => {
      setMapperRows((prev) =>
        prev.map((row) => (row.canvas_file_id === fileId ? { ...row, ...patch } : row)),
      );
      setFiles((prev) =>
        prev.map((row) => (row.canvas_file_id === fileId ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const classifyAlreadyFormatted = useCallback(
    async (row: OrphanFile): Promise<MapperResult> => {
      const fallbackName = row.original_name ?? row.canvas_file_id;
      const fallbackFolder = row.ai_suggested_folder ?? 'Already Formatted';
      const patch = {
        ai_suggested_name: fallbackName,
        ai_suggested_folder: fallbackFolder,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('canvas_orphan_files')
        .update(patch)
        .eq('canvas_file_id', row.canvas_file_id);
      if (error) throw error;
      updateMapperRowField(row.canvas_file_id, patch);
      return {
        resourceType: row.ai_resource_type ?? 'Already Formatted',
        purpose: row.ai_purpose ?? ['Already Formatted'],
        snippet: (row.ai_snippet ?? fallbackName).slice(0, 200),
        suggestedName: patch.ai_suggested_name,
        suggestedFolder: patch.ai_suggested_folder,
        alreadyFormatted: true,
      };
    },
    [updateMapperRowField],
  );

  const runMapperSequentially = useCallback(async (rows: OrphanFile[], title: string) => {
    if (rows.length === 0) {
      toast.info('No files found to map');
      return;
    }
    setMapperRunning(true);
    setMapperPaused(false);
    setMapperCancelRequested(false);
    mapperPausedRef.current = false;
    mapperCancelRequestedRef.current = false;
    setMapperInFlightCount(0);
    setMapperProgressLabel('Mapping files');
    setMapperProgress({ current: 0, total: rows.length });

    let skipped = 0;
    let mapped = 0;
    let failed = 0;
    let completed = 0;
    let nextIndex = 0;

    try {
      const processOne = async (row: OrphanFile) => {
        const displayName = row.original_name ?? '';
        const alreadyFormatted = isAlreadyFormattedDisplayName(displayName);

        if (alreadyFormatted) {
          await classifyAlreadyFormatted(row);
          skipped += 1;
          return;
        }

        const { data, error } = await supabase.functions.invoke('canvas-mapper-classify', {
          body: { canvasFileId: row.canvas_file_id },
        });
        if (error) throw error;
        if ((data)?.error) throw new Error((data).error);

        const mappedRow = data as MapperResult;
        updateMapperRowField(row.canvas_file_id, {
          ai_suggested_name: mappedRow.suggestedName,
          ai_suggested_folder: mappedRow.suggestedFolder,
          ai_resource_type: mappedRow.resourceType,
          ai_purpose: mappedRow.purpose,
          ai_snippet: mappedRow.snippet,
          ai_folder_chunked: !!mappedRow.suggestedFolder.match(/\d+\s*-\s*\d+/),
          file_hash: mappedRow.fileHash ?? null,
          is_duplicate: mappedRow.isDuplicate ?? false,
          canonical_file_id: mappedRow.canonicalFileId ?? null,
        });
        mapped += 1;
      };

      const workerCount = Math.min(MAPPER_MAX_CONCURRENCY, rows.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          if (mapperCancelRequestedRef.current) return;

          while (mapperPausedRef.current && !mapperCancelRequestedRef.current) {
            await sleep(PAUSE_POLL_MS);
          }
          if (mapperCancelRequestedRef.current) return;

          const idx = nextIndex;
          nextIndex += 1;
          if (idx >= rows.length) return;
          const row = rows[idx];

          setMapperInFlightCount((prev) => prev + 1);
          try {
            await processOne(row);
          } catch (e: any) {
            failed += 1;
            toast.error('File map failed', {
              description: `${row.original_name ?? row.canvas_file_id}: ${e?.message ?? String(e)}`,
            });
          } finally {
            completed += 1;
            setMapperProgress({ current: completed, total: rows.length });
            setMapperInFlightCount((prev) => Math.max(0, prev - 1));
            await sleep(0);
          }
        }
      });

      await Promise.all(workers);

      if (mapperCancelRequestedRef.current) {
        toast.info('Mapping canceled', {
          description: `${mapped} AI-mapped, ${skipped} already formatted, ${failed} failed`,
        });
      } else if (failed > 0) {
        toast.warning(`${title} completed with errors`, {
          description: `${mapped} AI-mapped, ${skipped} already formatted, ${failed} failed`,
        });
      } else {
        toast.success(title, {
          description: `${mapped} AI-mapped, ${skipped} already formatted`,
        });
      }
    } finally {
      setMapperRunning(false);
      setMapperPaused(false);
      setMapperCancelRequested(false);
      mapperPausedRef.current = false;
      mapperCancelRequestedRef.current = false;
      setMapperInFlightCount(0);
    }
  }, [classifyAlreadyFormatted, updateMapperRowField]);

  const mapCourseSequentially = useCallback(async () => {
    if (!mapperCourseId) {
      toast.error('Select a course first');
      return;
    }
    if (mapperRows.length === 0) {
      toast.info('No files found for this course');
      return;
    }
    await runMapperSequentially(mapperRows, 'Content mapping complete');
  }, [mapperCourseId, mapperRows, runMapperSequentially]);

  const mapAllCoursesSequentially = useCallback(async () => {
    if (courseOptions.length === 0) {
      toast.error('No course IDs configured');
      return;
    }
    const selectedCourses = courseOptions.filter((opt) => opt.value?.trim().length > 0);

    setMapperLoading(true);
    try {
      const rowsByCourse = await Promise.allSettled(
        selectedCourses.map(async (opt) => {
          const parsedCourseId = Number.parseInt(opt.value, 10);
          if (!Number.isFinite(parsedCourseId) || parsedCourseId <= 0) {
            throw new Error(`${opt.label}: invalid course id "${opt.value}"`);
          }
          const { data, error } = await supabase
            .from('canvas_orphan_files')
            .select('*')
            .eq('status', 'PENDING')
            .eq('course_id', String(parsedCourseId))
            .order('created_at', { ascending: true });
          if (error) throw new Error(`${opt.label}: ${error.message}`);
          return (data ?? []) as OrphanFile[];
        }),
      );

      const failedCourses = rowsByCourse
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => String(result.reason?.message ?? result.reason ?? 'Unknown error'));
      if (failedCourses.length > 0) {
        toast.warning('Some courses failed to load', {
          description: failedCourses.slice(0, 3).join(' • '),
        });
      }

      const dedupedRows = Array.from(
        new Map(
          rowsByCourse
            .filter((result): result is PromiseFulfilledResult<OrphanFile[]> => result.status === 'fulfilled')
            .flatMap((result) => result.value)
            .map((row) => [String(row.canvas_file_id), row] as const),
        ).values(),
      );

      setMapperRows(dedupedRows);

      if (dedupedRows.length === 0) {
        toast.info('No files found across all target courses');
        return;
      }

      await runMapperSequentially(dedupedRows, 'Global content mapping complete');
    } catch (e: any) {
      toast.error('Global content mapping failed', { description: e?.message ?? String(e) });
    } finally {
      setMapperLoading(false);
    }
  }, [courseOptions, runMapperSequentially]);

  const handlePauseResumeSweep = useCallback(() => {
    if (!mapperRunning || mapperCancelRequested) return;
    setMapperPaused((prev) => !prev);
  }, [mapperCancelRequested, mapperRunning]);

  const handleCancelSweep = useCallback(() => {
    if (!mapperRunning) return;
    setMapperCancelRequested(true);
    setMapperPaused(false);
  }, [mapperRunning]);

  const logMapperDryRunChanges = useCallback(async (rows: OrphanFile[]) => {
    if (rows.length === 0) return 0;

    const logEntries = rows.map((row) => {
      const oldName = row.original_name ?? row.canvas_file_id;
      const oldFolder = oldName.includes('/') ? oldName.split('/').slice(0, -1).join('/') || null : null;
      const newName = row.ai_suggested_name?.trim() || oldName;
      const newFolder = row.ai_suggested_folder?.trim() || null;
      const parsedCourseId = row.course_id ? Number.parseInt(row.course_id, 10) : null;

      return {
        deployment_mode: 'dry-run',
        action: 'content_mapper_file_rename_move',
        subject: 'File Organizer Content Mapper',
        course_id: Number.isNaN(parsedCourseId) ? null : parsedCourseId,
        status: 'simulated',
        metadata: {
          fileId: row.canvas_file_id,
          oldName,
          newName,
          oldFolder,
          newFolder,
          nameChange: `${oldName} -> ${newName}`,
          folderChange: `${oldFolder ?? 'Unknown'} -> ${newFolder ?? 'Unknown'}`,
        },
      };
    });

    const { error } = await (supabase as any).from('dev_canvas_logs').insert(logEntries);
    if (error) throw error;
    return logEntries.length;
  }, []);

  const detectNameCollisions = useCallback((rows: OrphanFile[]): Set<string> => {
    const seen = new Map<string, string>(); // collision key -> first fileId
    const collisions = new Set<string>();
    for (const row of rows) {
      const name = (row.ai_suggested_name ?? '').trim().toLowerCase();
      const folder = (row.ai_suggested_folder ?? '').trim().toLowerCase();
      const courseId = row.course_id ?? '';
      if (!name) continue;
      const key = `${courseId}|${folder}|${name}`;
      if (seen.has(key)) {
        collisions.add(row.canvas_file_id);
        collisions.add(seen.get(key)!);
      } else {
        seen.set(key, row.canvas_file_id);
      }
    }
    return collisions;
  }, []);

  const executeMapperRow = useCallback(
    async (row: OrphanFile, currentMapperRows: OrphanFile[]) => {
      // Collision check: abort if another file targets the same name+folder+course
      const collisions = detectNameCollisions(currentMapperRows);
      if (collisions.has(row.canvas_file_id)) {
        setCollisionIds(collisions);
        toast.error('Collision Detected', {
          description: `"${row.ai_suggested_name}" already targets folder "${row.ai_suggested_folder ?? ''}" for course ${row.course_id ?? ''}`,
        });
        return;
      }

      setRowExecutingId(row.canvas_file_id);
      try {
        if (isDryRun) {
          const logged = await logMapperDryRunChanges([row]);
          toast.success(`Dry Run: Logged ${logged} changes to simulation database`);
          return;
        }

        const { data, error } = await supabase.functions.invoke('canvas-mapper-execute', {
          body: {
            fileId: row.canvas_file_id,
            suggestedName: row.ai_suggested_name,
            suggestedFolder: row.ai_suggested_folder,
          },
        });
        if (error) throw error;
        if ((data)?.error) throw new Error((data).error);
        setMapperRows((prev) => prev.filter((r) => r.canvas_file_id !== row.canvas_file_id));
        setFiles((prev) => prev.filter((r) => r.canvas_file_id !== row.canvas_file_id));
        toast.success('Applied to Canvas', { description: row.ai_suggested_name ?? row.original_name ?? '' });
      } catch (e: any) {
        toast.error('Apply failed', { description: e?.message ?? String(e) });
      } finally {
        setRowExecutingId(null);
      }
    },
    [isDryRun, logMapperDryRunChanges, detectNameCollisions],
  );

  const executeMapperBulk = useCallback(async () => {
    if (mapperRows.length === 0) {
      toast.info('No mapped rows to execute');
      return;
    }

    // Detect name collisions before any execution
    const collisions = detectNameCollisions(mapperRows);
    setCollisionIds(collisions);
    if (collisions.size > 0) {
      toast.warning(`${collisions.size} collision(s) detected`, {
        description: 'Files with duplicate name+folder combinations will be skipped and flagged.',
      });
    }

    const rowsToExecute = mapperRows.filter((row) => !collisions.has(row.canvas_file_id));
    if (rowsToExecute.length === 0) {
      toast.error('All files have name collisions — resolve them before executing.');
      return;
    }

    setMapperExecuting(true);
    setMapperProgressLabel('Executing rename & move');
    setMapperProgress({ current: 0, total: rowsToExecute.length });
    try {
      if (isDryRun) {
        const logged = await logMapperDryRunChanges(rowsToExecute);
        setMapperProgress({ current: rowsToExecute.length, total: rowsToExecute.length });
        toast.success(`Dry Run: Logged ${logged} changes to simulation database`);
        return;
      }

      // Rate-limited execution: 1 file per second to avoid Canvas API 429 errors
      const succeededIds = new Set<string>();

      for (let i = 0; i < rowsToExecute.length; i++) {
        const row = rowsToExecute[i];

        const { data, error } = await supabase.functions.invoke('canvas-mapper-execute', {
          body: {
            fileId: row.canvas_file_id,
            suggestedName: row.ai_suggested_name,
            suggestedFolder: row.ai_suggested_folder,
          },
        });

        if (!error && !(data as any)?.error) {
          succeededIds.add(String(row.canvas_file_id));
        }

        setMapperProgress({ current: i + 1, total: rowsToExecute.length });

        // 1-per-second rate limit (skip delay after the last file)
        if (i < rowsToExecute.length - 1) {
          await sleep(1000);
        }
      }

      setMapperRows((prev) => prev.filter((row) => !succeededIds.has(String(row.canvas_file_id))));
      setFiles((prev) => prev.filter((row) => !succeededIds.has(String(row.canvas_file_id))));
      toast.success('Bulk rename & move complete', {
        description: `${succeededIds.size} file(s) applied`,
      });
    } catch (e: any) {
      toast.error('Bulk execute failed', { description: e?.message ?? String(e) });
    } finally {
      setMapperExecuting(false);
      setMapperProgress((prev) => (prev.total === prev.current ? prev : { current: 0, total: 0 }));
    }
  }, [isDryRun, logMapperDryRunChanges, mapperRows, detectNameCollisions]);

  /**
   * Safe Execution Loop — processes files in chunks of MASS_ORG_CHUNK_SIZE (5)
   * using Promise.all to avoid Canvas API rate-limiting (429 errors).
   *
   * Before each chunk the full "Before State" is written to dev_canvas_logs as a
   * failsafe/rollback record. On per-file failure the row is marked FAILED in
   * canvas_orphan_files and the loop continues with the next chunk. After the
   * run, any source folders reported by Canvas as empty are deleted via the
   * canvas-cleanup-folders edge function.
   */
  const handleExecuteMassOrganization = useCallback(async () => {
    if (mapperRows.length === 0) {
      toast.info('No mapped rows to execute');
      return;
    }

    setMassOrganizing(true);
    setMapperProgressLabel('Safe-executing rename & move');
    setMapperProgress({ current: 0, total: mapperRows.length });

    const rows = [...mapperRows];
    try {
      if (isDryRun) {
        const logged = await logMapperDryRunChanges(rows);
        setMapperProgress({ current: rows.length, total: rows.length });
        toast.success(`Dry Run: Logged ${logged} changes to simulation database`);
        return;
      }

      const chunks: OrphanFile[][] = [];
      for (let i = 0; i < rows.length; i += MASS_ORG_CHUNK_SIZE) {
        chunks.push(rows.slice(i, i + MASS_ORG_CHUNK_SIZE));
      }

      const succeededIds = new Set<string>();
      const failedIds = new Set<string>();
      const emptiedSourceFolders = new Map<string, { courseId: number; folderId: number; folderName: string }>();
      let processed = 0;

      for (const chunk of chunks) {
        // Failsafe: log "Before State" for every file in the chunk before touching Canvas
        const beforeStateEntries = chunk.map((row) => ({
          deployment_mode: 'live',
          action: 'mass_organization_before_state',
          subject: 'File Organizer Safe Execution',
          course_id: row.course_id ? Number.parseInt(row.course_id, 10) : null,
          status: 'before_state',
          metadata: {
            fileId: row.canvas_file_id,
            originalName: row.original_name,
            currentStatus: row.status,
            suggestedName: row.ai_suggested_name,
            suggestedFolder: row.ai_suggested_folder,
          },
        }));
        try {
          await (supabase as any).from('dev_canvas_logs').insert(beforeStateEntries);
        } catch {
          // Non-fatal: don't abort the whole loop if logging fails
          console.warn('handleExecuteMassOrganization: failed to write before-state to dev_canvas_logs');
        }

        // Process chunk concurrently — 5 files at a time to avoid 429s
        await Promise.all(
          chunk.map(async (row) => {
            try {
              const { data, error } = await supabase.functions.invoke('canvas-mapper-execute', {
                body: {
                  fileId: row.canvas_file_id,
                  suggestedName: row.ai_suggested_name,
                  suggestedFolder: row.ai_suggested_folder,
                },
              });
              if (error) throw error;
              if ((data)?.error) throw new Error((data).error);

              // The edge function returns { results: [{fileId, ok, error?}] } for single items
              const result = (
                data?.results as Array<{
                  fileId: string;
                  ok: boolean;
                  error?: string;
                  sourceFolder?: {
                    courseId: number | null;
                    folderId: number;
                    fullName: string;
                    parentFolderId: number | null;
                    isEmpty: boolean;
                  } | null;
                }>
              )?.[0];
              if (result && !result.ok) {
                throw new Error(result.error ?? 'Canvas execution failed');
              }

              succeededIds.add(row.canvas_file_id);
              if (
                result?.sourceFolder?.isEmpty &&
                result.sourceFolder.courseId !== null &&
                result.sourceFolder.parentFolderId !== null
              ) {
                emptiedSourceFolders.set(
                  `${result.sourceFolder.courseId}:${result.sourceFolder.folderId}`,
                  {
                    courseId: result.sourceFolder.courseId,
                    folderId: result.sourceFolder.folderId,
                    folderName: result.sourceFolder.fullName,
                  },
                );
              }
            } catch (e: any) {
              // Error recovery: mark the file as failed and continue with the next one
              failedIds.add(row.canvas_file_id);
              const errorMsg: string = e?.message ?? String(e);

              await supabase
                .from('canvas_orphan_files')
                .update({ status: 'FAILED', updated_at: new Date().toISOString() })
                .eq('canvas_file_id', row.canvas_file_id);

              updateMapperRowField(row.canvas_file_id, { status: 'FAILED' });

              try {
                await (supabase as any).from('dev_canvas_logs').insert({
                  deployment_mode: 'live',
                  action: 'mass_organization_execute_failed',
                  subject: 'File Organizer Safe Execution',
                  course_id: row.course_id ? Number.parseInt(row.course_id, 10) : null,
                  status: 'failed',
                  error_message: `Failed - Manual Intervention Needed: ${errorMsg}`,
                  metadata: {
                    fileId: row.canvas_file_id,
                    originalName: row.original_name,
                    suggestedName: row.ai_suggested_name,
                    suggestedFolder: row.ai_suggested_folder,
                    error: errorMsg,
                  },
                });
              } catch {
                // Non-fatal
              }
            } finally {
              processed += 1;
              setMapperProgress({ current: processed, total: rows.length });
            }
          }),
        );

        // Brief pause between chunks to further reduce 429 risk
        await sleep(200);
      }

      // Remove succeeded files from the local UI queue
      setMapperRows((prev) => prev.filter((row) => !succeededIds.has(String(row.canvas_file_id))));
      setFiles((prev) => prev.filter((row) => !succeededIds.has(String(row.canvas_file_id))));

      if (emptiedSourceFolders.size > 0) {
        try {
          const { data: cleanupData, error: cleanupError } = await supabase.functions.invoke(
            'canvas-cleanup-folders',
            {
              body: {
                dryRun: false,
                targetFolders: Array.from(emptiedSourceFolders.values()),
              },
            },
          );
          if (cleanupError) throw cleanupError;
          if ((cleanupData)?.error) throw new Error((cleanupData).error);
          const deleted = (cleanupData)?.summary?.foldersDeleted ?? 0;
          if (deleted > 0) {
            toast.info(`Auto-cleanup: Deleted ${deleted} emptied source folder(s)`);
          }
        } catch (e: any) {
          toast.warning('Auto-cleanup failed', { description: e?.message ?? String(e) });
        }
      }

      if (cleanupUntitled && succeededIds.size > 0) {
        try {
          const hasUntitledScanSource = rows.some((row) => {
            if (!succeededIds.has(row.canvas_file_id)) return false;
            const nameParts = (row.original_name ?? '').split('/');
            const firstSegment = (nameParts.length > 1 ? nameParts[0] : row.ai_suggested_folder ?? '').trim();
            return firstSegment.length > 0 && UNTITLED_SCAN_PATTERN.test(firstSegment);
          });

          if (hasUntitledScanSource) {
            const { data: cleanupData, error: cleanupError } = await supabase.functions.invoke(
              'canvas-cleanup-folders',
              { body: { dryRun: false } },
            );
            if (cleanupError) throw cleanupError;
            if ((cleanupData)?.error) throw new Error((cleanupData).error);
            const deleted = (cleanupData)?.summary?.foldersDeleted ?? 0;
            if (deleted > 0) {
              toast.info(`Extra cleanup: Deleted ${deleted} empty folder(s) matching Untitled/Scan`);
            }
          }
        } catch (e: any) {
          toast.warning('Extra cleanup failed', { description: e?.message ?? String(e) });
        }
      }

      if (failedIds.size > 0) {
        toast.warning('Mass organization completed with failures', {
          description: `${succeededIds.size} applied, ${failedIds.size} marked "Failed - Manual Intervention Needed"`,
        });
      } else {
        toast.success('Mass organization complete', {
          description: `${succeededIds.size} file(s) renamed & moved`,
        });
      }
    } catch (e: any) {
      toast.error('Mass organization failed', { description: e?.message ?? String(e) });
    } finally {
      setMassOrganizing(false);
      setMapperProgress((prev) => (prev.total === prev.current ? prev : { current: 0, total: 0 }));
    }
  }, [cleanupUntitled, isDryRun, logMapperDryRunChanges, mapperRows, updateMapperRowField]);


  /**
   * Safe Execution Loop — processes files in chunks of MASS_ORG_CHUNK_SIZE (5)
   * using Promise.all to avoid Canvas API rate-limiting (429 errors).
   *
   * Before each chunk the full "Before State" is written to dev_canvas_logs as a
   * failsafe/rollback record.  On per-file failure the row is marked FAILED in
   * canvas_orphan_files and the loop continues with the next chunk.  After all
   * moves are complete, an optional step deletes empty Untitled/Scan source
   * folders via the canvas-cleanup-folders edge function.
   */
  const handleExecuteMassOrganization = useCallback(async () => {
    if (mapperRows.length === 0) {
      toast.info('No mapped rows to execute');
      return;
    }

    setMassOrganizing(true);
    setMapperProgressLabel('Safe-executing rename & move');
    setMapperProgress({ current: 0, total: mapperRows.length });

    const rows = [...mapperRows];
    try {
      if (isDryRun) {
        const logged = await logMapperDryRunChanges(rows);
        setMapperProgress({ current: rows.length, total: rows.length });
        toast.success(`Dry Run: Logged ${logged} changes to simulation database`);
        return;
      }

      const chunks: OrphanFile[][] = [];
      for (let i = 0; i < rows.length; i += MASS_ORG_CHUNK_SIZE) {
        chunks.push(rows.slice(i, i + MASS_ORG_CHUNK_SIZE));
      }

      const succeededIds = new Set<string>();
      const failedIds = new Set<string>();
      let processed = 0;

      for (const chunk of chunks) {
        // Failsafe: log "Before State" for every file in the chunk before touching Canvas
        const beforeStateEntries = chunk.map((row) => ({
          deployment_mode: 'live',
          action: 'mass_organization_before_state',
          subject: 'File Organizer Safe Execution',
          course_id: row.course_id ? Number.parseInt(row.course_id, 10) : null,
          status: 'before_state',
          metadata: {
            fileId: row.canvas_file_id,
            originalName: row.original_name,
            currentStatus: row.status,
            suggestedName: row.ai_suggested_name,
            suggestedFolder: row.ai_suggested_folder,
          },
        }));
        try {
          await (supabase as any).from('dev_canvas_logs').insert(beforeStateEntries);
        } catch {
          // Non-fatal: don't abort the whole loop if logging fails
          console.warn('handleExecuteMassOrganization: failed to write before-state to dev_canvas_logs');
        }

        // Process chunk concurrently — 5 files at a time to avoid 429s
        await Promise.all(
          chunk.map(async (row) => {
            try {
              const { data, error } = await supabase.functions.invoke('canvas-mapper-execute', {
                body: {
                  fileId: row.canvas_file_id,
                  suggestedName: row.ai_suggested_name,
                  suggestedFolder: row.ai_suggested_folder,
                },
              });
              if (error) throw error;
              if ((data)?.error) throw new Error((data).error);

              // The edge function returns { results: [{fileId, ok, error?}] } for single items
              const result = (data?.results as Array<{ fileId: string; ok: boolean; error?: string }>)?.[0];
              if (result && !result.ok) {
                throw new Error(result.error ?? 'Canvas execution failed');
              }

              succeededIds.add(row.canvas_file_id);
            } catch (e: any) {
              // Error recovery: mark the file as failed and continue with the next one
              failedIds.add(row.canvas_file_id);
              const errorMsg: string = e?.message ?? String(e);

              await supabase
                .from('canvas_orphan_files')
                .update({ status: 'FAILED', updated_at: new Date().toISOString() })
                .eq('canvas_file_id', row.canvas_file_id);

              updateMapperRowField(row.canvas_file_id, { status: 'FAILED' });

              try {
                await (supabase as any).from('dev_canvas_logs').insert({
                  deployment_mode: 'live',
                  action: 'mass_organization_execute_failed',
                  subject: 'File Organizer Safe Execution',
                  course_id: row.course_id ? Number.parseInt(row.course_id, 10) : null,
                  status: 'failed',
                  error_message: `Failed - Manual Intervention Needed: ${errorMsg}`,
                  metadata: {
                    fileId: row.canvas_file_id,
                    originalName: row.original_name,
                    suggestedName: row.ai_suggested_name,
                    suggestedFolder: row.ai_suggested_folder,
                    error: errorMsg,
                  },
                });
              } catch {
                // Non-fatal
              }
            } finally {
              processed += 1;
              setMapperProgress({ current: processed, total: rows.length });
            }
          }),
        );

        // Brief pause between chunks to further reduce 429 risk
        await sleep(200);
      }

      // Remove succeeded files from the local UI queue
      setMapperRows((prev) => prev.filter((row) => !succeededIds.has(String(row.canvas_file_id))));
      setFiles((prev) => prev.filter((row) => !succeededIds.has(String(row.canvas_file_id))));

      // Auto-cleanup: delete empty source folders that match the Untitled/Scan pattern
      if (cleanupUntitled && succeededIds.size > 0) {
        try {
          // Check whether any successfully-moved rows came from an Untitled/Scan context.
          // We probe the first path segment of original_name (when it contains '/') or
          // the first path segment of ai_suggested_folder as a heuristic.
          const hasUntitledScanSource = rows.some((row) => {
            if (!succeededIds.has(row.canvas_file_id)) return false;
            const nameParts = (row.original_name ?? '').split('/');
            const firstSegment = (nameParts.length > 1 ? nameParts[0] : row.ai_suggested_folder ?? '').trim();
            return firstSegment.length > 0 && UNTITLED_SCAN_PATTERN.test(firstSegment);
          });

          if (hasUntitledScanSource) {
            // canvas-cleanup-folders only deletes truly empty folders (files_count === 0),
            // so it is safe to run unconditionally after a mass move.
            const { data: cleanupData, error: cleanupError } = await supabase.functions.invoke(
              'canvas-cleanup-folders',
              { body: { dryRun: false } },
            );
            if (cleanupError) throw cleanupError;
            if ((cleanupData)?.error) throw new Error((cleanupData).error);
            const deleted = (cleanupData)?.summary?.foldersDeleted ?? 0;
            if (deleted > 0) {
              toast.info(`Auto-cleanup: Deleted ${deleted} empty folder(s) matching Untitled/Scan`);
            }
          }
        } catch (e: any) {
          toast.warning('Auto-cleanup failed', { description: e?.message ?? String(e) });
        }
      }

      if (failedIds.size > 0) {
        toast.warning('Mass organization completed with failures', {
          description: `${succeededIds.size} applied, ${failedIds.size} marked "Failed - Manual Intervention Needed"`,
        });
      } else {
        toast.success('Mass organization complete', {
          description: `${succeededIds.size} file(s) renamed & moved`,
        });
      }
    } catch (e: any) {
      toast.error('Mass organization failed', { description: e?.message ?? String(e) });
    } finally {
      setMassOrganizing(false);
      setMapperProgress((prev) => (prev.total === prev.current ? prev : { current: 0, total: 0 }));
    }
  }, [cleanupUntitled, isDryRun, logMapperDryRunChanges, mapperRows, updateMapperRowField]);


  const loadBatchProgress = useCallback(async () => {
    const { data: job } = await supabase
      .from('automation_jobs')
      .select('*')
      .eq('job_name', BATCH_CLASSIFY_JOB_NAME)
      .maybeSingle();
    if (job) {
      const progress = parseBatchProgress(job);
      setBatchProgress(progress);
      if (progress.status === 'running') {
        setBatchRunning(true);
      }
    }
  }, []);

  useEffect(() => {
    void loadFiles();
    void loadApprovedFiles();
    void loadBatchProgress();
    void loadCourseOptions();
  }, [loadApprovedFiles, loadBatchProgress, loadCourseOptions, loadFiles]);

  useEffect(() => {
    if (mapperCourseId) {
      void loadMapperRows();
    }
  }, [loadMapperRows, mapperCourseId]);

  useEffect(() => {
    mapperPausedRef.current = mapperPaused;
  }, [mapperPaused]);

  useEffect(() => {
    mapperCancelRequestedRef.current = mapperCancelRequested;
  }, [mapperCancelRequested]);

  // Poll for batch progress while running
  useEffect(() => {
    if (!batchRunning) {
      if (batchPollRef.current) {
        clearInterval(batchPollRef.current);
        batchPollRef.current = null;
      }
      return;
    }
    batchPollRef.current = setInterval(async () => {
      const { data: job } = await supabase
        .from('automation_jobs')
        .select('*')
        .eq('job_name', BATCH_CLASSIFY_JOB_NAME)
        .maybeSingle();
      if (job) {
        const progress = parseBatchProgress(job);
        setBatchProgress(progress);
        if (progress.status !== 'running') {
          setBatchRunning(false);
          await loadFiles();
        }
      }
    }, 3000);
    return () => {
      if (batchPollRef.current) clearInterval(batchPollRef.current);
    };
  }, [batchRunning, loadFiles]);

  // Sync editable fields when selection changes
  useEffect(() => {
    if (selected) {
      setEditName(selected.ai_suggested_name ?? '');
      setEditLessonRef(selected.ai_lesson_ref ?? '');
    } else {
      setEditName('');
      setEditLessonRef('');
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) return;
    const inPending = files.some((f) => f.canvas_file_id === selectedId);
    const inApproved = approvedFiles.some((f) => f.canvas_file_id === selectedId);
    if (!inPending && !inApproved) {
      setSelectedId(null);
      return;
    }
    if (inboxTab === 'pending' && !inPending) {
      setSelectedId(null);
    } else if (inboxTab === 'approved' && !inApproved) {
      setSelectedId(null);
    }
  }, [approvedFiles, files, inboxTab, selectedId]);

  // Task 1: Analyze single file
  const handleAnalyze = async () => {
    if (!selected) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('file-vision-classify', {
        body: { canvasFileId: selected.canvas_file_id },
      });
      if (error) throw error;
      if ((data)?.error) throw new Error((data).error);

      const suggested = (data)?.suggested_name ?? '';
      const lessonRef = (data)?.ai_lesson_ref ?? '';
      const suggestedFolder = (data)?.suggestedFolder ?? (data)?.ai_suggested_folder ?? null;
      setEditName(suggested);
      setEditLessonRef(lessonRef);
      setFiles((prev) =>
        prev.map((f) =>
          f.canvas_file_id === selected.canvas_file_id
            ? { ...f, ai_suggested_name: suggested, ai_lesson_ref: lessonRef, ai_suggested_folder: suggestedFolder }
            : f,
        ),
      );
      if (String(suggestedFolder ?? '').trim().toLowerCase() === 'needs visual review') {
        toast.warning('AI analysis requires manual review', {
          description: 'Suggested folder is "Needs Visual Review".',
        });
      } else {
        toast.success('AI analysis complete');
      }
    } catch (e: any) {
      toast.error('Analyze failed', { description: e?.message ?? String(e) });
    } finally {
      setAnalyzing(false);
    }
  };

  // Task 1: Start / continue batch analysis
  const handleBatchAnalyze = async () => {
    setBatchRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('canvas-batch-classify', {
        body: { batchSize: 25 },
      });
      if (error) throw error;
      if ((data)?.error) throw new Error((data).error);

      const result = data;
      setBatchProgress({
        filesProcessed: result.filesProcessed ?? 0,
        filesTotal: result.filesTotal ?? 0,
        cursor: result.cursor ?? null,
        status: result.done ? 'success' : 'running',
      });

      if (result.done) {
        setBatchRunning(false);
        toast.success('Batch analysis complete', {
          description: `All ${result.filesTotal} files analyzed`,
        });
        await loadFiles();
      } else {
        toast.info('Batch in progress', {
          description: `${result.processed} files processed in this batch`,
        });
      }
    } catch (e: unknown) {
      setBatchRunning(false);
      toast.error('Batch analysis failed', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleApprove = async () => {
    if (!selected) return;
    if (approving || reclassifying) return;
    if ((selected.status ?? '').toUpperCase() === 'APPROVED') {
      toast.error('Selected file is already approved');
      return;
    }
    if (!editName.trim()) {
      toast.error('Suggested name is required');
      return;
    }
    setApproving(true);
    try {
      const { error: updErr } = await supabase
        .from('canvas_orphan_files')
        .update({
          ai_suggested_name: editName.trim(),
          ai_lesson_ref: editLessonRef.trim() || null,
        })
        .eq('canvas_file_id', selected.canvas_file_id);
      if (updErr) throw updErr;

      if (isDryRun) {
        const rowToLog = { ...selected, ai_suggested_name: editName.trim(), ai_lesson_ref: editLessonRef.trim() || null };
        const logged = await logMapperDryRunChanges([rowToLog]);
        toast.success(`Dry Run: Logged ${logged} change(s) to simulation database`);
        return;
      }

      const { data, error } = await supabase.functions.invoke('canvas-file-rename', {
        body: { fileId: selected.canvas_file_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setSelectedId(null);
      void loadApprovedFiles();
      toast.success('Approved & renamed', { description: editName });
    } catch (e: unknown) {
      toast.error('Approve failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setApproving(false);
    }
  };

  const handleReclassify = async () => {
    if (!selected) return;
    setReclassifying(true);
    try {
      const { error: updErr } = await supabase
        .from('canvas_orphan_files')
        .update({
          status: 'PENDING',
          ai_suggested_name: null,
          ai_suggested_folder: null,
          ai_lesson_ref: null,
          ai_resource_type: null,
          ai_purpose: null,
          ai_snippet: null,
          ai_confidence: null,
          updated_at: new Date().toISOString(),
        })
        .eq('canvas_file_id', selected.canvas_file_id);
      if (updErr) throw updErr;

      setApprovedFiles((prev) => prev.filter((f) => f.canvas_file_id !== selected.canvas_file_id));
      setSelectedId(null);
      setInboxTab('pending');
      void loadFiles();
      toast.success('Moved back to Pending for re-classification', {
        description: selected.original_name ?? selected.canvas_file_id,
      });
    } catch (e: any) {
      toast.error('Re-classify failed', { description: e?.message ?? String(e) });
    } finally {
      setReclassifying(false);
    }
  };

  // Task 2: Detect duplicates
  const handleDetectDuplicates = useCallback(async () => {
    setDetectingDuplicates(true);
    try {
      const { data, error } = await supabase.functions.invoke('canvas-detect-duplicates', {
        body: { deleteDuplicates: false },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = data;
      toast.success(`Found ${result.duplicatesFound} duplicate(s)`, {
        description: 'Duplicate files are now highlighted in red.',
      });
      await loadFiles();
    } catch (e: unknown) {
      toast.error('Duplicate detection failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDetectingDuplicates(false);
    }
  }, [loadFiles]);

  // Task 2: Delete duplicates
  const handleDeleteDuplicates = async () => {
    const dupCount = files.filter((f) => f.is_duplicate).length;
    if (dupCount === 0) {
      toast.info('No duplicates to delete. Run detection first.');
      return;
    }
    setDeletingDuplicates(true);
    try {
      const { data, error } = await supabase.functions.invoke('canvas-detect-duplicates', {
        body: { deleteDuplicates: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = data;
      toast.success(`Deleted ${result.duplicatesDeleted} duplicate(s)`, {
        description: 'Canonical versions have been preserved.',
      });
      await loadFiles();
    } catch (e: unknown) {
      toast.error('Delete duplicates failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeletingDuplicates(false);
    }
  };

  // Task 3: Clean empty folders
  const handleCleanFolders = async () => {
    setCleaningFolders(true);
    try {
      const { data, error } = await supabase.functions.invoke('canvas-cleanup-folders', {
        body: { dryRun: false },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = data;
      toast.success(`Cleaned ${result.summary?.foldersDeleted ?? 0} empty folder(s)`, {
        description: `Scanned ${result.summary?.coursesScanned ?? 0} course(s)`,
      });
    } catch (e: unknown) {
      toast.error('Folder cleanup failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCleaningFolders(false);
    }
  };

  const handleScanAllCourses = useCallback(async () => {
    if (canvasCourseIds.length === 0) {
      toast.error('No course IDs configured');
      return;
    }

    setGlobalSweepRunning(true);
    setGlobalSweepProgress({
      current: 0,
      total: canvasCourseIds.length,
      label: '',
      scanned: 0,
      upserted: 0,
      failedCourses: 0,
    });

    let scanned = 0;
    let upserted = 0;
    let failedCourses = 0;

    try {
      for (let i = 0; i < canvasCourseIds.length; i += 1) {
        const courseId = canvasCourseIds[i];
        const courseLabel = courseLabelById.get(courseId) ?? `Course ${courseId}`;

        setGlobalSweepProgress({
          current: i + 1,
          total: canvasCourseIds.length,
          label: courseLabel,
          scanned,
          upserted,
          failedCourses,
        });
        await sleep(0);

        try {
          const { data, error } = await supabase.functions.invoke('canvas-read-files', {
            body: { courseId: Number(courseId) },
          });
          if (error) throw error;

          const result = (data as CanvasReadFilesResponse | null)?.results?.find(
            (entry) => String(entry.courseId ?? '') === String(courseId),
          );
          const courseFiles = result?.files ?? [];
          scanned += courseFiles.length;

          if (courseFiles.length > 0) {
            const rows = courseFiles.map((file) => ({
              canvas_file_id: String(file.id),
              course_id: String(courseId),
              original_name: file.display_name ?? file.filename ?? null,
              canvas_url: file.url ?? null,
              status: 'PENDING',
            }));

            const { error: upsertError } = await supabase
              .from('canvas_orphan_files')
              .upsert(rows, { onConflict: 'canvas_file_id' });
            if (upsertError) throw upsertError;
            upserted += rows.length;
          }
        } catch (e) {
          failedCourses += 1;
          console.warn('Global registry sweep course failed', { courseId, error: e });
        }

        setGlobalSweepProgress({
          current: i + 1,
          total: canvasCourseIds.length,
          label: courseLabel,
          scanned,
          upserted,
          failedCourses,
        });
        await sleep(0);
      }

      if (failedCourses > 0) {
        toast.warning('Global Registry Sweep completed with errors', {
          description: `${upserted} file(s) upserted from ${canvasCourseIds.length - failedCourses}/${canvasCourseIds.length} course(s)`,
        });
      } else {
        toast.success('Global Registry Sweep complete', {
          description: `${upserted} file(s) upserted across ${canvasCourseIds.length} course(s)`,
        });
      }
      await loadFiles();
      if (mapperCourseId) {
        await loadMapperRows();
      }
    } finally {
      setGlobalSweepRunning(false);
    }
  }, [canvasCourseIds, courseLabelById, loadFiles, loadMapperRows, mapperCourseId]);

  const duplicateCount = files.filter((f) => f.is_duplicate).length;
  const progressPct =
    batchProgress && batchProgress.filesTotal > 0
      ? Math.round((batchProgress.filesProcessed / batchProgress.filesTotal) * 100)
      : 0;

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">File Organizer</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Triage and map Canvas files across courses
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1.5">
            <Inbox className="h-3 w-3" />
            {files.length} pending
          </Badge>
          {approvedFiles.length > 0 && (
            <Badge variant="outline" className="gap-1.5 border-emerald-500 text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {approvedFiles.length} approved
            </Badge>
          )}
          {duplicateCount > 0 && (
            <Badge variant="destructive" className="gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => { void loadFiles(); void loadApprovedFiles(); }} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <div className="flex items-center gap-2">
            <Switch
              id="global-dry-run"
              checked={isDryRun}
              onCheckedChange={setIsDryRun}
              disabled={mapperRunning || mapperExecuting || approving}
            />
            <Label htmlFor="global-dry-run" className="text-xs whitespace-nowrap cursor-pointer">
              Dry Run (Log Only)
            </Label>
          </div>
        </div>
      </div>

      <Tabs defaultValue="triage" className="space-y-4">
        <TabsList>
          <TabsTrigger value="triage">Triage Orphans</TabsTrigger>
          <TabsTrigger value="mapper">Content Mapper</TabsTrigger>
        </TabsList>

        <TabsContent value="triage" className="space-y-4">
          {isBatchMode && (
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" />
                      Batch Mode Available
                      {batchProgress && (
                        <span className="text-xs text-muted-foreground font-normal">
                          — {formatBatchProgress(batchProgress)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {files.length} files detected. Batch analysis processes 25 files at a time and
                      resumes on page reload.
                    </p>
                    {batchProgress && batchProgress.filesTotal > 0 && (
                      <div className="pt-1 space-y-1">
                        <Progress value={progressPct} className="h-2 w-full max-w-sm" />
                        <p className="text-[11px] text-muted-foreground">
                          {batchProgress.filesProcessed} of {batchProgress.filesTotal} files processed
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleBatchAnalyze}
                    disabled={batchRunning}
                    className="gap-1.5"
                  >
                    {batchRunning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {batchRunning ? 'Analyzing…' : batchProgress?.status === 'running' ? 'Resume Batch' : 'Start Batch Analysis'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDetectDuplicates}
              disabled={detectingDuplicates}
              className="gap-1.5"
            >
              {detectingDuplicates ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              Detect Duplicates
            </Button>
            {duplicateCount > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteDuplicates}
                disabled={deletingDuplicates}
                className="gap-1.5"
              >
                {deletingDuplicates ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete Duplicates ({duplicateCount})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCleanFolders}
              disabled={cleaningFolders}
              className="gap-1.5"
            >
              {cleaningFolders ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderX className="h-3.5 w-3.5" />
              )}
              Clean Folders
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <Tabs value={inboxTab} onValueChange={(v) => { setInboxTab(v as 'pending' | 'approved'); setSelectedId(null); }} className="flex flex-col h-full">
                  <TabsList className="w-full rounded-none border-b">
                    <TabsTrigger value="pending" className="flex-1 text-xs gap-1.5">
                      <Inbox className="h-3 w-3" />
                      Pending
                      {files.length > 0 && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{files.length}</Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="approved" className="flex-1 text-xs gap-1.5">
                      <CheckCircle2 className="h-3 w-3" />
                      Approved
                      {approvedFiles.length > 0 && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{approvedFiles.length}</Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="pending" className="mt-0 flex-1">
                    <ScrollArea className="h-[calc(100vh-265px)] min-h-[380px]">
                      {loading ? (
                        <div className="p-3 space-y-2">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-14 w-full" />
                          ))}
                        </div>
                      ) : files.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground space-y-2">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500" />
                          <p className="text-sm font-medium">Inbox zero</p>
                          <p className="text-xs">No pending files to triage.</p>
                        </div>
                      ) : (
                        <div className="p-2 space-y-1.5">
                          {isBatchMode && (
                            <div className="px-1 pb-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                              Page {currentPage} of {numPages} — showing {visibleFiles.length} of {files.length} files
                            </div>
                          )}
                          {visibleFiles.map((f) => {
                            const isActive = f.canvas_file_id === selectedId;
                            return (
                              <button
                                key={f.canvas_file_id}
                                onClick={() => setSelectedId(f.canvas_file_id)}
                                className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                                  isActive
                                    ? 'border-primary bg-primary/10'
                                    : String(f.ai_suggested_folder ?? '').trim().toLowerCase() === 'needs visual review'
                                      ? 'border-amber-400/70 bg-amber-50 hover:bg-amber-100'
                                    : f.is_duplicate
                                      ? 'border-destructive/60 bg-destructive/5 hover:bg-destructive/10'
                                      : 'border-border hover:bg-muted/60'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-medium truncate">
                                      {f.original_name || f.canvas_file_id}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                      {f.is_duplicate ? (
                                        <Badge variant="destructive" className="text-[9px]">
                                          Duplicate
                                        </Badge>
                                      ) : f.ai_suggested_name ? (
                                        <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30">
                                          AI ready
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-[9px]">
                                          pending
                                        </Badge>
                                      )}
                                      {f.course_id && (
                                        <span className="text-[10px] text-muted-foreground">
                                          course {f.course_id}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                          {isBatchMode && numPages > 1 && (
                            <div className="flex items-center justify-between pt-2 px-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage <= 1}
                                className="gap-1 h-7 text-xs"
                              >
                                <ChevronLeft className="h-3 w-3" /> Prev
                              </Button>
                              <span className="text-[10px] text-muted-foreground">
                                {currentPage} / {numPages}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                                disabled={currentPage >= numPages}
                                className="gap-1 h-7 text-xs"
                              >
                                Next <ChevronRight className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="approved" className="mt-0 flex-1">
                    <ScrollArea className="h-[calc(100vh-265px)] min-h-[380px]">
                      {approvedFiles.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground space-y-2">
                          <Inbox className="h-8 w-8 mx-auto opacity-40" />
                          <p className="text-sm font-medium">No approved files</p>
                          <p className="text-xs">Approved files will appear here.</p>
                        </div>
                      ) : (
                        <div className="p-2 space-y-1.5">
                          {approvedFiles.map((f) => {
                            const isActive = f.canvas_file_id === selectedId;
                            return (
                              <button
                                key={f.canvas_file_id}
                                onClick={() => setSelectedId(f.canvas_file_id)}
                                className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                                  isActive
                                    ? 'border-primary bg-primary/10'
                                    : 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/60'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-medium truncate">
                                      {f.ai_suggested_name || f.original_name || f.canvas_file_id}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                      <Badge className="text-[9px] bg-emerald-100 text-emerald-700 border-emerald-300">
                                        approved
                                      </Badge>
                                      {f.ai_suggested_folder && (
                                        <span className="text-[10px] text-muted-foreground truncate">
                                          {f.ai_suggested_folder}
                                        </span>
                                      )}
                                      {f.course_id && (
                                        <span className="text-[10px] text-muted-foreground">
                                          course {f.course_id}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardContent className="p-6">
                {!selected ? (
                  <div className="h-full min-h-[420px] flex flex-col items-center justify-center text-center text-muted-foreground">
                    <Inbox className="h-10 w-10 mb-3 opacity-50" />
                    <p className="text-sm font-medium">Select a file to triage</p>
                    <p className="text-xs mt-1">
                      Pick a file from the inbox on the left to analyze and approve it.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                          Original name
                        </div>
                        <div className="font-mono text-sm break-all">
                          {selected.original_name ?? '—'}
                        </div>
                      </div>
                      {selected.canvas_url && (
                        <Button asChild variant="outline" size="sm" className="gap-1.5">
                          <a href={selected.canvas_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" /> Open in Canvas
                          </a>
                        </Button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {isSelectedApproved && (
                        <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-300 gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          Approved
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        File ID: {selected.canvas_file_id}
                      </Badge>
                      {selected.course_id && (
                        <Badge variant="outline" className="text-[10px]">
                          Course: {selected.course_id}
                        </Badge>
                      )}
                      {selected.ai_suggested_folder && (
                        <Badge className="text-[10px] bg-primary/15 text-primary border-primary/30">
                          {selected.ai_suggested_folder}
                        </Badge>
                      )}
                      {selected.is_duplicate && (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Duplicate
                          {selected.canonical_file_id && (
                            <span className="ml-1 opacity-80">
                              (original: {selected.canonical_file_id.slice(0, 8)}…)
                            </span>
                          )}
                        </Badge>
                      )}
                      {selected.file_hash && (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          SHA: {selected.file_hash.slice(0, 12)}…
                        </Badge>
                      )}
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          AI Analysis
                        </div>
                        <Button
                          size="sm"
                          onClick={handleAnalyze}
                          disabled={analyzing}
                          className="gap-1.5"
                        >
                          {analyzing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          {analyzing ? 'Analyzing…' : 'Analyze with AI'}
                        </Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Suggested name</Label>
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="e.g. SM5_L078.pdf"
                            className="font-mono text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Lesson reference</Label>
                          <Input
                            value={editLessonRef}
                            onChange={(e) => setEditLessonRef(e.target.value)}
                            placeholder="e.g. Math_Lesson_078_L"
                            className="font-mono text-sm"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      {isDryRun && (
                        <Badge variant="outline" className="self-center text-[10px] gap-1 border-amber-400 text-amber-700">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Dry Run active — Canvas API blocked
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => setSelectedId(null)}
                        disabled={approving || reclassifying}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleApprove}
                        disabled={approving || !editName.trim()}
                        className="gap-1.5"
                      >
                        {approving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        {approving ? 'Approving…' : isDryRun ? 'Log (Dry Run)' : 'Approve & Move'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="mapper" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="space-y-1 min-w-[220px]">
                  <Label className="text-xs">Course</Label>
                  <Select value={mapperCourseId} onValueChange={setMapperCourseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select course" />
                    </SelectTrigger>
                    <SelectContent>
                      {courseOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label} ({opt.value})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Guided sequence</Label>
                  <Badge variant="outline">Run next: {SUBJECT_LABELS[nextSubjectToRun]}</Badge>
                </div>
                <Button
                  variant="outline"
                  onClick={loadMapperRows}
                  disabled={!mapperCourseId || mapperLoading || mapperRunning || mapperExecuting || smartWorkflowRunning}
                  className="gap-1.5"
                >
                  {mapperLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Load Course Files
                </Button>
                <Button
                  onClick={mapCourseSequentially}
                  disabled={!mapperCourseId || mapperRunning || mapperExecuting || massOrganizing || mapperRows.length === 0}
                  className="gap-1.5"
                >
                  {mapperRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {mapperRunning ? 'Mapping…' : 'Map Course Sequentially'}
                </Button>
                <Button
                  variant="outline"
                  onClick={mapAllCoursesSequentially}
                  disabled={mapperRunning || mapperExecuting || massOrganizing || mapperLoading}
                  className="gap-1.5"
                >
                  {mapperRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Layers className="h-3.5 w-3.5" />
                  )}
                  Map ALL Courses
                </Button>
                <Button
                  variant="outline"
                  onClick={handleScanAllCourses}
                  disabled={
                    globalSweepRunning || mapperRunning || mapperExecuting || massOrganizing || mapperLoading
                  }
                  className="gap-1.5"
                >
                  {globalSweepRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Layers className="h-3.5 w-3.5" />
                  )}
                  {globalSweepRunning ? 'Scanning…' : 'Scan All Courses'}
                </Button>
                <Button
                  variant="default"
                  onClick={executeMapperBulk}
                  disabled={mapperExecuting || mapperRunning || massOrganizing || mapperRows.length === 0}
                  className="gap-1.5"
                >
                  {mapperExecuting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Execute Rename & Move
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleExecuteMassOrganization}
                  disabled={massOrganizing || mapperExecuting || mapperRunning || mapperRows.length === 0}
                  className="gap-1.5"
                >
                  {massOrganizing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {massOrganizing ? 'Organizing…' : 'Safe Execute (Mass Organize)'}
                </Button>
                <div className="flex items-center gap-2 ml-1 mb-1">
                  <Switch
                    id="cleanup-untitled"
                    checked={cleanupUntitled}
                    onCheckedChange={setCleanupUntitled}
                    disabled={mapperRunning || mapperExecuting || massOrganizing}
                  />
                  <Label htmlFor="cleanup-untitled" className="text-xs whitespace-nowrap">
                    Auto-delete empty Untitled/Scan folders
                  </Label>
                </div>
              </div>

              {mapperProgress.total > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {mapperProgressLabel}: {mapperProgress.current} of {mapperProgress.total}
                    {mapperRunning && (
                      <span> · {mapperInFlightCount} in flight{mapperPaused ? ' · paused' : ''}</span>
                    )}
                  </p>
                  <Progress
                    value={Math.round((mapperProgress.current / mapperProgress.total) * 100)}
                    className="h-2 max-w-lg"
                  />
                  {mapperRunning && (
                    <div className="pt-1 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePauseResumeSweep}
                        disabled={mapperCancelRequested}
                      >
                        {mapperPaused ? 'Resume Sweep' : 'Pause Sweep'}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleCancelSweep}
                        disabled={mapperCancelRequested}
                      >
                        {mapperCancelRequested ? 'Canceling…' : 'Cancel Sweep'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {globalSweepProgress && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {globalSweepRunning
                      ? `Scanning Course ${globalSweepProgress.current} of ${globalSweepProgress.total}...`
                      : `Scanned ${globalSweepProgress.current} of ${globalSweepProgress.total} course(s)`}
                    {globalSweepProgress.label ? ` · ${globalSweepProgress.label}` : ''}
                  </p>
                  <Progress
                    value={
                      globalSweepProgress.total > 0
                        ? Math.round((globalSweepProgress.current / globalSweepProgress.total) * 100)
                        : 0
                    }
                    className="h-2 max-w-lg"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {globalSweepProgress.upserted} file(s) upserted · {globalSweepProgress.scanned} scanned
                    {globalSweepProgress.failedCourses > 0
                      ? ` · ${globalSweepProgress.failedCourses} course(s) failed`
                      : ''}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Strategy Preview</h3>
                  <p className="text-xs text-muted-foreground">
                    Review Current Path vs Proposed Path before writing any moves to Canvas.
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {strategyPreviewRows.filter((row) => row.changed).length} change
                  {strategyPreviewRows.filter((row) => row.changed).length !== 1 ? 's' : ''}
                </Badge>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Current Path</TableHead>
                      <TableHead>Proposed Path</TableHead>
                      <TableHead className="w-[120px]">Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strategyPreviewRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center py-6 text-xs text-muted-foreground">
                          Load course files to preview strategy.
                        </TableCell>
                      </TableRow>
                    ) : (
                      strategyPreviewRows.map((row) => (
                        <TableRow key={`preview-${row.fileId}`}>
                          <TableCell className="font-mono text-xs break-all">{row.currentPath}</TableCell>
                          <TableCell className="font-mono text-xs break-all">
                            <div className="flex items-center gap-2">
                              <span>{row.proposedPath}</span>
                              {!row.changed && (
                                <Badge variant="outline" className="text-[9px]">
                                  unchanged
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {row.confidence !== null ? (
                                <span className="text-xs tabular-nums">{row.confidence}%</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                              {row.needsReview && (
                                <Badge variant="destructive" className="text-[9px] gap-1">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  Needs Review
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Strategy Preview</h3>
                  <p className="text-xs text-muted-foreground">
                    Review Current Path vs Proposed Path before writing any moves to Canvas.
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {strategyPreviewRows.filter((row) => row.changed).length} change
                  {strategyPreviewRows.filter((row) => row.changed).length !== 1 ? 's' : ''}
                </Badge>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Current Path</TableHead>
                      <TableHead>Proposed Path</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strategyPreviewRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} className="text-center py-6 text-xs text-muted-foreground">
                          Load course files to preview strategy.
                        </TableCell>
                      </TableRow>
                    ) : (
                      strategyPreviewRows.map((row) => (
                        <TableRow key={`preview-${row.fileId}`}>
                          <TableCell className="font-mono text-xs break-all">{row.currentPath}</TableCell>
                          <TableCell className="font-mono text-xs break-all">
                            <div className="flex items-center gap-2">
                              <span>{row.proposedPath}</span>
                              {!row.changed && (
                                <Badge variant="outline" className="text-[9px]">
                                  unchanged
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div ref={mapperTableContainerRef} className="h-[560px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Current Name</TableHead>
                      <TableHead>Snippet</TableHead>
                      <TableHead>Resource Type</TableHead>
                      <TableHead>Purpose Array</TableHead>
                      <TableHead>Suggested Name/Folder</TableHead>
                      <TableHead>View File</TableHead>
                      <TableHead className="w-[150px]">Apply</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mapperLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : mapperRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No files loaded for this course.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {mapperPaddingTop > 0 && (
                          <TableRow>
                            <TableCell colSpan={7} style={{ height: `${mapperPaddingTop}px`, padding: 0 }} />
                          </TableRow>
                        )}
                        {virtualMapperRows.map((virtualRow) => {
                          const row = mapperRows[virtualRow.index];
                          if (!row) return null;
                          return (
                            <TableRow
                              key={row.canvas_file_id}
                              className={
                                collisionIds.has(row.canvas_file_id)
                                  ? 'bg-red-50/70'
                                  : row.status === 'FAILED'
                                  ? 'bg-destructive/5 border-l-2 border-l-destructive'
                                  : String(row.ai_suggested_folder ?? '').trim().toLowerCase() === 'needs visual review'
                                  ? 'bg-amber-50/70'
                                  : undefined
                              }
                            >
                              <TableCell className="max-w-[260px]">
                                <div className="truncate font-mono text-xs">
                                  {row.original_name ?? row.canvas_file_id}
                                </div>
                              </TableCell>
                              <TableCell className="max-w-[280px]">
                                <div className="text-xs text-muted-foreground line-clamp-3">
                                  {row.ai_snippet ?? '—'}
                                </div>
                              </TableCell>
                              <TableCell>{row.ai_resource_type ?? '—'}</TableCell>
                              <TableCell>
                                <div className="flex gap-1 flex-wrap">
                                  {(row.ai_purpose ?? []).map((p) => (
                                    <Badge key={`${row.canvas_file_id}-${p}`} variant="outline" className="text-[10px]">
                                      {p}
                                    </Badge>
                                  ))}
                                  {(row.ai_purpose ?? []).length === 0 && (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="space-y-1 min-w-[230px]">
                                <Input
                                  value={row.ai_suggested_name ?? ''}
                                  onChange={(e) =>
                                    updateMapperRowField(row.canvas_file_id, {
                                      ai_suggested_name: e.target.value,
                                    })
                                  }
                                  placeholder="Suggested name"
                                  className="h-8 text-xs font-mono"
                                />
                                <Input
                                  value={row.ai_suggested_folder ?? ''}
                                  onChange={(e) =>
                                    updateMapperRowField(row.canvas_file_id, {
                                      ai_suggested_folder: e.target.value,
                                    })
                                  }
                                  placeholder="Suggested folder"
                                  className="h-8 text-xs"
                                />
                              </TableCell>
                              <TableCell>
                                {row.canvas_url ? (
                                  <a
                                    className="text-xs underline inline-flex items-center gap-1"
                                    href={row.canvas_url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    View File
                                  </a>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {collisionIds.has(row.canvas_file_id) ? (
                                  <Badge variant="destructive" className="text-[10px] gap-1">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    Collision Detected
                                  </Badge>
                                ) : row.status === 'FAILED' ? (
                                  <Badge variant="destructive" className="text-[10px] gap-1">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    Failed – Manual Intervention Needed
                                  </Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    onClick={() => executeMapperRow(row, mapperRows)}
                                    disabled={
                                      mapperRunning ||
                                      mapperExecuting ||
                                      massOrganizing ||
                                      rowExecutingId === row.canvas_file_id ||
                                      !row.ai_suggested_name?.trim()
                                    }
                                    className="gap-1.5"
                                  >
                                    {rowExecutingId === row.canvas_file_id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                    )}
                                    Apply to Canvas
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {mapperPaddingBottom > 0 && (
                          <TableRow>
                            <TableCell colSpan={7} style={{ height: `${mapperPaddingBottom}px`, padding: 0 }} />
                          </TableRow>
                        )}
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
              {mapperRows.length > 0 && (
                <div className="px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Rendering {virtualMapperRows.length} of {mapperRows.length} file(s) in viewport
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
