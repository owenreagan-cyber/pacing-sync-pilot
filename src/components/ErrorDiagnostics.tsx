import { checkEnvStatus, getDiagEntries, type DiagnosticEntry, type InitStep } from '@/lib/diagnostics';

interface Props {
  failedStep: InitStep;
  errorMessage: string;
  onRetry: () => void;
}

function stepLabel(step: InitStep): string {
  const labels: Record<InitStep, string> = {
    start: 'Startup',
    'load-config': 'Loading configuration',
    'config-loaded': 'Configuration loaded',
    'boot-week': 'Determining active week',
    'boot-week-done': 'Active week resolved',
    render: 'Rendering UI',
  };
  return labels[step] ?? step;
}

export function ErrorDiagnostics({ failedStep, errorMessage, onRetry }: Props) {
  const env = checkEnvStatus();
  const entries = getDiagEntries();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="max-w-2xl w-full space-y-6">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-destructive">Initialization Failed</h2>

          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Failed step</p>
            <p className="text-sm text-muted-foreground">{stepLabel(failedStep)}</p>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Error</p>
            <p className="text-sm text-destructive font-mono">{errorMessage}</p>
          </div>

          <button
            onClick={onRetry}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
          >
            Retry
          </button>
        </div>

        <div className="rounded-xl border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Environment Variables</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">VITE_SUPABASE_URL</span>
            <span className={env.supabaseUrl ? 'text-green-600' : 'text-destructive'}>
              {env.supabaseUrl ? '✓ present' : '✗ missing'}
            </span>
            <span className="text-muted-foreground">VITE_SUPABASE_ANON_KEY</span>
            <span className={env.supabaseKey ? 'text-green-600' : 'text-destructive'}>
              {env.supabaseKey ? '✓ present' : '✗ missing'}
            </span>
          </div>
        </div>

        {entries.length > 0 && (
          <div className="rounded-xl border p-4 space-y-2">
            <h3 className="text-sm font-semibold">Initialization Log</h3>
            <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-xs text-muted-foreground">
              {entries.map((entry: DiagnosticEntry, i: number) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-foreground/40">{entry.timestamp.slice(11, 23)}</span>
                  <span className="shrink-0 font-medium text-foreground/60">[{entry.step}]</span>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ErrorDiagnostics;
