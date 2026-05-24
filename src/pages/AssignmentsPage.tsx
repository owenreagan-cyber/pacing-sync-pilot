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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Rocket, Loader2, AlertCircle, ArrowRightLeft, ShieldCheck,
  ChevronDown, Eye, FlaskConical, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useConfig } from '@/lib/config';
import { callEdge } from '@/lib/edge';
import { useRealtimeDeploy } from '@/hooks/use-realtime-deploy';
import { useSystemStore } from '@/store/useSystemStore';
import SafetyDiffModal from '@/components/SafetyDiffModal';
import { logDeployHabit } from '@/lib/teacher-memory';
import {
  buildAssignmentForCell,
  type BuiltAssignment,
} from '@/lib/assignment-build';
import {
  generateCanvasPageHtml,
  type CanvasPageRow,
} from '@/lib/canvas-html';
import { runQ4W5Tests, type TestResult } from '@/lib/test-runner';
import type { ContentMapEntry } from '@/lib/auto-link';
import { getPacingWeekDatesISO } from '@/lib/pacing-week';
import { isDryRunMode } from '@/lib/env/canvas-mode';

const SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'];
const FILTER_CHIPS = ['All', 'Math', 'Reading', 'Language Arts', 'Spelling'];

type DeployStatus = 'NEW' | 'UPDATE' | 'NO_CHANGE' | 'SKIP' | 'ERROR' | 'DEPLOYED';

interface PreviewRow extends BuiltAssignment {
  dayIndex: number;
  rowKey: string;
  status: DeployStatus;
  isSynthetic?: boolean;
}

interface PacingDbRow {
  subject: string;
  day: string;
  type: string | null;
  lesson_num: string | null;
  canvas_assignment_id: number | null;
  content_hash: string | null;
  created_at: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function computeWeekDates(quarter: string, week: number): string[] {
  const startDate = new Date(2026, 0, 1);
  startDate.setDate(startDate.getDate() + (parseInt(quarter.slice(1)) - 1) * 13 * 7 + (week - 1) * 7);
  const dates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
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
  const [_weekId, setWeekId] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('All');
  const [deployResults, setDeployResults] = useState<Record<string, DeployStatus>>({});
  const [forcedRows, setForcedRows] = useState<Set<string>>(new Set());
  const [editOverrides, _setEditOverrides] = useState<
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
      .then(({ data }) => {
        if (data) setContentMap(data as ContentMapEntry[]);
      });
  }, []);

  // Fetch pacing_rows for selected quarter/week
  useEffect(() => {
    if (!selectedMonth || !selectedWeek) return;
    supabase
      .from('weeks')
      .select('id')
      .eq('quarter', selectedMonth)
      .eq('week_num', selectedWeek)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setWeekId(data?.id ?? null);
        if (!data?.id) return;
        supabase
          .from('pacing_rows')
          .select('subject, day, type, lesson_num, canvas_assignment_id, content_hash, created_at')
          .eq('week_id', data.id)
          .then(({ data: rows }) => {
            setPacingDbRows((rows as any) || []);
          });
      });

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
    void (async () => {
      if (!selectedMonth || !selectedWeek || !config) return;
      const Q = selectedMonth;
      const W = selectedWeek;
      const weekDates = getPacingWeekDatesISO(Q, W);

      const pacingRows = pacingDbRows;

      const built: PreviewRow[] = [];

      const isDash = (t: string | null) => !t || t === '-' || t === 'No Class';

      const histRows = pacingRows.filter((r: any) => r.subject === 'History');
      const sciRows = pacingRows.filter((r: any) => r.subject === 'Science');
      const allHistDash = histRows.length === 0 || histRows.every((r: any) => isDash(r.type));
      const allSciDash = sciRows.length === 0 || sciRows.every((r: any) => isDash(r.type));
      if (allHistDash && !allSciDash) setHistoryRedirect({ from: 'History', to: 'Science' });
      else if (allSciDash && !allHistDash) setHistoryRedirect({ from: 'Science', to: 'History' });
      else setHistoryRedirect(null);

      function toPreview(a: BuiltAssignment): PreviewRow {
        const dayIndex = DAYS.indexOf(a.day);
        const rowKey = `${a.subject}_${dayIndex}_${a.type}_${a.lesson_num}`;
        const dbRow = findDbRow(a.subject, dayIndex, a.type, a.lesson_num);
        let status: DeployStatus = 'NEW';
        if (dbRow) {
          const oldHash = dbRow.content_hash;
          const newHash = JSON.stringify(a).substring(0, 40);
          status = oldHash === newHash ? 'NO_CHANGE' : 'UPDATE';
        }
        return { ...a, dayIndex, rowKey, status };
      }

      for (const subject of SUBJECTS) {
        for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
          const day = DAYS[dayIdx];
          const cell = { day, dayIndex: dayIdx, isTest: false };

          const row = pacingRows.find(
            (r: any) => r.subject === subject && r.day === day,
          );
          if (!row) continue;

          // Skip rows with dash-like types
          if (isDash(row.type)) {
            // Reading Double-Split: Test + Checkout
            if (subject === 'Reading' && row.lesson_num) {
              const test = await buildAssignmentForCell('Reading', dayIdx, { ...cell, isTest: true },
                { config, contentMap, weekDates }, { type: 'Test' });
              if (test) built.push(toPreview(test));
              const checkout = await buildAssignmentForCell('Reading', dayIdx, cell,
                { config, contentMap, weekDates }, { type: 'Checkout', isSynthetic: true });
              if (checkout) built.push(toPreview(checkout));
            }
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
          if (subject === 'History' || subject === 'Science') continue;

          const a = await buildAssignmentForCell(subject, dayIdx, cell,
            { config, contentMap, weekDates });
          if (a) built.push(toPreview(a));
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

  const formatDueET = (dueDate: string | undefined) => {
    if (!dueDate) return '\u2014';
    try {
      const d = new Date(dueDate + 'T16:59:00Z');
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
    } catch {
      return dueDate;
    }
  };

  const statusBadge = (liveStatus: DeployStatus) => {
    if (liveStatus === 'NEW') return <Badge className="text-[10px] bg-blue-600">NEW</Badge>;
    if (liveStatus === 'UPDATE') return <Badge className="text-[10px] bg-amber-600">UPDATE</Badge>;
    if (liveStatus === 'NO_CHANGE') return <Badge variant="secondary" className="text-[10px]">UP-TO-DATE</Badge>;
    if (liveStatus === 'SKIP') return <Badge variant="outline" className="text-[10px]">SKIP</Badge>;
    if (liveStatus === 'ERROR') return <Badge variant="destructive" className="text-[10px]">ERROR</Badge>;
    if (liveStatus === 'DEPLOYED') return <Badge className="text-[10px] bg-success text-success-foreground">DEPLOYED</Badge>;
    return <Badge variant="outline" className="text-[10px]">{liveStatus}</Badge>;
  };

  const handleDeployAll = async () => {
    if (deployable.length === 0) {
      toast.error('No deployable assignments');
      return;
    }

    if (testMode) {
      console.log('[TEST MODE] Deploy:', deployable.map((r) => r.title));
      setDeployResults(Object.fromEntries(deployable.map((r) => [r.rowKey, 'DEPLOYED'])));
      toast.message(`TEST: ${deployable.length} assignments`, {
        description: 'No Canvas API calls made',
      });
      return;
    }

    setDiffOpen(true);
  };

  const handleSafetyApprove = async () => {
    setDeploying(true);
    const results: Record<string, DeployStatus> = {};
    let ok = 0, err = 0;

    const toastId = toast.loading(`Deploying 0/${deployable.length} assignments\u2026`);

    for (const r of deployable) {
      toast.loading(`Deploying (${ok + 1}/${deployable.length}) ${r.title}\u2026`, { id: toastId });

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
          type: r.type,
        },
      );
      if (res?.status === 'DEPLOYED' || res?.status === 'NO_CHANGE') {
        results[r.rowKey] = 'DEPLOYED';
        ok++;
      } else {
        toast.error(`Deploy failed: ${r.title}`, { description: res?.error });
        results[r.rowKey] = 'ERROR';
        err++;
      }
    }

    setDeployResults(results);
    toast.success(`${ok} deployed, ${err} failed`, { id: toastId });
    void logDeployHabit(deployable.map((r) => r.subject));
    setDeploying(false);
  };

  const handleTestRun = async () => {
    setTestRunning(true);
    try {
      const Q = selectedMonth;
      const W = selectedWeek;
      const weekDates = computeWeekDates(Q, W);
      const built = deployable.slice(0, 10);

      const dateRange = `${weekDates[0]} – ${weekDates[4]}`;
      const quarterColor = (config as any).quarterColors?.[Q] || '#0065a7';
      const buildPage = (subj: string) => {
        const sRows: CanvasPageRow[] = pacingDbRows
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
        {isDryRunMode() && (
          <div className="rounded-md border border-yellow-500/60 bg-yellow-500/15 px-4 py-2.5 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <p className="text-xs font-semibold text-yellow-700">
              🧪 Dry-Run Mode — No Canvas changes will be made
            </p>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                <SelectItem key={q} value={q}>
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(selectedWeek)} onValueChange={(v) => setSelectedWeek(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  Week {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border">
              <input
                id="ap-test-mode"
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              <label htmlFor="ap-test-mode" className="text-[10px] uppercase tracking-wider cursor-pointer">
                Test Mode
              </label>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={handleTestRun}
              disabled={deploying || testRunning || deployable.length === 0}
              className="gap-1.5"
            >
              {testRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              {testRunning ? 'Testing\u2026' : 'Run Tests'}
            </Button>

            <Button
              size="sm"
              variant="deploy"
              onClick={handleDeployAll}
              disabled={deploying || deployable.length === 0}
              className="gap-1.5"
            >
              {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              {deploying ? 'Deploying\u2026' : `Deploy ${deployable.length}`}
            </Button>
          </div>
        </div>

        {testMode && (
          <Card className="border-warning bg-warning/10">
            <CardContent className="py-2.5 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-warning" />
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
              <div className="border-b flex gap-2 px-4 py-2 bg-muted/50 overflow-x-auto">
                {FILTER_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => setFilter(chip)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded whitespace-nowrap transition-colors ${
                      filter === chip
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="text-xs w-[90px]">Status</TableHead>
                      <TableHead className="text-xs w-20">Day</TableHead>
                      <TableHead className="text-xs">Title</TableHead>
                      <TableHead className="text-xs w-[120px]">Assignment Group</TableHead>
                      <TableHead className="text-xs w-16 text-center">Pts</TableHead>
                      <TableHead className="text-xs w-[80px]">Due (ET)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => {
                      const isSelected = selected.has(row.rowKey);
                      const isExpanded = expanded.has(row.rowKey);
                      const isForced = forcedRows.has(row.rowKey);
                      const liveStatus = deployResults[row.rowKey] ?? row.status;
                      const canDeploy = row.status === 'NEW' || row.status === 'UPDATE' || isForced;

                      return (
                        <TableRow
                          key={row.rowKey}
                          className={`${
                            liveStatus === 'DEPLOYED' ? 'bg-success/10' :
                            liveStatus === 'ERROR' ? 'bg-destructive/10' :
                            'hover:bg-muted/50'
                          }`}
                        >
                          <TableCell className="w-8">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => {
                                setSelected((p) => {
                                  const n = new Set(p);
                                  if (n.has(row.rowKey)) n.delete(row.rowKey);
                                  else n.add(row.rowKey);
                                  return n;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell className="w-8">
                            <button
                              onClick={() => {
                                setExpanded((p) => {
                                  const n = new Set(p);
                                  if (n.has(row.rowKey)) n.delete(row.rowKey);
                                  else n.add(row.rowKey);
                                  return n;
                                });
                              }}
                              className={`p-0.5 rounded hover:bg-muted transition-colors ${isExpanded ? 'bg-muted' : ''}`}
                            >
                              <ChevronDown
                                className={`h-4 w-4 text-muted-foreground transition-transform ${
                                  isExpanded ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                          </TableCell>
                          <TableCell className="text-[10px]">
                            {canDeploy ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div>
                                    <Button
                                      size="sm"
                                      variant={isForced ? 'default' : 'outline'}
                                      onClick={() => toggleForce(row.rowKey)}
                                      className="text-[8px] h-5 px-1"
                                    >
                                      {isForced ? '✓ Force' : 'Force'}
                                    </Button>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="text-[10px]">
                                  Force deployment (normally: {row.status})
                                </TooltipContent>
                              </Tooltip>
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
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Safety Diff Modal */}
        <SafetyDiffModal
          open={diffOpen}
          onOpenChange={setDiffOpen}
          month={selectedMonth}
          week={selectedWeek}
          action="DEPLOY_ASSIGNMENTS"
          itemCount={deployable.length}
          items={deployable.map((r) => ({ label: r.title, subject: r.subject }))}
          onApprove={handleSafetyApprove}
        />

        {/* Test Results Dialog */}
        <Dialog open={testOpen} onOpenChange={setTestOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Q4W5 Test Results</DialogTitle>
            </DialogHeader>
            {(() => {
              const pass = testResults.filter((r) => r.status === 'PASS').length;
              const fail = testResults.filter((r) => r.status === 'FAIL').length;
              const warn = testResults.filter((r) => r.status === 'WARN').length;
              return (
                <div className="text-xs text-muted-foreground space-y-1 border-b pb-3">
                  {pass > 0 && <span className="text-success">✅ {pass} passed</span>}
                  {fail > 0 && <span className="text-destructive"> · ❌ {fail} failed</span>}
                  {warn > 0 && (
                    <span className="text-warning">{warn} warnings</span>
                  )}
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
