import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Zap, Loader2, CalendarDays, Sparkles, Upload, Database, X,
  ChevronDown, ChevronUp, Pencil, FolderOpen,
} from 'lucide-react';
import PasteImportDialog from '@/components/PasteImportDialog';
import { DaySubjectCard } from '@/components/pacing/DaySubjectCard';
import { PacingEntryHeader } from '@/components/pacing-entry/PacingEntryHeader';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useConfig } from '@/lib/config';
import { evaluateWeekRisk } from '@/lib/risk-engine';
import { cn } from '@/lib/utils';
import type { ContentMapEntry } from '@/lib/auto-link';
import { loadSchoolCalendar, getWeekEvents, type CalendarEvent } from '@/lib/school-calendar';
import { getPacingWeekDatesISO } from '@/lib/pacing-week';
import {
  SUBJECTS,
  DAYS,
  SUBJECT_TYPES,
  isLanguageArtsAssignable,
  emptyDay,
  initWeekData,
  buildInClass,
  buildAtHome,
  buildResourceRefs,
  buildAllResourceRefs,
  type DayData,
  type WeekData,
} from '@/lib/pacing';


const SCHOOL_YEAR = '2025-2026';


function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function fmtIsoShort(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface PacingEntryPageProps {
  activeQuarter: string;
  setActiveQuarter: (q: string) => void;
  activeWeek: number;
  setActiveWeek: (w: number) => void;
  setRiskLevel: (l: 'LOW' | 'MEDIUM' | 'HIGH') => void;
  setRiskScore: (s: number) => void;
  quarterColor: string;
}


function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}





function _buildAutoReminders(weekData: WeekData): string {
  const lines: string[] = [];
  const DAYS_LOCAL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const DAY_ABBR: Record<string, string> = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri',
  };
  for (const day of DAYS_LOCAL) {
    for (const subj of Object.keys(weekData)) {
      const cell = weekData[subj]?.[day];
      if (!cell?.type?.toLowerCase().includes('test')) continue;
      const n = cell.lesson_num ? ` ${cell.lesson_num}` : '';
      const label = ({
        Math: `Math Test${n} — ${DAY_ABBR[day]}`,
        Reading: `Reading Mastery Test${n} & Fluency Checkout — ${DAY_ABBR[day]}`,
        Spelling: `Spelling Test — ${DAY_ABBR[day]}`,
        'Language Arts': `Shurley English Test — ${DAY_ABBR[day]}`,
        History: `History Test — ${DAY_ABBR[day]}`,
        Science: `Science Test — ${DAY_ABBR[day]}`,
      } as Record<string, string>)[subj];
      if (label) lines.push(label);
    }
  }
  return lines.join('\n');
}




export default function PacingEntryPage({
  activeQuarter,
  setActiveQuarter,
  activeWeek,
  setActiveWeek,
  setRiskLevel,
  setRiskScore,
  quarterColor,
}: PacingEntryPageProps) {
  const config = useConfig();
  const [weekData, setWeekData] = useState<WeekData>(initWeekData);

  // Date pickers — replace the old free-text dateRange field
  const [weekStart, setWeekStart] = useState<string>('');
  const [weekEnd, setWeekEnd] = useState<string>('');
  const datesEditedByUser = useRef(false);

  const [reminders, setReminders] = useState('');
  const [resources, setResources] = useState('');
  const [subjectReminders, setSubjectReminders] = useState<Record<string, string>>({});
  const [subjectResources, setSubjectResources] = useState<
    Record<string, Array<{ label: string; url?: string; group?: string }>>
  >({});
  const [_activeResourceSubject, setActiveResourceSubject] = useState<string>('Math');
  const _SUBJECT_REMINDER_TABS = ['Math', 'Reading', 'Language Arts', 'History', 'Science'] as const;
  const [_activeReminderSubject, setActiveReminderSubject] = useState<string>('Math');
  const [wizardSubject, setWizardSubject] = useState<typeof SUBJECTS[number]>('Math');
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [activeHsSubject, setActiveHsSubject] = useState<string>('Both');
  const [savedWeeks, setSavedWeeks] = useState<{ id: string; quarter: string; week_num: number }[]>([]);
  const [contentMap, setContentMap] = useState<ContentMapEntry[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [syncingResources, setSyncingResources] = useState(false);

  // Smart input panel
  const [smartOpen, setSmartOpen] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showAiBanner, setShowAiBanner] = useState(false);
  const [masterRows, setMasterRows] = useState<any[]>([]);
  const [masterLoading, setMasterLoading] = useState(false);

  // Derived display string for the date range — never "Invalid Date"
  const dateRange = useMemo(() => {
    if (!weekStart || !weekEnd) return '';
    const left = fmtIsoShort(weekStart);
    const right = fmtIsoShort(weekEnd);
    if (!left || !right) return '';
    const [y] = weekEnd.split('-');
    return `${left}–${right}, ${y}`;
  }, [weekStart, weekEnd]);

  // Auto-fill weekStart/End whenever Q+W changes (unless user manually overrode)
  useEffect(() => {
    if (datesEditedByUser.current) return;
    const dates = getPacingWeekDatesISO(activeQuarter, activeWeek);
    if (dates.length === 5) {
      setWeekStart(dates[0]);
      setWeekEnd(dates[4]);
    } else {
      setWeekStart('');
      setWeekEnd('');
    }
  }, [activeQuarter, activeWeek]);

  // Load content_map for resource auto-link
  const loadContentMap = useCallback(async () => {
    const { data } = await supabase
      .from('content_map')
      .select('lesson_ref, subject, canvas_url, canonical_name');
    if (data) setContentMap(data as ContentMapEntry[]);
  }, []);
  useEffect(() => { void loadContentMap(); }, [loadContentMap]);
  useEffect(() => { loadSchoolCalendar(supabase).then(setCalendar).catch(() => {}); }, []);

  const handleSyncResources = useCallback(async () => {
    setSyncingResources(true);
    try {
      await loadContentMap();
      toast.success('Resources refreshed');
    } catch (e: any) {
      toast.error('Could not refresh resources', { description: e?.message });
    } finally {
      setSyncingResources(false);
    }
  }, [loadContentMap]);

  // Risk evaluation
  useEffect(() => {
    const rows = SUBJECTS.flatMap((subj) =>
      DAYS.map((day) => ({
        type: weekData[subj][day].type,
        day,
        create_assign:
          weekData[subj][day].create_assign &&
          !(config?.autoLogic.historyScienceNoAssign && (subj === 'History' || subj === 'Science')) &&
          day !== 'Friday',
      })),
    );
    const risk = evaluateWeekRisk(rows);
    setRiskLevel(risk.level);
    setRiskScore(risk.score);
  }, [weekData, config, setRiskLevel, setRiskScore]);

  useEffect(() => {
    supabase
      .from('weeks')
      .select('id, quarter, week_num')
      .order('quarter')
      .order('week_num')
      .then(({ data }) => { if (data) setSavedWeeks(data); });
  }, []);

  const updateCell = useCallback(
    (subject: string, day: string, field: keyof DayData, value: string | boolean | null | undefined) => {
      setShowAiBanner(false);
      setIsDirty(true);
      setWeekData((prev) => ({
        ...prev,
        [subject]: { ...prev[subject], [day]: { ...prev[subject][day], [field]: value } },
      }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const { data: weekRow, error: weekErr } = await supabase
        .from('weeks')
        .upsert(
          {
            quarter: activeQuarter,
            week_num: activeWeek,
            date_range: dateRange,
            reminders,
            resources,
            subject_reminders: subjectReminders,
            subject_resources: subjectResources,
            active_hs_subject: activeHsSubject === 'Both' ? null : activeHsSubject,
          } as any,
          { onConflict: 'quarter,week_num' },
        )
        .select('id')
        .single();

      if (weekErr || !weekRow) throw new Error(weekErr?.message || 'Failed to save week');

      const rows = SUBJECTS.flatMap((subj) =>
        DAYS.map((day) => {
          const d = weekData[subj][day];
          const isNoAssign =
            config?.autoLogic.historyScienceNoAssign && (subj === 'History' || subj === 'Science');
          const isFriday = day === 'Friday';
          const isLA = subj === 'Language Arts';
          const laBlocked = isLA && !isLanguageArtsAssignable(d.type);
          return {
            week_id: weekRow.id,
            subject: subj,
            day,
            type: d.type || null,
            lesson_num: d.lesson_num || null,
            in_class: buildInClass(subj, d),
            at_home: buildAtHome(subj, d, isFriday),
            resources: (() => {
              const refs = buildResourceRefs(subj, d);
              if (!refs.length) return d.resources || null;
              const matched = contentMap
                .filter((cm) => refs.includes(cm.lesson_ref) && cm.canonical_name)
                .map((cm) => ({
                  label: cm.canonical_name,
                  url: cm.canvas_url || undefined,
                  group: (cm as any).group || undefined,
                }));
              if (!matched.length) return d.resources || null;
              return JSON.stringify(matched);
            })(),
            create_assign: isNoAssign || isFriday || laBlocked || d.type === 'CLT Testing' ? false : d.create_assign,
            hint_override: d.hint_override ?? null,
          };
        }),
      );

      const { error: rowsErr } = await supabase
        .from('pacing_rows')
        .upsert(rows, { onConflict: 'week_id,subject,day' });
      if (rowsErr) throw new Error(rowsErr.message);

      await supabase.from('weeks').update({ is_active: false }).neq('id', weekRow.id);
      await supabase.from('weeks').update({ is_active: true }).eq('id', weekRow.id);

      toast.success('Week saved!');
      setShowAiBanner(false);
      setIsDirty(false);

      const { data: updated } = await supabase
        .from('weeks').select('id, quarter, week_num').order('quarter').order('week_num');
      if (updated) setSavedWeeks(updated);
    } catch (e: any) {
      toast.error('Save failed', { description: e.message });
    }
    setSaving(false);
  }, [activeQuarter, activeWeek, dateRange, reminders, resources, subjectReminders, subjectResources, activeHsSubject, weekData, config]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saving) void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saving, handleSave]);

  const loadWeekById = useCallback(async (weekId: string, showToast = true) => {
    const week = savedWeeks.find((w) => w.id === weekId);
    if (!week) return;

    setActiveQuarter(week.quarter);
    setActiveWeek(week.week_num);

    const [{ data: weekData2 }, { data: rows }] = await Promise.all([
      supabase.from('weeks').select('*').eq('id', weekId).single(),
      supabase.from('pacing_rows').select('*').eq('week_id', weekId),
    ]);

    await supabase.from('weeks').update({ is_active: false }).neq('id', weekId);
    await supabase.from('weeks').update({ is_active: true }).eq('id', weekId);

    if (weekData2) {
      // Reset manual override flag on load — let auto-fill take over
      datesEditedByUser.current = false;
      setActiveHsSubject(((weekData2 as any).active_hs_subject as string) || 'Both');
      const sr = (weekData2 as any).subject_reminders;
      setSubjectReminders(sr && typeof sr === 'object' && !Array.isArray(sr) ? (sr as Record<string, string>) : {});
      const sres = (weekData2 as any).subject_resources;
      setSubjectResources(
        sres && typeof sres === 'object' && !Array.isArray(sres)
          ? (sres as Record<string, Array<{ label: string; url?: string; group?: string }>>)
          : {}
      );
    }

    if (rows) {
      const newData = initWeekData();
      for (const row of rows) {
        if (newData[row.subject] && newData[row.subject][row.day]) {
          newData[row.subject][row.day] = {
            type: row.type || '',
            lesson_num: row.lesson_num || '',
            in_class: row.in_class || '',
            at_home: row.at_home || '',
            resources: row.resources || '',
            create_assign: row.create_assign ?? true,
            hint_override: ((row as any).hint_override ?? null) as DayData['hint_override'],
          };
        }
      }
      setWeekData(newData);

      setReminders(weekData2?.reminders || '');

      const refs = buildAllResourceRefs(rows);
      const matched = contentMap.filter((r) => refs.has(r.lesson_ref)).map((r) => r.canonical_name).join('\n');

      if (weekData2?.resources) setResources(weekData2.resources);
      else if (matched) setResources(matched);
      else setResources('');
    } else if (weekData2) {
      setReminders(weekData2.reminders || '');
      setResources(weekData2.resources || '');
    }

    setIsDirty(false);
    if (showToast) toast.success(`Loaded ${week.quarter} Week ${week.week_num}`);
  }, [savedWeeks, setActiveQuarter, setActiveWeek, contentMap]);

  useEffect(() => {
    if (savedWeeks.length === 0) return;
    const matching = savedWeeks.find((w) => w.quarter === activeQuarter && w.week_num === activeWeek);
    if (matching) void loadWeekById(matching.id, false);
  }, [savedWeeks, activeQuarter, activeWeek, loadWeekById]);

  const handleAutoRemind = () => {
    // Per-subject test reminders → write into subjectReminders[subject]
    const perSubject: Record<string, string[]> = {};
    let count = 0;
    for (const subj of SUBJECTS) {
      for (const day of DAYS) {
        const d = weekData[subj][day];
        if (!d) continue;
        const isTest = (d.type || '').toLowerCase().includes('test') ||
          (d.in_class || '').toLowerCase().includes('test');
        if (!isTest) continue;
        const line = `${subj} test on ${day}${d.lesson_num ? ` — ${d.lesson_num}` : ''}`;
        (perSubject[subj] ||= []).push(line);
        count++;
      }
    }
    if (count === 0) {
      toast.info('No tests found this week');
      return;
    }
    setSubjectReminders((prev) => {
      const next = { ...prev };
      for (const [subj, lines] of Object.entries(perSubject)) {
        const existing = next[subj] || '';
        const append = lines.join('\n');
        next[subj] = existing ? `${existing}\n${append}` : append;
      }
      return next;
    });
    setIsDirty(true);
    toast.success(`Auto-filled ${count} test reminder(s) per subject`);
  };

  // ─── AI Parse ───
  const applyParsedRows = (rows: any[]) => {
    const newData = initWeekData();
    for (const row of rows) {
      if (!newData[row.subject]?.[row.day]) continue;
      newData[row.subject][row.day] = {
        type: row.type || '',
        lesson_num: row.lesson_num || '',
        in_class: row.in_class || '',
        at_home: row.at_home || '',
        resources: '',
        create_assign: (() => {
          if (row.type === '-' || row.type === 'No Class') return false;
          if (row.subject === 'Spelling' && row.type !== 'Test') return false;
          if (row.subject === 'History' || row.subject === 'Science') return false;
          if (row.subject === 'Language Arts') {
            return ['CP', 'Classroom Practice', 'Test'].includes(row.type || '');
          }
          return true;
        })(),
        hint_override: null,
      };
    }
    setWeekData(newData);
    setIsDirty(true);
    setShowAiBanner(true);
    toast.success(`Parsed ${rows.length} cells — review and save`);
  };

  function validateParsedRows(rows: any[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const VALID_SUBJECTS = ['Math','Reading','Spelling','Language Arts','History','Science'];
    const VALID_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

    if (!Array.isArray(rows) || rows.length === 0) {
      errors.push('AI returned empty or non-array response');
      return { valid: false, errors };
    }
    if (rows.length > 30) {
      errors.push(`AI returned ${rows.length} rows — expected 30 max (6 subjects × 5 days)`);
    }

    for (const row of rows) {
      if (!VALID_SUBJECTS.includes(row.subject)) {
        errors.push(`Invalid subject: "${row.subject}"`);
      }
      if (!VALID_DAYS.includes(row.day)) {
        errors.push(`Invalid day: "${row.day}"`);
      }
      const n = parseInt(row.lesson_num || '0');
      if (row.subject === 'Math' && !isNaN(n) && n > 0 && (n < 1 || n > 140)) {
        errors.push(`Math lesson ${n} out of range (1-140)`);
      }
      if (row.subject === 'Reading' && !isNaN(n) && n > 0 && (n < 1 || n > 160)) {
        errors.push(`Reading lesson ${n} out of range (1-160)`);
      }
      if (row.subject === 'Spelling' && !isNaN(n) && n > 0 && (n < 1 || n > 140)) {
        errors.push(`Spelling lesson ${n} out of range (1-140)`);
      }
    }

    const subjects = [...new Set(rows.map(r => r.subject))];
    for (const subj of subjects) {
      const subjRows = rows
        .filter(r => r.subject === subj)
        .sort((a, b) => VALID_DAYS.indexOf(a.day) - VALID_DAYS.indexOf(b.day));
      const nums = subjRows
        .map(r => parseInt(r.lesson_num || '0'))
        .filter(n => !isNaN(n) && n > 0);
      for (let i = 1; i < nums.length; i++) {
        if (Math.abs(nums[i] - nums[i-1]) > 15) {
          errors.push(`${subj}: lesson jump from ${nums[i-1]} to ${nums[i]} — possible AI error`);
        }
      }
    }

    return { valid: errors.filter(e => !e.includes('out of range')).length === 0, errors };
  }

  const runAiParse = async (payload: { pastedText?: string; imageBase64?: string; mimeType?: string }) => {
    setAiParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke('pacing-parse', { body: payload });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const rows = data?.rows ?? [];
      if (!rows.length) { toast.info('AI returned no rows'); return; }

      const validation = validateParsedRows(rows);
      if (!validation.valid) {
        toast.error('AI parse validation failed', {
          description: validation.errors.slice(0, 3).join('; '),
        });
        return;
      }
      if (validation.errors.length > 0) {
        toast.warning(`AI parse: ${validation.errors.length} warning(s) — review highlighted cells`, {
          description: validation.errors[0],
        });
      }

      applyParsedRows(rows);
    } catch (e: any) {
      toast.error('AI parse failed', { description: e?.message });
    } finally {
      setAiParsing(false);
    }
  };

  const handleParseText = () => {
    if (!pastedText.trim()) { toast.info('Paste some pacing text first'); return; }
    void runAiParse({ pastedText });
  };

  const handleFileDrop = async (file: File) => {
    try {
      const base64 = await fileToBase64(file);
      const mimeType = file.type || 'application/octet-stream';
      if (mimeType.startsWith('image/')) setImagePreview(`data:${mimeType};base64,${base64}`);
      else setImagePreview(null);
      await runAiParse({ pastedText: '', imageBase64: base64, mimeType });
    } catch (e: any) {
      toast.error('Could not read file', { description: e?.message });
    }
  };

  // ─── Master ───
  const loadMaster = useCallback(async () => {
    setMasterLoading(true);
    const { data, error } = await supabase
      .from('annual_pacing_master' as any)
      .select('*')
      .eq('school_year', SCHOOL_YEAR)
      .eq('quarter', activeQuarter)
      .eq('week_num', activeWeek)
      .order('subject').order('day');
    if (error) toast.error('Could not load master', { description: error.message });
    setMasterRows((data as any[]) ?? []);
    setMasterLoading(false);
  }, [activeQuarter, activeWeek]);

  useEffect(() => { void loadMaster(); }, [loadMaster]);

  const loadMasterIntoGrid = () => {
    if (!masterRows.length) { toast.info('No master rows for this Q/W yet'); return; }
    applyParsedRows(masterRows);
  };

  const saveGridToMaster = async () => {
    const rows = SUBJECTS.flatMap((subj) =>
      DAYS.map((day) => {
        const d = weekData[subj][day];
        return {
          school_year: SCHOOL_YEAR, quarter: activeQuarter, week_num: activeWeek,
          subject: subj, day,
          type: d.type || null, lesson_num: d.lesson_num || null,
          in_class: d.in_class || null, at_home: d.at_home || null,
        };
      }),
    );
    const { error } = await supabase
      .from('annual_pacing_master' as any)
      .upsert(rows, { onConflict: 'school_year,quarter,week_num,subject,day' });
    if (error) { toast.error('Save to master failed', { description: error.message }); return; }
    toast.success(`Saved ${rows.length} rows to master (${activeQuarter} W${activeWeek})`);
    void loadMaster();
  };

  const isTestWeek = (subject: string) =>
    DAYS.some((d) => weekData[subject][d].type?.toLowerCase().includes('test'));

  const getPowerUp = (lessonNum: string) => {
    if (!config || !lessonNum) return null;
    return config.powerUpMap[lessonNum] || null;
  };

  // Auto-collapse smart input when grid has data
  const gridHasData = useMemo(
    () => SUBJECTS.some((s) => DAYS.some((d) => weekData[s][d].type || weekData[s][d].lesson_num)),
    [weekData],
  );
  useEffect(() => { setSmartOpen(!gridHasData); }, [gridHasData]);

  const isSaved =
    savedWeeks.some((w) => w.quarter === activeQuarter && w.week_num === activeWeek) && !isDirty;

  // Master tab compact summary: 1 row per subject, lesson_num for each day
  const masterSummary = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const r of masterRows) {
      if (!map[r.subject]) map[r.subject] = {};
      map[r.subject][r.day] = r.lesson_num || (r.type === '-' ? '—' : r.type || '');
    }
    return map;
  }, [masterRows]);

  const sortedSavedWeeks = useMemo(
    () => [...savedWeeks].sort((a, b) =>
      a.quarter.localeCompare(b.quarter) || a.week_num - b.week_num),
    [savedWeeks],
  );

  const testingBanner = useMemo(() => {
    if (calendar.length === 0) return null;
    const dates = getPacingWeekDatesISO(activeQuarter, activeWeek);
    if (dates.length === 0) return null;
    const events = getWeekEvents(dates, calendar).filter((e) => e.event_type === 'testing_window');
    if (events.length === 0) return null;
    return `⚠️ Testing Window: ${events[0].label} ${events[0].date} – ${events[events.length - 1].date} — check assignment due dates`;
  }, [calendar, activeQuarter, activeWeek]);

  return (
    <div className="animate-in fade-in duration-300 space-y-4">
      {testingBanner && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-300">
          {testingBanner}
        </div>
      )}
      {/* ───────────────────────────────────────── */}
      {/* SECTION A: Header bar (status, save, sync) */}
      {/* ───────────────────────────────────────── */}
      <PacingEntryHeader
        quarter={activeQuarter}
        weekNum={activeWeek}
        dateRange={dateRange}
        isSaved={isSaved}
        onSyncResources={handleSyncResources}
        syncing={syncingResources}
        onSave={handleSave}
        saving={saving}
        quarterColor={quarterColor}
      />

      {/* SECTION A.2: Week selector bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-3">
        <div className="flex items-center gap-1.5">
          {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
            <button
              key={q}
              onClick={() => { datesEditedByUser.current = false; setActiveQuarter(q); }}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all',
                activeQuarter === q
                  ? 'text-white shadow-md'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
              style={activeQuarter === q ? { backgroundColor: quarterColor } : undefined}
            >
              {q}
            </button>
          ))}
        </div>

        <Select
          value={String(activeWeek)}
          onValueChange={(v) => { datesEditedByUser.current = false; setActiveWeek(Number(v)); }}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 9 }, (_, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>Week {i + 1}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Auto date display + edit-popover override */}
        <div className="flex items-center gap-1.5 text-sm">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span className={cn(dateRange ? 'font-medium' : 'text-muted-foreground/70 italic')}>
            {dateRange || 'No date range'}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Edit week dates">
                <Pencil className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3" align="start">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Override week dates
              </div>
              <div className="space-y-2">
                <label className="text-xs">
                  Monday (start)
                  <Input
                    type="date"
                    value={weekStart}
                    onChange={(e) => {
                      datesEditedByUser.current = true;
                      setWeekStart(e.target.value);
                      if (e.target.value) setWeekEnd(addDaysIso(e.target.value, 4));
                      setIsDirty(true);
                    }}
                    className="mt-1"
                  />
                </label>
                <label className="text-xs">
                  Friday (end)
                  <Input
                    type="date"
                    value={weekEnd}
                    onChange={(e) => {
                      datesEditedByUser.current = true;
                      setWeekEnd(e.target.value);
                      setIsDirty(true);
                    }}
                    className="mt-1"
                  />
                </label>
              </div>
              <Button
                variant="outline" size="sm" className="w-full"
                onClick={() => {
                  datesEditedByUser.current = false;
                  const dates = getPacingWeekDatesISO(activeQuarter, activeWeek);
                  if (dates.length === 5) {
                    setWeekStart(dates[0]);
                    setWeekEnd(dates[4]);
                  }
                }}
              >
                Reset to canonical
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex-1" />

        {sortedSavedWeeks.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" />
                Load Week
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end">
              <div className="max-h-72 overflow-auto py-1">
                {sortedSavedWeeks.map((w) => {
                  const active = w.quarter === activeQuarter && w.week_num === activeWeek;
                  return (
                    <button
                      key={w.id}
                      onClick={() => { datesEditedByUser.current = false; void loadWeekById(w.id, true); }}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-muted',
                        active && 'bg-muted/50 font-semibold',
                      )}
                    >
                      <span>{w.quarter} · Week {w.week_num}</span>
                      {active && <span className="text-emerald-500">●</span>}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <PasteImportDialog onImport={(d) => { setWeekData(d); setIsDirty(true); }} />
      </div>

      {/* ───────────────────────────────────────── */}
      {/* SECTION B: Smart Input (collapsible)       */}
      {/* ───────────────────────────────────────── */}
      <Collapsible open={smartOpen} onOpenChange={setSmartOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Smart Input</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                    gridHasData
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-primary/10 text-primary',
                  )}
                >
                  {gridHasData ? 'Has data' : 'AI Ready'}
                </span>
              </div>
              {smartOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="pt-0">
              <Tabs defaultValue="paste" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="paste" className="text-xs gap-1">
                    <Sparkles className="h-3 w-3" /> Type / Paste
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="text-xs gap-1">
                    <Upload className="h-3 w-3" /> Upload
                  </TabsTrigger>
                  <TabsTrigger value="master" className="text-xs gap-1">
                    <Database className="h-3 w-3" /> Annual Master
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="paste" className="space-y-3 mt-3">
                  <Textarea
                    rows={8}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={`Paste or type your pacing for this week.\n\nExample:\nMath: 101, 102, 103, 104, Test 10\nReading: 109, 110, 111, 112, Test 11\nSpelling: L97, L98, L99, review, Test\nELA: 12.1, 12.2, 12.3 CP44, CP44, Test\nHistory: Ch5, Ch5, Ch6, Ch6, -\nScience: -, -, -, -, -`}
                    className="text-xs font-mono"
                  />
                  <Button onClick={handleParseText} disabled={aiParsing} className="w-full gap-1.5">
                    {aiParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Parse with AI ✦
                  </Button>
                </TabsContent>

                <TabsContent value="upload" className="space-y-3 mt-3">
                  <label
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-primary', 'bg-primary/5'); }}
                    onDragLeave={(e) => e.currentTarget.classList.remove('border-primary', 'bg-primary/5')}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('border-primary', 'bg-primary/5');
                      const file = e.dataTransfer.files?.[0];
                      if (file) void handleFileDrop(file);
                    }}
                    className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  >
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Drop a screenshot, photo, or PDF of your pacing guide
                    </span>
                    <span className="text-[10px] text-muted-foreground">PNG · JPG · HEIC · PDF</span>
                    <input
                      type="file" accept="image/*,application/pdf" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileDrop(f); }}
                    />
                  </label>
                  {imagePreview && (
                    <div className="relative rounded border border-border overflow-hidden">
                      <img src={imagePreview} alt="Preview" className="w-full h-32 object-cover" />
                      <button
                        onClick={() => setImagePreview(null)}
                        className="absolute top-1 right-1 rounded-full bg-background/80 p-1 hover:bg-background"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {aiParsing && (
                    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Parsing with AI...
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="master" className="space-y-3 mt-3">
                  <div className="text-xs text-muted-foreground">
                    Annual master · {SCHOOL_YEAR} · {activeQuarter} W{activeWeek}
                  </div>
                  <div className="overflow-auto rounded border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold">Subject</th>
                          {DAYS.map((d) => (
                            <th key={d} className="px-2 py-1.5 text-left font-semibold">
                              {d.slice(0, 3)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {masterLoading ? (
                          <tr><td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">Loading…</td></tr>
                        ) : Object.keys(masterSummary).length === 0 ? (
                          <tr><td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">No master rows yet</td></tr>
                        ) : (
                          SUBJECTS.filter((s) => masterSummary[s]).map((s) => (
                            <tr key={s} className="border-t border-border/50">
                              <td className="px-2 py-1 font-medium">{s}</td>
                              {DAYS.map((d) => (
                                <td key={d} className="px-2 py-1 font-mono text-muted-foreground">
                                  {masterSummary[s][d] || '—'}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" onClick={loadMasterIntoGrid}
                      disabled={masterLoading || masterRows.length === 0}>
                      Load into Grid
                    </Button>
                    <Button size="sm" onClick={saveGridToMaster}>Save Grid → Master</Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* AI banner */}
      {showAiBanner && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <span>✦ AI parsed cells — review fields below and save when ready</span>
          <button onClick={() => setShowAiBanner(false)} className="opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ───────────────────────────────────────── */}
      {/* SECTION C: Subject-by-Subject Wizard       */}
      {/* ───────────────────────────────────────── */}
      <div className="space-y-4">
        {/* Subject tab bar */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card/50 p-2">
          {SUBJECTS.map((s) => {
            const hasData = DAYS.some((d) => (weekData[s][d].type || '').trim().length > 0);
            const active = wizardSubject === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setWizardSubject(s);
                  setActiveReminderSubject(s);
                  setActiveResourceSubject(s);
                }}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                )}
              >
                {hasData && <span className={cn('text-[10px]', active ? 'text-emerald-200' : 'text-emerald-500')}>✓</span>}
                {s}
              </button>
            );
          })}
        </div>

        {(() => {
          const subject = wizardSubject;
          const courseId = config?.courseIds[subject];
          const prefix = config?.assignmentPrefixes[subject] ?? '';
          const isHsBlocked =
            !!config?.autoLogic.historyScienceNoAssign && (subject === 'History' || subject === 'Science');

          // Auto-suggest resources from content_map for this subject's lesson numbers
          const subjectLessonNums = DAYS
            .map((d) => weekData[subject][d].lesson_num)
            .filter(Boolean);
          const suggestedResources = contentMap.filter((cm) => {
            if (cm.subject !== subject && !(subject === 'Reading' && cm.subject === 'Spelling')) return false;
            if (!cm.canvas_url) return false;
            const num = cm.lesson_ref?.replace(/[^0-9]/g, '') || '';
            return subjectLessonNums.some((ln) => ln === num || ln === cm.lesson_ref);
          });
          const alreadyAdded = new Set((subjectResources[subject] ?? []).map(r => r.label));
          const newSuggestions = suggestedResources.filter(s => !alreadyAdded.has(s.canonical_name));
          const subjectIdx = SUBJECTS.indexOf(subject);
          const isFirst = subjectIdx === 0;
          const isLast = subjectIdx === SUBJECTS.length - 1;

          return (
            <>
              {/* Subject header */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">{subject}</h2>
                  {courseId && (
                    <span className="text-[10px] font-mono text-muted-foreground">Course {courseId}</span>
                  )}
                  {isTestWeek(subject) && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600">
                      Test Week
                    </span>
                  )}
                  {subject === 'Math' && (() => {
                    const pu = getPowerUp(weekData.Math.Monday.lesson_num);
                    return pu ? (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">
                        Power Up {pu}
                      </span>
                    ) : null;
                  })()}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Step {subjectIdx + 1} of {SUBJECTS.length}
                </span>
              </div>

              {/* H/S subject toggle (only when relevant) */}
              {(subject === 'History' || subject === 'Science') && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/50 px-3 py-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Active H/S Subject
                  </label>
                  <div className="flex gap-1">
                    {(['Both', 'History', 'Science'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setActiveHsSubject(opt); setIsDirty(true); }}
                        className={cn(
                          'px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all',
                          activeHsSubject === opt
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80',
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  {activeHsSubject !== 'Both' && (
                    <span className="text-[11px] text-muted-foreground">
                      The {activeHsSubject === 'History' ? 'Science' : 'History'} page will redirect to {activeHsSubject}.
                    </span>
                  )}
                </div>
              )}

              {/* STEP 1 — Schedule */}
              <div className="rounded-lg border border-border bg-card/30 p-3 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Step 1 — Schedule
                </div>
                <div className="overflow-x-auto snap-x snap-mandatory">
                  <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
                    {DAYS.map((day) => {
                      const cell = weekData[subject][day];
                      const isLaBlocked = subject === 'Language Arts' && !isLanguageArtsAssignable(cell.type);
                      return (
                        <div key={day} className="snap-start w-[260px] shrink-0">
                          <DaySubjectCard
                            subject={subject}
                            day={day}
                            cell={cell}
                            prefix={prefix}
                            isFriday={day === 'Friday'}
                            isHsBlocked={isHsBlocked}
                            isLaBlocked={isLaBlocked}
                            availableTypes={SUBJECT_TYPES[subject] ?? ['Lesson', 'Test', '-']}
                            contentMap={contentMap}
                            subjectAccent="hsl(var(--primary))"
                            onChange={(field, value) =>
                              updateCell(subject, day, field as keyof typeof cell, value)
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* STEP 2 — Resources */}
              <div className="rounded-lg border border-border bg-card/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Step 2 — Resources
                  </div>
                  <span className="text-[10px] text-muted-foreground italic">
                    Group · Label · Canvas URL
                  </span>
                </div>
                {newSuggestions.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Auto-matched from Content Registry
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {newSuggestions.slice(0, 8).map((s) => (
                        <button
                          key={s.lesson_ref}
                          type="button"
                          className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10 transition-colors"
                          onClick={() => {
                            const updated = [
                              ...(subjectResources[subject] ?? []),
                              { label: s.canonical_name, url: s.canvas_url || undefined, group: undefined }
                            ];
                            setSubjectResources(prev => ({ ...prev, [subject]: updated }));
                            setIsDirty(true);
                          }}
                        >
                          + {s.canonical_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  {(subjectResources[subject] ?? []).map((r, i) => (
                    <div key={i} className="flex gap-1 items-center">
                      <Input placeholder="Group" value={r.group ?? ''} className="w-24 text-xs h-7"
                        onChange={(e) => {
                          const updated = [...(subjectResources[subject] ?? [])];
                          updated[i] = { ...updated[i], group: e.target.value || undefined };
                          setSubjectResources(prev => ({ ...prev, [subject]: updated }));
                          setIsDirty(true);
                        }} />
                      <Input placeholder="File label *" value={r.label} className="flex-1 text-xs h-7"
                        onChange={(e) => {
                          const updated = [...(subjectResources[subject] ?? [])];
                          updated[i] = { ...updated[i], label: e.target.value };
                          setSubjectResources(prev => ({ ...prev, [subject]: updated }));
                          setIsDirty(true);
                        }} />
                      <Input placeholder="https://thalesacademy.instructure.com/..." value={r.url ?? ''} className="flex-1 text-xs h-7"
                        onChange={(e) => {
                          const updated = [...(subjectResources[subject] ?? [])];
                          updated[i] = { ...updated[i], url: e.target.value || undefined };
                          setSubjectResources(prev => ({ ...prev, [subject]: updated }));
                          setIsDirty(true);
                        }} />
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0"
                        onClick={() => {
                          const updated = (subjectResources[subject] ?? []).filter((_, j) => j !== i);
                          setSubjectResources(prev => ({ ...prev, [subject]: updated }));
                          setIsDirty(true);
                        }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="text-xs h-7 mt-1"
                    onClick={() => {
                      const updated = [...(subjectResources[subject] ?? []), { label: '', url: undefined, group: undefined }];
                      setSubjectResources(prev => ({ ...prev, [subject]: updated }));
                      setIsDirty(true);
                    }}>
                    + Add Resource
                  </Button>
                </div>
              </div>

              {/* STEP 3 — Reminder */}
              <div className="rounded-lg border border-border bg-card/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Step 3 — Reminder shown on {subject} Canvas page
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleAutoRemind} className="h-6 gap-1 text-[10px]">
                    <Zap className="h-3 w-3" /> Auto-fill from tests
                  </Button>
                </div>
                <Textarea
                  value={subjectReminders[subject] || ''}
                  onChange={(e) => {
                    setSubjectReminders((prev) => ({ ...prev, [subject]: e.target.value }));
                    setIsDirty(true);
                  }}
                  placeholder={`Reminder text for ${subject} (one item per line)`}
                  className="border-l-4 bg-[#fff8fb] dark:bg-pink-950/20"
                  style={{ borderLeftColor: '#c51062' }}
                  rows={3}
                />
              </div>

              {/* Wizard navigation */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="outline"
                  disabled={isFirst}
                  onClick={() => {
                    const next = SUBJECTS[subjectIdx - 1];
                    setWizardSubject(next);
                    setActiveReminderSubject(next);
                    setActiveResourceSubject(next);
                  }}
                >
                  ← Previous Subject
                </Button>
                <Button
                  onClick={async () => {
                    await handleSave();
                    if (!isLast) {
                      const next = SUBJECTS[subjectIdx + 1];
                      setWizardSubject(next);
                      setActiveReminderSubject(next);
                      setActiveResourceSubject(next);
                    }
                  }}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isLast ? 'Save Week ✓' : 'Save & Continue →'}
                </Button>
              </div>
            </>
          );
        })()}

        {/* Homeroom — Mark Your Calendars (newsletter only) */}
        <div className="rounded-lg border border-border bg-card/30 p-3 space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Homeroom Newsletter Calendar
          </label>
          <Textarea
            value={reminders}
            onChange={(e) => { setReminders(e.target.value); setIsDirty(true); }}
            placeholder="Calendar items shown only in the Homeroom newsletter (one per line)..."
            className="border-l-4 bg-[#fff8fb] dark:bg-pink-950/20"
            style={{ borderLeftColor: '#c51062' }}
            rows={3}
          />
        </div>
      </div>
    </div>
  );
}
