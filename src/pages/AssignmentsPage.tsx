/**
 * THALES OS — Assignments Gatekeeper (v23.0)
 * Preview-first deployment engine. Builds payloads via assignment-build helper,
 * shows status (NEW / UPDATE / NO_CHANGE / SKIP / ERROR), supports per-row deploy
 * via Safety Diff modal. Subject filter chips. DST-correct due dates in ET.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Rocket, Loader2, AlertCircle, ArrowRightLeft, ShieldCheck,
  CheckCircle2, ChevronDown, Eye, SkipForward, FlaskConical,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSystemStore, type PacingCell } from '@/store/useSystemStore';
import { useConfig } from '@/lib/config';
import { callEdge } from '@/lib/edge';
import { supabase } from '@/integrations/supabase/client';
import SafetyDiffModal from '@/components/SafetyDiffModal';
import { useRealtimeDeploy } from '@/hooks/use-realtime-deploy';
import {
  buildAssignmentForCell,
  expandMathRow,
  formatDueET,
  type BuiltAssignment,
} from '@/lib/assignment-build';
import { generateCanvasPageHtml, type CanvasPageRow } from '@/lib/canvas-html';
import { runQ4W5Tests, type TestResult } from '@/lib/test-runner';
import type { ContentMapEntry } from '@/lib/auto-link';
import { logDeployHabit } from '@/lib/teacher-memory';
import { validateDeployment, type ValidationResult } from '@/lib/pre-deploy-validator';
import { getPacingWeekDatesISO } from '@/lib/pacing-week';

const SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'];
const FILTER_CHIPS = ['All', 'Math', 'Reading', 'Language Arts', 'Spelling'];

type DeployStatus = 'NEW' | 'UPDATE' | 'NO_CHANGE' | 'SKIP' | 'ERROR' | 'DEPLOYED';

interface PreviewRow extends BuiltAssignment {
  status: DeployStatus;
  rowId: string | null;
  canvasUrl: string | null;
  storedHash: string | null;
}

interface PacingDbRow {
  id: string;
  subject: string;
  day: string;
  type: string | null;
  lesson_num: string | null;
  content_hash: string | null;
  canvas_assignment_id: string | null;
  canvas_url: string | null;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function computeWeekDates(quarter: string, week: number): string[] {
  return getPacingWeekDatesISO(quarter, week);
}

export default function AssignmentsPage() {
  const config = useConfig();
  const {
    selectedMonth, selectedWeek, isLoading,
    setSelectedMonth, setSelectedWeek,
  } = useSystemStore();

  const [deploying, setDeploying] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [contentMap, setContentMap] = useState<ContentMapEntry[]>([]);
  const [pacingDbRows, setPacingDbRows] = useState<PacingDbRow[]>([]);
  const [weekId, setWeekId] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('All');
  const [deployResults, setDeployResults] = useState<Record<string, DeployStatus>>({});
  const [forcedRows, setForcedRows] = useState<Set<string>>(new Set());
  const [editOverrides, setEditOverrides] = useState<
    Record<string, Partial<{ title: string; dueDate: string; points: number; gradingType: string }>>
  >({});
  const [testMode, setTestMode] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  const toggleForce = (key: string) => {
    setForcedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useRealtimeDeploy();

  // Fetch content_map
  useEffect(() => {
    supabase
      .from('content_map')
      .select('lesson_ref, subject, canvas_url, canonical_name')
      .then(({ data }) => { if (data) setContentMap(data as ContentMapEntry[]); });
  }, []);

  // Fetch pacing rows from DB (for hash comparison + canvas IDs)
  useEffect(() => {
    (async () => {
      const { data: week } = await supabase
        .from('weeks')
        .select('id')
        .eq('quarter', selectedMonth)
        .eq('week_num', selectedWeek)
        .maybeSingle();
      if (!week) { setWeekId(null); setPacingDbRows([]); return; }
      setWeekId(week.id);
      const { data: rows } = await supabase
        .from('pacing_rows')
        .select('id, subject, day, type, lesson_num, content_hash, canvas_assignment_id, canvas_url')
        .eq('week_id', week.id);
      setPacingDbRows((rows as PacingDbRow[]) || []);
    })();
  }, [selectedMonth, selectedWeek]);

  useEffect(() => {
    setDeployResults({});
    setSelected(new Set());
  }, [selectedMonth, selectedWeek]);

  // History/Science redirect detection (derived from pacing_rows in main build effect)
  const [historyRedirect, setHistoryRedirect] = useState<
    { from: string; to: string } | null
  >(null);

  // Find DB row matching a built assignment to compare hash + Canvas state
  const findDbRow = (subject: string, dayIndex: number, type: string, lessonNum: string) => {
    return pacingDbRows.find(
      (r) =>
        r.subject === subject &&
        r.day === DAYS[dayIndex] &&
        (r.type || '') === type &&
        (r.lesson_num || '') === lessonNum,
    );
  };

  // Build preview rows whenever inputs change — sourced from Supabase pacing_rows
  useEffect(() => {
    if (!config || !selectedMonth || !selectedWeek) { setPreviewRows([]); return; }

    (async () => {
      const built: PreviewRow[] = [];

      const { data: weekRecord } = await supabase
        .from('weeks')
        .select('id')
        .eq('quarter', selectedMonth)
        .eq('week_num', selectedWeek)
        .maybeSingle();

      if (!weekRecord) { setPreviewRows([]); return; }

      const weekDates = computeWeekDates(selectedMonth, selectedWeek);

      const { data: pacingRows } = await supabase
        .from('pacing_rows')
        .select('*')
        .eq('week_id', weekRecord.id);

      if (!pacingRows?.length) { setPreviewRows([]); setHistoryRedirect(null); return; }

      // History/Science redirect detection from pacing_rows
      const isDash = (t: string | null) => !t || t === '-' || t === 'No Class';
      const histRows = pacingRows.filter((r: any) => r.subject === 'History');
      const sciRows = pacingRows.filter((r: any) => r.subject === 'Science');
      const allHistDash = histRows.length === 0 || histRows.every((r: any) => isDash(r.type));
      const allSciDash = sciRows.length === 0 || sciRows.every((r: any) => isDash(r.type));
      if (allHistDash && !allSciDash) setHistoryRedirect({ from: 'History', to: 'Science' });
      else if (allSciDash && !allHistDash) setHistoryRedirect({ from: 'Science', to: 'History' });
      else setHistoryRedirect(null);

      function toPreview(a: BuiltAssignment): PreviewRow {
        const dbRow = findDbRow(a.subject, a.dayIndex, a.type, a.lessonNum);
        let status: DeployStatus;
        if (a.skipReason) status = 'SKIP';
        else if (!dbRow?.canvas_assignment_id) status = 'NEW';
        else if (dbRow.content_hash === a.contentHash) status = 'NO_CHANGE';
        else status = 'UPDATE';
        return {
          ...a,
          status,
          rowId: dbRow?.id ?? null,
          canvasUrl: dbRow?.canvas_url ?? null,
          storedHash: dbRow?.content_hash ?? null,
        };
      }

      for (const subject of SUBJECTS) {
        for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
          const day = DAYS[dayIdx];
          const dayRows = pacingRows.filter((r: any) => r.subject === subject && r.day === day);
          for (const row of dayRows) {
            if (!row.type || row.type === '-' || row.type === 'No Class') continue;
            if (!row.create_assign) continue;

            const cell: PacingCell = {
              value: row.in_class || row.lesson_num || '',
              lessonNum: row.lesson_num || '',
              isTest: (row.type || '').toLowerCase().includes('test'),
              isReview: (row.in_class || '').toLowerCase().includes('review'),
              isNoClass: row.type === '-' || row.type === 'No Class',
              hint_override: (row as any).hint_override ?? null,
            };

            // Math Triple Logic
            if (subject === 'Math') {
              const items = await expandMathRow(dayIdx, cell, { config, contentMap, weekDates });
              for (const a of items) built.push(toPreview(a));
              continue;
            }

            // Reading Double-Split: Test + Checkout
            if (subject === 'Reading' && cell.isTest) {
              const test = await buildAssignmentForCell('Reading', dayIdx, cell,
                { config, contentMap, weekDates }, { type: 'Test' });
              if (test) built.push(toPreview(test));
              const checkout = await buildAssignmentForCell('Reading', dayIdx, cell,
                { config, contentMap, weekDates }, { type: 'Checkout', isSynthetic: true });
              if (checkout) built.push(toPreview(checkout));
              continue;
            }

            // Spelling: only Tests create assignments
            if (subject === 'Spelling' && !cell.isTest) continue;

            // Language Arts: only CP / Classroom Practice / Test
            if (subject === 'Language Arts') {
              const upper = (row.type || '').toUpperCase();
              if (!upper.includes('CP') && !upper.includes('TEST') &&
                  !upper.includes('CLASSROOM PRACTICE')) continue;
            }

            // History / Science: never create assignments
            if (subject === 'History' || subject === 'Science') continue;

            const a = await buildAssignmentForCell(subject, dayIdx, cell,
              { config, contentMap, weekDates });
            if (a) built.push(toPreview(a));
          }
        }
      }

      built.sort((a, b) => a.dayIndex - b.dayIndex || a.subject.localeCompare(b.subject));
      setPreviewRows(built);
    })();
  }, [selectedMonth, selectedWeek, config, contentMap, pacingDbRows]);

  const filtered = useMemo(() => {
    if (filter === 'All') return previewRows;
    return previewRows.filter((r) => r.subject === filter);
  }, [previewRows, filter]);

  const deployable = useMemo(
    () => filtered.filter((r) => r.status === 'NEW' || r.status === 'UPDATE' || forcedRows.has(r.rowKey)),
    [filtered, forcedRows],
  );

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllPending = () => {
    setSelected(new Set(deployable.map((r) => r.rowKey)));
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDeploy = async () => {
    setDeploying(true);
    const targets = previewRows.filter((r) => selected.has(r.rowKey));
    const results: Record<string, DeployStatus> = {};
    let ok = 0, fail = 0, skip = 0;

    for (const r of targets) {
      try {
        if (testMode) {
          const fakeUrl = `https://canvas.test/courses/${r.courseId}/assignments/TEST_${Math.floor(Math.random() * 100000)}`;
          console.log('[TEST DEPLOY]', r.title, '→', fakeUrl);
          toast.message(`TEST DEPLOY: ${r.title}`, { description: fakeUrl });
          results[r.rowKey] = 'DEPLOYED'; ok++;
          continue;
        }
        const ov = editOverrides[r.rowKey] || {};
        const res = await callEdge<{ status?: string; canvasUrl?: string; error?: string }>(
          'canvas-deploy-assignment',
          {
            subject: r.subject,
            courseId: r.courseId,
            title: ov.title ?? r.title,
            description: r.description,
            points: ov.points ?? r.points,
            gradingType: ov.gradingType ?? r.gradingType,
            assignmentGroup: r.assignmentGroup,
            dueDate: ov.dueDate ?? r.dueDate ?? undefined,
            omitFromFinal: r.omitFromFinal,
            existingId: r.canvasUrl ? r.canvasUrl.split('/').pop() : undefined,
            rowId: r.rowId || undefined,
            weekId: weekId || undefined,
            contentHash: r.contentHash,
            day: r.day,
            type: r.type,
            isSynthetic: r.isSynthetic,
            force: forcedRows.has(r.rowKey) || undefined,
          },
        );
        if (res.status === 'DEPLOYED') {
          results[r.rowKey] = 'DEPLOYED'; ok++;
          void logDeployHabit(r.subject);
        }
        else if (res.status === 'NO_CHANGE') { results[r.rowKey] = 'NO_CHANGE'; skip++; }
        else { results[r.rowKey] = 'ERROR'; fail++; }
      } catch {
        results[r.rowKey] = 'ERROR'; fail++;
      }
    }

    setDeployResults((prev) => ({ ...prev, ...results }));
    if (fail === 0 && skip === 0) toast.success(`Deployed ${ok} assignments to Canvas`);
    else if (fail === 0) toast.success(`Deployed ${ok}, skipped ${skip} unchanged`);
    else toast.warning(`Deployed ${ok}, skipped ${skip}, failed ${fail}`);

    // Post-deploy cleanup: History/Science must NEVER have assignments.
    // If teacher (or a stale row) created any in those courses for this week,
    // delete them automatically.
    try {
      const weekDates: string[] = computeWeekDates(selectedMonth, selectedWeek);
      if (weekDates.length > 0) {
        await deleteRogueHistoryScienceAssignments(weekDates, weekId || null);
      }
    } catch (e) {
      console.warn('Rogue cleanup failed', e);
    }

    setDeploying(false);
    setSelected(new Set());
    // Refresh DB rows to pick up new canvas_assignment_id + hashes
    if (weekId) {
      const { data: rows } = await supabase
        .from('pacing_rows')
        .select('id, subject, day, type, lesson_num, content_hash, canvas_assignment_id, canvas_url')
        .eq('week_id', weekId);
      setPacingDbRows((rows as PacingDbRow[]) || []);
    }
  };

  /**
   * Delete any assignments lingering in History (21934) or Science (21970)
   * whose due_at falls inside the current week. Per Thales policy these
   * subjects are page/announcement-only — no Canvas assignments allowed.
   */
  async function deleteRogueHistoryScienceAssignments(
    weekDates: string[],
    weekIdForLog: string | null,
  ) {
    const HIST_SCI_COURSES: Array<{ id: number; subject: 'History' | 'Science' }> = [
      { id: 21934, subject: 'History' },
      { id: 21970, subject: 'Science' },
    ];
    for (const { id: courseId, subject } of HIST_SCI_COURSES) {
      const { data, error } = await supabase.functions.invoke('canvas-fetch', {
        body: { action: 'list_assignments', courseId: String(courseId) },
      });
      if (error) {
        console.warn(`canvas-fetch list_assignments failed for ${subject}`, error);
        continue;
      }
      const assignments: Array<{ id: number | string; name: string; due_at: string | null }> =
        Array.isArray(data) ? data : [];
      const weekAssignments = assignments.filter((a) => {
        if (!a.due_at) return false;
        return weekDates.includes(a.due_at.slice(0, 10));
      });
      for (const a of weekAssignments) {
        await supabase.functions.invoke('canvas-patch', {
          body: {
            patches: [{
              courseId: String(courseId),
              assignmentId: String(a.id),
              action: 'delete',
            }],
          },
        });
        console.warn(`Deleted rogue ${subject} assignment: ${a.name}`);
        await supabase.from('deploy_log').insert({
          subject,
          week_id: weekIdForLog,
          action: 'auto_delete_rogue',
          status: 'OK',
          message: `Deleted rogue ${subject} assignment "${a.name}" (id ${a.id}) in course ${courseId}`,
          payload: { courseId, assignmentId: a.id, name: a.name, due_at: a.due_at },
        });
      }
    }
  }


  const statusBadge = (s: DeployStatus) => {
    switch (s) {
      case 'NEW':
        return <Badge className="bg-primary/15 text-primary border-primary/30 text-[9px]" variant="outline">NEW</Badge>;
      case 'UPDATE':
        return <Badge className="bg-warning/15 text-warning border-warning/30 text-[9px]" variant="outline">UPDATE</Badge>;
      case 'NO_CHANGE':
        return <Badge className="bg-muted text-muted-foreground text-[9px]" variant="outline">UP TO DATE</Badge>;
      case 'SKIP':
        return <Badge className="bg-muted text-muted-foreground text-[9px]" variant="outline">SKIP</Badge>;
      case 'DEPLOYED':
        return <Badge className="bg-success/15 text-success border-success/30 text-[9px] gap-1" variant="outline"><CheckCircle2 className="h-2.5 w-2.5" />DONE</Badge>;
      case 'ERROR':
        return <Badge variant="destructive" className="text-[9px]">ERROR</Badge>;
    }
  };

  const counts = useMemo(() => {
    const c = { NEW: 0, UPDATE: 0, NO_CHANGE: 0, SKIP: 0 };
    for (const r of filtered) {
      if (r.status in c) c[r.status as keyof typeof c]++;
    }
    return c;
  }, [filtered]);

  // ── Q4W5 DRY-RUN TEST HARNESS ──────────────────────────────
  const handleRunTests = async () => {
    if (!config) return;
    setTestRunning(true);
    try {
      const Q = 'Q4';
      const W = 5;
      const weekDates = computeWeekDates(Q, W);

      const { data: weekRec } = await supabase
        .from('weeks').select('id').eq('quarter', Q).eq('week_num', W).maybeSingle();
      if (!weekRec) {
        toast.error('No Q4W5 week found in database');
        setTestRunning(false);
        return;
      }
      const { data: pRows } = await supabase
        .from('pacing_rows').select('*').eq('week_id', weekRec.id);
      const rows = pRows || [];

      const built: BuiltAssignment[] = [];
      for (const subject of SUBJECTS) {
        for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
          const day = DAYS[dayIdx];
          const dayRows = rows.filter((r: any) => r.subject === subject && r.day === day);
          for (const row of dayRows) {
            if (!row.type || row.type === '-' || row.type === 'No Class') continue;
            if (!row.create_assign) continue;

            const cell: PacingCell = {
              value: row.in_class || row.lesson_num || '',
              lessonNum: row.lesson_num || '',
              isTest: (row.type || '').toLowerCase().includes('test'),
              isReview: (row.in_class || '').toLowerCase().includes('review'),
              isNoClass: row.type === '-' || row.type === 'No Class',
              hint_override: (row as any).hint_override ?? null,
            };

            if (subject === 'Math') {
              const items = await expandMathRow(dayIdx, cell, { config, contentMap, weekDates });
              built.push(...items);
              continue;
            }
            if (subject === 'Reading' && cell.isTest) {
              const t = await buildAssignmentForCell('Reading', dayIdx, cell,
                { config, contentMap, weekDates }, { type: 'Test' });
              if (t) built.push(t);
              const c = await buildAssignmentForCell('Reading', dayIdx, cell,
                { config, contentMap, weekDates }, { type: 'Checkout', isSynthetic: true });
              if (c) built.push(c);
              continue;
            }
            if (subject === 'Spelling' && !cell.isTest) continue;
            if (subject === 'Language Arts') {
              const upper = (row.type || '').toUpperCase();
              if (!upper.includes('CP') && !upper.includes('TEST') &&
                  !upper.includes('CLASSROOM PRACTICE')) continue;
            }
            if (subject === 'History' || subject === 'Science') continue;

            const a = await buildAssignmentForCell(subject, dayIdx, cell,
              { config, contentMap, weekDates });
            if (a) built.push(a);
          }
        }
      }

      const dateRange = `${weekDates[0]} – ${weekDates[4]}`;
      const quarterColor = (config as any).quarterColors?.[Q] || '#0065a7';
      const buildPage = (subj: string) => {
        const sRows: CanvasPageRow[] = rows
          .filter((r: any) => r.subject === subj || (subj === 'Reading' && r.subject === 'Spelling'))
          .map((r: any) => ({
            day: r.day, type: r.type, lesson_num: r.lesson_num,
            in_class: r.in_class, at_home: r.at_home, canvas_url: r.canvas_url,
            canvas_assignment_id: r.canvas_assignment_id, object_id: null,
            subject: r.subject, resources: r.resources,
          }));
        return generateCanvasPageHtml({
          subject: subj === 'Reading' ? 'Reading & Spelling' : subj,
          rows: sRows, quarter: Q, weekNum: W, dateRange,
          subjectReminder: '', subjectResources: [], quarterColor, contentMap,
        });
      };
      const pageHtml: Record<string, string> = {
        Math: buildPage('Math'),
        Reading: buildPage('Reading'),
      };

      const r = await runQ4W5Tests(built, pageHtml);
      setTestResults(r);
      setTestOpen(true);
    } catch (e: any) {
      toast.error('Test run failed', { description: e?.message });
    }
    setTestRunning(false);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                <SelectItem key={q} value={q}>{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(selectedWeek)} onValueChange={(v) => setSelectedWeek(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>Week {i + 1}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5 ml-2">
            {FILTER_CHIPS.map((chip) => (
              <Button
                key={chip}
                variant={filter === chip ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setFilter(chip)}
              >
                {chip}
              </Button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border">
              <Switch id="test-mode" checked={testMode} onCheckedChange={setTestMode} />
              <Label htmlFor="test-mode" className="text-[10px] uppercase tracking-wider cursor-pointer">
                Test Mode
              </Label>
            </div>
            <Button
              variant="outline" size="sm"
              onClick={handleRunTests}
              disabled={!testMode || testRunning}
              className="gap-1.5"
            >
              {testRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Run Q4W5 Tests 🧪
            </Button>
            <Badge variant="outline" className="text-[9px]">{counts.NEW} NEW</Badge>
            <Badge variant="outline" className="text-[9px]">{counts.UPDATE} UPDATE</Badge>
            <Badge variant="outline" className="text-[9px]">{counts.NO_CHANGE} OK</Badge>
            <Badge variant="outline" className="text-[9px]">{counts.SKIP} SKIP</Badge>
            <Button variant="outline" size="sm" onClick={selectAllPending} disabled={deployable.length === 0}>
              Select Pending ({deployable.length})
            </Button>
            <Button
              onClick={() => setDiffOpen(true)}
              disabled={deploying || selected.size === 0 || isLoading}
              className="gap-1.5 bg-success hover:bg-success/90 text-success-foreground"
              size="sm"
            >
              {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              Deploy Selected ({selected.size})
            </Button>
          </div>
        </div>

        {testMode && (
          <Card className="border-warning bg-warning/10">
            <CardContent className="py-2.5 flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-warning" />
              <p className="text-xs font-semibold text-warning">
                🧪 TEST MODE — no Canvas API calls will be made
              </p>
            </CardContent>
          </Card>
        )}

        {historyRedirect && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="py-4 flex items-center gap-3">
              <ArrowRightLeft className="h-5 w-5 text-warning" />
              <p className="text-sm">
                <span className="font-semibold">{historyRedirect.from}</span> has no content this week.
                Redirecting to <span className="font-semibold">{historyRedirect.to}</span>.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Preview Table */}
        {isLoading ? (
          <Card>
            <CardContent className="py-12 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>No assignments to preview.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                Assignment Preview — {selectedMonth} Week {selectedWeek}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="text-xs w-[90px]">Status</TableHead>
                      <TableHead className="text-xs w-[80px]">Day</TableHead>
                      <TableHead className="text-xs">Title</TableHead>
                      <TableHead className="text-xs">Group</TableHead>
                      <TableHead className="text-xs text-center w-[60px]">Pts</TableHead>
                      <TableHead className="text-xs">Due (ET)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => {
                      const liveStatus = deployResults[row.rowKey] || row.status;
                      const isSkip = row.status === 'SKIP';
                      const isForced = forcedRows.has(row.rowKey);
                      const canSelect = row.status === 'NEW' || row.status === 'UPDATE' || isForced;
                      const isExpanded = expanded.has(row.rowKey);
                      return (
                        <>
                          <TableRow
                            key={row.rowKey}
                            className={
                              liveStatus === 'DEPLOYED' ? 'bg-success/5' :
                              liveStatus === 'ERROR' ? 'bg-destructive/10' :
                              isSkip ? 'opacity-60' : ''
                            }
                          >
                            <TableCell>
                              <Checkbox
                                checked={selected.has(row.rowKey)}
                                onCheckedChange={() => toggleSelect(row.rowKey)}
                                disabled={!canSelect}
                              />
                            </TableCell>
                            <TableCell>
                              <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(row.rowKey)}>
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                  </Button>
                                </CollapsibleTrigger>
                              </Collapsible>
                            </TableCell>
                            <TableCell>
                              {isSkip && row.skipReason ? (
                                <div className="flex items-center gap-1.5">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-1">
                                        {statusBadge(liveStatus)}
                                        <SkipForward className="h-3 w-3 text-muted-foreground" />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>{row.skipReason}</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant={isForced ? 'default' : 'outline'}
                                        className="h-5 px-1.5 text-[9px] gap-1"
                                        onClick={() => {
                                          toggleForce(row.rowKey);
                                          if (!isForced) {
                                            setSelected((prev) => {
                                              const next = new Set(prev);
                                              next.add(row.rowKey);
                                              return next;
                                            });
                                          }
                                        }}
                                      >
                                        {isForced ? 'FORCED' : 'FORCE'}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Bypass gatekeeper and deploy this assignment to Canvas anyway.</TooltipContent>
                                  </Tooltip>
                                </div>
                              ) : statusBadge(liveStatus)}
                            </TableCell>
                            <TableCell className="text-xs font-medium text-primary">{row.day}</TableCell>
                            <TableCell className="text-xs">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-semibold flex items-center gap-1.5">
                                  {row.title}
                                  {row.isSynthetic && (
                                    <Badge
                                      variant="outline"
                                      className="text-[8px] h-4 px-1 bg-primary/10 text-primary border-primary/30"
                                    >
                                      AUTO
                                    </Badge>
                                  )}
                                </span>
                                <span className="text-[9px] text-muted-foreground">
                                  {row.subject} · Course {row.courseId}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
                              {row.assignmentGroup}
                            </TableCell>
                            <TableCell className="text-xs text-center font-mono">{row.points}</TableCell>
                            <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                              {formatDueET(row.dueDate)}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (() => {
                            const overrides = editOverrides[row.rowKey] || {};
                            const setField = (field: string, value: any) => {
                              setEditOverrides(prev => ({
                                ...prev,
                                [row.rowKey]: { ...prev[row.rowKey], [field]: value }
                              }));
                            };
                            return (
                              <TableRow key={`${row.rowKey}_exp`} className="bg-muted/20">
                                <TableCell colSpan={8} className="p-4 space-y-3">
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div className="space-y-1">
                                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Title</label>
                                      <Input
                                        className="text-xs h-8"
                                        value={overrides.title ?? row.title}
                                        onChange={(e) => setField('title', e.target.value)}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Due Date (ET midnight)</label>
                                      <Input
                                        type="date"
                                        className="text-xs h-8"
                                        value={overrides.dueDate?.slice(0, 10) ?? (row.dueDate?.slice(0, 10) || '')}
                                        onChange={(e) => setField('dueDate', e.target.value ? `${e.target.value}T23:59:00` : '')}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Points</label>
                                      <Input
                                        type="number"
                                        className="text-xs h-8 w-20"
                                        value={overrides.points ?? row.points}
                                        onChange={(e) => setField('points', Number(e.target.value))}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Grading Type</label>
                                      <select
                                        className="h-8 rounded border border-input bg-background px-2 text-xs w-full"
                                        value={overrides.gradingType ?? row.gradingType}
                                        onChange={(e) => setField('gradingType', e.target.value)}
                                      >
                                        <option value="points">Points</option>
                                        <option value="pass_fail">Pass/Fail</option>
                                        <option value="not_graded">Not Graded</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Description Preview</div>
                                    <div
                                      className="text-sm prose prose-sm max-w-none [&_a]:text-primary [&_a]:underline rounded border border-border/50 bg-background p-3 max-h-40 overflow-auto"
                                      dangerouslySetInnerHTML={{ __html: row.description }}
                                    />
                                  </div>
                                  <div className="text-[10px] font-mono text-muted-foreground">
                                    hash: {row.contentHash.slice(0, 12)}…
                                    {row.storedHash && ` · stored: ${row.storedHash.slice(0, 12)}…`}
                                    {Object.keys(overrides).length > 0 && (
                                      <span className="ml-2 text-amber-500 font-semibold">● Overrides pending</span>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })()}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-muted bg-muted/30">
          <CardContent className="py-3 flex items-center gap-3">
            <AlertCircle size={16} className="text-muted-foreground shrink-0" />
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              Friday Exception · History/Science skip · DST-aware due 11:59 PM ET · Hash-skip prevents duplicates.
            </p>
          </CardContent>
        </Card>

        <SafetyDiffModal
          open={diffOpen}
          onOpenChange={setDiffOpen}
          month={selectedMonth}
          week={selectedWeek}
          action="DEPLOY_ASSIGNMENTS"
          itemCount={selected.size}
          items={previewRows
            .filter((r) => selected.has(r.rowKey))
            .map((r) => ({ label: r.title, subject: r.subject }))}
          onApprove={handleDeploy}
          validation={
            diffOpen
              ? validateDeployment({
                  assignments: previewRows.filter((r) => selected.has(r.rowKey)),
                  contentMap,
                })
              : undefined
          }
        />

        <Dialog open={testOpen} onOpenChange={setTestOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-warning" />
                Q4W5 Test Results
              </DialogTitle>
            </DialogHeader>
            {(() => {
              const pass = testResults.filter((r) => r.status === 'PASS').length;
              const fail = testResults.filter((r) => r.status === 'FAIL').length;
              const warn = testResults.filter((r) => r.status === 'WARN').length;
              return (
                <div className="text-sm font-mono mb-3">
                  <span className="text-success">{pass} passed</span> ·{' '}
                  <span className="text-destructive">{fail} failed</span> ·{' '}
                  <span className="text-warning">{warn} warnings</span>
                </div>
              );
            })()}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-xs">Status</TableHead>
                  <TableHead className="text-xs">Test</TableHead>
                  <TableHead className="text-xs">Expected</TableHead>
                  <TableHead className="text-xs">Actual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {testResults.map((r, i) => (
                  <TableRow
                    key={i}
                    className={
                      r.status === 'PASS' ? 'bg-success/10' :
                      r.status === 'FAIL' ? 'bg-destructive/10' :
                      'bg-warning/10'
                    }
                  >
                    <TableCell className="text-[10px] font-bold">{r.status}</TableCell>
                    <TableCell className="text-xs">{r.name}</TableCell>
                    <TableCell className="text-[11px] font-mono text-muted-foreground">{r.expected}</TableCell>
                    <TableCell className="text-[11px] font-mono">{r.actual}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
