import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Library, RefreshCw, Loader2, ExternalLink, AlertTriangle, CheckCircle2, DatabaseZap, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { callEdge } from '@/lib/edge';
import { fetchAllCourseFiles, type CanvasFile } from '@/lib/canvas-api';

interface ContentMapRow {
  id: string;
  subject: string;
  lesson_ref: string;
  type: string | null;
  slug: string | null;
  canonical_name: string | null;
  canvas_url: string | null;
  canvas_file_id: string | null;
  confidence: string | null;
  auto_linked: boolean;
  last_synced: string | null;
}

interface FileRow {
  id: string;
  drive_file_id: string | null;
  original_name: string | null;
  friendly_name: string | null;
  subject: string | null;
  type: string | null;
  lesson_num: string | null;
  confidence: string | null;
  slug: string | null;
  canvas_url: string | null;
  needs_rename: boolean;
  renamed_at: string | null;
}

interface PacingRow {
  id: string;
  subject: string;
  lesson_num: string | null;
  type: string | null;
  day: string;
  week_id: string | null;
}

interface WeekRow { id: string; quarter: string; week_num: number; date_range: string | null; }

interface SyncResult {
  synced: number;
  classified: number;
  mapped: number;
  needsReview: number;
  perCourse: Record<string, number>;
}

const SUBJECTS = ['All', 'Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'] as const;

function _lessonRefFor(subject: string, lessonNum: string | null, type: string | null): string {
  if (!lessonNum) return '';
  const isTest = (type || '').toLowerCase().includes('test');
  return `${isTest ? 'T' : 'L'}${lessonNum}`;
}

export default function ContentRegistryPage() {
  const [tab, setTab] = useState('sync');
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const [contentMap, setContentMap] = useState<ContentMapRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [pacing, setPacing] = useState<PacingRow[]>([]);
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<string>('All');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [bulkRenaming, setBulkRenaming] = useState(false);

  // Snapshot Registry state
  const [snapshotFiles, setSnapshotFiles] = useState<CanvasFile[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [generatingMap, setGeneratingMap] = useState(false);

  async function loadAll() {
    const [{ data: cm }, { data: fs }, { data: pr }, { data: wk }, { data: log }] = await Promise.all([
      supabase.from('content_map').select('*').order('subject').order('lesson_ref'),
      supabase.from('files').select('*').order('updated_at', { ascending: false }),
      supabase.from('pacing_rows').select('id, subject, lesson_num, type, day, week_id'),
      supabase.from('weeks').select('id, quarter, week_num, date_range'),
      supabase.from('deploy_log').select('created_at').eq('action', 'canvas-files-sync')
        .order('created_at', { ascending: false }).limit(1),
    ]);
    setContentMap((cm as ContentMapRow[]) || []);
    setFiles((fs as FileRow[]) || []);
    setPacing((pr as PacingRow[]) || []);
    setWeeks((wk as WeekRow[]) || []);
    setLastSync(log?.[0]?.created_at || null);
  }

  useEffect(() => { void loadAll(); }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await callEdge<SyncResult>('canvas-files-sync', {});
      setLastResult(result);
      toast.success(`Synced ${result.synced} files`);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function updateMapRow(id: string, patch: Partial<ContentMapRow>) {
    const { error } = await supabase.from('content_map').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setContentMap((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function renameFile(id: string) {
    setRenamingId(id);
    try {
      await callEdge('canvas-file-rename', { fileId: id });
      toast.success('Renamed in Canvas');
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rename failed');
    } finally {
      setRenamingId(null);
    }
  }

  async function renameAll() {
    const queue = files.filter((f) => f.needs_rename && f.friendly_name);
    if (!queue.length) return;
    setBulkRenaming(true);
    let ok = 0; let fail = 0;
    for (const f of queue) {
      try { await callEdge('canvas-file-rename', { fileId: f.id }); ok++; }
      catch { fail++; }
    }
    setBulkRenaming(false);
    toast.success(`Renamed ${ok}${fail ? `, ${fail} failed` : ''}`);
    await loadAll();
  }

  async function loadSnapshot() {
    setSnapshotLoading(true);
    try {
      const files = await fetchAllCourseFiles();
      setSnapshotFiles(files);
      toast.success(`Loaded ${files.length} files from Canvas`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Snapshot failed');
    } finally {
      setSnapshotLoading(false);
    }
  }

  async function generateMap() {
    if (!snapshotFiles.length) {
      toast.error('Load a snapshot first');
      return;
    }
    setGeneratingMap(true);
    try {
      const records = snapshotFiles.map((f) => ({
        canvas_file_id: String(f.id),
        course_id: String(f.course_id ?? ''),
        original_name: f.display_name || f.filename || null,
        canvas_url: f.html_url || f.url || null,
        status: 'SNAPSHOT',
      }));
      const { error } = await supabase
        .from('canvas_orphan_files')
        .upsert(records, { onConflict: 'canvas_file_id' });
      if (error) throw new Error(error.message);
      toast.success(`Map generated: ${records.length} files saved as Source of Truth`);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generate map failed');
    } finally {
      setGeneratingMap(false);
    }
  }

  // Derived
  const filteredMap = useMemo(
    () => subjectFilter === 'All' ? contentMap : contentMap.filter((r) => r.subject === subjectFilter),
    [contentMap, subjectFilter],
  );

  const renameQueue = useMemo(() => files.filter((f) => f.needs_rename && f.friendly_name), [files]);

  // Snapshot: group files by subject → folder_name
  const snapshotGrouped = useMemo(() => {
    const groups: Record<string, Record<string, CanvasFile[]>> = {};
    for (const f of snapshotFiles) {
      const subj = f.subject ?? 'Unknown';
      const folder = f.folder_name ?? 'course files';
      if (!groups[subj]) groups[subj] = {};
      if (!groups[subj][folder]) groups[subj][folder] = [];
      groups[subj][folder].push(f);
    }
    return groups;
  }, [snapshotFiles]);

  const weekById = useMemo(() => {
    const m = new Map<string, WeekRow>();
    weeks.forEach((w) => m.set(w.id, w));
    return m;
  }, [weeks]);

  const missingFiles = useMemo(() => {
    const mapKey = new Set(
      contentMap.map((r) => `${r.subject}|${r.lesson_ref}|${r.type || ''}`),
    );
    const out: { row: PacingRow; expectedRef: string; week?: WeekRow }[] = [];
    for (const r of pacing) {
      if (!r.lesson_num) continue;
      // Reading/Spelling share course
      const subjects = r.subject === 'Spelling' ? ['Spelling', 'Reading'] : [r.subject];
      const isTest = (r.type || '').toLowerCase().includes('test');
      const ref = `${isTest ? 'T' : 'L'}${r.lesson_num}`;
      const expectedType = isTest ? 'test' : 'worksheet';
      const found = subjects.some((s) => mapKey.has(`${s}|${ref}|${expectedType}`));
      if (!found) {
        out.push({ row: r, expectedRef: ref, week: r.week_id ? weekById.get(r.week_id) : undefined });
      }
    }
    return out;
  }, [pacing, contentMap, weekById]);

  const stats = useMemo(() => {
    const totalMapped = contentMap.length;
    const expected = pacing.filter((r) => r.lesson_num).length;
    const coverage = expected ? Math.round(((expected - missingFiles.length) / expected) * 100) : 0;
    const unclassified = files.filter((f) => f.confidence === 'unclassified' || !f.confidence).length;
    const orphans = files.filter((f) => !f.lesson_num && f.confidence !== 'unclassified').length;
    const breakdown = { regex: 0, ai: 0, manual: 0, other: 0 };
    contentMap.forEach((r) => {
      const c = (r.confidence || 'manual').toLowerCase();
      if (c === 'regex') breakdown.regex++;
      else if (c.startsWith('ai')) breakdown.ai++;
      else if (c === 'manual') breakdown.manual++;
      else breakdown.other++;
    });
    return { totalMapped, expected, coverage, unclassified, orphans, breakdown, needsRename: renameQueue.length };
  }, [contentMap, pacing, files, missingFiles, renameQueue]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Library className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Content Registry</h1>
            <p className="text-sm text-muted-foreground">
              Sync, classify, and map Canvas files to lessons
            </p>
          </div>
        </div>
        {lastSync && (
          <Badge variant="outline" className="text-xs">
            Last sync: {new Date(lastSync).toLocaleString()}
          </Badge>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="sync">Sync</TabsTrigger>
          <TabsTrigger value="map">Content Map</TabsTrigger>
          <TabsTrigger value="missing">
            Missing {missingFiles.length > 0 && <Badge variant="destructive" className="ml-2">{missingFiles.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="rename">
            Rename Queue {renameQueue.length > 0 && <Badge variant="secondary" className="ml-2">{renameQueue.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        {/* SYNC */}
        <TabsContent value="sync" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Sync Canvas Files</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pulls every file from each Canvas course, applies regex classification, generates friendly names,
                and auto-maps high-confidence matches into the Content Map.
              </p>
              <Button onClick={handleSync} disabled={syncing} size="lg">
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {syncing ? 'Syncing…' : 'Sync Canvas Files'}
              </Button>

              {lastResult && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  <Card><CardContent className="pt-6">
                    <div className="text-2xl font-bold">{lastResult.synced}</div>
                    <div className="text-xs text-muted-foreground">Synced</div>
                  </CardContent></Card>
                  <Card><CardContent className="pt-6">
                    <div className="text-2xl font-bold text-success">{lastResult.classified}</div>
                    <div className="text-xs text-muted-foreground">Classified</div>
                  </CardContent></Card>
                  <Card><CardContent className="pt-6">
                    <div className="text-2xl font-bold text-primary">{lastResult.mapped}</div>
                    <div className="text-xs text-muted-foreground">Mapped</div>
                  </CardContent></Card>
                  <Card><CardContent className="pt-6">
                    <div className="text-2xl font-bold text-warning">{lastResult.needsReview}</div>
                    <div className="text-xs text-muted-foreground">Needs Review</div>
                  </CardContent></Card>
                </div>
              )}

              {lastResult?.perCourse && (
                <div className="mt-4 space-y-2">
                  <h3 className="text-sm font-semibold">Per-course</h3>
                  {Object.entries(lastResult.perCourse).map(([s, n]) => (
                    <div key={s} className="flex justify-between text-sm border rounded px-3 py-2">
                      <span>{s}</span>
                      <Badge variant="outline">{n} files</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONTENT MAP */}
        <TabsContent value="map" className="space-y-4">
          <div className="flex items-center justify-between">
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Badge variant="outline">{filteredMap.length} entries</Badge>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Canonical Name</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Auto-link</TableHead>
                    <TableHead>Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMap.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{r.subject}</TableCell>
                      <TableCell className="font-mono text-xs">{r.lesson_ref}</TableCell>
                      <TableCell className="text-xs">{r.type}</TableCell>
                      <TableCell>
                        <Input
                          defaultValue={r.slug || ''}
                          className="h-8 text-xs font-mono"
                          onBlur={(e) => e.target.value !== (r.slug || '') && updateMapRow(r.id, { slug: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          defaultValue={r.canonical_name || ''}
                          className="h-8 text-xs"
                          onBlur={(e) => e.target.value !== (r.canonical_name || '') && updateMapRow(r.id, { canonical_name: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.confidence === 'regex' ? 'default' : 'outline'} className="text-[10px]">
                          {r.confidence || 'manual'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={r.auto_linked}
                          onCheckedChange={(v) => updateMapRow(r.id, { auto_linked: v })}
                        />
                      </TableCell>
                      <TableCell>
                        {r.canvas_url ? (
                          <a href={r.canvas_url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredMap.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      No entries. Run a Sync to populate.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MISSING */}
        <TabsContent value="missing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-warning" />
                Missing Files ({missingFiles.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Expected Ref</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>Week</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missingFiles.map(({ row, expectedRef, week }) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.subject}</TableCell>
                      <TableCell className="font-mono text-xs">{expectedRef}</TableCell>
                      <TableCell>{row.day}</TableCell>
                      <TableCell className="text-xs">
                        {week ? `${week.quarter} W${week.week_num}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{row.type || 'lesson'}</TableCell>
                      <TableCell><Badge variant="destructive" className="text-[10px]">🔴 Missing</Badge></TableCell>
                    </TableRow>
                  ))}
                  {missingFiles.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">
                      <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">All pacing rows have matching files</p>
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* RENAME QUEUE */}
        <TabsContent value="rename" className="space-y-4">
          <div className="flex justify-between items-center">
            <Badge variant="outline">{renameQueue.length} pending</Badge>
            <Button onClick={renameAll} disabled={bulkRenaming || renameQueue.length === 0}>
              {bulkRenaming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Rename All
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Original</TableHead>
                    <TableHead>Friendly</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renameQueue.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs font-mono max-w-xs truncate">{f.original_name}</TableCell>
                      <TableCell className="text-xs font-mono text-success">{f.friendly_name}</TableCell>
                      <TableCell className="text-xs">{f.subject || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{f.confidence}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" disabled={renamingId === f.id} onClick={() => renameFile(f.id)}>
                          {renamingId === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Rename'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {renameQueue.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                      Queue empty
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SNAPSHOT REGISTRY */}
        <TabsContent value="snapshot" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Camera className="h-5 w-5 text-primary" />
                  Snapshot Registry
                </CardTitle>
                <div className="flex items-center gap-2">
                  {snapshotFiles.length > 0 && (
                    <Badge variant="outline">{snapshotFiles.length} files</Badge>
                  )}
                  <Button
                    variant="outline"
                    onClick={loadSnapshot}
                    disabled={snapshotLoading}
                  >
                    {snapshotLoading
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <RefreshCw className="mr-2 h-4 w-4" />}
                    {snapshotLoading ? 'Loading…' : 'Load Snapshot'}
                  </Button>
                  <Button
                    onClick={generateMap}
                    disabled={generatingMap || snapshotFiles.length === 0}
                  >
                    {generatingMap
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <DatabaseZap className="mr-2 h-4 w-4" />}
                    {generatingMap ? 'Saving…' : 'Generate Map'}
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Live snapshot of all files across every Canvas course, grouped by subject and folder.
                Use <strong>Generate Map</strong> to save this as the Source of Truth for renaming.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {snapshotFiles.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Click <strong>Load Snapshot</strong> to fetch all Canvas files.
                </div>
              ) : (
                <div className="divide-y">
                  {Object.entries(snapshotGrouped).sort(([a], [b]) => a.localeCompare(b)).map(([subject, folders]) => (
                    <div key={subject}>
                      <div className="px-4 py-2 bg-muted/50 flex items-center gap-2">
                        <Badge>{subject}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {Object.values(folders).reduce((n, arr) => n + arr.length, 0)} files
                        </span>
                      </div>
                      {Object.entries(folders).sort(([a], [b]) => a.localeCompare(b)).map(([folder, folderFiles]) => (
                        <div key={folder}>
                          <div className="px-6 py-1 bg-muted/20 text-xs font-medium text-muted-foreground flex items-center gap-2">
                            📁 {folder}
                            <span className="font-normal">({folderFiles.length})</span>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="pl-8">File Name</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Updated</TableHead>
                                <TableHead>Link</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {folderFiles.map((f) => (
                                <TableRow key={f.id}>
                                  <TableCell className="pl-8 text-xs font-mono max-w-xs truncate">
                                    {f.display_name || f.filename}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {f.content_type ?? '—'}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {f.updated_at ? new Date(f.updated_at).toLocaleDateString() : '—'}
                                  </TableCell>
                                  <TableCell>
                                    {f.html_url ? (
                                      <a
                                        href={f.html_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary inline-flex items-center gap-1 text-xs"
                                      >
                                        Open <ExternalLink className="h-3 w-3" />
                                      </a>
                                    ) : <span className="text-xs text-muted-foreground">—</span>}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* HEALTH */}
        <TabsContent value="health" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.totalMapped}</div>
              <div className="text-xs text-muted-foreground">Total mapped</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-2xl font-bold text-success">{stats.coverage}%</div>
              <div className="text-xs text-muted-foreground">Coverage ({stats.expected} expected)</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-2xl font-bold text-warning">{stats.unclassified}</div>
              <div className="text-xs text-muted-foreground">Unclassified files</div>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-2xl font-bold text-destructive">{stats.needsRename}</div>
              <div className="text-xs text-muted-foreground">Needs rename</div>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Confidence Breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(['regex', 'ai', 'manual', 'other'] as const).map((k) => {
                const v = stats.breakdown[k];
                const pct = stats.totalMapped ? (v / stats.totalMapped) * 100 : 0;
                return (
                  <div key={k}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{k}</span><span>{v}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {lastSync && (
            <p className="text-xs text-muted-foreground">
              Last full sync: {new Date(lastSync).toLocaleString()}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
