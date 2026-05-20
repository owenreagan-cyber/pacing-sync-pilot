import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Rocket, Eye, Code, ExternalLink, Copy, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useConfig } from '@/lib/config';
import { generateCanvasPageHtml, generateHomeroomPageHtml, generateRedirectPageHtml, type CanvasPageRow, type ContactEntry, type LinkEntry } from '@/lib/canvas-html';
import type { ContentMapEntry } from '@/lib/auto-link';
import type { Resource } from '@/types/thales';
import { validateFpkPage } from '@/lib/validators/fpk-validator';

function parseSubjectResources(
  subjectResourcesJson: Record<string, unknown[]> | null | undefined,
  subject: string,
): Resource[] {
  const map = subjectResourcesJson ?? {};
  const raw = map[subject];
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .filter((r) => typeof r.label === 'string' && (r.label as string).trim() !== '')
    .map((r) => ({
      label: r.label as string,
      url:   typeof r.url === 'string' && (r.url as string).trim() ? r.url as string : undefined,
      group: typeof r.group === 'string' && (r.group as string).trim() ? r.group as string : undefined,
    }));
}
import { callEdge } from '@/lib/edge';
import { useRealtimeDeploy } from '@/hooks/use-realtime-deploy';
import { useSystemStore } from '@/store/useSystemStore';
import SafetyDiffModal from '@/components/SafetyDiffModal';
import {
  filterTogetherPageRows,
  resolveTogetherCourseId,
} from '@/lib/together-logic';
import { logDeployHabit } from '@/lib/teacher-memory';
import { StyleSuggestions } from '@/components/canvas-brain/StyleSuggestions';
import { FullSheetImportDialog } from '@/components/pacing-entry/FullSheetImportDialog';
import { loadSchoolCalendar, getWeekEvents, type CalendarEvent } from '@/lib/school-calendar';
import { getPacingWeekDateRange, getPacingWeekDatesISO } from '@/lib/pacing-week';

const PAGE_SUBJECTS = ['Math', 'Reading', 'Language Arts', 'History', 'Science', 'Homeroom'] as const;
const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function deriveDateRange(quarter: string, weekNum: number): string {
  return getPacingWeekDateRange(quarter, weekNum).replace(' - ', '–');
}

// SHA-256 of an HTML string → hex digest. Used for hash-based deploy skip.
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface WeekOption {
  id: string;
  quarter: string;
  week_num: number;
  date_range: string | null;
  reminders: string | null;
  resources: string | null;
  subject_reminders: Record<string, string> | null;
  subject_resources: Record<string, unknown[]> | null;
  active_hs_subject?: string | null;
}

interface DeployResult {
  status: string;
  canvasUrl?: string;
  error?: string;
}

export default function PageBuilderPage() {
  const config = useConfig();
  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>('');
  const [selectedWeek, setSelectedWeek] = useState<WeekOption | null>(null);
  const [savedRows, setSavedRows] = useState<CanvasPageRow[]>([]);
  const [contentMap, setContentMap] = useState<ContentMapEntry[]>([]);
  const [latestNewsletter, setLatestNewsletter] = useState<{
    homeroom_notes: string | null;
    birthdays: string | null;
    school_news?: string | null;
    points_of_contact?: ContactEntry[];
    quick_links?: LinkEntry[];
    footer_line?: string | null;
  } | null>(null);
  const [activeSubject, setActiveSubject] = useState<string>('Math');
  const [previewMode, setPreviewMode] = useState<'preview' | 'code'>('preview');
  const [editableHtml, setEditableHtml] = useState<string>('');
  const [deploying, setDeploying] = useState<Record<string, boolean>>({});
  const [deployStatuses, setDeployStatuses] = useState<Record<string, { status: string; canvasUrl?: string }>>({});
  const [deployingAll, setDeployingAll] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [previewError, setPreviewError] = useState(false);
  const [deployAttempt, setDeployAttempt] = useState<Record<string, number>>({});
  const { selectedMonth, selectedWeek: storeWeek } = useSystemStore();

  const handleRealtimeEvent = useCallback((event: any) => {
    if (event.action === 'page_deploy' && event.subject) {
      setDeployStatuses((prev) => ({
        ...prev,
        [event.subject]: { status: event.status || 'DEPLOYED', canvasUrl: event.canvas_url || undefined },
      }));
    }
  }, []);
  useRealtimeDeploy(handleRealtimeEvent);

  const refreshWeeks = useCallback(() => {
    supabase.from('weeks').select('*').order('quarter').order('week_num').then(({ data }) => {
      if (data) setWeeks(data as unknown as WeekOption[]);
    });
  }, []);

  useEffect(() => {
    refreshWeeks();
    loadSchoolCalendar(supabase).then(setCalendar).catch(() => {});
    supabase.from('content_map').select('lesson_ref, subject, canvas_url, canonical_name').then(({ data }) => {
      if (data) setContentMap(data as ContentMapEntry[]);
    });
    supabase
      .from('newsletters')
      .select('homeroom_notes, birthdays, school_news, points_of_contact, quick_links, footer_line')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLatestNewsletter((data as any) ?? null));
  }, [refreshWeeks]);

  useEffect(() => {
    if (!selectedWeekId) return;
    const week = weeks.find((w) => w.id === selectedWeekId) || null;
    setSelectedWeek(week);

    supabase
      .from('pacing_rows')
      .select('*')
      .eq('week_id', selectedWeekId)
      .then(({ data }) => {
        setSavedRows((data as unknown as CanvasPageRow[]) || []);
      });

    supabase
      .from('deploy_log')
      .select('*')
      .eq('week_id', selectedWeekId)
      .eq('action', 'page_deploy')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) {
          const statuses: Record<string, { status: string; canvasUrl?: string }> = {};
          for (const log of data) {
            if (log.subject && !statuses[log.subject]) {
              statuses[log.subject] = { status: log.status || 'PENDING', canvasUrl: log.canvas_url || undefined };
            }
          }
          setDeployStatuses(statuses);
        }
      });
  }, [selectedWeekId, weeks]);

  useEffect(() => {
    if (!weeks.length || !selectedMonth || !storeWeek) return;
    const matchingWeek = weeks.find((w) => w.quarter === selectedMonth && w.week_num === storeWeek);
    if (matchingWeek && matchingWeek.id !== selectedWeekId) {
      setSelectedWeekId(matchingWeek.id);
    }
  }, [weeks, selectedMonth, storeWeek, selectedWeekId]);

  const rows: CanvasPageRow[] = useMemo(() => savedRows, [savedRows]);

  // Get rows for active subject (Reading tab merges Reading + Spelling via Together Logic)
  const subjectRows = useMemo(() => {
    return filterTogetherPageRows(rows, activeSubject);
  }, [rows, activeSubject]);

  const weekDates = useMemo(() => {
    if (!selectedWeek) return [] as string[];
    return getPacingWeekDatesISO(selectedWeek.quarter, selectedWeek.week_num);
  }, [selectedWeek]);

  // Generate HTML for active subject
  const generatedHtml = useMemo(() => {
    if (!selectedWeek || !config) return '';
    const quarterColor = config.quarterColors[selectedWeek.quarter] || '#0065a7';

    if (activeSubject === 'Homeroom') {
      // Collect upcoming tests across all subjects this week
      const tests = rows
        .filter((r) => r.type === 'Test' || (r.in_class || '').toLowerCase().includes('test'))
        .map((r) => `${r.day}: ${r.subject}${r.lesson_num ? ` \u2014 ${r.lesson_num}` : ''}`);
      return generateHomeroomPageHtml({
        weekNum: selectedWeek.week_num,
        quarter: selectedWeek.quarter,
        dateRange: selectedWeek.date_range || deriveDateRange(selectedWeek.quarter, selectedWeek.week_num),
        quarterColor,
        calendarReminders: selectedWeek.reminders || '',
        homeroomNotes: latestNewsletter?.homeroom_notes || '',
        birthdays: latestNewsletter?.birthdays || '',
        schoolNews: latestNewsletter?.school_news || '',
        pointsOfContact: latestNewsletter?.points_of_contact ?? [],
        quickLinks: latestNewsletter?.quick_links ?? [],
        footer: latestNewsletter?.footer_line ?? 'Thales Academy Grade 4A &mdash; Mr. Reagan',
      });
    }

    // History/Science redirect routing — inactive subject shows redirect
    const activeHs = selectedWeek.active_hs_subject;
    if ((activeSubject === 'History' || activeSubject === 'Science') && activeHs && activeHs !== activeSubject) {
      return generateRedirectPageHtml({
        thisSubject: activeSubject as 'History' | 'Science',
        activeSubject: activeHs as 'History' | 'Science',
        weekNum: selectedWeek.week_num,
        quarter: selectedWeek.quarter,
        dateRange: selectedWeek.date_range || deriveDateRange(selectedWeek.quarter, selectedWeek.week_num),
        quarterColor,
        reminderOverride: (selectedWeek.subject_reminders ?? {})[activeSubject] || undefined,
      });
    }

    if (subjectRows.length === 0) return '';
    const subjectReminder = (selectedWeek.subject_reminders ?? {})[activeSubject] ?? '';
    const subjectResources = parseSubjectResources(selectedWeek.subject_resources, activeSubject);
    return generateCanvasPageHtml({
      subject: activeSubject === 'Reading' ? 'Reading & Spelling' : activeSubject,
      rows: subjectRows,
      quarter: selectedWeek.quarter,
      weekNum: selectedWeek.week_num,
      dateRange: selectedWeek.date_range || deriveDateRange(selectedWeek.quarter, selectedWeek.week_num),
      subjectReminder,
      subjectResources,
      quarterColor,
      contentMap,
      calendarEvents: getWeekEvents(weekDates, calendar),
      weekDates,
    });
  }, [subjectRows, rows, selectedWeek, activeSubject, config, contentMap, latestNewsletter, weekDates, calendar]);

  // Reset preview error when generated HTML changes
  useEffect(() => setPreviewError(false), [generatedHtml]);

  // Sync generated HTML to editable state
  useEffect(() => {
    setEditableHtml(generatedHtml);
  }, [generatedHtml]);

  // Deploy with retry healing — up to 3 attempts with backoff
  const deployWithRetry = useCallback(
    async (subject: string, payload: object, maxAttempts = 3): Promise<any> => {
      let lastErr: Error | null = null;
      for (let i = 0; i < maxAttempts; i++) {
        setDeployAttempt((p) => ({ ...p, [subject]: i + 1 }));
        try {
          const result = await supabase.functions.invoke('canvas-deploy-page', { body: payload });
          if (result.error) throw new Error(result.error.message);
          return result.data;
        } catch (e: any) {
          lastErr = e instanceof Error ? e : new Error(String(e));
          if (i < maxAttempts - 1) {
            const wait = [1000, 3000, 8000][i];
            await new Promise((r) => setTimeout(r, wait));
            toast.info(`Deploy attempt ${i + 2}/${maxAttempts}…`);
          }
        }
      }
      throw lastErr;
    },
    [],
  );

  // Canvas page naming: Q4W2, Q3W5, etc.
  const getPageSlug = (quarter: string, weekNum: number) => {
    // Extract quarter number from "Q4" or "Quarter 4" etc.
    const qMatch = quarter.match(/(\d+)/);
    const qNum = qMatch ? qMatch[1] : quarter;
    return `q${qNum}w${weekNum}`;
  };

  const getPageTitle = (quarter: string, weekNum: number) => {
    const qMatch = quarter.match(/(\d+)/);
    const qNum = qMatch ? qMatch[1] : quarter;
    return `Q${qNum}W${weekNum}`;
  };

  // Deploy single subject page via canvas-deploy-page edge function
  const handleDeploy = async (subject: string) => {
    if (!selectedWeek || !config) return;

    let sRows: CanvasPageRow[] = [];
    let html = '';
    let courseId: number | undefined;
    const quarterColor = config.quarterColors[selectedWeek.quarter] || '#0065a7';
    const pageSlug = getPageSlug(selectedWeek.quarter, selectedWeek.week_num);
    const pageTitle = getPageTitle(selectedWeek.quarter, selectedWeek.week_num);

    if (subject === 'Homeroom') {
      courseId = config.courseIds['Homeroom'];
      const tests = rows
        .filter((r) => r.type === 'Test' || (r.in_class || '').toLowerCase().includes('test'))
        .map((r) => `${r.day}: ${r.subject}${r.lesson_num ? ` \u2014 ${r.lesson_num}` : ''}`);
      html = generateHomeroomPageHtml({
        weekNum: selectedWeek.week_num,
        quarter: selectedWeek.quarter,
        dateRange: selectedWeek.date_range || deriveDateRange(selectedWeek.quarter, selectedWeek.week_num),
        quarterColor,
        calendarReminders: selectedWeek.reminders || '',
        homeroomNotes: latestNewsletter?.homeroom_notes || '',
        birthdays: latestNewsletter?.birthdays || '',
        schoolNews: latestNewsletter?.school_news || '',
        pointsOfContact: latestNewsletter?.points_of_contact ?? [],
        quickLinks: latestNewsletter?.quick_links ?? [],
        footer: latestNewsletter?.footer_line ?? 'Thales Academy Grade 4A &mdash; Mr. Reagan',
      });
    } else {
      const activeHs = selectedWeek.active_hs_subject;
      const isInactiveHs =
        (subject === 'History' || subject === 'Science') && activeHs && activeHs !== subject;

      if (isInactiveHs) {
        // Deploy redirect page instead of full agenda
        courseId = config.courseIds[subject];
        html = generateRedirectPageHtml({
          thisSubject: subject as 'History' | 'Science',
          activeSubject: activeHs as 'History' | 'Science',
          weekNum: selectedWeek.week_num,
          quarter: selectedWeek.quarter,
          dateRange: selectedWeek.date_range || deriveDateRange(selectedWeek.quarter, selectedWeek.week_num),
          quarterColor,
          reminderOverride: (selectedWeek.subject_reminders ?? {})[subject] || undefined,
        });
      } else {
        sRows = filterTogetherPageRows(rows, subject);

        if (sRows.length === 0) {
          toast.error(`No data for ${subject}`);
          return;
        }

        courseId = resolveTogetherCourseId(subject) ?? config.courseIds[subject];

        const subjectReminderD = (selectedWeek.subject_reminders ?? {})[subject] ?? '';
        const subjectResourcesD = parseSubjectResources(selectedWeek.subject_resources, subject);
        html = generateCanvasPageHtml({
          subject: subject === 'Reading' ? 'Reading & Spelling' : subject,
          rows: sRows,
          quarter: selectedWeek.quarter,
          weekNum: selectedWeek.week_num,
          dateRange: selectedWeek.date_range || deriveDateRange(selectedWeek.quarter, selectedWeek.week_num),
          subjectReminder: subjectReminderD,
          subjectResources: subjectResourcesD,
          quarterColor,
          contentMap,
          calendarEvents: getWeekEvents(weekDates, calendar),
          weekDates,
        });
      }
    }

    if (!courseId) {
      toast.error(`No course ID configured for ${subject}`);
      return;
    }

    setDeploying((p) => ({ ...p, [subject]: true }));

    try {
      const finalHtml = activeSubject === subject ? (editableHtml || html) : html;
      
      // Validate FPK compliance before deployment
      const validation = validateFpkPage(finalHtml, subject);
      if (!validation.pass) {
        const criticalIssues = validation.issues.filter(i => i.severity === 'critical');
        const errorMessages = criticalIssues.map(i => `${i.code}: ${i.message}`).join('; ');
        toast.error(`FPK validation failed — ${subject}`, { description: errorMessages });
        setDeployStatuses((p) => ({ ...p, [subject]: { status: 'VALIDATION_FAILED' } }));
        return;
      }

      const contentHash = await sha256Hex(finalHtml);
      const result = testMode
        ? {
            status: 'DEPLOYED',
            canvasUrl: `https://canvas.test/courses/${courseId}/pages/${pageSlug}`,
          } as { status?: string; canvasUrl?: string; error?: string }
        : await deployWithRetry(subject, {
            subject,
            courseId,
            pageUrl: pageSlug,
            pageTitle,
            bodyHtml: finalHtml,
            published: true,
            setFrontPage: true,
            weekId: selectedWeekId || null,
            contentHash,
          }) as { status?: string; canvasUrl?: string; error?: string };

      if (testMode) {
        console.log('[TEST DEPLOY PAGE]', subject, '→', result.canvasUrl);
        toast.message(`TEST DEPLOY: ${subject} agenda`, { description: result.canvasUrl });
      }


      if (result.status === 'DEPLOYED' || result.status === 'NO_CHANGE') {
        setDeployStatuses((p) => ({ ...p, [subject]: { status: result.status!, canvasUrl: result.canvasUrl } }));
        if (result.status === 'DEPLOYED') void logDeployHabit(subject);
        toast.success(`${subject} agenda ${result.status === 'NO_CHANGE' ? 'up to date' : 'deployed & set as homepage'}`, {
          action: result.canvasUrl ? { label: 'Open', onClick: () => window.open(result.canvasUrl, '_blank') } : undefined,
        });
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (e: any) {
      toast.error(`Deploy failed — ${subject}`, { description: e.message });
      setDeployStatuses((p) => ({ ...p, [subject]: { status: 'ERROR' } }));
    }
    setDeploying((p) => ({ ...p, [subject]: false }));
    setDeployAttempt((p) => ({ ...p, [subject]: 0 }));
  };

  const deployableSubjects = useMemo(() => {
    const activeHs = selectedWeek?.active_hs_subject;
    return PAGE_SUBJECTS.filter((s) => {
      if (s === 'Homeroom') return true; // always deployable
      // Inactive H/S still deploys (as a redirect page)
      if ((s === 'History' || s === 'Science') && activeHs && activeHs !== s) return true;
      const sRows = filterTogetherPageRows(rows, s);
      return sRows.length > 0;
    });
  }, [rows, selectedWeek]);

  // Deploy all pages with progress toast
  const handleDeployAll = async () => {
    setDeployingAll(true);

    if (deployableSubjects.length === 0) {
      toast.error('No data to deploy');
      setDeployingAll(false);
      return;
    }

    const toastId = toast.loading(`Deploying 0/${deployableSubjects.length} pages\u2026`);
    let done = 0;
    let errors = 0;

    for (const subject of deployableSubjects) {
      toast.loading(`Deploying ${subject} (${done + 1}/${deployableSubjects.length})\u2026`, { id: toastId });
      try {
        await handleDeploy(subject);
      } catch {
        errors++;
      }
      done++;
    }

    if (errors > 0) {
      toast.warning(`Deployed ${done - errors}/${deployableSubjects.length} pages (${errors} failed)`, { id: toastId });
    } else {
      toast.success(`All ${deployableSubjects.length} pages deployed! \u2705`, { id: toastId });
    }
    setDeployingAll(false);
  };

  const copyHtml = () => {
    navigator.clipboard.writeText(generatedHtml);
    toast.success('HTML copied!');
  };

  const statusBadge = (subject: string) => {
    const s = deployStatuses[subject];
    if (!s) return <Badge variant="outline" className="text-[10px]">PENDING</Badge>;
    if (s.status === 'DEPLOYED') return <Badge className="text-[10px] bg-success text-success-foreground">DEPLOYED</Badge>;
    if (s.status === 'NO_CHANGE') return <Badge variant="secondary" className="text-[10px]">NO CHANGE</Badge>;
    if (s.status === 'ERROR') return <Badge variant="destructive" className="text-[10px]">ERROR</Badge>;
    if (s.status === 'VALIDATION_FAILED') return <Badge variant="destructive" className="text-[10px]">VALIDATION FAILED</Badge>;
    return <Badge variant="outline" className="text-[10px]">{s.status}</Badge>;
  };

  const testingBanner = useMemo(() => {
    if (!selectedWeek || calendar.length === 0) return null;
    const dates = getPacingWeekDatesISO(selectedWeek.quarter, selectedWeek.week_num);
    const events = getWeekEvents(dates, calendar).filter((e) => e.event_type === 'testing_window');
    if (events.length === 0) return null;
    const label = events[0].label;
    const range = `${events[0].date} – ${events[events.length - 1].date}`;
    return `⚠️ Testing Window: ${label} ${range} — check assignment due dates`;
  }, [selectedWeek, calendar]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {testingBanner && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-300">
          {testingBanner}
        </div>
      )}
      {/* Header bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedWeekId} onValueChange={setSelectedWeekId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Select a week\u2026" />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.quarter} Week {w.week_num}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedWeek && (
          <span className="text-sm text-muted-foreground">{selectedWeek.date_range || deriveDateRange(selectedWeek.quarter, selectedWeek.week_num)}</span>
        )}

        <FullSheetImportDialog onImported={refreshWeeks} />

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border">
            <input
              id="pb-test-mode"
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            <label htmlFor="pb-test-mode" className="text-[10px] uppercase tracking-wider cursor-pointer">
              Test Mode
            </label>
          </div>
          <Button
            variant="deploy"
            size="sm"
            onClick={() => setDiffOpen(true)}
            disabled={deployingAll || !selectedWeekId || deployableSubjects.length === 0}
            className="gap-1.5"
          >
            {deployingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            {deployingAll ? 'Deploying\u2026' : 'Deploy All Pages'}
          </Button>
        </div>
      </div>

      {testMode && (
        <Card className="border-warning bg-warning/10">
          <CardContent className="py-2.5 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <p className="text-xs font-semibold text-warning">
              🧪 TEST MODE — no Canvas API calls will be made
            </p>
          </CardContent>
        </Card>
      )}

      <SafetyDiffModal
        open={diffOpen}
        onOpenChange={setDiffOpen}
        month={selectedMonth}
        week={selectedWeek?.week_num ?? storeWeek}
        action="DEPLOY_AGENDAS"
        itemCount={deployableSubjects.length}
        items={deployableSubjects.map(s => ({ label: `${s === 'Reading' ? 'Reading & Spelling' : s} Agenda`, subject: s }))}
        onApprove={handleDeployAll}
      />

      {!selectedWeekId ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">Select a saved week to preview and deploy agenda pages.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* LEFT — Subject tabs + cards */}
          <div className="space-y-4">
            <Tabs value={activeSubject} onValueChange={setActiveSubject}>
              <TabsList>
                {PAGE_SUBJECTS.map((s) => (
                  <TabsTrigger key={s} value={s} className="text-xs gap-1.5">
                    {s === 'Reading' ? 'Reading & Spelling' : s}
                    {deployStatuses[s]?.status === 'DEPLOYED' && <CheckCircle2 className="h-3 w-3 text-success" />}
                    {deployStatuses[s]?.status === 'ERROR' && <AlertTriangle className="h-3 w-3 text-destructive" />}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {activeSubject === 'Reading' ? 'Reading & Spelling' : activeSubject} Agenda
                  </CardTitle>
                  {statusBadge(activeSubject)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <StyleSuggestions type="page_section_order" subject={activeSubject} />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>Page URL:</strong> {selectedWeek ? getPageSlug(selectedWeek.quarter, selectedWeek.week_num) : '\u2014'}</p>
                  <p><strong>Course ID:</strong> {config?.courseIds[activeSubject] || '\u2014'}</p>
                  {deployStatuses[activeSubject]?.canvasUrl && (
                    <p>
                      <strong>Canvas URL:</strong>{' '}
                      <a
                        href={deployStatuses[activeSubject].canvasUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline inline-flex items-center gap-1"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="deploy"
                    onClick={() => handleDeploy(activeSubject)}
                    disabled={deploying[activeSubject]}
                    className="gap-1.5"
                  >
                    {deploying[activeSubject] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                    {deploying[activeSubject]
                      ? deployAttempt[activeSubject] && deployAttempt[activeSubject] > 1
                        ? `Deploying… (attempt ${deployAttempt[activeSubject]}/3)`
                        : 'Deploying…'
                      : 'Deploy Page'}
                  </Button>
                </div>

                {/* Row summary */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted">
                        <th className="text-left p-2">Day</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-left p-2">Lesson</th>
                        <th className="text-left p-2">In Class</th>
                        <th className="text-left p-2">At Home</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DAYS_ORDER.map((day) => {
                        const dayRows = subjectRows.filter((r) => r.day === day);
                        if (dayRows.length === 0) return null;
                        return dayRows.map((r, i) => (
                          <tr key={`${day}-${i}`} className="border-t">
                            <td className="p-2 font-medium">{i === 0 ? day : ''}</td>
                            <td className="p-2">{r.type || '\u2014'}</td>
                            <td className="p-2">{r.lesson_num || '\u2014'}</td>
                            <td className="p-2 max-w-[200px] truncate">{r.in_class || '\u2014'}</td>
                            <td className="p-2 max-w-[200px] truncate text-muted-foreground">{day === 'Friday' ? 'No Homework' : (r.at_home || '\u2014')}</td>
                          </tr>
                        ));
                      })}
                      {subjectRows.length === 0 && (
                        <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No pacing data for this subject.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT — Preview / HTML Code */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button
                variant={previewMode === 'preview' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPreviewMode('preview')}
                className="gap-1.5"
              >
                <Eye className="h-3.5 w-3.5" />
                Preview
              </Button>
              <Button
                variant={previewMode === 'code' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPreviewMode('code')}
                className="gap-1.5"
              >
                <Code className="h-3.5 w-3.5" />
                HTML Code
              </Button>
              {previewMode === 'code' && (
                <Button variant="outline" size="sm" onClick={copyHtml} className="gap-1.5 ml-auto">
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              )}
            </div>

            <Card className="min-h-[500px]">
              <CardContent className="p-4">
                {!generatedHtml ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Globe className="h-10 w-10 mb-3 opacity-20" />
                    <p className="text-sm">No data for this subject/week.</p>
                  </div>
                ) : previewMode === 'preview' ? (
                  previewError ? (
                    <div className="border rounded-lg p-8 bg-amber-50 text-amber-800 space-y-3">
                      <div className="font-semibold">⚠️ Preview rendering failed</div>
                      <p className="text-sm">
                        The generated HTML could not be rendered in the preview. You can still deploy — the issue is display-only.
                      </p>
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium">View raw HTML</summary>
                        <pre className="mt-2 p-3 bg-white rounded border overflow-auto max-h-64 text-xs whitespace-pre-wrap">
                          {generatedHtml}
                        </pre>
                      </details>
                      <Button size="sm" variant="outline" onClick={() => setPreviewError(false)}>
                        Retry Preview
                      </Button>
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden bg-white">
                      <div className="bg-gray-100 border-b px-4 py-2 flex items-center gap-2">
                        <div className="flex gap-1">
                          <div className="w-3 h-3 rounded-full bg-red-400" />
                          <div className="w-3 h-3 rounded-full bg-yellow-400" />
                          <div className="w-3 h-3 rounded-full bg-green-400" />
                        </div>
                        <span className="text-xs text-muted-foreground flex-1 text-center">
                          Canvas Preview — {activeSubject} | {selectedWeek?.quarter} Week {selectedWeek?.week_num}
                        </span>
                      </div>
                      <iframe
                        key={editableHtml}
                        srcDoc={`<!DOCTYPE html><html><head>
                          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                          <style>
                            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                   padding: 24px; margin: 0; background: white; }
                            .kl_subtitle { color: #6b7280; font-size: 0.9rem; }
                            .kl_solid_border { display: block; }
                          </style>
                        </head><body>${editableHtml}</body></html>`}
                        onError={() => setPreviewError(true)}
                        onLoad={(e) => {
                          try {
                            const doc = (e.target as HTMLIFrameElement).contentDocument;
                            if (!doc || doc.body.innerHTML.trim() === '') setPreviewError(true);
                          } catch {
                            setPreviewError(true);
                          }
                        }}
                        className="w-full border-0"
                        style={{ height: '700px' }}
                        sandbox="allow-same-origin"
                        title="Canvas page preview"
                      />
                    </div>
                  )
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground px-1">
                      Edit the HTML directly. The preview updates as you type. Changes here are used when you click Deploy.
                    </p>
                    <Textarea
                      value={editableHtml}
                      onChange={(e) => setEditableHtml(e.target.value)}
                      className="font-mono text-xs min-h-[500px] w-full resize-y"
                      spellCheck={false}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
