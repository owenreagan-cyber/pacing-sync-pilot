export type InitStep =
  | 'start'
  | 'load-config'
  | 'config-loaded'
  | 'boot-week'
  | 'boot-week-done'
  | 'render';

export interface DiagnosticEntry {
  step: InitStep;
  timestamp: string;
  message: string;
  details?: unknown;
}

const entries: DiagnosticEntry[] = [];

function ts(): string {
  return new Date().toISOString();
}

export function diagLog(step: InitStep, message: string, details?: unknown): void {
  const entry: DiagnosticEntry = { step, timestamp: ts(), message, details };
  entries.push(entry);
  if (details !== undefined) {
    console.debug(`[diag][${entry.timestamp}] ${step}: ${message}`, details);
  } else {
    console.debug(`[diag][${entry.timestamp}] ${step}: ${message}`);
  }
}

export function diagError(step: InitStep, message: string, err?: unknown): void {
  const entry: DiagnosticEntry = { step, timestamp: ts(), message, details: err };
  entries.push(entry);
  console.error(`[diag][${entry.timestamp}] ${step} ERROR: ${message}`, err ?? '');
}

export function getDiagEntries(): DiagnosticEntry[] {
  return [...entries];
}

export function clearDiagEntries(): void {
  entries.length = 0;
}

export interface EnvStatus {
  supabaseUrl: boolean;
  supabaseKey: boolean;
}

export function checkEnvStatus(): EnvStatus {
  return {
    supabaseUrl: Boolean(
      import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_PUBLIC_SUPABASE_URL,
    ),
    supabaseKey: Boolean(
      import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}
