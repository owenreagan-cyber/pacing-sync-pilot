import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Clock, Loader2, Wifi } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { runDiagnostics, overallStatus, type DiagnosticResult } from '@/lib/diagnostics';

interface DeployLogEntry {
  id: string;
  action: string | null;
  subject: string | null;
  status: string | null;
  message: string | null;
  canvas_url: string | null;
  created_at: string | null;
  week_id: string | null;
}

interface Stats {
  total: number;
  deployed: number;
  errors: number;
  noChange: number;
}

export default function HealthMonitorPage() {
  const [logs, setLogs] = useState<DeployLogEntry[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, deployed: 0, errors: 0, noChange: 0 });
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [diagResults, setDiagResults] = useState<DiagnosticResult[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagRan, setDiagRan] = useState(false);

  const handleRunDiagnostics = async () => {
    setDiagRunning(true);
    const results = await runDiagnostics();
    setDiagResults(results);
    setDiagRan(true);
    setDiagRunning(false);
  };

  const computeStats = (entries: DeployLogEntry[]) => ({
    total: entries.length,
    deployed: entries.filter(l => l.status === 'DEPLOYED').length,
    errors: entries.filter(l => l.status === 'ERROR').length,
    noChange: entries.filter(l => l.status === 'NO_CHANGE').length,
  });

  const loadLogs = async () => {
    setLoading(true);
    let query = supabase.from('deploy_log').select('*').order('created_at', { ascending: false }).limit(100);
    if (filter !== 'all') query = query.eq('action', filter);
    const { data } = await query;
    if (data) {
      setLogs(data);
      setStats(computeStats(data));
    }
    setLoading(false);
  };

  useEffect(() => { loadLogs(); }, [filter]);
  useEffect(() => { handleRunDiagnostics(); }, []);

  // Realtime subscription with connection status
  useEffect(() => {
    const channel = supabase
      .channel('deploy-log-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deploy_log' }, (payload) => {
        const newEntry = payload.new as DeployLogEntry;
        setLogs(prev => {
          const updated = [newEntry, ...prev].slice(0, 100);
          setStats(computeStats(updated));
          return updated;
        });
        
        // Flash toast for new events
        const label = [newEntry.action?.replace(/_/g, ' '), newEntry.subject].filter(Boolean).join(' \u2014 ');
        if (newEntry.status === 'DEPLOYED') {
          toast.success(label, { description: newEntry.message || undefined });
        } else if (newEntry.status === 'ERROR') {
          toast.error(label, { description: newEntry.message || undefined });
        }
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });
    return () => { supabase.removeChannel(channel); };
  }, []);

  const statusIcon = (status: string | null) => {
    if (status === 'DEPLOYED') return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (status === 'ERROR') return <XCircle className="h-4 w-4 text-destructive" />;
    if (status === 'NO_CHANGE') return <AlertTriangle className="h-4 w-4 text-warning" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  const statusBadge = (status: string | null) => {
    if (status === 'DEPLOYED') return <Badge className="text-[10px] bg-success text-success-foreground">DEPLOYED</Badge>;
    if (status === 'ERROR') return <Badge variant="destructive" className="text-[10px]">ERROR</Badge>;
    if (status === 'NO_CHANGE') return <Badge variant="secondary" className="text-[10px]">NO CHANGE</Badge>;
    return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  };

  const formatTime = (ts: string | null) => {
    if (!ts) return '\u2014';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (ts: string | null) => {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Health Monitor</h1>
          <p className="text-muted-foreground mt-1">Real-time deployment logs &amp; system diagnostics</p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge variant="outline" className={`text-[10px] gap-1 ${connected ? 'text-success border-success/30' : 'text-muted-foreground'}`}>
            <Wifi className="h-3 w-3" />
            {connected ? 'Live' : 'Connecting\u2026'}
          </Badge>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="page_deploy">Page Deploys</SelectItem>
              <SelectItem value="assignment_deploy">Assignments</SelectItem>
              <SelectItem value="announcement_post">Announcements</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              System Diagnostics
            </CardTitle>
            <div className="flex items-center gap-2">
              {diagRan && (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    overallStatus(diagResults) === 'pass'
                      ? 'text-green-600 border-green-500'
                      : overallStatus(diagResults) === 'warn'
                      ? 'text-amber-600 border-amber-500'
                      : 'text-destructive border-destructive'
                  }`}
                >
                  {overallStatus(diagResults).toUpperCase()}
                </Badge>
              )}
              <Button size="sm" variant="outline" onClick={handleRunDiagnostics}
                disabled={diagRunning} className="h-7 text-xs gap-1">
                {diagRunning
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
                {diagRunning ? 'Checking...' : 'Re-run'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {diagRunning && !diagRan && (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Running diagnostics...</span>
            </div>
          )}
          {diagResults.map((r) => (
            <div key={r.name} className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0">
              <div className={`h-2 w-2 rounded-full shrink-0 ${
                r.status === 'pass' ? 'bg-green-500' :
                r.status === 'warn' ? 'bg-amber-500' : 'bg-destructive'
              }`} />
              <span className="text-xs font-medium w-44 shrink-0">{r.name}</span>
              <span className="text-xs text-muted-foreground flex-1">{r.message}</span>
              {r.durationMs !== undefined && (
                <span className="text-[10px] text-muted-foreground shrink-0">{r.durationMs}ms</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-extrabold">{stats.total}</p>
            <p className="text-xs text-muted-foreground uppercase mt-1">Total</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-extrabold text-success">{stats.deployed}</p>
            <p className="text-xs text-muted-foreground uppercase mt-1">Deployed</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-extrabold text-destructive">{stats.errors}</p>
            <p className="text-xs text-muted-foreground uppercase mt-1">Errors</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-extrabold text-warning">{stats.noChange}</p>
            <p className="text-xs text-muted-foreground uppercase mt-1">No Change</p>
          </CardContent>
        </Card>
      </div>

      {/* Deploy log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Deployment Log
            {connected && (
              <span className="relative flex h-2 w-2 ml-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="p-3 text-left text-xs font-semibold">Time</th>
                  <th className="p-3 text-left text-xs font-semibold">Action</th>
                  <th className="p-3 text-left text-xs font-semibold">Subject</th>
                  <th className="p-3 text-left text-xs font-semibold">Status</th>
                  <th className="p-3 text-left text-xs font-semibold">Message</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Loading logs...
                  </td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    No deployment logs yet.
                  </td></tr>
                ) : logs.map((log, idx) => (
                  <tr key={log.id} className={`border-t hover:bg-muted/50 transition-colors ${idx === 0 ? 'bg-primary/5' : ''}`}>
                    <td className="p-3 font-mono text-xs whitespace-nowrap">
                      <div>{formatTime(log.created_at)}</div>
                      <div className="text-muted-foreground text-[10px]">{formatDate(log.created_at)}</div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-[10px]">{log.action}</Badge>
                    </td>
                    <td className="p-3 text-xs font-medium">{log.subject || '\u2014'}</td>
                    <td className="p-3 flex items-center gap-1.5">
                      {statusIcon(log.status)}
                      {statusBadge(log.status)}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[300px] truncate">
                      {log.canvas_url ? (
                        <a href={log.canvas_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                          {log.message}
                        </a>
                      ) : log.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
