import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, Table2, ExternalLink, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSystemStore } from '@/store/useSystemStore';
import { supabase } from '@/integrations/supabase/client';
import { getPacingWeekDatesISO } from '@/lib/pacing-week';

const SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const SUBJECT_COLORS: Record<string, string> = {
  Math: '#ea580c', Reading: '#2563eb', Spelling: '#2563eb',
  'Language Arts': '#10b981', History: '#0284c7', Science: '#9333ea',
};

export default function PacingViewerPage() {
  const navigate = useNavigate();
  const { selectedMonth, selectedWeek, setSelectedMonth, setSelectedWeek } = useSystemStore();
  const [rows, setRows] = useState<any[]>([]);
  const [weekRecord, setWeekRecord] = useState<any>(null);
  const [deployLog, setDeployLog] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const weekDates = getPacingWeekDatesISO(selectedMonth, selectedWeek);

  const loadData = async () => {
    setLoading(true);
    const { data: week } = await supabase
      .from('weeks')
      .select('id, date_range, subject_reminders, subject_resources')
      .eq('quarter', selectedMonth)
      .eq('week_num', selectedWeek)
      .maybeSingle();
    setWeekRecord(week);
    if (!week) { setRows([]); setDeployLog({}); setLoading(false); return; }
    const { data: pr } = await supabase.from('pacing_rows').select('*').eq('week_id', week.id);
    setRows(pr || []);
    const { data: logs } = await supabase
      .from('deploy_log')
      .select('subject, status')
      .eq('week_id', week.id)
      .eq('action', 'page_deploy')
      .order('created_at', { ascending: false });
    const statusMap: Record<string, string> = {};
    for (const log of logs || []) {
      if (log.subject && !statusMap[log.subject]) statusMap[log.subject] = log.status;
    }
    setDeployLog(statusMap);
    setLoading(false);
  };

  useEffect(() => { void loadData(); }, [selectedMonth, selectedWeek]);

  const getCell = (subject: string, day: string) =>
    rows.find((r) => r.subject === subject && r.day === day);

  const subjectReminders = (weekRecord?.subject_reminders as Record<string, string>) || {};

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['Q1','Q2','Q3','Q4'].map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(selectedWeek)} onValueChange={(v) => setSelectedWeek(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => (
              <SelectItem key={i+1} value={String(i+1)}>Week {i+1}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate('/pacing')} className="gap-1.5 ml-auto">
          <Pencil className="h-3.5 w-3.5" /> Edit in Pacing Entry
        </Button>
      </div>

      {weekRecord?.date_range && (
        <div className="text-sm text-muted-foreground font-medium">{weekRecord.date_range}</div>
      )}

      {loading ? (
        <Card><CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent></Card>
      ) : !weekRecord ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Table2 className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>No pacing data for {selectedMonth} Week {selectedWeek}.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/pacing')}>
            Go to Pacing Entry
          </Button>
        </CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Table2 className="h-4 w-4 text-primary" />
              {selectedMonth} Week {selectedWeek} — Pacing Grid
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/60 border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider w-36">Subject</th>
                    {DAYS.map((day, i) => {
                      const isCLT = rows.some(r => r.day === day && r.type === 'CLT Testing');
                      return (
                        <th key={day} className="p-3 text-center text-xs font-semibold uppercase tracking-wider">
                          <div>{DAY_SHORT[i]}</div>
                          {weekDates[i] && <div className="text-[10px] text-muted-foreground font-normal">{weekDates[i].slice(5).replace('-','/')}</div>}
                          {isCLT && <div className="text-[9px] text-pink-600 font-bold mt-0.5">CLT</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {SUBJECTS.map((subject) => {
                    const color = SUBJECT_COLORS[subject] || '#475569';
                    const deployed = deployLog[subject];
                    const reminder = subjectReminders[subject];
                    return (
                      <>
                        <tr key={subject} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="p-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-sm" style={{ color }}>{subject}</span>
                              {deployed && (
                                <Badge
                                  className={`text-[9px] w-fit ${deployed === 'DEPLOYED' ? 'bg-success/15 text-success border-success/20' : 'bg-muted text-muted-foreground'}`}
                                  variant="outline"
                                >
                                  {deployed === 'DEPLOYED' ? '✓ Page live' : deployed}
                                </Badge>
                              )}
                            </div>
                          </td>
                          {DAYS.map((day) => {
                            const cell = getCell(subject, day);
                            const isCLT = cell?.type === 'CLT Testing';
                            const isTest = cell?.type?.toLowerCase().includes('test');
                            const isNoClass = !cell?.type || cell.type === '-' || cell.type === 'No Class';
                            return (
                              <td
                                key={day}
                                className={`p-2 text-center text-xs border-l border-border/30 ${
                                  isCLT ? 'bg-pink-50 dark:bg-pink-950/20' :
                                  isTest ? 'bg-amber-50 dark:bg-amber-950/20' :
                                  isNoClass ? 'bg-muted/20' : ''
                                }`}
                              >
                                {isCLT ? (
                                  <span className="text-pink-600 font-semibold text-[10px]">CLT Testing</span>
                                ) : isNoClass ? (
                                  <span className="text-muted-foreground/40">—</span>
                                ) : (
                                  <div className="space-y-0.5">
                                    <div className={`font-medium ${isTest ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                                      {cell?.type || ''}
                                    </div>
                                    {cell?.lesson_num && (
                                      <div className="text-[10px] font-mono text-muted-foreground">L{cell.lesson_num}</div>
                                    )}
                                    {cell?.canvas_url && (
                                      <a href={cell.canvas_url} target="_blank" rel="noopener"
                                        className="inline-flex items-center gap-0.5 text-[9px] text-primary hover:underline">
                                        <ExternalLink className="h-2.5 w-2.5" /> Canvas
                                      </a>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {reminder && (
                          <tr key={`${subject}_reminder`} className="border-t-0">
                            <td className="px-3 pb-1.5 pt-0">
                              <div className="text-[9px] text-pink-600 font-semibold uppercase tracking-wider">Reminder</div>
                            </td>
                            <td colSpan={5} className="px-3 pb-1.5 pt-0 text-[11px] text-muted-foreground italic">
                              {reminder}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
