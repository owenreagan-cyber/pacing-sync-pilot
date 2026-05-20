import { supabase } from '@/integrations/supabase/client';

export interface DiagnosticResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  durationMs?: number;
}

export async function runDiagnostics(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  // 1. Supabase connectivity
  const t0 = Date.now();
  try {
    const { error } = await supabase.from('system_config').select('id').limit(1);
    results.push({
      name: 'Supabase Connection',
      status: error ? 'fail' : 'pass',
      message: error ? `DB error: ${error.message}` : 'Connected successfully',
      durationMs: Date.now() - t0,
    });
  } catch (e: any) {
    results.push({
      name: 'Supabase Connection',
      status: 'fail',
      message: `Exception: ${e.message}`,
      durationMs: Date.now() - t0,
    });
  }

  // 2. system_config row
  try {
    const { data, error } = await supabase
      .from('system_config')
      .select('id, canvas_base_url, assignment_prefixes')
      .eq('id', 'current')
      .maybeSingle();
    if (error) {
      results.push({ name: 'System Config Row', status: 'fail', message: error.message });
    } else if (!data) {
      results.push({ name: 'System Config Row', status: 'fail', message: 'No "current" row in system_config — app will use fallback defaults. Some assignment titles may lack colons.' });
    } else if (!(data as any).canvas_base_url) {
      results.push({ name: 'System Config Row', status: 'warn', message: 'canvas_base_url is empty in system_config' });
    } else {
      results.push({ name: 'System Config Row', status: 'pass', message: 'system_config row found and valid' });
    }
  } catch (e: any) {
    results.push({ name: 'System Config Row', status: 'fail', message: e.message });
  }

  // 3. Canvas token environment variable
  const token = import.meta.env.VITE_CANVAS_TOKEN || import.meta.env.VITE_SUPABASE_ANON_KEY;
  results.push({
    name: 'Canvas Token',
    status: token ? 'pass' : 'warn',
    message: token ? 'Token environment variable present' : 'VITE_CANVAS_TOKEN not set — Canvas API calls will use server-side token from Supabase secrets',
  });

  // 4. Required tables
  const requiredTables = ['weeks', 'pacing_rows', 'announcements', 'newsletters', 'content_map'];
  for (const table of requiredTables) {
    try {
      const { error } = await supabase.from(table as any).select('id').limit(1);
      results.push({
        name: `Table: ${table}`,
        status: error ? 'fail' : 'pass',
        message: error ? `Cannot query ${table}: ${error.message}` : `${table} accessible`,
      });
    } catch (e: any) {
      results.push({ name: `Table: ${table}`, status: 'fail', message: e.message });
    }
  }

  return results;
}

export function overallStatus(results: DiagnosticResult[]): 'pass' | 'warn' | 'fail' {
  if (results.some(r => r.status === 'fail')) return 'fail';
  if (results.some(r => r.status === 'warn')) return 'warn';
  return 'pass';
}
