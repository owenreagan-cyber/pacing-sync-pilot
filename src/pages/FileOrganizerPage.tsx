import { useCallback, useEffect, useRef, useState } from 'react';
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
  alreadyFormatted?: boolean;
}

const GLOBAL_MAPPER_SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'] as const;
const MAPPER_MAX_CONCURRENCY = 5;
const EXECUTE_CHUNK_SIZE = 25;
const PAUSE_POLL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function FileOrganizerPage() {
  const [files, setFiles] = useState<OrphanFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [approving, setApproving] = useState(false);

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
  const [mapperPaused, setMapperPaused] = useState(false);
  const [mapperCancelRequested, setMapperCancelRequested] = useState(false);
  const [mapperInFlightCount, setMapperInFlightCount] = useState(0);
  const mapperPausedRef = useRef(false);
  const mapperCancelRequestedRef = useRef(false);
  const mapperTableContainerRef = useRef<HTMLDivElement | null>(null);

  const selected = files.find((f) => f.canvas_file_id === selectedId) ?? null;
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
        if ((data as any)?.error) throw new Error((data as any).error);

        const mappedRow = data as MapperResult;
        updateMapperRowField(row.canvas_file_id, {
          ai_suggested_name: mappedRow.suggestedName,
          ai_suggested_folder: mappedRow.suggestedFolder,
          ai_resource_type: mappedRow.resourceType,
          ai_purpose: mappedRow.purpose,
          ai_snippet: mappedRow.snippet,
          ai_folder_chunked: !!mappedRow.suggestedFolder.match(/\d+\s*-\s*\d+/),
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

    const targetSubjects = new Set<string>(GLOBAL_MAPPER_SUBJECTS);
    const selectedCourses = courseOptions.filter((opt) => targetSubjects.has(opt.label));
    if (selectedCourses.length === 0) {
      toast.error('No target subjects found in course IDs');
      return;
    }

    setMapperLoading(true);
    try {
      const rowsByCourse = await Promise.all(
        selectedCourses.map(async (opt) => {
          const { data, error } = await supabase
            .from('canvas_orphan_files')
            .select('*')
            .eq('status', 'PENDING')
            .eq('course_id', opt.value)
            .order('created_at', { ascending: true });
          if (error) throw new Error(`${opt.label}: ${error.message}`);
          return (data ?? []) as OrphanFile[];
        }),
      );

      const dedupedRows = Array.from(
        new Map(
          rowsByCourse
            .flat()
            .map((row) => [String(row.canvas_file_id), row] as const),
        ).values(),
      );

      setMapperRows(dedupedRows);
      setMapperTablePage(1);

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

  const executeMapperRow = useCallback(
    async (row: OrphanFile) => {
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
        if ((data as any)?.error) throw new Error((data as any).error);
        setMapperRows((prev) => prev.filter((r) => r.canvas_file_id !== row.canvas_file_id));
        setFiles((prev) => prev.filter((r) => r.canvas_file_id !== row.canvas_file_id));
        toast.success('Applied to Canvas', { description: row.ai_suggested_name ?? row.original_name ?? '' });
      } catch (e: any) {
        toast.error('Apply failed', { description: e?.message ?? String(e) });
      } finally {
        setRowExecutingId(null);
      }
    },
    [isDryRun, logMapperDryRunChanges],
  );

  const executeMapperBulk = useCallback(async () => {
    if (mapperRows.length === 0) {
      toast.info('No mapped rows to execute');
      return;
    }

    setMapperExecuting(true);
    setMapperProgressLabel('Executing rename & move');
    setMapperProgress({ current: 0, total: mapperRows.length });
    try {
      if (isDryRun) {
        const logged = await logMapperDryRunChanges(mapperRows);
        setMapperProgress({ current: mapperRows.length, total: mapperRows.length });
        toast.success(`Dry Run: Logged ${logged} changes to simulation database`);
        return;
      }

      const payload = mapperRows.map((row) => ({
        fileId: row.canvas_file_id,
        suggestedName: row.ai_suggested_name,
        suggestedFolder: row.ai_suggested_folder,
      }));

      const chunks: Array<typeof payload> = [];
      for (let i = 0; i < payload.length; i += EXECUTE_CHUNK_SIZE) {
        chunks.push(payload.slice(i, i + EXECUTE_CHUNK_SIZE));
      }

      const succeededIds = new Set<string>();
      let processed = 0;

      for (const chunk of chunks) {
        const { data, error } = await supabase.functions.invoke('canvas-mapper-execute', {
          body: { items: chunk },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);

        const chunkResults = ((data as any)?.results as Array<{ fileId: string; ok: boolean }>) ?? [];
        chunkResults
          .filter((r) => r.ok)
          .forEach((r) => succeededIds.add(String(r.fileId)));

        processed += chunk.length;
        setMapperProgress({ current: Math.min(processed, payload.length), total: payload.length });
        await sleep(0);
      }

      setMapperRows((prev) => prev.filter((row) => !succeededIds.has(String(row.canvas_file_id))));
      setFiles((prev) => prev.filter((row) => !succeededIds.has(String(row.canvas_file_id))));
      setMapperTablePage(1);
      toast.success('Bulk rename & move complete', {
        description: `${succeededIds.size} file(s) applied`,
      });
    } catch (e: any) {
      toast.error('Bulk execute failed', { description: e?.message ?? String(e) });
    } finally {
      setMapperExecuting(false);
      setMapperProgress((prev) => (prev.total === prev.current ? prev : { current: 0, total: 0 }));
    }
  }, [isDryRun, logMapperDryRunChanges, mapperRows]);

  // Load batch progress on mount (for resume on reload)
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
    loadFiles();
    loadBatchProgress();
    loadCourseOptions();
  }, [loadBatchProgress, loadCourseOptions, loadFiles]);

  useEffect(() => {
    if (mapperCourseId) {
      loadMapperRows();
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

  // Task 1: Analyze single file
  const handleAnalyze = async () => {
    if (!selected) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('file-vision-classify', {
        body: { canvasFileId: selected.canvas_file_id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const suggested = (data as any)?.suggested_name ?? '';
      const lessonRef = (data as any)?.ai_lesson_ref ?? '';
      setEditName(suggested);
      setEditLessonRef(lessonRef);
      setFiles((prev) =>
        prev.map((f) =>
          f.canvas_file_id === selected.canvas_file_id
            ? { ...f, ai_suggested_name: suggested, ai_lesson_ref: lessonRef }
            : f,
        ),
      );
      toast.success('AI analysis complete');
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
      if ((data as any)?.error) throw new Error((data as any).error);

      const result = data as any;
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
    } catch (e: any) {
      setBatchRunning(false);
      toast.error('Batch analysis failed', { description: e?.message ?? String(e) });
    }
  };

  const handleApprove = async () => {
    if (!selected) return;
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

      const { data, error } = await supabase.functions.invoke('canvas-file-rename', {
        body: { fileId: selected.canvas_file_id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      setFiles((prev) => prev.filter((f) => f.canvas_file_id !== selected.canvas_file_id));
      setSelectedId(null);
      toast.success('Approved & renamed', { description: editName });
    } catch (e: any) {
      toast.error('Approve failed', { description: e?.message ?? String(e) });
    } finally {
      setApproving(false);
    }
  };

  // Task 2: Detect duplicates
  const handleDetectDuplicates = async () => {
    setDetectingDuplicates(true);
    try {
      const { data, error } = await supabase.functions.invoke('canvas-detect-duplicates', {
        body: { deleteDuplicates: false },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const result = data as any;
      toast.success(`Found ${result.duplicatesFound} duplicate(s)`, {
        description: 'Duplicate files are now highlighted in red.',
      });
      await loadFiles();
    } catch (e: any) {
      toast.error('Duplicate detection failed', { description: e?.message ?? String(e) });
    } finally {
      setDetectingDuplicates(false);
    }
  };

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
      if ((data as any)?.error) throw new Error((data as any).error);

      const result = data as any;
      toast.success(`Deleted ${result.duplicatesDeleted} duplicate(s)`, {
        description: 'Canonical versions have been preserved.',
      });
      await loadFiles();
    } catch (e: any) {
      toast.error('Delete duplicates failed', { description: e?.message ?? String(e) });
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
      if ((data as any)?.error) throw new Error((data as any).error);

      const result = data as any;
      toast.success(`Cleaned ${result.summary?.foldersDeleted ?? 0} empty folder(s)`, {
        description: `Scanned ${result.summary?.coursesScanned ?? 0} course(s)`,
      });
    } catch (e: any) {
      toast.error('Folder cleanup failed', { description: e?.message ?? String(e) });
    } finally {
      setCleaningFolders(false);
    }
  };

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
          {duplicateCount > 0 && (
            <Badge variant="destructive" className="gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={loadFiles} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
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
                <ScrollArea className="h-[calc(100vh-220px)] min-h-[420px]">
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
                      <Button
                        variant="outline"
                        onClick={() => setSelectedId(null)}
                        disabled={approving}
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
                        {approving ? 'Approving…' : 'Approve & Move'}
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
                <Button
                  variant="outline"
                  onClick={loadMapperRows}
                  disabled={!mapperCourseId || mapperLoading || mapperRunning || mapperExecuting}
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
                  disabled={!mapperCourseId || mapperRunning || mapperExecuting || mapperRows.length === 0}
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
                  disabled={mapperRunning || mapperExecuting || mapperLoading}
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
                  variant="default"
                  onClick={executeMapperBulk}
                  disabled={mapperExecuting || mapperRunning || mapperRows.length === 0}
                  className="gap-1.5"
                >
                  {mapperExecuting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Execute Rename & Move
                </Button>
                <div className="flex items-center gap-2 ml-1 mb-1">
                  <Switch
                    id="mapper-dry-run"
                    checked={isDryRun}
                    onCheckedChange={setIsDryRun}
                    disabled={mapperRunning || mapperExecuting}
                  />
                  <Label htmlFor="mapper-dry-run" className="text-xs whitespace-nowrap">
                    Enable Dry Run (Log Only)
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
                            <TableRow key={row.canvas_file_id}>
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
                                <Button
                                  size="sm"
                                  onClick={() => executeMapperRow(row)}
                                  disabled={
                                    mapperRunning ||
                                    mapperExecuting ||
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
