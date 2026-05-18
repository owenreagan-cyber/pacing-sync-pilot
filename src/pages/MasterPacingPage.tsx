/**
 * Master Pacing Manager Page
 * 
 * Allows:
 * - Import pacing from Google Sheets
 * - View/edit the annual_pacing_master table
 * - Filter by quarter, week, subject, school year
 * - Sync back to working pacing for a specific Q/W
 */

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Upload, RefreshCw, Edit2, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchGoogleSheetsPacing } from '@/lib/google-sheets-sync';
import { normalizePacingEntry } from '@/lib/pacing-abbreviations';

const SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'] as const;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const SCHOOL_YEARS = ['2024-2025', '2025-2026', '2026-2027', '2027-2028'] as const;

interface MasterRow {
  id?: string;
  school_year: string;
  quarter: string;
  week_num: number;
  subject: string;
  day: string;
  type: string | null;
  lesson_num: string | null;
  in_class: string | null;
  at_home: string | null;
  date_range?: string;
}

export default function MasterPacingPage() {
  const [masterRows, setMasterRows] = useState<MasterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [schoolYear, setSchoolYear] = useState<string>('2025-2026');
  const [filterQuarter, setFilterQuarter] = useState<string>('Q1');
  const [filterSubject, setFilterSubject] = useState<string>('All');
  const [googleSheetUrl, setGoogleSheetUrl] = useState(
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vTRf9-kG7C2iO75HNB2y4roFZ55YS3gyMFMijGiJsVW8Qm7njs5rTsir6U8Cvi0pljaJAh17WvbqX7f/pub?gid=287822418&single=true&output=csv'
  );
  const [importing, setImporting] = useState(false);
  const [editingRow, setEditingRow] = useState<MasterRow | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  // Load master rows from database
  const loadMaster = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('annual_pacing_master' as any)
        .select('*')
        .eq('school_year', schoolYear)
        .order('quarter')
        .order('week_num')
        .order('subject')
        .order('day');

      if (error) throw error;
      setMasterRows((data as MasterRow[]) || []);
    } catch (err: any) {
      toast.error('Failed to load master', { description: err.message });
    } finally {
      setLoading(false);
    }
  }, [schoolYear]);

  useEffect(() => {
    void loadMaster();
  }, [loadMaster]);

  // Import from Google Sheets
  const handleImportFromSheets = async () => {
    setImporting(true);
    try {
      const cells = await fetchGoogleSheetsPacing(googleSheetUrl, schoolYear);

      if (cells.length === 0) {
        toast.error('No cells parsed from Google Sheet');
        return;
      }

      const { error } = await supabase
        .from('annual_pacing_master' as any)
        .upsert(cells, { onConflict: 'school_year,quarter,week_num,subject,day' });

      if (error) throw error;

      toast.success(`Imported ${cells.length} cells from Google Sheet`);
      await loadMaster();
    } catch (err: any) {
      toast.error('Import failed', { description: err.message });
    } finally {
      setImporting(false);
    }
  };

  // Delete a row
  const handleDeleteRow = async (row: MasterRow) => {
    if (!row.id) return;

    try {
      const { error } = await supabase
        .from('annual_pacing_master' as any)
        .delete()
        .eq('id', row.id);

      if (error) throw error;
      toast.success('Row deleted');
      await loadMaster();
    } catch (err: any) {
      toast.error('Delete failed', { description: err.message });
    }
  };

  // Save edited row
  const handleSaveEdit = async () => {
    if (!editingRow) return;

    try {
      // Normalize the lesson_num
      if (editingRow.lesson_num) {
        editingRow.lesson_num = normalizePacingEntry(editingRow.lesson_num);
      }

      const { error } = await supabase
        .from('annual_pacing_master' as any)
        .upsert([editingRow], { onConflict: 'school_year,quarter,week_num,subject,day' });

      if (error) throw error;

      toast.success('Row saved');
      setShowEditDialog(false);
      setEditingRow(null);
      await loadMaster();
    } catch (err: any) {
      toast.error('Save failed', { description: err.message });
    }
  };

  // Filter rows for display
  const filteredRows = masterRows.filter((row) => {
    if (filterQuarter !== 'All' && row.quarter !== filterQuarter) return false;
    if (filterSubject !== 'All' && row.subject !== filterSubject) return false;
    return true;
  });

  // Render a compact table view
  const renderTable = () => {
    // Group by quarter and week for easier scanning
    const grouped: Record<string, Record<string, MasterRow[]>> = {};
    for (const row of filteredRows) {
      const qkey = row.quarter;
      const wkey = `W${row.week_num}`;
      if (!grouped[qkey]) grouped[qkey] = {};
      if (!grouped[qkey][wkey]) grouped[qkey][wkey] = [];
      grouped[qkey][wkey].push(row);
    }

    return (
      <div className="space-y-6">
        {Object.entries(grouped).map(([q, weeks]) => (
          <div key={q} className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{q}</h3>
            {Object.entries(weeks).map(([w, rows]) => (
              <div key={`${q}-${w}`} className="rounded border border-border bg-card/50 p-3 space-y-2">
                <div className="text-xs font-semibold">{w} ({rows.length} cells)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-2 py-1 text-left font-semibold">Subject</th>
                        {DAYS.map((d) => (
                          <th key={d} className="px-2 py-1 text-left font-semibold">
                            {d.slice(0, 3)}
                          </th>
                        ))}
                        <th className="px-2 py-1 text-left font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SUBJECTS.map((subj) => {
                        const subjRows = rows.filter((r) => r.subject === subj);
                        const dayMap: Record<string, MasterRow> = {};
                        subjRows.forEach((r) => {
                          dayMap[r.day] = r;
                        });

                        return (
                          <tr key={subj} className="border-t border-border/50 hover:bg-muted/20">
                            <td className="px-2 py-1 font-medium">{subj}</td>
                            {DAYS.map((day) => {
                              const cell = dayMap[day];
                              return (
                                <td key={day} className="px-2 py-1 text-muted-foreground font-mono">
                                  <div className="flex flex-col gap-0.5">
                                    {cell ? (
                                      <>
                                        <div className="font-semibold text-foreground">{cell.lesson_num || '—'}</div>
                                        {cell.type && <Badge variant="outline" className="w-fit text-[10px]">{cell.type}</Badge>}
                                      </>
                                    ) : (
                                      <span>—</span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            <td className="px-2 py-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => {
                                  if (subjRows.length > 0) {
                                    setEditingRow(subjRows[0]);
                                    setShowEditDialog(true);
                                  }
                                }}
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in duration-300 space-y-6 p-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Master Pacing Guide</h1>
        <p className="text-sm text-muted-foreground">
          Import from Google Sheets and edit pacing across quarters, weeks, and years
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card/50 p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase text-muted-foreground">School Year</label>
          <Select value={schoolYear} onValueChange={setSchoolYear}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHOOL_YEARS.map((sy) => (
                <SelectItem key={sy} value={sy}>
                  {sy}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase text-muted-foreground">Quarter</label>
          <Select value={filterQuarter} onValueChange={setFilterQuarter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All</SelectItem>
              {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                <SelectItem key={q} value={q}>
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase text-muted-foreground">Subject</label>
          <Select value={filterSubject} onValueChange={setFilterSubject}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Subjects</SelectItem>
              {SUBJECTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1" />

        <Button onClick={loadMaster} disabled={loading} variant="outline" className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Reload
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-1.5">
              <Upload className="h-4 w-4" />
              Import from Sheets
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Import from Google Sheets</DialogTitle>
              <DialogDescription>
                Paste your Google Sheets CSV export URL. The system will parse the pacing data and merge it into the master.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Textarea
                value={googleSheetUrl}
                onChange={(e) => setGoogleSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/e/..."
                className="font-mono text-xs"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                To get the CSV URL: File → Share → Click "Share" link → Change to "Anyone can view" → Copy link and replace `/edit` with `/export?format=csv`
              </p>
            </div>
            <DialogFooter>
              <Button
                onClick={handleImportFromSheets}
                disabled={importing || !googleSheetUrl.trim()}
                className="gap-1.5"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Master Table */}
      <Card>
        <CardHeader>
          <CardTitle>Master Pacing Data</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading master data...</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No master pacing rows found for {schoolYear} {filterQuarter !== 'All' && filterQuarter} {filterSubject !== 'All' && filterSubject}
            </div>
          ) : (
            renderTable()
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Master Row</DialogTitle>
          </DialogHeader>
          {editingRow && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="font-semibold">Quarter</label>
                  <Input
                    value={editingRow.quarter}
                    onChange={(e) => setEditingRow({ ...editingRow, quarter: e.target.value })}
                  />
                </div>
                <div>
                  <label className="font-semibold">Week</label>
                  <Input
                    type="number"
                    value={editingRow.week_num}
                    onChange={(e) => setEditingRow({ ...editingRow, week_num: parseInt(e.target.value) || 1 })}
                  />
                </div>
                <div>
                  <label className="font-semibold">Subject</label>
                  <Select value={editingRow.subject} onValueChange={(s) => setEditingRow({ ...editingRow, subject: s })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECTS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="font-semibold">Day</label>
                  <Select value={editingRow.day} onValueChange={(d) => setEditingRow({ ...editingRow, day: d })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">Lesson Number (e.g., "L 45", "CP 2", "12.2")</label>
                <Input
                  value={editingRow.lesson_num || ''}
                  onChange={(e) => setEditingRow({ ...editingRow, lesson_num: e.target.value })}
                  placeholder="L 45"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">Type</label>
                <Input
                  value={editingRow.type || ''}
                  onChange={(e) => setEditingRow({ ...editingRow, type: e.target.value })}
                  placeholder="Lesson"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} className="gap-1.5">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
