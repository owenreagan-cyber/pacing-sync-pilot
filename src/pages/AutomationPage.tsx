import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Play, RefreshCw, AlertTriangle } from 'lucide-react';

interface Job {
  id: string;
  job_name: string;
  schedule: string | null;
  status: string;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  last_result: any;
  retry_count: number;
}

interface FailureRow {
  id: string;
  action: string | null;
  status: string | null;
  message: string | null;
  created_at: string | null;
  payload: any;
}

const SCHEDULE_HUMAN: Record<string, string> = {
  '0 21 * * 5': 'Friday 4:00 PM ET',
  '0 7 * * *': 'Daily 2:00 AM ET',
  '30 11 * * *': 'Daily 6:30 AM ET',
};

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function AutomationPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data: j }, { data: f }] = await Promise.all([
      supabase.from('automation_jobs').select('*').order('job_name'),
      supabase.from('deploy_log').select('id, action, status, message, created_at, payload')
        .eq('status', 'ERROR')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    setJobs((j ?? []) as Job[]);
    setFailures((f ?? []) as FailureRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const ch = supabase
      .channel('automation-jobs-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_jobs' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  async function runNow(jobName: string) {
    setRunning((p) => ({ ...p, [jobName]: true }));
    toast.info(`Running ${jobName}…`);
    try {
      const { data, error } = await supabase.functions.invoke(jobName, { body: {} });
      if (error) throw error;
      const ok = (data)?.success !== false;
      if (ok) toast.success(`${jobName} complete`);
      else toast.error(`${jobName} failed`, { description: (data)?.error });
    } catch (e) {
      toast.error(`${jobName} failed`, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning((p) => ({ ...p, [jobName]: false }));
      void load();
    }
  }

  async function toggleEnabled(job: Job, enabled: boolean) {
    await supabase.from('automation_jobs').update({ enabled }).eq('id', job.id);
    void load();
  }

  const statusVariant = (s: string) =>
    s === 'idle' ? 'secondary' : s === 'running' ? 'default' : s === 'retrying' ? 'outline' : 'destructive';

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Zero-Touch Automation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scheduled jobs deploy, sync, train memory, and notify automatically.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Last Result</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono text-xs">{job.job_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {SCHEDULE_HUMAN[job.schedule ?? ''] ?? job.schedule ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(job.status) as any} className="capitalize">
                      {job.status}
                      {job.retry_count > 0 ? ` (${job.retry_count})` : ''}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{fmtDate(job.last_run)}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate text-muted-foreground">
                    {job.last_result
                      ? (job.last_result.success === false
                          ? `❌ ${job.last_result.error}`
                          : `✓ ${job.last_result.attempts ?? 1} attempt${(job.last_result.attempts ?? 1) === 1 ? '' : 's'}`)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Switch checked={job.enabled} onCheckedChange={(v) => toggleEnabled(job, v)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={!!running[job.job_name]}
                      onClick={() => runNow(job.job_name)}
                    >
                      <Play className="h-3 w-3" />
                      {running[job.job_name] ? 'Running…' : 'Run Now'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {jobs.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-8">
                    No automation jobs configured.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Recent Failures (7d)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {failures.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No failures in the last 7 days. ✨</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="text-right">Retry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs">{fmtDate(f.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{f.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md truncate">{f.message}</TableCell>
                    <TableCell className="text-right">
                      {f.action && jobs.some((j) => j.job_name === f.action) && (
                        <Button size="sm" variant="outline" onClick={() => runNow(f.action)}>
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
