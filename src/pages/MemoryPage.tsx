/**
 * THALES OS — Memory Page
 * Inspect & manage the teacher memory layer:
 *  - Learned Patterns: edit/forget rows in teacher_memory
 *  - Edit History: raw audit log
 *  - Suggested Patterns: promote teacher_patterns into memory
 *  - Deploy Habits: when teacher actually deploys (heatmap)
 *  - Stats: memory hit rate + totals
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Brain, Trash2, Pencil, ChevronDown, ChevronRight, Check, X, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getMemoryHitStats } from '@/lib/teacher-memory';

interface MemoryRow {
  id: string;
  category: string;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  usage_count: number;
  last_used: string | null;
  updated_at: string;
}

interface FeedbackRow {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  diff_summary: string | null;
  created_at: string;
}

interface PatternRow {
  id: string;
  pattern_type: string;
  subject: string | null;
  description: string | null;
  rule: Record<string, unknown>;
  confidence: number;
  applied_count: number;
}

const DAYS_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MemoryRow | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedFeedback, setExpandedFeedback] = useState<Set<string>>(new Set());

  const loadAll = async () => {
    setLoading(true);
    const [m, f, p] = await Promise.all([
      supabase.from('teacher_memory').select('*').order('confidence', { ascending: false }),
      supabase.from('teacher_feedback_log').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('teacher_patterns').select('*').gte('confidence', 0.5).order('confidence', { ascending: false }),
    ]);
    setMemories((m.data ?? []) as MemoryRow[]);
    setFeedback((f.data ?? []) as FeedbackRow[]);
    setPatterns((p.data ?? []) as PatternRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  // ── Learned Patterns ─────────────────────────────────────────────────────
  const handleForget = async (id: string) => {
    const { error } = await supabase.from('teacher_memory').delete().eq('id', id);
    if (error) return toast.error('Forget failed: ' + error.message);
    toast.success('Memory forgotten');
    void loadAll();
  };

  const openEdit = (row: MemoryRow) => {
    setEditing(row);
    setEditValue(JSON.stringify(row.value, null, 2));
  };

  const saveEdit = async () => {
    if (!editing) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editValue);
    } catch {
      return toast.error('Invalid JSON');
    }
    const { error } = await supabase
      .from('teacher_memory')
      .update({ value: parsed as unknown as never })
      .eq('id', editing.id);
    if (error) return toast.error('Save failed: ' + error.message);
    toast.success('Memory updated');
    setEditing(null);
    void loadAll();
  };

  const groupedMemories = useMemo(() => {
    const out: Record<string, MemoryRow[]> = {};
    for (const m of memories) {
      (out[m.category] ??= []).push(m);
    }
    return out;
  }, [memories]);

  // ── Suggested Patterns ───────────────────────────────────────────────────
  const promotePattern = async (p: PatternRow) => {
    const { error } = await supabase.from('teacher_memory').insert({
      category: p.pattern_type,
      key: p.subject ?? 'global',
      value: p.rule as unknown as never,
      confidence: p.confidence,
      usage_count: p.applied_count,
    });
    if (error) return toast.error('Promote failed: ' + error.message);
    await supabase.from('teacher_patterns').delete().eq('id', p.id);
    toast.success('Pattern promoted to memory');
    void loadAll();
  };

  const rejectPattern = async (id: string) => {
    await supabase.from('teacher_patterns').delete().eq('id', id);
    toast.success('Pattern rejected');
    void loadAll();
  };

  // ── Deploy Habits heatmap ────────────────────────────────────────────────
  const heatmap = useMemo(() => {
    const grid: Record<string, Record<number, number>> = {};
    DAYS_ORDER.forEach((d) => (grid[d] = {}));
    for (const m of memories.filter((m) => m.category === 'deploy_timing')) {
      const day = (m.key.split(':')[1] || '').slice(0, 3);
      const hour = Number((m.value as { hourET?: number }).hourET ?? -1);
      if (DAYS_ORDER.includes(day) && hour >= 0) {
        grid[day][hour] = (grid[day][hour] ?? 0) + (m.usage_count || 1);
      }
    }
    return grid;
  }, [memories]);

  const heatmapMax = useMemo(() => {
    let max = 0;
    for (const d of DAYS_ORDER) {
      for (const h of Object.keys(heatmap[d] ?? {})) {
        max = Math.max(max, heatmap[d][Number(h)] ?? 0);
      }
    }
    return max || 1;
  }, [heatmap]);

  // ── Stats ────────────────────────────────────────────────────────────────
  const hits = getMemoryHitStats();
  const totalHits = hits.memory + hits.template + hits.ai;
  const hitRate = totalHits > 0 ? Math.round((hits.memory / totalHits) * 100) : 0;

  const topCorrected = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of feedback) {
      const k = `${f.entity_type}:${f.action}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [feedback]);

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center gap-3 mb-6">
        <Brain className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Teacher Memory</h1>
          <p className="text-sm text-muted-foreground">
            Memory &gt; Templates &gt; AI — what the system has learned about your style
          </p>
        </div>
      </div>

      <Tabs defaultValue="patterns">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="patterns">Learned Patterns</TabsTrigger>
          <TabsTrigger value="history">Edit History</TabsTrigger>
          <TabsTrigger value="suggested">Suggested</TabsTrigger>
          <TabsTrigger value="habits">Deploy Habits</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
        </TabsList>

        {/* ─── Learned Patterns ──────────────────────────────────────────── */}
        <TabsContent value="patterns" className="mt-4 space-y-4">
          {loading && <p className="text-muted-foreground">Loading…</p>}
          {!loading && memories.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              No memories yet. Edit an assignment, page, or announcement and the system will start learning.
            </CardContent></Card>
          )}
          {Object.entries(groupedMemories).map(([cat, rows]) => (
            <Card key={cat}>
              <CardHeader><CardTitle className="text-base capitalize">{cat.replace(/_/g, ' ')}</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="w-32">Confidence</TableHead>
                      <TableHead className="w-20">Uses</TableHead>
                      <TableHead className="w-32">Last Used</TableHead>
                      <TableHead className="w-32">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.key}</TableCell>
                        <TableCell className="text-xs max-w-md truncate">
                          {JSON.stringify(r.value)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${Math.round(r.confidence * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs">{Math.round(r.confidence * 100)}%</span>
                          </div>
                        </TableCell>
                        <TableCell>{r.usage_count}</TableCell>
                        <TableCell className="text-xs">
                          {r.last_used ? new Date(r.last_used).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleForget(r.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ─── Edit History ──────────────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Date</TableHead>
                    <TableHead className="w-28">Entity</TableHead>
                    <TableHead className="w-24">Action</TableHead>
                    <TableHead>Diff</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feedback.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No edits logged yet.
                    </TableCell></TableRow>
                  )}
                  {feedback.map((f) => {
                    const expanded = expandedFeedback.has(f.id);
                    return (
                      <>
                        <TableRow key={f.id} className="cursor-pointer" onClick={() => {
                          const next = new Set(expandedFeedback);
                          if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                          setExpandedFeedback(next);
                        }}>
                          <TableCell className="text-xs">{new Date(f.created_at).toLocaleString()}</TableCell>
                          <TableCell><Badge variant="outline">{f.entity_type}</Badge></TableCell>
                          <TableCell><Badge>{f.action}</Badge></TableCell>
                          <TableCell className="text-xs truncate max-w-md">{f.diff_summary || '—'}</TableCell>
                          <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow key={f.id + '-exp'}>
                            <TableCell colSpan={5} className="bg-muted/30">
                              <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                                <div>
                                  <div className="font-semibold mb-1 text-muted-foreground">Before</div>
                                  <pre className="bg-background p-2 rounded overflow-auto max-h-40">{JSON.stringify(f.before, null, 2)}</pre>
                                </div>
                                <div>
                                  <div className="font-semibold mb-1 text-muted-foreground">After</div>
                                  <pre className="bg-background p-2 rounded overflow-auto max-h-40">{JSON.stringify(f.after, null, 2)}</pre>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Suggested Patterns ───────────────────────────────────────── */}
        <TabsContent value="suggested" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead className="w-40">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patterns.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No suggested patterns yet.
                    </TableCell></TableRow>
                  )}
                  {patterns.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell><Badge variant="outline">{p.pattern_type}</Badge></TableCell>
                      <TableCell>{p.subject ?? '—'}</TableCell>
                      <TableCell className="text-xs">{p.description ?? JSON.stringify(p.rule).slice(0, 80)}</TableCell>
                      <TableCell>{Math.round(p.confidence * 100)}%</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="default" onClick={() => promotePattern(p)}>
                            <Check className="h-3 w-3 mr-1" /> Promote
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => rejectPattern(p.id)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Deploy Habits ─────────────────────────────────────────────── */}
        <TabsContent value="habits" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Deploy Heatmap (ET)</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <table className="text-xs">
                  <thead>
                    <tr>
                      <th className="p-1"></th>
                      {Array.from({ length: 24 }, (_, h) => (
                        <th key={h} className="p-1 w-8 text-center text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS_ORDER.map((d) => (
                      <tr key={d}>
                        <td className="p-1 pr-2 font-semibold">{d}</td>
                        {Array.from({ length: 24 }, (_, h) => {
                          const v = heatmap[d]?.[h] ?? 0;
                          const intensity = v / heatmapMax;
                          return (
                            <td
                              key={h}
                              className="p-0 w-8 h-8 text-center border border-border/30"
                              style={{ backgroundColor: v ? `hsl(var(--primary) / ${0.15 + intensity * 0.7})` : undefined }}
                              title={`${d} ${h}:00 — ${v} deploys`}
                            >
                              {v || ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Suggested cron: deploy automation should run 1h before your most-common slot.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Stats ─────────────────────────────────────────────────────── */}
        <TabsContent value="stats" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Total Memories</div>
              <div className="text-3xl font-bold">{memories.length}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Edits Logged</div>
              <div className="text-3xl font-bold">{feedback.length}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Memory Hit Rate</div>
              <div className="text-3xl font-bold flex items-center gap-2">
                {hitRate}%
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {hits.memory}m / {hits.template}t / {hits.ai}ai
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">High-Confidence (≥60%)</div>
              <div className="text-3xl font-bold">
                {memories.filter((m) => m.confidence >= 0.6).length}
              </div>
            </CardContent></Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Top Corrected Entities</CardTitle></CardHeader>
            <CardContent>
              {topCorrected.length === 0 && <p className="text-sm text-muted-foreground">No data yet.</p>}
              <div className="space-y-2">
                {topCorrected.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-sm">
                    <span className="font-mono">{k}</span>
                    <Badge variant="secondary">{v} edits</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit memory: {editing?.category} / {editing?.key}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="font-mono text-xs min-h-[200px]"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
