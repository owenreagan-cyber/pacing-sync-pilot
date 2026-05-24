import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Megaphone, Clock, Send, Plus, Trash2, RefreshCw, Loader2, CheckCircle2, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useConfig, type AppConfig } from '@/lib/config';
import { callEdge } from '@/lib/edge';
import { useRealtimeDeploy } from '@/hooks/use-realtime-deploy';
import { TOGETHER_LOGIC_COURSE_ID, getCourseId } from '@/lib/course-ids';
import { logEdit, learnFromEdit, logDeployHabit } from '@/lib/teacher-memory';
import {
  buildCombinedTitle,
  getReadingFluencyTarget,
  renderLanguageArtsChapterTestBody,
  renderMathTestBody,
  renderReadingTestBody,
  renderCombinedReadingSpellingBody,
  renderSpellingTestBody,
} from '@/lib/announcement-templates';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────
interface Announcement {
  id: string;
  title: string | null;
  content: string | null;
  subject: string | null;
  type: string | null;
  status: string | null;
  scheduled_post: string | null;
  posted_at: string | null;
  week_id: string | null;
  course_id: number | null;
  created_at: string | null;
}

interface WeekOption {
  id: string;
  quarter: string;
  week_num: number;
}

interface PacingRow {
  id: string;
  week_id: string | null;
  subject: string;
  day: string;
  type: string | null;
  lesson_num: string | null;
  in_class: string | null;
  at_home: string | null;
  canvas_url: string | null;
  object_id: string | null;
}

interface DraftInsert {
  week_id: string | null;
  subject: string;
  title: string;
  content: string;
  type: string;
  status: 'DRAFT';
  course_id: number | null;
  scheduled_post: string | null;
}

const SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'] as const;

// Subject color tokens (4px left border + accent text)
const SUBJECT_BORDER: Record<string, string> = {
  Math: 'border-l-orange-500',
  Reading: 'border-l-blue-500',
  Spelling: 'border-l-blue-500',
  'Language Arts': 'border-l-emerald-500',
  Science: 'border-l-purple-500',
  History: 'border-l-sky-500',
  Homeroom: 'border-l-primary',
};

const SUBJECT_HEX: Record<string, string> = {
  Math: '#ea580c',
  Reading: '#2563eb',
  Spelling: '#2563eb',
  'Language Arts': '#10b981',
  Science: '#9333ea',
  History: '#0284c7',
  Homeroom: '#475569',
};

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────
export default function AnnouncementCenterPage() {
  const config = useConfig();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState<Record<string, boolean>>({});
  const [postingAll, setPostingAll] = useState(false);

  // Edit drawer state
  const [editingAnn, setEditingAnn] = useState<Announcement | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editScheduled, setEditScheduled] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [aiRewriting, setAiRewriting] = useState(false);

  // Manual create form
  const [showForm, setShowForm] = useState(false);
  const [formSubject, setFormSubject] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formType, setFormType] = useState('custom');
  const [tplTestNum, setTplTestNum] = useState('');
  const [tplLessonNum, setTplLessonNum] = useState('');
  const [tplSummarySubject, setTplSummarySubject] = useState('Math');

  // Reading Mastery quick-create dialog
  const [showRM, setShowRM] = useState(false);
  const [rmTestNum, setRmTestNum] = useState('');
  const [rmTestDate, setRmTestDate] = useState('');
  const [rmCheckoutLesson, setRmCheckoutLesson] = useState('');

  const handleRealtimeEvent = useCallback(() => {
    loadAnnouncements(selectedWeekId || undefined);
  }, [selectedWeekId]);
  useRealtimeDeploy(handleRealtimeEvent);

  useEffect(() => {
    supabase.from('weeks').select('id, quarter, week_num').order('quarter').order('week_num')
      .then(({ data }) => { if (data) setWeeks(data); });
  }, []);

  const loadAnnouncements = async (weekId?: string) => {
    setLoading(true);
    let query = supabase.from('announcements').select('*').order('created_at', { ascending: false });
    if (weekId) query = query.eq('week_id', weekId);
    const { data } = await query.limit(50);
    if (data) setAnnouncements(data);
    setLoading(false);
  };

  useEffect(() => {
    loadAnnouncements(selectedWeekId || undefined);
  }, [selectedWeekId]);

  // ──────────────────────────────────────────────────────────────────────────
  // PART 1: Automation Engine
  // ──────────────────────────────────────────────────────────────────────────
  const handleAutoGenerate = async () => {
    if (!selectedWeekId || !config) {
      toast.error('Select a week first');
      return;
    }
    setGenerating(true);
    try {
      const { data: rows } = await supabase
        .from('pacing_rows')
        .select('id, week_id, subject, day, type, lesson_num, in_class, at_home, canvas_url, object_id')
        .eq('week_id', selectedWeekId);

      if (!rows || rows.length === 0) {
        toast.info('No pacing data for this week');
        setGenerating(false);
        return;
      }

      const week = weeks.find((w) => w.id === selectedWeekId);
      const weekLabel = week ? `${week.quarter} Wk ${week.week_num}` : '';
      const drafts: DraftInsert[] = [];

      // ─── A. Math Test Logic (Early Friday + Urgent Wednesday) ──────────
      const mathTests = rows.filter((r) => r.subject === 'Math' && /test/i.test(r.type || ''));
      for (const mt of mathTests) {
        const lesson = mt.lesson_num || '';
        const powerUp = lesson ? (config.powerUpMap[lesson] || config.powerUpMap[parseInt(lesson, 10) as unknown as string] || '') : '';
        const factTest = lesson ? `Fact Test ${lesson} (${40} Division facts)` : 'Fact Test';
        const blankStudyGuideUrl = mt.canvas_url || undefined;
        const answerKeyUrl = mt.object_id?.startsWith('http') ? mt.object_id : undefined;

        // Early draft → previous Friday 4 PM ET
        drafts.push({
          week_id: selectedWeekId,
          subject: 'Math',
          type: 'test_reminder',
          status: 'DRAFT',
          course_id: getCourseId('Math'),
          scheduled_post: getPreviousFriday4PM(),
          title: `🔢 Math Test Heads-Up — Lesson ${lesson} (${mt.day})`,
          content: renderMathTestBody({
            lesson,
            day: mt.day,
            powerUp,
            factTestLabel: factTest,
            factCount: 40,
            blankStudyGuideUrl,
            answerKeyUrl,
            reminderTone: 'early',
          }),
        });

        // Urgent draft → Wednesday before test 4 PM ET
        drafts.push({
          week_id: selectedWeekId,
          subject: 'Math',
          type: 'test_reminder',
          status: 'DRAFT',
          course_id: getCourseId('Math'),
          scheduled_post: getWednesdayBefore(mt.day),
          title: `⚠️ Math Test Reminder — Lesson ${lesson}`,
          content: renderMathTestBody({
            lesson,
            day: mt.day,
            powerUp,
            factTestLabel: factTest,
            factCount: 40,
            blankStudyGuideUrl,
            answerKeyUrl,
            reminderTone: 'urgent',
          }),
        });
      }

      // ─── B. Reading + Spelling Together Logic ──────────────────────────
      const readingTest = rows.find((r) => r.subject === 'Reading' && /test/i.test(r.type || ''));
      const spellingTest = rows.find((r) => r.subject === 'Spelling' && /test/i.test(r.type || ''));
      if (readingTest || spellingTest) {
        const rNum = readingTest?.lesson_num || '';
        const sNum = parseInt(spellingTest?.lesson_num || '0', 10) || 0;
        const dateStr = readingTest?.day || spellingTest?.day || 'this week';
        const rFluency = getReadingFluencyTarget(rNum);

        drafts.push({
          week_id: selectedWeekId,
          subject: 'Reading',
          type: 'test_reminder',
          status: 'DRAFT',
          course_id: TOGETHER_LOGIC_COURSE_ID,
          scheduled_post: getNextFriday4PM(),
          title: buildCombinedTitle(weekLabel),
          content: renderCombinedReadingSpellingBody({
            weekLabel,
            reading: readingTest
              ? {
                  lessonNum: rNum,
                  readingTestPhrases: config.autoLogic?.readingTestPhrases || [],
                  fluencyGoalWpm: rFluency.wpm,
                  fluencyMaxErrors: rFluency.maxErrors,
                  checkoutLesson: rNum,
                  blankStudyGuideUrl: readingTest.canvas_url || undefined,
                  answerKeyUrl: readingTest.object_id?.startsWith('http') ? readingTest.object_id : undefined,
                }
              : undefined,
            spelling: sNum
              ? { testNum: sNum, wordBank: config.spellingWordBank || {} }
              : undefined,
          }),
        });
      }

      // ─── C. Language Arts Weekly Summary ───────────────────────────────
      const laRows = rows.filter((r) => r.subject === 'Language Arts');
      if (laRows.length > 0) {
        drafts.push({
          week_id: selectedWeekId,
          subject: 'Language Arts',
          type: 'weekly_summary',
          status: 'DRAFT',
          course_id: getCourseId('Language Arts'),
          scheduled_post: getNextFriday4PM(),
          title: `✏️ Language Arts — ${weekLabel} Overview`,
          content: buildSubjectSummaryHtml('Language Arts', laRows, weekLabel),
        });
      }
      const laChapterTest = laRows.find((r) => /test/i.test(r.type || ''));
      if (laChapterTest) {
        const chapterLabel = laChapterTest.lesson_num || laChapterTest.type || 'Current Chapter';
        drafts.push({
          week_id: selectedWeekId,
          subject: 'Language Arts',
          type: 'test_reminder',
          status: 'DRAFT',
          course_id: getCourseId('Language Arts'),
          scheduled_post: getWednesdayBefore(laChapterTest.day || 'Friday'),
          title: `📖 Language Arts Chapter Test — ${chapterLabel}`,
          content: renderLanguageArtsChapterTestBody({
            chapterLabel,
            testDay: laChapterTest.day || undefined,
            blankStudyGuideUrl: laChapterTest.canvas_url || undefined,
            answerKeyUrl: laChapterTest.object_id?.startsWith('http') ? laChapterTest.object_id : undefined,
          }),
        });
      }

      // ─── C2. History OR Science (whichever is active) ──────────────────
      const histRows = rows.filter((r) => r.subject === 'History');
      const sciRows = rows.filter((r) => r.subject === 'Science');
      const hsActive = histRows.length >= sciRows.length ? histRows : sciRows;
      const hsSubject = histRows.length >= sciRows.length ? 'History' : 'Science';
      if (hsActive.length > 0) {
        drafts.push({
          week_id: selectedWeekId,
          subject: hsSubject,
          type: 'weekly_summary',
          status: 'DRAFT',
          course_id: getCourseId(hsSubject),
          scheduled_post: getNextFriday4PM(),
          title: `${hsSubject === 'History' ? '🏛️' : '🔬'} ${hsSubject} — ${weekLabel} Overview`,
          content: buildSubjectSummaryHtml(hsSubject, hsActive, weekLabel),
        });
      }

      // ─── D. Homeroom Weekly Update ─────────────────────────────────────
      drafts.push({
        week_id: selectedWeekId,
        subject: 'Homeroom',
        type: 'weekly_summary',
        status: 'DRAFT',
        course_id: 22254,
        scheduled_post: getNextFriday4PM(),
        title: `🏠 Homeroom Weekly Update — ${weekLabel}`,
        content: buildHomeroomHtml(rows, weekLabel),
      });

      if (drafts.length === 0) {
        toast.info('No triggers matched this week');
        setGenerating(false);
        return;
      }

      const { error } = await supabase.from('announcements').insert(drafts);
      if (error) throw error;

      toast.success(`Auto-generated ${drafts.length} announcement(s)`);
      loadAnnouncements(selectedWeekId);
    } catch (e: any) {
      toast.error('Auto-generate failed', { description: e.message });
    }
    setGenerating(false);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Reading Mastery Quick Create
  // ──────────────────────────────────────────────────────────────────────────
  const handleRMSubmit = async () => {
    if (!rmTestNum || !rmTestDate) {
      toast.error('Test number and date required');
      return;
    }
    try {
      const rmFluency = getReadingFluencyTarget(rmTestNum);
      const html = renderCombinedReadingSpellingBody({
        reading: {
          lessonNum: rmTestNum,
          readingTestPhrases: config?.autoLogic?.readingTestPhrases || [],
          fluencyGoalWpm: rmFluency.wpm,
          fluencyMaxErrors: rmFluency.maxErrors,
          checkoutLesson: rmCheckoutLesson || rmTestNum,
        },
      });
      const { error } = await supabase.from('announcements').insert({
        week_id: selectedWeekId || null,
        subject: 'Reading',
        type: 'test_reminder',
        status: 'DRAFT',
        course_id: TOGETHER_LOGIC_COURSE_ID,
        scheduled_post: getNextFriday4PM(),
        title: `📚 Reading Mastery Test ${rmTestNum} — ${rmTestDate}`,
        content: html,
      });
      if (error) throw error;
      toast.success('Reading Mastery draft created');
      setShowRM(false);
      setRmTestNum(''); setRmTestDate(''); setRmCheckoutLesson('');
      loadAnnouncements(selectedWeekId || undefined);
    } catch (e: any) {
      toast.error('Create failed', { description: e.message });
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Manual create / delete / post (preserved)
  // ──────────────────────────────────────────────────────────────────────────
  // Map a template type to its target course_id
  const courseIdForType = (type: string): number | null => {
    if (type === 'math_early' || type === 'math_2day') return 21957;
    if (type === 'spelling_test' || type === 'reading_test' || type === 'combined') {
      return TOGETHER_LOGIC_COURSE_ID;
    }
    if (type === 'language_arts_chapter_test') return config?.courseIds['Language Arts'] || null;
    if (type === 'weekly_summary') {
      return config?.courseIds[tplSummarySubject] || null;
    }
    return config?.courseIds[formSubject] || null;
  };

  // Pick scheduled_post timestamp based on type
  const scheduledForType = (type: string): string => {
    if (type === 'math_early') return getNextFriday4PM();
    if (type === 'math_2day') return getWednesdayBefore('Friday');
    return getNextFriday4PM();
  };

  // Generate HTML/title from selected template
  const handleGenerateDraft = () => {
    if (!config) { toast.error('Config not loaded'); return; }
    try {
      if (formType === 'math_early' || formType === 'math_2day') {
        const lesson = tplTestNum.trim();
        if (!lesson) { toast.error('Test Number required'); return; }
        const powerUp = lesson ? (config.powerUpMap[lesson] || config.powerUpMap[parseInt(lesson, 10) as unknown as string] || '') : '';
        const args = {
          lesson,
          day: 'Friday',
          powerUp,
          factTestLabel: `Fact Test ${lesson} (40 Division facts)`,
          factCount: 40,
          reminderTone: formType === 'math_early' ? 'early' as const : 'urgent' as const,
        };
        const html = renderMathTestBody(args);
        setFormTitle(formType === 'math_early'
          ? `🔢 Heads Up: Math Test — Lesson ${lesson}`
          : `⚠️ Math Test Lesson ${lesson} — 2 Days Out`);
        setFormContent(html);
        setFormSubject('Math');
      } else if (formType === 'spelling_test') {
        const n = parseInt(tplTestNum || tplLessonNum, 10);
        if (!n) { toast.error('Test Number required'); return; }
        const html = renderSpellingTestBody({
          testNum: n,
          wordBank: config.spellingWordBank || {},
        });
        setFormTitle(`📝 Spelling Test ${n} — Reminder`);
        setFormContent(html);
        setFormSubject('Spelling');
      } else if (formType === 'reading_test') {
        const lessonNum = tplLessonNum || tplTestNum;
        if (!lessonNum) { toast.error('Lesson / Test Number required'); return; }
        const { wpm: rtWpm, maxErrors: rtMaxErrors } = getReadingFluencyTarget(lessonNum);
        const html = renderReadingTestBody({
          lessonNum,
          readingTestPhrases: config.autoLogic?.readingTestPhrases || [],
          fluencyGoalWpm: rtWpm,
          fluencyMaxErrors: rtMaxErrors,
          checkoutLesson: lessonNum,
        });
        setFormTitle(`📚 Reading Mastery Test ${lessonNum} — Reminder`);
        setFormContent(html);
        setFormSubject('Reading');
      } else if (formType === 'combined') {
        const lessonNum = tplLessonNum || tplTestNum;
        const sNum = parseInt(tplTestNum || tplLessonNum, 10);
        const cFluency = getReadingFluencyTarget(lessonNum);
        const html = renderCombinedReadingSpellingBody({
          reading: lessonNum
            ? {
                lessonNum,
                readingTestPhrases: config.autoLogic?.readingTestPhrases || [],
                fluencyGoalWpm: cFluency.wpm,
                fluencyMaxErrors: cFluency.maxErrors,
                checkoutLesson: lessonNum,
              }
            : undefined,
          spelling: sNum ? { testNum: sNum, wordBank: config.spellingWordBank || {} } : undefined,
        });
        setFormTitle(`📚 Reading & Spelling — Combined Reminder`);
        setFormContent(html);
        setFormSubject('Reading');
      } else if (formType === 'language_arts_chapter_test') {
        const chapterLabel = tplLessonNum || tplTestNum;
        if (!chapterLabel) { toast.error('Chapter number required'); return; }
        const html = renderLanguageArtsChapterTestBody({
          chapterLabel,
          testDay: 'Friday',
        });
        setFormTitle(`📖 Language Arts Chapter Test — ${chapterLabel}`);
        setFormContent(html);
        setFormSubject('Language Arts');
      } else if (formType === 'weekly_summary') {
        setFormTitle(`📅 ${tplSummarySubject} — Weekly Overview`);
        setFormContent(`<p>Here is what we are covering in <strong>${tplSummarySubject}</strong> this week.</p>`);
        setFormSubject(tplSummarySubject);
      }
      toast.success('Draft generated — review and Create');
    } catch (e: any) {
      toast.error('Generate failed', { description: e.message });
    }
  };

  const handleCreate = async () => {
    if (!formTitle || !formSubject) { toast.error('Title and subject required'); return; }
    try {
      const courseId = courseIdForType(formType);
      const { error } = await supabase.from('announcements').insert({
        week_id: selectedWeekId || null,
        subject: formSubject,
        title: formTitle,
        content: formContent,
        type: formType,
        status: 'DRAFT',
        course_id: courseId,
        scheduled_post: scheduledForType(formType),
      });
      if (error) throw error;
      toast.success('Announcement created');
      setShowForm(false);
      setFormTitle(''); setFormContent(''); setFormSubject('');
      setTplTestNum(''); setTplLessonNum('');
      loadAnnouncements(selectedWeekId || undefined);
    } catch (e: any) {
      toast.error('Create failed', { description: e.message });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      toast.success('Deleted');
    } catch (e: any) {
      toast.error('Delete failed', { description: e.message });
    }
  };

  const openEdit = (ann: Announcement) => {
    setEditingAnn(ann);
    setEditTitle(ann.title || '');
    setEditContent(ann.content || '');
    setEditScheduled(ann.scheduled_post || '');
  };

  const handleEditSave = async () => {
    if (!editingAnn) return;
    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('announcements')
        .update({
          title: editTitle,
          content: editContent,
          scheduled_post: editScheduled || null,
        })
        .eq('id', editingAnn.id);
      if (error) throw error;
      toast.success('Announcement updated');
      setEditingAnn(null);
      loadAnnouncements(selectedWeekId || undefined);
    } catch (e: any) {
      toast.error('Save failed', { description: e.message });
    }
    setEditSaving(false);
  };

  const handleAiRewrite = async () => {
    if (!editContent.trim()) return;
    setAiRewriting(true);
    try {
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-001',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that rewrites Canvas LMS announcements for elementary school teachers. Keep the same facts and structure. Use warm, clear, parent-friendly language. Return only the HTML body content, no explanation.'
            },
            { role: 'user', content: `Rewrite this announcement:\n\n${editContent}` }
          ]
        })
      });
      const data = await res.json();
      const rewritten = data.choices?.[0]?.message?.content;
      if (rewritten) {
        setEditContent(rewritten);
        toast.success('AI rewrite complete — review before saving');
      }
    } catch (e: any) {
      toast.error('AI rewrite failed', { description: e.message });
    }
    setAiRewriting(false);
  };

  const handlePost = async (ann: Announcement) => {
    if (!ann.course_id || !ann.title) { toast.error('Missing course ID or title'); return; }
    setPosting((p) => ({ ...p, [ann.id]: true }));
    try {
      await callEdge('canvas-post-announcement', {
        courseId: ann.course_id,
        title: ann.title,
        message: ann.content || '',
        delayedPostAt: ann.scheduled_post || undefined,
        weekId: ann.week_id,
        subject: ann.subject,
      });
      await supabase.from('announcements').update({ status: 'POSTED', posted_at: new Date().toISOString() }).eq('id', ann.id);
      void logEdit('announcement', ann.id, null, ann as never, 'deploy');
      void learnFromEdit('announcement', null, ann as never);
      void logDeployHabit(ann.subject || 'Announcement');
      toast.success(`Posted: ${ann.title}`);
      loadAnnouncements(selectedWeekId || undefined);
    } catch (e: any) {
      toast.error('Post failed', { description: e.message });
    }
    setPosting((p) => ({ ...p, [ann.id]: false }));
  };

  const handlePostAll = async () => {
    const drafts = announcements.filter((a) => a.status === 'DRAFT');
    if (drafts.length === 0) { toast.info('No drafts to post'); return; }
    setPostingAll(true);
    const toastId = toast.loading(`Posting 0/${drafts.length} announcements…`);
    let done = 0;
    let errors = 0;
    for (const ann of drafts) {
      toast.loading(`Posting "${ann.title}" (${done + 1}/${drafts.length})…`, { id: toastId });
      try { await handlePost(ann); } catch { errors++; }
      done++;
    }
    if (errors > 0) toast.warning(`Posted ${done - errors}/${drafts.length} (${errors} failed)`, { id: toastId });
    else toast.success(`All ${drafts.length} announcements posted! ✅`, { id: toastId });
    setPostingAll(false);
  };

  const draftCount = announcements.filter((a) => a.status === 'DRAFT').length;
  const postedCount = announcements.filter((a) => a.status === 'POSTED').length;

  const statusColor = (s: string | null) => {
    if (s === 'POSTED') return 'bg-success text-success-foreground';
    if (s === 'ERROR') return 'bg-destructive text-destructive-foreground';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Announcement Center</h1>
          <p className="text-muted-foreground mt-1">Create, auto-generate, and post announcements to Canvas</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {draftCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              <Clock className="h-3 w-3" /> {draftCount} draft{draftCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {postedCount > 0 && (
            <Badge className="text-xs bg-success/10 text-success border-success/20 gap-1">
              <CheckCircle2 className="h-3 w-3" /> {postedCount} posted
            </Badge>
          )}
          <Select value={selectedWeekId || '__all__'} onValueChange={(v) => setSelectedWeekId(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All weeks" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All weeks</SelectItem>
              {weeks.map((w) => <SelectItem key={w.id} value={w.id}>{w.quarter} Wk {w.week_num}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleAutoGenerate} disabled={generating} className="gap-1.5">
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Auto-Generate
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowRM(true)} className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Reading Mastery
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
          <Button size="sm" onClick={handlePostAll} disabled={postingAll || draftCount === 0} className="gap-1.5">
            {postingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {postingAll ? 'Posting…' : 'Post All Drafts'}
          </Button>
        </div>
      </div>

      {/* Reading Mastery quick-create dialog */}
      <Dialog open={showRM} onOpenChange={setShowRM}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reading Mastery Quick Create</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Test Number</Label>
              <Input value={rmTestNum} onChange={(e) => setRmTestNum(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div>
              <Label>Test Date</Label>
              <Input value={rmTestDate} onChange={(e) => setRmTestDate(e.target.value)} placeholder="e.g. Friday, Oct 18" />
            </div>
            <div>
              <Label>Checkout Passage Lesson</Label>
              <Input value={rmCheckoutLesson} onChange={(e) => setRmCheckoutLesson(e.target.value)} placeholder="defaults to test number" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRM(false)}>Cancel</Button>
            <Button onClick={handleRMSubmit}>Create Draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showForm && (
        <Card className="border-primary/20 shadow-md">
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Select value={formSubject} onValueChange={setFormSubject}>
                <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
                <SelectContent>
                  {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="weekly_summary">Weekly Summary</SelectItem>
                  <SelectItem value="math_early">Math Test — Early Reminder</SelectItem>
                  <SelectItem value="math_2day">Math Test — 2-Day Reminder</SelectItem>
                   <SelectItem value="spelling_test">Spelling Test Reminder</SelectItem>
                   <SelectItem value="reading_test">Reading Test Reminder</SelectItem>
                   <SelectItem value="combined">Reading + Spelling Combined</SelectItem>
                   <SelectItem value="language_arts_chapter_test">Language Arts Chapter Test</SelectItem>
                 </SelectContent>
               </Select>
            </div>

            {formType !== 'custom' && (
              <div className="grid grid-cols-2 gap-3 items-end">
                {(formType === 'math_early' || formType === 'math_2day') && (
                  <div>
                    <Label className="text-xs">Test Number</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 15"
                      value={tplTestNum}
                      onChange={(e) => setTplTestNum(e.target.value)}
                    />
                  </div>
                )}
                {(formType === 'spelling_test' || formType === 'reading_test' || formType === 'combined' || formType === 'language_arts_chapter_test') && (
                  <div>
                    <Label className="text-xs">{formType === 'language_arts_chapter_test' ? 'Chapter Number' : 'Lesson / Test Number'}</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 12"
                      value={tplLessonNum}
                      onChange={(e) => setTplLessonNum(e.target.value)}
                    />
                  </div>
                )}
                {formType === 'weekly_summary' && (
                  <div>
                    <Label className="text-xs">Subject</Label>
                    <Select value={tplSummarySubject} onValueChange={setTplSummarySubject}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button size="sm" variant="secondary" onClick={handleGenerateDraft}>
                  Generate Draft
                </Button>
              </div>
            )}

            <Input placeholder="Title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
            <Textarea placeholder="Message body..." value={formContent} onChange={(e) => setFormContent(e.target.value)} rows={6} />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate}>Create</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {loading ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading announcements...
          </CardContent></Card>
        ) : announcements.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No announcements yet. Auto-generate from test data or create manually.</p>
          </CardContent></Card>
        ) : announcements.map((ann) => {
          const borderClass = SUBJECT_BORDER[ann.subject || ''] || 'border-l-muted';
          return (
            <Card
              key={ann.id}
              className={`transition-all border-l-4 ${borderClass} ${ann.status === 'POSTED' ? 'opacity-70' : ''} cursor-pointer hover:shadow-md`}
              onClick={() => openEdit(ann)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-primary" />
                    {ann.title}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{ann.subject}</Badge>
                    <Badge className={`text-xs ${statusColor(ann.status)}`}>{ann.status}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground line-clamp-3" dangerouslySetInnerHTML={{ __html: ann.content || '' }} />
                {ann.status === 'DRAFT' && ann.scheduled_post && (
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    Scheduled: {formatScheduled(ann.scheduled_post)}
                  </p>
                )}
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {ann.scheduled_post ? new Date(ann.scheduled_post).toLocaleString() : 'Not scheduled'}
                    </span>
                    {ann.posted_at && <span className="text-success">Posted {new Date(ann.posted_at).toLocaleString()}</span>}
                  </div>
                  <div className="flex gap-2">
                    {ann.status === 'DRAFT' && (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handlePost(ann); }} disabled={posting[ann.id]} className="gap-1 text-xs">
                        {posting[ann.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Post
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDelete(ann.id); }} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Full edit drawer */}
      <Dialog open={!!editingAnn} onOpenChange={(o) => { if (!o) setEditingAnn(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Edit Announcement
              {editingAnn?.status && (
                <Badge className={`text-xs ml-2 ${statusColor(editingAnn.status)}`}>
                  {editingAnn.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 p-6 overflow-auto flex-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Title</label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scheduled Post (ET)</label>
                <Input
                  type="datetime-local"
                  value={editScheduled ? editScheduled.slice(0, 16) : ''}
                  onChange={(e) => setEditScheduled(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subject</label>
                <div className="flex items-center h-10 px-3 rounded border border-border text-sm text-muted-foreground">
                  {editingAnn?.subject || '—'}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Content (HTML)</label>
                <Button
                  size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                  onClick={handleAiRewrite} disabled={aiRewriting}
                >
                  {aiRewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>✦</span>}
                  AI Rewrite
                </Button>
              </div>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={8}
                className="text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Preview</label>
              <div
                className="rounded border border-border bg-white p-4 text-sm max-h-64 overflow-auto"
                dangerouslySetInnerHTML={{ __html: editContent }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-6 py-4 border-t">
            <Button variant="outline" onClick={() => setEditingAnn(null)}>Cancel</Button>
            <div className="flex gap-2">
              {editingAnn?.status === 'DRAFT' && (
                <Button variant="secondary" onClick={async () => { await handleEditSave(); if (editingAnn) handlePost({ ...editingAnn, title: editTitle, content: editContent, scheduled_post: editScheduled }); }}>
                  Save & Post Now
                </Button>
              )}
              <Button onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PART 2: HTML Template Builders (Canvas + Cidi Labs DesignPlus safe)
// ────────────────────────────────────────────────────────────────────────────
function wrapper(subject: string, inner: string): string {
  const color = SUBJECT_HEX[subject] || '#475569';
  return `<div class="kl_wrapper" style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;border-top:6px solid ${color};padding:16px;background:#ffffff;">${inner}</div>`;
}
function banner(subject: string, title: string): string {
  const color = SUBJECT_HEX[subject] || '#475569';
  return `<div class="kl_banner" style="background:${color};color:#fff;padding:14px 18px;border-radius:6px;margin-bottom:16px;"><h2 style="margin:0;font-size:20px;">${title}</h2></div>`;
}

interface MathArgs { lesson: string; day: string; powerUp: string; factTest: string; studyGuideUrl: string; weekLabel?: string; }

function buildMathEarlyHtml(a: MathArgs): string {
  const link = a.studyGuideUrl
    ? `<p><a href="${a.studyGuideUrl}" style="color:#ea580c;font-weight:600;">📄 Study Guide</a></p>`
    : '';
  return wrapper('Math', `
    ${banner('Math', `Math Test Coming Up — Lesson ${a.lesson}`)}
    <p>Hi parents, a heads up that <strong>Math Test ${a.lesson}</strong> is scheduled for <strong>${a.day}</strong>.</p>
    <ul>
      <li><strong>Power Up:</strong> ${a.powerUp || '—'}</li>
      <li><strong>Fact Test:</strong> ${a.factTest}</li>
    </ul>
    ${link}
    <p>Please review the study guide together this weekend so students walk in confident.</p>
  `);
}

function buildMathUrgentHtml(a: MathArgs): string {
  const link = a.studyGuideUrl
    ? `<p><a href="${a.studyGuideUrl}" style="color:#ea580c;font-weight:600;">📄 Study Guide</a></p>`
    : '';
  return wrapper('Math', `
    ${banner('Math', `⚠️ Math Test ${a.lesson} — ${a.day}`)}
    <p><strong>Quick reminder:</strong> the Math Test is just a couple days away.</p>
    <ul>
      <li><strong>Power Up:</strong> ${a.powerUp || '—'}</li>
      <li><strong>Fact Test:</strong> ${a.factTest}</li>
    </ul>
    ${link}
    <p>Tonight is a great night for one focused review pass.</p>
  `);
}

interface RSArgs {
  testNum: string;
  testDate: string;
  checkoutLesson: string;
  spellingFocus: string[];
  spellingTestNum: number | null;
}

function buildReadingSpellingHtml(a: RSArgs): string {
  const spellingBlock = a.spellingTestNum && a.spellingFocus.length
    ? `
      <h3 style="color:#2563eb;margin-top:20px;">Spelling Test ${a.spellingTestNum}</h3>
      <p><strong>Focus Words (21–25):</strong> ${a.spellingFocus.join(', ')}</p>
    `
    : '';
  return wrapper('Reading', `
    ${banner('Reading', `Reading Mastery Test ${a.testNum} — ${a.testDate}`)}
    <p>Good afternoon, I hope you are having a great week so far!</p>
    <p>The mastery test will cover story details, background information, and vocabulary from our recent lessons. Students will also be reading a timed fluency passage.</p>
    <p><strong>Fluency goal:</strong> The goal of this fluency check is to read 100 words in one minute with 2 or fewer errors.</p>
    <p>Make sure they are tracking and tapping so they do not miss any words or skip lines. Practice reading with your child every day, especially out loud.</p>
    <p>For practice, the checkout passage will come from lesson ${a.checkoutLesson}, reading up to the flower.</p>
    ${spellingBlock}
  `);
}

function buildSubjectSummaryHtml(subject: string, rows: PacingRow[], weekLabel: string): string {
  const items = rows
    .filter((r) => r.in_class)
    .map((r) => `<li><strong>${r.day}:</strong> ${escapeHtml(r.in_class || '')}${r.at_home ? ` <em>(at home: ${escapeHtml(r.at_home)})</em>` : ''}</li>`)
    .join('');
  return wrapper(subject, `
    ${banner(subject, `${subject} — ${weekLabel}`)}
    <p>Here is what we are covering in ${subject} this week:</p>
    <ul>${items || '<li>Continued practice from prior lessons.</li>'}</ul>
  `);
}

function buildHomeroomHtml(rows: PacingRow[], weekLabel: string): string {
  const subjects = Array.from(new Set(rows.map((r) => r.subject))).filter(Boolean);
  const sections = subjects.map((sub) => {
    const subRows = rows.filter((r) => r.subject === sub && r.in_class);
    if (subRows.length === 0) return '';
    const color = SUBJECT_HEX[sub] || '#475569';
    const lis = subRows.map((r) => `<li><strong>${r.day}:</strong> ${escapeHtml(r.in_class || '')}</li>`).join('');
    return `<h3 style="color:${color};margin-top:18px;border-bottom:2px solid ${color};padding-bottom:4px;">${sub}</h3><ul>${lis}</ul>`;
  }).join('');
  return wrapper('Homeroom', `
    ${banner('Homeroom', `Homeroom Weekly Update — ${weekLabel}`)}
    <p>Here is a quick look at what each subject is doing this week.</p>
    ${sections}
    <p style="margin-top:18px;">As always, reach out anytime with questions.</p>
  `);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function formatScheduled(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  });
}

// ────────────────────────────────────────────────────────────────────────────
// PART 4: Scheduling Utilities (America/New_York)
// ────────────────────────────────────────────────────────────────────────────
/** Eastern Time offset in hours for a given date (handles DST). */
function etOffsetHours(date: Date): number {
  // Use Intl to find ET offset; -5 EST or -4 EDT
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
  const parts = dtf.formatToParts(date);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'EST';
  return tz === 'EDT' ? -4 : -5;
}

/** Build an ISO string for a given Y/M/D at HH:00 ET. */
function etDateAt(year: number, month: number, day: number, hour: number): string {
  const tmp = new Date(Date.UTC(year, month, day, hour, 0, 0));
  const offset = etOffsetHours(tmp);
  return new Date(Date.UTC(year, month, day, hour - offset, 0, 0)).toISOString();
}

export function getNextFriday4PM(): string {
  const now = new Date();
  const day = now.getDay();
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  const target = new Date(now);
  target.setDate(now.getDate() + daysUntilFriday);
  return etDateAt(target.getFullYear(), target.getMonth(), target.getDate(), 16);
}

export function getPreviousFriday4PM(): string {
  const now = new Date();
  const day = now.getDay();
  const daysSinceFriday = (day - 5 + 7) % 7 || 7;
  const target = new Date(now);
  target.setDate(now.getDate() - daysSinceFriday);
  return etDateAt(target.getFullYear(), target.getMonth(), target.getDate(), 16);
}

const DAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

export function getWednesdayBefore(testDay: string): string {
  const targetDow = DAY_INDEX[testDay] ?? 5;
  const now = new Date();
  const today = now.getDay();
  const daysUntilTest = (targetDow - today + 7) % 7 || 7;
  const test = new Date(now);
  test.setDate(now.getDate() + daysUntilTest);

  const wed = new Date(test);
  if (targetDow === 4) {
    wed.setDate(test.getDate() - 1);
  } else if (targetDow === 5) {
    wed.setDate(test.getDate() - 2);
  } else {
    const backToWednesday = (targetDow - 3 + 7) % 7;
    wed.setDate(test.getDate() - backToWednesday);
  }
  return etDateAt(wed.getFullYear(), wed.getMonth(), wed.getDate(), 16);
}
