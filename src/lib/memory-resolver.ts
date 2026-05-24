/**
 * THALES OS — Memory-First Resolver
 * Universal precedence: Memory (≥0.6 confidence) > Templates > AI fallback.
 *
 * Usage:
 *   const title = await resolve('assignment_name', `${subject}:${type}`,
 *     () => fallbackTitleBuilder(),
 *     { lessonNum: '78' },
 *   );
 */
import { supabase } from '@/integrations/supabase/client';
import { recordMemoryHit } from './teacher-memory';

const CONFIDENCE_THRESHOLD = 0.6;

interface ResolveOptions {
  /** Substituted into `{N}` placeholders in stored patterns */
  lessonNum?: string;
  /** Which value field to read from the memory row (default: titlePattern) */
  field?: string;
  /** Force-skip memory lookup (for A/B comparisons) */
  bypass?: boolean;
}

/**
 * Resolve a value using memory first, then fallback. Records hit telemetry.
 */
export async function resolve(
  category: string,
  key: string,
  fallback: () => string | Promise<string>,
  options: ResolveOptions = {},
): Promise<string> {
  if (!options.bypass) {
    try {
      const { data } = await supabase
        .from('teacher_memory')
        .select('value, confidence, id')
        .eq('category', category)
        .eq('key', key)
        .maybeSingle();

      if (data && Number(data.confidence ?? 0) >= CONFIDENCE_THRESHOLD) {
        const value = data.value as Record<string, unknown> | null;
        const field = options.field ?? defaultFieldFor(category);
        const raw = value && typeof value[field] === 'string' ? (value[field]) : null;
        if (raw) {
          // Bump usage_count + last_used (fire and forget)
          supabase
            .from('teacher_memory')
            .update({
              usage_count: ((data as never as { usage_count: number }).usage_count ?? 0) + 1,
              last_used: new Date().toISOString(),
            })
            .eq('id', data.id)
            .then(() => undefined);
          recordMemoryHit('memory');
          return interpolate(raw, options);
        }
      }
    } catch (e) {
      console.warn('[memory-resolver] lookup failed, falling back', e);
    }
  }

  recordMemoryHit('template');
  return await fallback();
}

function defaultFieldFor(category: string): string {
  switch (category) {
    case 'assignment_name':
      return 'titlePattern';
    case 'page_title':
      return 'template';
    case 'file_naming':
      return 'pattern';
    case 'announcement_phrase':
      return 'opener';
    default:
      return 'value';
  }
}

function interpolate(template: string, options: ResolveOptions): string {
  let out = template;
  if (options.lessonNum) out = out.replace(/\{N\}/g, options.lessonNum);
  return out;
}

/**
 * Sync helper for callers that already have a fallback value computed.
 */
export async function resolveOr(
  category: string,
  key: string,
  fallbackValue: string,
  options: ResolveOptions = {},
): Promise<string> {
  return resolve(category, key, () => fallbackValue, options);
}
