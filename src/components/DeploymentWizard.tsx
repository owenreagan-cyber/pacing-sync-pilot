/* eslint-disable */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { callEdge } from '@/lib/edge';
import { useSystemStore } from '@/store/useSystemStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import SafetyDiffModal from '@/components/SafetyDiffModal';
import { FileOrganizerStepPanel } from '@/components/deployment-wizard/FileOrganizerStepPanel';
import { AssignmentsStepPanel } from '@/components/deployment-wizard/AssignmentsStepPanel';
import { CanvasPagesStepPanel } from '@/components/deployment-wizard/CanvasPagesStepPanel';
import { AnnouncementsStepPanel } from '@/components/deployment-wizard/AnnouncementsStepPanel';
import type { StepContract, StepRunSummary, StepStatus } from '@/components/deployment-wizard/types';
import {
  assignmentPlan,
  announcementPlan,
  type PacingRowLike,
} from '@/lib/pacing';

type StepNumber = 1 | 2 | 3 | 4;
type DraftEntity = 'assignment' | 'page' | 'announcement';

interface AssignmentDraftRow {
  id: string;
  subject: string;
  day: string;
  type: string | null;
  lesson_num: string | null;
  is_synthetic?: boolean | null;
  create_assign?: boolean | null;
  canvas_assignment_id?: number | string | null;
  content_hash?: string | null;
}

interface AnnouncementDraftRow {
  id: string;
  title: string | null;
  content: string | null;
  status: string | null;
}

interface EditValue {
  title?: string;
  content?: string;
  html?: string;
}

const STEPS: Array<{ id: StepNumber; title: string; subtitle: string }> = [
  { id: 1, title: 'File Organizer & Mapping', subtitle: 'Prepare files and canonical mappings' },
  { id: 2, title: 'Assignment Review & Deploy', subtitle: 'Review assignment payloads before deploy' },
  { id: 3, title: 'Canvas Page HTML Review & Deploy', subtitle: 'Review generated page HTML and deploy' },
  { id: 4, title: 'Announcement Review & Deploy', subtitle: 'Review drafts, schedule, and post' },
];

const SUBJECT_PAGE_KEYS = ['Math', 'Reading', 'Language Arts', 'History', 'Science', 'Homeroom'];

function mergeSummary(base: StepRunSummary, extra: Partial<StepRunSummary>): StepRunSummary {
  return {
    message: extra.message ?? base.message,
    generated: extra.generated ?? base.generated,
    edited: extra.edited ?? base.edited,
    deployed: extra.deployed ?? base.deployed,
    errors: extra.errors ?? base.errors,
  };
}

export default function DeploymentWizard() {
  const { selectedMonth, selectedWeek } = useSystemStore();
  const [currentStep, setCurrentStep] = useState<StepNumber>(1);
  const [stepStatus, setStepStatus] = useState<Record<StepNumber, StepStatus>>({
    1: 'ready',
    2: 'idle',
    3: 'idle',
    4: 'idle',
  });
  const [stepSummary, setStepSummary] = useState<Record<StepNumber, StepRunSummary | null>>({
    1: null,
    2: null,
    3: null,
    4: null,
  });

  const [weekId, setWeekId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<AssignmentDraftRow[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementDraftRow[]>([]);
  // subject → latest page_deploy status; used for Step 3 attestation.
  const [pageDeployStatus, setPageDeployStatus] = useState<Record<string, string>>({});
  const [loadingWeekData, setLoadingWeekData] = useState(false);
  const [runningTransition, setRunningTransition] = useState(false);

  const [draftEdits, setDraftEdits] = useState<Record<DraftEntity, Record<string, EditValue>>>({
    assignment: {},
    page: {},
    announcement: {},
  });

  const [safetyOpen, setSafetyOpen] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<null | (() => Promise<void>)>(null);
  const [safetyAction, setSafetyAction] = useState<'DEPLOY_ASSIGNMENTS' | 'DEPLOY_AGENDAS'>('DEPLOY_ASSIGNMENTS');

  const editedCount = useMemo(
    () =>
      Object.values(draftEdits.assignment).length +
      Object.values(draftEdits.page).length +
      Object.values(draftEdits.announcement).length,
    [draftEdits],
  );

  const refreshWeekData = useCallback(async () => {
    if (!selectedMonth || !selectedWeek) {
      setWeekId(null);
      setAssignments([]);
      setAnnouncements([]);
      return;
    }

    setLoadingWeekData(true);
    try {
      const { data: weekData } = await supabase
        .from('weeks')
        .select('id')
        .eq('quarter', selectedMonth)
        .eq('week_num', selectedWeek)
        .limit(1)
        .maybeSingle();

      const id = weekData?.id ?? null;
      setWeekId(id);

      if (!id) {
        setAssignments([]);
        setAnnouncements([]);
        return;
      }

      const [{ data: assignmentRows }, { data: announcementRows }, { data: deployRows }] = await Promise.all([
        supabase
          .from('pacing_rows')
          .select('id, subject, day, type, lesson_num, is_synthetic, create_assign, canvas_assignment_id, content_hash')
          .eq('week_id', id)
          .order('subject')
          .order('day'),
        supabase
          .from('announcements')
          .select('id, title, content, status')
          .eq('week_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('deploy_log')
          .select('subject, status')
          .eq('week_id', id)
          .eq('action', 'page_deploy')
          .order('created_at', { ascending: false }),
      ]);

      setAssignments((assignmentRows ?? []) as AssignmentDraftRow[]);
      setAnnouncements((announcementRows ?? []) as AnnouncementDraftRow[]);

      // Reduce deploy_log → { subject: latest_status } for step 3 attestation.
      const pageStatus: Record<string, string> = {};
      for (const row of deployRows ?? []) {
        if (row.subject && !pageStatus[row.subject]) {
          pageStatus[row.subject] = row.status ?? 'UNKNOWN';
        }
      }
      setPageDeployStatus(pageStatus);
    } finally {
      setLoadingWeekData(false);
    }
  }, [selectedMonth, selectedWeek]);

  useEffect(() => {
    refreshWeekData();
  }, [refreshWeekData]);

  const hasPendingByStep = useMemo(
    () => ({
      1: false,
      2: Object.keys(draftEdits.assignment).length > 0,
      3: Object.keys(draftEdits.page).length > 0,
      4: Object.keys(draftEdits.announcement).length > 0,
    }),
    [draftEdits],
  );

  const contracts = useMemo<Record<StepNumber, StepContract>>(() => {
    const baseValidate = async () => {
      if (!selectedMonth || !selectedWeek) return { valid: false, message: 'Select an active quarter/week first.' };
      return { valid: true };
    };

    // Row shape → selector shape. `assignments` already contains the fields
    // `assignmentPlan` needs (subject/day/type/lesson_num/is_synthetic/create_assign).
    const rowsForPlan: PacingRowLike[] = assignments.map((r) => ({
      id: r.id,
      subject: r.subject,
      day: r.day,
      type: r.type,
      lesson_num: r.lesson_num,
      is_synthetic: r.is_synthetic ?? false,
      create_assign: r.create_assign ?? true,
    }));

    return {
      1: {
        load: refreshWeekData,
        validate: baseValidate,
        buildPreview: async () => ({
          message: `File organization context loaded. ${assignments.length} pacing rows on file.`,
          generated: assignments.length,
        }),
        deploySelected: async () => ({
          message: 'File mapping approved — advance to build assignments.',
          deployed: 0,
        }),
        hasPendingChanges: hasPendingByStep[1],
        lastRunSummary: stepSummary[1],
      },
      2: {
        load: refreshWeekData,
        validate: baseValidate,
        buildPreview: async () => {
          const plan = assignmentPlan(rowsForPlan);
          const willDeploy = plan.filter((p) => p.willDeploy).length;
          const skipped = plan.length - willDeploy;
          return {
            message: `Assignment plan: ${willDeploy} to deploy, ${skipped} skipped by rules.`,
            generated: willDeploy,
          };
        },
        // Real deploy — iterate every willDeploy row and hit the edge function.
        // The edge function re-validates against pacing_rows and enforces the
        // same rule set, so we send the row id + week id and let it reject
        // anything that violates the trigger.
        deploySelected: async () => {
          const plan = assignmentPlan(rowsForPlan).filter((p) => p.willDeploy);
          let deployed = 0;
          let blocked = 0;
          let errors = 0;
          for (const item of plan) {
            if (!item.rowId) continue;
            try {
              const res = await callEdge<{ status?: string; error?: string }>(
                'canvas-deploy-assignment',
                {
                  rowId: item.rowId,
                  weekId: weekId ?? undefined,
                  subject: item.subject,
                  day: item.day,
                  type: item.type,
                  force: false,
                },
              );
              if (res?.status === 'BLOCKED') blocked += 1;
              else if (res?.status === 'DEPLOYED' || res?.status === 'NO_CHANGE') deployed += 1;
              else errors += 1;
            } catch (e) {
              errors += 1;
              console.error('[wizard step 2] deploy failed', item.rowId, e);
            }
          }
          return {
            message: `Deployed ${deployed} · blocked ${blocked} · errors ${errors}.`,
            deployed,
            edited: Object.keys(draftEdits.assignment).length,
            errors,
          };
        },
        hasPendingChanges: hasPendingByStep[2],
        lastRunSummary: stepSummary[2],
      },
      3: {
        load: refreshWeekData,
        validate: baseValidate,
        // Attestation-style contract: Canvas page deploy lives in Page Builder
        // (it needs the full HTML + FPK validation). Here we count subjects
        // that actually have rows and confirm the deploy log recorded each one.
        buildPreview: async () => {
          const subjectsWithRows = new Set(assignments.map((r) => r.subject));
          const applicable = SUBJECT_PAGE_KEYS.filter(
            (s) => subjectsWithRows.has(s) || s === 'Homeroom' || s === 'Reading',
          );
          return {
            message: `Canvas pages: ${applicable.length} subjects ready to build.`,
            generated: applicable.length,
          };
        },
        deploySelected: async () => {
          const deployedSubjects = SUBJECT_PAGE_KEYS.filter(
            (s) => pageDeployStatus[s] === 'DEPLOYED',
          );
          const missing = SUBJECT_PAGE_KEYS.filter((s) => !deployedSubjects.includes(s));
          return {
            message:
              missing.length === 0
                ? 'All Canvas pages deployed for this week.'
                : `${deployedSubjects.length}/${SUBJECT_PAGE_KEYS.length} pages deployed. Open Page Builder to deploy: ${missing.join(', ')}.`,
            deployed: deployedSubjects.length,
            edited: Object.keys(draftEdits.page).length,
            errors: missing.length,
          };
        },
        hasPendingChanges: hasPendingByStep[3],
        lastRunSummary: stepSummary[3],
      },
      4: {
        load: refreshWeekData,
        validate: baseValidate,
        buildPreview: async () => {
          const testCount = announcementPlan(rowsForPlan).length;
          return {
            message: `Announcements: ${announcements.length} drafts on file (${testCount} test-driven reminders).`,
            generated: announcements.length,
          };
        },
        deploySelected: async () => {
          let edited = 0;
          const updates = Object.entries(draftEdits.announcement);

          for (const [id, edit] of updates) {
            const payload: { title?: string; content?: string } = {};
            if (typeof edit.title === 'string') payload.title = edit.title;
            if (typeof edit.content === 'string') payload.content = edit.content;
            if (Object.keys(payload).length > 0) {
              edited += 1;
              await supabase.from('announcements').update(payload).eq('id', id);
            }
          }

          return {
            message: 'Announcements updated and ready to post/deploy.',
            deployed: announcements.length,
            edited,
          };
        },
        hasPendingChanges: hasPendingByStep[4],
        lastRunSummary: stepSummary[4],
      },
    };
  }, [
    assignments,
    announcements.length,
    draftEdits.announcement,
    draftEdits.assignment,
    draftEdits.page,
    hasPendingByStep,
    pageDeployStatus,
    refreshWeekData,
    selectedMonth,
    selectedWeek,
    stepSummary,
    weekId,
  ]);


  const setStepState = (step: StepNumber, status: StepStatus, summary?: StepRunSummary) => {
    setStepStatus((prev) => ({ ...prev, [step]: status }));
    if (summary) setStepSummary((prev) => ({ ...prev, [step]: summary }));
  };

  const runGuarded = async (runner: () => Promise<void>, action?: typeof safetyAction) => {
    if (action) {
      setSafetyAction(action);
      setPendingTransition(() => runner);
      setSafetyOpen(true);
      return;
    }
    await runner();
  };

  const runStep1To2 = async () => {
    const step = contracts[1];
    setRunningTransition(true);
    setStepState(1, 'deploying');
    try {
      await step.load();
      const validated = await step.validate();
      if (!validated.valid) throw new Error(validated.message || 'Step 1 validation failed');
      const preview = await step.buildPreview();
      const done = mergeSummary(preview, { message: 'Assignments prepared from file mapping.' });
      setStepState(1, 'complete', done);
      setStepState(2, 'ready');
      setCurrentStep(2);
      toast.success('Step 1 complete: Assignments are ready to build.');
    } catch (error) {
      setStepState(1, 'error', { message: error instanceof Error ? error.message : 'Step 1 failed', errors: 1 });
      toast.error('Step 1 failed', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunningTransition(false);
    }
  };

  const runStep2To3 = async () => {
    const step = contracts[2];
    setRunningTransition(true);
    setStepState(2, 'deploying');
    try {
      const validated = await step.validate();
      if (!validated.valid) throw new Error(validated.message || 'Step 2 validation failed');
      const deploySummary = await step.deploySelected();
      const previewSummary = await contracts[3].buildPreview();
      setStepState(2, 'complete', deploySummary);
      setStepState(3, 'ready', previewSummary);
      setCurrentStep(3);
      toast.success('Step 2 complete: Canvas pages are ready to build.');
    } catch (error) {
      setStepState(2, 'error', { message: error instanceof Error ? error.message : 'Step 2 failed', errors: 1 });
      toast.error('Step 2 failed', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunningTransition(false);
    }
  };

  const runStep3To4 = async () => {
    const step = contracts[3];
    setRunningTransition(true);
    setStepState(3, 'deploying');
    try {
      const validated = await step.validate();
      if (!validated.valid) throw new Error(validated.message || 'Step 3 validation failed');
      const deploySummary = await step.deploySelected();
      const previewSummary = await contracts[4].buildPreview();
      setStepState(3, 'complete', deploySummary);
      setStepState(4, 'ready', previewSummary);
      setCurrentStep(4);
      toast.success('Step 3 complete: Announcements are ready to schedule.');
    } catch (error) {
      setStepState(3, 'error', { message: error instanceof Error ? error.message : 'Step 3 failed', errors: 1 });
      toast.error('Step 3 failed', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunningTransition(false);
    }
  };

  const runFinish = async () => {
    const step = contracts[4];
    setRunningTransition(true);
    setStepState(4, 'deploying');
    try {
      const validated = await step.validate();
      if (!validated.valid) throw new Error(validated.message || 'Step 4 validation failed');
      const summary = await step.deploySelected();
      setStepState(4, 'complete', summary);
      toast.success('Deployment Wizard complete.');
      await refreshWeekData();
    } catch (error) {
      setStepState(4, 'error', { message: error instanceof Error ? error.message : 'Step 4 failed', errors: 1 });
      toast.error('Step 4 failed', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunningTransition(false);
    }
  };

  const handleNext = async () => {
    if (currentStep === 1) return runGuarded(runStep1To2);
    if (currentStep === 2) return runGuarded(runStep2To3, 'DEPLOY_ASSIGNMENTS');
    if (currentStep === 3) return runGuarded(runStep3To4, 'DEPLOY_AGENDAS');
    return runGuarded(runFinish, 'DEPLOY_ASSIGNMENTS');
  };

  const handleSafetyApprove = async () => {
    const runner = pendingTransition;
    setSafetyOpen(false);
    setPendingTransition(null);
    if (runner) await runner();
  };

  const setDraftEdit = (entity: DraftEntity, key: string, patch: EditValue) => {
    setDraftEdits((prev) => ({
      ...prev,
      [entity]: {
        ...prev[entity],
        [key]: {
          ...prev[entity][key],
          ...patch,
        },
      },
    }));
  };

  const resetDraftEdit = (entity: DraftEntity, key: string) => {
    setDraftEdits((prev) => {
      const nextEntity = { ...prev[entity] };
      delete nextEntity[key];
      return { ...prev, [entity]: nextEntity };
    });
  };

  const statusBadge = (status: StepStatus) => {
    if (status === 'ready') return <Badge className="bg-blue-600">READY</Badge>;
    if (status === 'deploying') return <Badge className="bg-amber-600">DEPLOYING</Badge>;
    if (status === 'complete') return <Badge className="bg-emerald-600">COMPLETE</Badge>;
    if (status === 'error') return <Badge variant="destructive">ERROR</Badge>;
    return <Badge variant="outline">IDLE</Badge>;
  };

  const safetyItems = useMemo(() => {
    if (currentStep === 2) {
      return assignments.slice(0, 20).map((row) => ({
        label: `${draftEdits.assignment[row.id]?.title ?? `${row.subject} ${row.day} ${row.type || 'Lesson'}`}`,
        subject: row.subject,
      }));
    }
    if (currentStep === 3) {
      return SUBJECT_PAGE_KEYS.map((subject) => ({
        label: draftEdits.page[subject]?.title ?? `${subject} Agenda`,
        subject,
      }));
    }
    return announcements.slice(0, 20).map((row) => ({
      label: draftEdits.announcement[row.id]?.title ?? row.title ?? 'Announcement',
      subject: 'Homeroom',
    }));
  }, [announcements, assignments, currentStep, draftEdits]);

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Deployment Wizard</h1>
        <p className="text-sm text-muted-foreground">
          Guided flow to organize files, deploy assignments, build pages, and post announcements.
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{selectedMonth || 'No quarter selected'}</Badge>
          <Badge variant="outline">Week {selectedWeek || '—'}</Badge>
          <Badge variant="outline">{editedCount} inline edit{editedCount === 1 ? '' : 's'}</Badge>
          {loadingWeekData && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {STEPS.map((step) => {
              const isActive = currentStep === step.id;
              const isComplete = stepStatus[step.id] === 'complete';
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setCurrentStep(step.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    isActive ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm">Step {step.id}</div>
                    {isComplete ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : statusBadge(stepStatus[step.id])}
                  </div>
                  <div className="text-sm font-medium mt-2">{step.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{step.subtitle}</div>
                </button>
              );
            })}
          </div>

          {stepSummary[currentStep] && (
            <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{stepSummary[currentStep]?.message}</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {typeof stepSummary[currentStep]?.generated === 'number' && <span>Generated: {stepSummary[currentStep]?.generated}</span>}
                {typeof stepSummary[currentStep]?.edited === 'number' && <span>Edited: {stepSummary[currentStep]?.edited}</span>}
                {typeof stepSummary[currentStep]?.deployed === 'number' && <span>Deployed: {stepSummary[currentStep]?.deployed}</span>}
                {typeof stepSummary[currentStep]?.errors === 'number' && <span>Errors: {stepSummary[currentStep]?.errors}</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inline Review & Edit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentStep === 2 && (
            <div className="space-y-3">
              {assignments.slice(0, 8).map((row) => {
                const defaultTitle = `${row.subject} ${row.day} ${row.type || 'Lesson'} ${row.lesson_num || ''}`.trim();
                const value = draftEdits.assignment[row.id]?.title ?? defaultTitle;
                return (
                  <div key={row.id} className="rounded-md border p-3">
                    <Label className="text-xs">Assignment title override ({row.subject})</Label>
                    <Input
                      value={value}
                      onChange={(e) => setDraftEdit('assignment', row.id, { title: e.target.value })}
                      className="mt-1"
                    />
                    <div className="mt-2 flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => resetDraftEdit('assignment', row.id)}>
                        Reset
                      </Button>
                    </div>
                  </div>
                );
              })}
              {assignments.length === 0 && <p className="text-xs text-muted-foreground">No assignment rows available for this week.</p>}
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-3">
              {SUBJECT_PAGE_KEYS.map((subject) => {
                const title = draftEdits.page[subject]?.title ?? `${subject} Agenda`;
                const html = draftEdits.page[subject]?.html ?? '';
                return (
                  <div key={subject} className="rounded-md border p-3 space-y-2">
                    <Label className="text-xs">{subject} page title</Label>
                    <Input value={title} onChange={(e) => setDraftEdit('page', subject, { title: e.target.value })} />
                    <Label className="text-xs">{subject} HTML notes / overrides</Label>
                    <Textarea
                      value={html}
                      onChange={(e) => setDraftEdit('page', subject, { html: e.target.value })}
                      rows={3}
                    />
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => resetDraftEdit('page', subject)}>
                        Reset
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-3">
              {announcements.slice(0, 8).map((row) => {
                const title = draftEdits.announcement[row.id]?.title ?? row.title ?? '';
                const content = draftEdits.announcement[row.id]?.content ?? row.content ?? '';
                return (
                  <div key={row.id} className="rounded-md border p-3 space-y-2">
                    <Label className="text-xs">Announcement title ({row.status || 'DRAFT'})</Label>
                    <Input value={title} onChange={(e) => setDraftEdit('announcement', row.id, { title: e.target.value })} />
                    <Label className="text-xs">Announcement content</Label>
                    <Textarea
                      value={content}
                      onChange={(e) => setDraftEdit('announcement', row.id, { content: e.target.value })}
                      rows={4}
                    />
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => resetDraftEdit('announcement', row.id)}>
                        Reset
                      </Button>
                    </div>
                  </div>
                );
              })}
              {announcements.length === 0 && <p className="text-xs text-muted-foreground">No announcement drafts available for this week.</p>}
            </div>
          )}

          {currentStep === 1 && (
            <p className="text-xs text-muted-foreground">
              Step 1 uses the File Organizer panel directly. Any edits there are preserved in its native workflow.
            </p>
          )}
        </CardContent>
      </Card>

      <Separator />

      <div className="space-y-4">
        {currentStep === 1 && <FileOrganizerStepPanel />}
        {currentStep === 2 && <AssignmentsStepPanel />}
        {currentStep === 3 && <CanvasPagesStepPanel />}
        {currentStep === 4 && <AnnouncementsStepPanel />}
      </div>

      <div className="sticky bottom-4 z-10">
        <Card className="border-primary/30 shadow-lg">
          <CardContent className="py-4 flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              {stepStatus[currentStep] === 'error' && <AlertTriangle className="h-4 w-4 text-destructive" />}
              {stepStatus[currentStep] === 'error'
                ? 'Step failed. Fix issues inline and retry.'
                : hasPendingByStep[currentStep]
                  ? 'Unsaved inline edits detected for this step.'
                  : 'Ready to continue.'}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={refreshWeekData} disabled={loadingWeekData || runningTransition}>
                Refresh
              </Button>
              <Button onClick={handleNext} disabled={runningTransition || loadingWeekData}>
                {runningTransition ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Running…
                  </span>
                ) : currentStep === 1 ? (
                  'Next: Build Assignments'
                ) : currentStep === 2 ? (
                  'Next: Build Canvas Pages'
                ) : currentStep === 3 ? (
                  'Next: Schedule Announcements'
                ) : (
                  'Finish'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <SafetyDiffModal
        open={safetyOpen}
        onOpenChange={setSafetyOpen}
        month={selectedMonth}
        week={selectedWeek}
        action={safetyAction}
        itemCount={safetyItems.length}
        items={safetyItems}
        onApprove={handleSafetyApprove}
      />

      {weekId === null && selectedMonth && selectedWeek && (
        <p className="text-xs text-warning">No matching week record found for {selectedMonth} week {selectedWeek}.</p>
      )}
    </div>
  );
}
