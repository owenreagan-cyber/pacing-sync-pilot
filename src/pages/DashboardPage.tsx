import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity, Globe, ClipboardList, Megaphone, AlertTriangle,
  CheckCircle2, Clock, BookOpen, FileText, Calendar,
  Rocket, AlertCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { evaluateWeekRisk, type RiskRow } from '@/lib/risk-engine';
import { QuickStats } from '@/components/dashboard/QuickStats';
import { UpcomingPosts } from '@/components/dashboard/UpcomingPosts';
import { getPacingWeekDateRange } from '@/lib/pacing-week';

interface WeekSummary {
  weekId: string;
  quarter: string;
  weekNum: number;
  dateRange: string | null;
  totalRows: number;
  deployedCount: number;
  pendingCount: number;
  testRows: { subject: string; day: string }[];
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskIssues: string[];
}

interface RecentDeploy {
  id: string;
  action: string | null;
  subject: string | null;
  status: string | null;
  created_at: string | null;
}

interface PacingRow {
  subject: string;
  day: string;
  type: string | null;
  lesson_num: string | null;
  in_class: string | null;
  deploy_status: string | null;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'] as const;

const SUBJECT_COLORS: Record<string, string> = {
  Math: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
  Reading: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  Spelling: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  'Language Arts': 'bg-purple-500/10 border-purple-500/30 text-purple-300',
  History: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
  Science: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
};

export default function DashboardPage({
  activeQuarter,
  activeWeek,
  quarterColor: _quarterColor,
}: {
  activeQuarter: string;
  activeWeek: number;
  quarterColor: string;
}) {
  const navigate = useNavigate();
  const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null);
  const [recentDeploys, setRecentDeploys] = useState<RecentDeploy[]>([]);
  const [_stats, setStats] = useState({ announcements: 0, pages: 0, files: 0 });
  const [loading, setLoading] = useState(true);
  const [pacingRows, setPacingRows] = useState<PacingRow[]>([]);
  const [briefing, setBriefing] = useState<{
    hasPacing: boolean; draftAnnouncements: number;
    deployedPages: string[]; pendingSubjects: string[];
  }>({ hasPacing: false, draftAnnouncements: 0, deployedPages: [], pendingSubjects: [] });

  useEffect(() => {
    void (async () => {
      const { data: week } = await supabase.from('weeks').select('id')
        .eq('quarter', activeQuarter).eq('week_num', activeWeek).maybeSingle();
      if (!week) {
        setBriefing({ hasPacing: false, draftAnnouncements: 0, deployedPages: [], pendingSubjects: [] });
        return;
      }
      const [{ data: rows }, { data: logs }, { data: anns }] = await Promise.all([
        supabase.from('pacing_rows').select('subject').eq('week_id', week.id).limit(1),
        supabase.from('deploy_log').select('subject, status').eq('week_id', week.id).eq('action', 'page_deploy').eq('status', 'DEPLOYED'),
        supabase.from('announcements').select('id').eq('week_id', week.id).eq('status', 'DRAFT'),
      ]);
      const deployedPages = [...new Set((logs || []).map((l: any) => l.subject).filter(Boolean))] as string[];
      const allSubjects = ['Math', 'Reading', 'Language Arts', 'History', 'Science', 'Homeroom'];
      const pendingSubjects = allSubjects.filter(s => !deployedPages.includes(s));
      setBriefing({
        hasPacing: (rows?.length || 0) > 0,
        draftAnnouncements: (anns?.length || 0),
        deployedPages,
        pendingSubjects,
      });
    })();
  }, [activeQuarter, activeWeek]);

  const briefingDateRange = getPacingWeekDateRange(activeQuarter, activeWeek);
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  useEffect(() => {
    void loadDashboard();
  }, [activeQuarter, activeWeek]);

  const loadDashboard = async () => {
    setLoading(true);

    // Get current week
    const { data: week } = await supabase
      .from('weeks')
      .select('*')
      .eq('quarter', activeQuarter)
      .eq('week_num', activeWeek)
      .maybeSingle();

    if (week) {
      // Get pacing rows for this week
      const { data: rows } = await supabase
        .from('pacing_rows')
        .select('*')
        .eq('week_id', week.id);

      const pacingRows = rows || [];
      setPacingRows(pacingRows.map(r => ({
        subject: r.subject,
        day: r.day,
        type: r.type,
        lesson_num: r.lesson_num,
        in_class: r.in_class,
        deploy_status: r.deploy_status,
      })));
      const riskRows: RiskRow[] = pacingRows.map(r => ({
        type: r.type,
        day: r.day,
        create_assign: r.create_assign ?? true,
      }));
      const risk = evaluateWeekRisk(riskRows);

      const deployed = pacingRows.filter(r => r.deploy_status === 'DEPLOYED').length;
      const pending = pacingRows.filter(r => r.deploy_status !== 'DEPLOYED').length;
      const testRows = pacingRows
        .filter(r => r.type?.toLowerCase().includes('test'))
        .map(r => ({ subject: r.subject, day: r.day }));

      setWeekSummary({
        weekId: week.id,
        quarter: week.quarter,
        weekNum: week.week_num,
        dateRange: week.date_range,
        totalRows: pacingRows.length,
        deployedCount: deployed,
        pendingCount: pending,
        testRows,
        riskScore: risk.score,
        riskLevel: risk.level,
        riskIssues: risk.issues,
      });

      // Recent deploys for this week
      const { data: deploys } = await supabase
        .from('deploy_log')
        .select('id, action, subject, status, created_at')
        .eq('week_id', week.id)
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentDeploys(deploys || []);
    }

    // Global stats
    const [annResult, fileResult] = await Promise.all([
      supabase.from('announcements').select('id', { count: 'exact', head: true }).eq('status', 'DRAFT'),
      supabase.from('files').select('id', { count: 'exact', head: true }).eq('confidence', 'unclassified'),
    ]);

    setStats({
      announcements: annResult.count || 0,
      pages: weekSummary?.pendingCount || 0,
      files: fileResult.count || 0,
    });

    setLoading(false);
  };

  const riskColorClass =
    weekSummary?.riskLevel === 'HIGH'
      ? 'border-destructive bg-destructive/10 text-destructive'
      : weekSummary?.riskLevel === 'MEDIUM'
        ? 'border-warning bg-warning/10 text-warning'
        : 'border-success bg-success/10 text-success';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          {activeQuarter} · Week {activeWeek}
          {weekSummary?.dateRange && ` · ${weekSummary.dateRange}`}
        </p>
      </div>

      {/* Today's Briefing */}
      <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 to-primary/0 p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{todayLabel}</p>
          <h2 className="text-2xl font-bold mt-0.5">{activeQuarter} · Week {activeWeek}</h2>
          <p className="text-sm text-muted-foreground">{briefingDateRange}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={() => navigate('/pacing')} className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors p-3 text-left">
            <BookOpen className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">Pacing Entry</span>
            <span className="text-[11px] text-muted-foreground">{briefing.hasPacing ? 'Data saved' : 'Not started'}</span>
          </button>
          <button onClick={() => navigate('/pages')} className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors p-3 text-left">
            <FileText className="h-5 w-5 text-blue-500" />
            <span className="text-sm font-semibold">Canvas Pages</span>
            <span className="text-[11px] text-muted-foreground">{briefing.deployedPages.length}/6 deployed</span>
          </button>
          <button onClick={() => navigate('/assignments')} className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors p-3 text-left">
            <Rocket className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-semibold">Assignments</span>
            <span className="text-[11px] text-muted-foreground">Review &amp; deploy</span>
          </button>
          <button onClick={() => navigate('/announcements')} className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors p-3 text-left">
            <Megaphone className="h-5 w-5 text-orange-500" />
            <span className="text-sm font-semibold">Announcements</span>
            <span className="text-[11px] text-muted-foreground">
              {briefing.draftAnnouncements > 0
                ? `${briefing.draftAnnouncements} draft${briefing.draftAnnouncements !== 1 ? 's' : ''} ready`
                : 'No drafts'}
            </span>
          </button>
        </div>
        {briefing.pendingSubjects.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span className="text-xs text-muted-foreground">Pages not yet deployed:</span>
            {briefing.pendingSubjects.map(s => (
              <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
            ))}
          </div>
        )}
        {briefing.deployedPages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
            <span className="text-xs text-muted-foreground">Live on Canvas:</span>
            {briefing.deployedPages.map(s => (
              <Badge key={s} className="text-[10px] bg-success/15 text-success border-success/20" variant="outline">{s}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Top stat cards — system-wide signals */}
      <QuickStats />

      {/* Upcoming scheduled posts */}
      <UpcomingPosts limit={5} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Score */}
        <Card className={`border-2 ${riskColorClass}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" /> Risk Assessment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-4xl font-extrabold">{weekSummary?.riskScore ?? 100}</span>
              <Badge
                className={`text-xs ${
                  weekSummary?.riskLevel === 'HIGH'
                    ? 'bg-destructive text-destructive-foreground'
                    : weekSummary?.riskLevel === 'MEDIUM'
                      ? 'bg-warning text-warning-foreground'
                      : 'bg-success text-success-foreground'
                }`}
              >
                {weekSummary?.riskLevel || 'LOW'}
              </Badge>
            </div>
            {weekSummary?.riskIssues && weekSummary.riskIssues.length > 0 ? (
              <ul className="space-y-1">
                {weekSummary.riskIssues.map((issue, i) => (
                  <li key={i} className="text-xs flex items-start gap-1.5">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {issue}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs opacity-70">No risk issues detected</p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Tests */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" /> Upcoming Tests
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weekSummary?.testRows && weekSummary.testRows.length > 0 ? (
              <div className="space-y-2">
                {weekSummary.testRows.map((test, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <span className="text-sm font-medium">{test.subject}</span>
                    <Badge variant="outline" className="text-xs">{test.day}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-4 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">No tests this week</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Recent Deployments
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentDeploys.length > 0 ? (
              <div className="space-y-2">
                {recentDeploys.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-xs">
                    <span className="truncate font-medium">
                      {d.action?.replace(/_/g, ' ')} — {d.subject}
                    </span>
                    <Badge
                      className={`text-[9px] ${
                        d.status === 'DEPLOYED'
                          ? 'bg-success text-success-foreground'
                          : d.status === 'ERROR'
                            ? 'bg-destructive text-destructive-foreground'
                            : ''
                      }`}
                    >
                      {d.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-4 text-muted-foreground">
                <Globe className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm">No deployments yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly Calendar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" /> Weekly Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pacingRows.length > 0 ? (
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted">
                    <th className="p-2 text-left font-semibold w-24">Subject</th>
                    {DAYS.map(day => (
                      <th key={day} className="p-2 text-center font-semibold">{day.slice(0, 3)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SUBJECTS.filter(subj => pacingRows.some(r => r.subject === subj)).map(subject => (
                    <tr key={subject} className="border-t border-border/50">
                      <td className="p-2 font-medium text-muted-foreground whitespace-nowrap">{subject}</td>
                      {DAYS.map(day => {
                        const cell = pacingRows.find(r => r.subject === subject && r.day === day);
                        if (!cell) return <td key={day} className="p-2 text-center text-muted-foreground/30">—</td>;
                        const isTest = cell.type?.toLowerCase().includes('test');
                        const colorClass = SUBJECT_COLORS[subject] || 'bg-muted/50 text-foreground';
                        return (
                          <td key={day} className="p-2">
                            <div className={`rounded-md border px-2 py-1.5 text-center ${colorClass} ${isTest ? 'ring-1 ring-destructive' : ''}`}>
                              <div className="font-semibold truncate">
                                {cell.type === 'test' ? '📝 Test' : cell.lesson_num ? `L${cell.lesson_num}` : cell.type || '—'}
                              </div>
                              {cell.in_class && (
                                <div className="text-[10px] opacity-70 truncate mt-0.5">{cell.in_class}</div>
                              )}
                              {cell.deploy_status === 'DEPLOYED' && (
                                <CheckCircle2 className="h-3 w-3 mx-auto mt-0.5 text-success" />
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <Calendar className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">No pacing data for this week</p>
              <Button size="sm" variant="link" onClick={() => navigate('/pacing')} className="mt-1">
                Go to Pacing Entry →
              </Button>
            </div>
          )}
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate('/pacing')} className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Edit Pacing
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/pages')} className="gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Deploy Pages
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/announcements')} className="gap-1.5">
              <Megaphone className="h-3.5 w-3.5" /> Post Announcements
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/newsletter')} className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Build Newsletter
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/health')} className="gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Health Monitor
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
