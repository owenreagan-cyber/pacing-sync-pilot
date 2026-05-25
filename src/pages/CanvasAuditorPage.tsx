import { Fragment, useMemo, useState } from 'react';
import { Stethoscope, ClipboardCheck, Download, Copy, Loader2, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  validateAudit, summarize, type Finding,
} from '@/lib/canvas-audit-validator';

const APP_VERSION = 'Thales OS v21.0';

export default function CanvasAuditorPage() {
  const [weekSlug, setWeekSlug] = useState('q4w5');
  const [weekStartDate, setWeekStartDate] = useState(() => {
    // default: Monday of current week
    const d = new Date();
    const dow = d.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  });
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState<any>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [filterCourse, setFilterCourse] = useState('all');
  const [filterSev, setFilterSev] = useState('all');
  const [expanded, setExpanded] = useState<number | null>(null);

  const summary = useMemo(() => summarize(findings), [findings]);

  const courseNames = useMemo(
    () => (audit ? Object.keys(audit.courses || {}) : []),
    [audit],
  );

  const filteredFindings = useMemo(() => {
    const sevOrder: Record<string, number> = { ERROR: 0, WARN: 1, INFO: 2 };
    return findings
      .filter((f) => filterCourse === 'all' || f.course === filterCourse)
      .filter((f) => filterSev === 'all' || f.severity === filterSev)
      .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  }, [findings, filterCourse, filterSev]);

  const totalAssignments = useMemo(() => {
    if (!audit) return 0;
    return Object.values<any>(audit.courses).reduce(
      (n, c) => n + (c.assignments?.length || 0), 0,
    );
  }, [audit]);

  const _totalPages = useMemo(() => {
    if (!audit) return 0;
    return Object.values<any>(audit.courses).filter((c) => c.page).length;
  }, [audit]);

  const runAudit = async () => {
    setLoading(true);
    setAudit(null);
    setFindings([]);
    try {
      const { data, error } = await supabase.functions.invoke('canvas-audit', {
        body: { weekSlug, weekStartDate },
      });
      if (error) throw error;
      if ((data).error) throw new Error((data).error);
      setAudit(data);
      const f = validateAudit(data);
      setFindings(f);
      toast.success(`Audit complete — ${f.length} findings`);
    } catch (e: any) {
      toast.error('Audit failed', { description: e.message });
    }
    setLoading(false);
  };

  const exportJson = () => {
    if (!audit) return;
    const out = {
      meta: {
        generated_at: audit.generated_at,
        week_slug: weekSlug,
        week_start_date: weekStartDate,
        app_version: APP_VERSION,
        total_errors: summary.errors,
        total_warnings: summary.warnings,
        health_score: summary.health,
      },
      findings,
      raw_audit: audit,
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-audit-${weekSlug}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyReport = async () => {
    if (!audit) return;
    const lines: string[] = [];
    lines.push(`# Canvas Audit — ${weekSlug}`);
    lines.push(`Generated: ${audit.generated_at}`);
    lines.push(`Health: ${summary.health} | Errors: ${summary.errors} | Warnings: ${summary.warnings}`);
    lines.push('');
    for (const c of courseNames) {
      const cd = audit.courses[c];
      lines.push(`## ${c} (${cd.course_id})`);
      lines.push(`- Page: ${cd.page ? (cd.page.published ? '✅ published' : '⚠️ unpublished') : '❌ missing'}`);
      lines.push(`- Assignments: ${cd.assignments?.length || 0}`);
    }
    lines.push('');
    lines.push('## Findings');
    for (const f of filteredFindings) {
      lines.push(`- **${f.severity}** [${f.course}] ${f.rule} — expected: \`${f.expected}\` / actual: \`${f.actual}\``);
    }
    await navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Markdown report copied');
  };

  const sevBadge = (sev: string) => {
    const cls =
      sev === 'ERROR'
        ? 'bg-destructive text-destructive-foreground'
        : sev === 'WARN'
          ? 'bg-warning text-warning-foreground'
          : 'bg-primary text-primary-foreground';
    return <Badge className={cls}>{sev}</Badge>;
  };

  const rowBg = (sev: string) =>
    sev === 'ERROR'
      ? 'bg-destructive/10'
      : sev === 'WARN'
        ? 'bg-warning/10'
        : 'bg-primary/5';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Stethoscope className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold">Canvas Audit</h1>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs uppercase text-muted-foreground">Week Slug</label>
            <Input
              value={weekSlug}
              onChange={(e) => setWeekSlug(e.target.value)}
              placeholder="q4w5"
              className="w-32"
            />
          </div>
          <div>
            <label className="text-xs uppercase text-muted-foreground">Week Start (Mon)</label>
            <Input
              type="date"
              value={weekStartDate}
              onChange={(e) => setWeekStartDate(e.target.value)}
              className="w-44"
            />
          </div>
          <Button onClick={runAudit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            Run Full Audit
          </Button>
          <Button variant="outline" onClick={exportJson} disabled={!audit}>
            <Download className="h-4 w-4" /> Export JSON
          </Button>
          <Button variant="outline" onClick={copyReport} disabled={!audit}>
            <Copy className="h-4 w-4" /> Copy Report
          </Button>
        </CardContent>
      </Card>

      {audit && (
        <>
          <Card>
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-6 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-destructive">{summary.errors}</div>
                <div className="text-xs uppercase text-muted-foreground">Errors</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-warning">{summary.warnings}</div>
                <div className="text-xs uppercase text-muted-foreground">Warnings</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{summary.info}</div>
                <div className="text-xs uppercase text-muted-foreground">Info</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{courseNames.length}</div>
                <div className="text-xs uppercase text-muted-foreground">Courses</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{totalAssignments}</div>
                <div className="text-xs uppercase text-muted-foreground">Assignments</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">{summary.health}</div>
                <div className="text-xs uppercase text-muted-foreground">Health</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Findings ({filteredFindings.length})</CardTitle>
              <div className="flex gap-2">
                <Select value={filterCourse} onValueChange={setFilterCourse}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All courses</SelectItem>
                    {courseNames.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterSev} onValueChange={setFilterSev}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severity</SelectItem>
                    <SelectItem value="ERROR">Error</SelectItem>
                    <SelectItem value="WARN">Warn</SelectItem>
                    <SelectItem value="INFO">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Actual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFindings.map((f, i) => (
                    <Fragment key={i}>
                      <TableRow
                        className={`cursor-pointer ${rowBg(f.severity)}`}
                        onClick={() => setExpanded(expanded === i ? null : i)}
                      >
                        <TableCell>{sevBadge(f.severity)}</TableCell>
                        <TableCell>{f.course}</TableCell>
                        <TableCell>{f.category}</TableCell>
                        <TableCell className="font-medium">{f.rule}</TableCell>
                        <TableCell className="font-mono text-xs">{f.expected}</TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-xs">{f.actual}</TableCell>
                      </TableRow>
                      {expanded === i && (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <pre className="text-xs whitespace-pre-wrap p-2 bg-muted rounded">
                              {JSON.stringify(f, null, 2)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                  {filteredFindings.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No findings
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {courseNames.map((cName) => {
              const c = audit.courses[cName];
              return (
                <Card key={cName}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{cName}</CardTitle>
                      <div className="flex gap-2">
                        <Badge variant="outline">#{c.course_id}</Badge>
                        {c.course_info?.workflow_state && (
                          <Badge
                            className={
                              c.course_info.workflow_state === 'available'
                                ? 'bg-success text-success-foreground'
                                : 'bg-warning text-warning-foreground'
                            }
                          >
                            {c.course_info.workflow_state}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      Page: {c.page ? (c.page.published ? '✅ published' : '❌ unpublished') : '❌ missing'}
                      {c.page && (
                        <span className="text-muted-foreground ml-2">
                          {c.page.word_count} words · updated {c.page.updated_at?.slice(0, 10)}
                        </span>
                      )}
                    </div>
                    <div>Assignments: {c.assignments?.length || 0}</div>
                    {c.assignments?.length > 0 && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Group</TableHead>
                            <TableHead>Pts</TableHead>
                            <TableHead>Grade</TableHead>
                            <TableHead>Due</TableHead>
                            <TableHead>Pub</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {c.assignments.map((a: any) => (
                            <TableRow key={a.id}>
                              <TableCell className="text-xs">{a.name}</TableCell>
                              <TableCell className="text-xs">{a.assignment_group_name}</TableCell>
                              <TableCell className="text-xs">{a.points_possible}</TableCell>
                              <TableCell className="text-xs">{a.grading_type}</TableCell>
                              <TableCell className="text-xs">{a.due_at?.slice(0, 16)}</TableCell>
                              <TableCell className="text-xs">{a.published ? '✅' : '❌'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    {c.fetch_errors?.length > 0 && (
                      <div className="text-xs text-destructive">
                        Fetch errors: {c.fetch_errors.join('; ')}
                      </div>
                    )}
                    {c.page && (
                      <>
                        <details className="text-xs">
                          <summary className="cursor-pointer flex items-center gap-1">
                            <ChevronDown className="h-3 w-3" /> Rendered page preview
                          </summary>
                          <iframe
                            sandbox=""
                            srcDoc={c.page.body}
                            className="w-full h-96 mt-2 border border-border rounded bg-white"
                          />
                        </details>
                        <details className="text-xs">
                          <summary className="cursor-pointer flex items-center gap-1">
                            <ChevronDown className="h-3 w-3" /> Raw body text
                          </summary>
                          <pre className="whitespace-pre-wrap p-2 bg-muted rounded mt-2 max-h-60 overflow-auto">
                            {c.page.body_text}
                          </pre>
                        </details>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
