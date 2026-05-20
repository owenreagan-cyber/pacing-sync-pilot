type InitStep =
  | 'start'
  | 'load-config'
  | 'config-loaded'
  | 'boot-week'
  | 'boot-week-done'
  | 'render';

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
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="max-w-2xl w-full space-y-4">
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
      </div>
    </div>
  );
}

export default ErrorDiagnostics;
