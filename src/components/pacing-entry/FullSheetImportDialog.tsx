/**
 * Full-sheet import dialog. Fetches the entire pacing CSV via the
 * `sheets-import` edge function, parses out each weekly block, lets the
 * teacher pick which weeks to import, then upserts into Supabase
 * `weeks` + `pacing_rows`.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'] as const;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

/** Map a column-0 label from the CSV to one of our internal subject names. */
function matchSubject(label: string): (typeof SUBJECTS)[number] | null {
  const l = label.toLowerCase().trim();
  if (!l) return null;
  if (l.includes('saxon') || l.startsWith('math') || l === 'sm5') return 'Math';
  if (l.includes('reading mastery') || l.startsWith('rm4') || l === 'reading') return 'Reading';
  if (l.includes('spelling')) return 'Spelling';
  if (l.includes('shurley') || l.includes('english') || l.startsWith('ela') || l.includes('language arts'))
    return 'Language Arts';
  if (l.includes('history')) return 'History';
  if (l.includes('science')) return 'Science';
  return null;
}

/** Recognize a row whose column-0 cell looks like a week-divider header. */
function isWeekHeader(label: string): boolean {
  const l = label.trim();
  if (!l) return false;
  if (/^week\s*\d+/i.test(l)) return true;
  // Date range like "Aug 18 - Aug 22" or "Aug 18-22"
  if (/[A-Za-z]{3,9}\.?\s*\d{1,2}\s*[-–]\s*([A-Za-z]{3,9}\.?\s*)?\d{1,2}/.test(l)) return true;
  return false;
}

function parseCellType(cell: string): string {
  const v = cell.trim();
  if (!v || v === '-') return '-';
  const l = v.toLowerCase();
  if (l.includes('no class')) return 'No Class';
  if (l.includes('fact')) return 'Fact Test';
  if (/\bsg\b/i.test(v) || l.includes('study guide')) return 'Study Guide';
  if (/\bco\b/i.test(v) || l.includes('checkout')) return 'Checkout';
  if (l.includes('test')) return 'Test';
  return 'Lesson';
}

interface ParsedWeek {
  weekNum: number;
  dateRange: string;
  rowCount: number;
  /** subject -> day -> raw cell value */
  cells: Record<string, Record<string, string>>;
}

function parseSheet(rows: string[][]): ParsedWeek[] {
  const weeks: ParsedWeek[] = [];
  let current: ParsedWeek | null = null;

  const flush = () => {
    if (current && current.rowCount > 0) weeks.push(current);
  };

  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const col0 = (row[0] ?? '').trim();

    if (isWeekHeader(col0)) {
      flush();
      current = {
        weekNum: weeks.length + 1,
        dateRange: col0,
        rowCount: 0,
        cells: {},
      };
      continue;
    }

    const subject = matchSubject(col0);
    if (!subject) continue;

    // If we encounter subject rows before any header, open an implicit week.
    if (!current) {
      current = { weekNum: 1, dateRange: '', rowCount: 0, cells: {} };
    }

    current.cells[subject] = current.cells[subject] || {};
    DAYS.forEach((day, i) => {
      const val = (row[2 + i] ?? '').trim();
      current.cells[subject][day] = val;
    });
    current.rowCount += 1;
  }
  flush();
  return weeks;
}

interface Props {
  onImported?: () => void | Promise<void>;
}

export function FullSheetImportDialog({ onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [weeks, setWeeks] = useState<ParsedWeek[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [quarter, setQuarter] = useState<string>('Q1');

  const fetchSheet = async () => {
    setLoading(true);
    setWeeks([]);
    setSelected(new Set());
    try {
      const { data, error } = await supabase.functions.invoke('sheets-import', { body: {} });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const rows: string[][] = data?.rows ?? [];
      if (!Array.isArray(rows) || rows.length === 0) {
        toast.info('Sheet returned no rows');
        return;
      }
      const parsed = parseSheet(rows);
      if (parsed.length === 0) {
        toast.info('No weeks detected in sheet');
        return;
      }
      setWeeks(parsed);
      setSelected(new Set(parsed.map((w) => w.weekNum)));
    } catch (e: any) {
      toast.error('Sheet fetch failed', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  const toggle = (n: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const importSelected = async () => {
    const picks = weeks.filter((w) => selected.has(w.weekNum));
    if (picks.length === 0) {
      toast.info('Select at least one week');
      return;
    }
    setImporting(true);
    let imported = 0;
    try {
      const startingQ = parseInt(quarter.replace('Q', '')) || 1;
      const resolveQuarter = (weekNum: number, startingQ: number): string => {
        const qNum = Math.min(4, Math.ceil(weekNum / 9) + (startingQ - 1));
        return `Q${Math.min(4, qNum)}`;
      };
      for (const wk of picks) {
        const wkQuarter = resolveQuarter(wk.weekNum, startingQ);
        const { data: weekRow, error: weekErr } = await supabase
          .from('weeks')
          .upsert(
            { quarter: wkQuarter, week_num: wk.weekNum, date_range: wk.dateRange || null } as any,
            { onConflict: 'quarter,week_num' },
          )
          .select('id')
          .single();
        if (weekErr || !weekRow) throw new Error(weekErr?.message || 'week upsert failed');

        const pacingRows: any[] = [];
        for (const subj of SUBJECTS) {
          for (const day of DAYS) {
            const raw = wk.cells[subj]?.[day] ?? '';
            const type = parseCellType(raw);
            const lessonMatch = raw.match(/\d+/);
            pacingRows.push({
              week_id: weekRow.id,
              subject: subj,
              day,
              type,
              lesson_num: lessonMatch ? lessonMatch[0] : null,
              in_class: raw || null,
            });
          }
        }
        const { error: rowsErr } = await supabase
          .from('pacing_rows')
          .upsert(pacingRows, { onConflict: 'week_id,subject,day' });
        if (rowsErr) throw new Error(rowsErr.message);
        imported += 1;
      }
      toast.success(`Imported ${imported} week${imported === 1 ? '' : 's'} into ${quarter}`);
      await onImported?.();
      setOpen(false);
    } catch (e: any) {
      toast.error('Import failed', { description: e?.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v && weeks.length === 0) void fetchSheet();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Import Full Sheet
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Full Pacing Sheet</DialogTitle>
          <DialogDescription>
            Pulls every week from the master Google Sheet. Select which weeks to upsert into the database.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Starting Quarter
            </label>
            <Select value={quarter} onValueChange={setQuarter}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                  <SelectItem key={q} value={q}>{q}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(weeks.map((w) => w.weekNum)))} disabled={loading || weeks.length === 0}>
              Select All
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={loading || weeks.length === 0}>
              Deselect All
            </Button>
            <Button size="sm" variant="outline" onClick={fetchSheet} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh'}
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[360px] rounded-md border border-border">
          {loading ? (
            <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Fetching sheet…
            </div>
          ) : weeks.length === 0 ? (
            <div className="p-8 text-sm text-center text-muted-foreground">
              No weeks loaded yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {weeks.map((w) => {
                const checked = selected.has(w.weekNum);
                return (
                  <li key={w.weekNum} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox checked={checked} onCheckedChange={() => toggle(w.weekNum)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">Week {w.weekNum}</div>
                      {w.dateRange && (
                        <div className="text-xs text-muted-foreground truncate">{w.dateRange}</div>
                      )}
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {w.rowCount} subj
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={importing}>Cancel</Button>
          <Button onClick={importSelected} disabled={importing || selected.size === 0}>
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Import Selected ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
