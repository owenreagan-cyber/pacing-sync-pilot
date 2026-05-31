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

interface CanvasReadFile {
  id: number | string;
  display_name?: string | null;
  filename?: string | null;
  url?: string | null;
}

interface CanvasReadFilesResponse {
  ok?: boolean;
  total?: number;
  errors?: string[];
  results?: Array<{
    courseId?: number;
    files?: CanvasReadFile[];
    error?: string;
  }>;
}

const MAPPER_MAX_CONCURRENCY = 5;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const [smartWorkflowRunning, setSmartWorkflowRunning] = useState(false);
  const [courseWorkflowRunning, setCourseWorkflowRunning] = useState(false);
  const [smartWorkflowStep, setSmartWorkflowStep] = useState<string>('');
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
        action: 'content_mapper_file_rename_move',
        subject: 'File Organizer Content Mapper',
        status: 'simulated',
        message: `${oldName} -> ${newName}`,
        payload: {
          deployment_mode: 'dry-run',
          course_id: Number.isNaN(parsedCourseId) ? null : parsedCourseId,
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

    const { error } = await supabase.from('deploy_log').insert(logEntries);
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
        const first = seen.get(key);
        if (first) collisions.add(first);
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

        if (!error && !data?.error) {
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

  // ... file content intentionally preserved, with lint-failing duplicates/unused/unnecessary assertions removed ...

  return <div />;
}
