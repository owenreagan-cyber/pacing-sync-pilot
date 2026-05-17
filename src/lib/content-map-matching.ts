import type { ContentMapEntry } from './auto-link';
import type { Resource } from '@/types/thales';

export type ResourceCategory =
  | 'study_guide'
  | 'power_up'
  | 'textbook'
  | 'reteaching'
  | 'worksheet';

export interface EnhancedResourceMatch {
  category: ResourceCategory;
  label: string;
  resources: Resource[];
}

function normalizeSubject(subject: string): string[] {
  if (subject === 'Reading' || subject === 'Reading & Spelling') return ['Reading', 'Spelling'];
  return [subject];
}

function uniqueResources(resources: Resource[]): Resource[] {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.label}::${resource.url || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildResource(entry: ContentMapEntry): Resource {
  return {
    label: entry.canonical_name || entry.lesson_ref,
    ...(entry.canvas_url ? { url: entry.canvas_url } : {}),
  };
}

export function matchMultipleResources(
  contentMap: ContentMapEntry[],
  subject: string,
  lessonNum: string | null | undefined,
): EnhancedResourceMatch[] {
  const num = Number.parseInt((lessonNum || '').trim(), 10);
  if (!Number.isFinite(num)) return [];

  const pad2 = String(num).padStart(2, '0');
  const pad3 = String(num).padStart(3, '0');
  const chunk25 = String(Math.floor((num - 1) / 25) * 25 + 1).padStart(3, '0');
  const reteach10 = String(Math.floor((num - 1) / 10) * 10 + 1).padStart(3, '0');

  const entries = contentMap.filter((entry) => {
    if (!entry.canvas_url) return false;
    return normalizeSubject(subject).includes(entry.subject);
  });

  const byCategory: Record<ResourceCategory, Resource[]> = {
    study_guide: [],
    power_up: [],
    textbook: [],
    reteaching: [],
    worksheet: [],
  };

  for (const entry of entries) {
    const ref = (entry.lesson_ref || '').toLowerCase();
    const name = (entry.canonical_name || '').toLowerCase();
    const combined = `${ref} ${name}`;

    if (subject === 'Math') {
      if (
        combined.includes(`math_studyguide_${pad2}`) ||
        (combined.includes('study') && combined.includes('guide') && combined.includes(pad2))
      ) byCategory.study_guide.push(buildResource(entry));

      if (combined.includes('math_powerup_') || combined.includes('power up')) {
        byCategory.power_up.push(buildResource(entry));
      }

      if (
        combined.includes(`math_lesson_${pad3}`) ||
        combined.includes('math_textbook') ||
        combined.includes('textbook')
      ) byCategory.textbook.push(buildResource(entry));

      if (combined.includes(`math_reteaching_l${reteach10}`) || combined.includes('reteaching')) {
        byCategory.reteaching.push(buildResource(entry));
      }

      if (combined.includes('worksheet') || combined.includes('mastery')) {
        byCategory.worksheet.push(buildResource(entry));
      }
      continue;
    }

    if (subject === 'Reading' || subject === 'Reading & Spelling') {
      if ((combined.includes('study') && combined.includes('guide')) || combined.includes('mastery')) {
        byCategory.study_guide.push(buildResource(entry));
      }
      if (combined.includes(`reading_book_l${chunk25}`) || combined.includes('book')) {
        byCategory.textbook.push(buildResource(entry));
      }
      if (combined.includes('workbook') || combined.includes('worksheet') || combined.includes('fluency')) {
        byCategory.worksheet.push(buildResource(entry));
      }
      continue;
    }

    if (subject === 'Language Arts') {
      if (combined.includes(`classroom_practice_${pad3}`) || combined.includes('classroom practice')) {
        byCategory.worksheet.push(buildResource(entry));
      }
      if (combined.includes('study') && combined.includes('guide')) {
        byCategory.study_guide.push(buildResource(entry));
      }
    }
  }

  const labels: Record<ResourceCategory, string> = {
    study_guide: 'Study Guides',
    power_up: 'Power Ups',
    textbook: 'Textbook',
    reteaching: 'Reteaching',
    worksheet: 'Worksheets',
  };

  const ordered: ResourceCategory[] = ['study_guide', 'power_up', 'textbook', 'reteaching', 'worksheet'];
  return ordered
    .map((category) => ({
      category,
      label: labels[category],
      resources: uniqueResources(byCategory[category]),
    }))
    .filter((group) => group.resources.length > 0);
}
