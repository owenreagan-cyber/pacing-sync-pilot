import { create } from 'zustand';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { getPacingWeekDatesISO } from '@/lib/pacing-week';

export type HintOverride = 'evens' | 'odds' | 'none' | null;

export interface PacingCell {
  value: string;
  lessonNum: string;
  isTest: boolean;
  isReview: boolean;
  isNoClass: boolean;
  hint_override?: HintOverride;
}

export interface PacingData {
  dates: string[];
  subjects: Record<string, PacingCell[]>; // 5-item arrays (Mon-Fri)
}

interface SystemState {
  selectedMonth: string;
  selectedWeek: number;
  pacingData: PacingData | null;
  isLoading: boolean;
  systemStatus: 'online' | 'offline' | 'checking';

  setSelectedMonth: (m: string) => void;
  setSelectedWeek: (w: number) => void;
  clearCache: () => void;
  setPacingData: (d: PacingData | null) => void;
  setIsLoading: (l: boolean) => void;
  setSystemStatus: (s: 'online' | 'offline' | 'checking') => void;

  fetchHealthCheck: () => Promise<void>;
  fetchPacingData: (month: string, week: number) => Promise<void>;
}

const GAS_URL = import.meta.env.VITE_GOOGLE_APPS_SCRIPT_URL;

const API_SUBJECT_MAP: Record<string, string> = {
  Math: 'Math',
  Reading: 'Reading',
  Spelling: 'Spelling',
  English: 'Language Arts',
  'Language Arts': 'Language Arts',
  History: 'History',
  Science: 'Science',
};

const SUBJECT_ORDER = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'] as const;
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

function formatSavedCellValue(row: {
  in_class: string | null;
  lesson_num: string | null;
  type: string | null;
}) {
  const type = row.type?.trim() ?? '';
  const inClass = row.in_class?.trim() ?? '';
  const lessonNum = row.lesson_num?.trim() ?? '';

  if (!type && !inClass && !lessonNum) return '-';
  if (type === '-' || type.toLowerCase() === 'no class') return '-';
  if (type.toLowerCase() === 'review') return 'Review';
  if (inClass) {
    return inClass
      .replace(/^Lesson\s+/i, '')
      .replace(/^Reading Lesson\s+/i, '')
      .replace(/^Spelling Lesson\s+/i, '')
      .replace(/^Chapter\s+/i, 'CH ');
  }
  if (type.toLowerCase().includes('test')) {
    return lessonNum ? `${type} ${lessonNum}` : type;
  }
  return lessonNum || type;
}

function buildSavedPacingData(
  month: string,
  week: number,
  rows: Array<{
    subject: string;
    day: string;
    in_class: string | null;
    lesson_num: string | null;
    type: string | null;
    hint_override?: HintOverride;
  }>,
): PacingData {
  const dates = getPacingWeekDatesISO(month, week).map((iso) => format(parseISO(iso), 'MMM d'));
  const subjects: Record<string, PacingCell[]> = Object.fromEntries(
    SUBJECT_ORDER.map((subject) => [subject, DAY_ORDER.map(() => ({
      value: '-',
      lessonNum: '',
      isTest: false,
      isReview: false,
      isNoClass: true,
      hint_override: null,
    }))]),
  );

  for (const row of rows) {
    const subjectName = API_SUBJECT_MAP[row.subject] || row.subject;
    const dayIndex = DAY_ORDER.indexOf(row.day as typeof DAY_ORDER[number]);
    if (!subjects[subjectName] || dayIndex === -1) continue;

    const value = formatSavedCellValue(row);
    const lower = value.toLowerCase();
    subjects[subjectName][dayIndex] = {
      value,
      lessonNum: row.lesson_num || '',
      isTest: (row.type || '').toLowerCase().includes('test'),
      isReview: (row.type || '').toLowerCase().includes('review'),
      isNoClass: value === '-' || lower === 'no class' || value === '',
      hint_override: row.hint_override ?? null,
    };
  }

  return { dates, subjects };
}

export const useSystemStore = create<SystemState>((set, _get) => ({
  selectedMonth: '',
  selectedWeek: 0,
  pacingData: null,
  isLoading: false,
  systemStatus: 'checking',

  setSelectedMonth: (m) => set({ selectedMonth: m }),
  setSelectedWeek: (w) => set({ selectedWeek: w }),
  clearCache: () => set({ pacingData: null }),
  setPacingData: (d) => set({ pacingData: d }),
  setIsLoading: (l) => set({ isLoading: l }),
  setSystemStatus: (s) => set({ systemStatus: s }),

  fetchHealthCheck: async () => {
    set({ systemStatus: 'checking' });
    try {
      const res = await fetch(`${GAS_URL}?action=healthCheck`, { redirect: 'follow' });
      if (res.ok) {
        set({ systemStatus: 'online' });
      } else {
        set({ systemStatus: 'offline' });
      }
    } catch {
      set({ systemStatus: 'offline' });
    }
  },

  fetchPacingData: async (month: string, week: number) => {
    set({ isLoading: true });
    try {
      const { data: savedWeek } = await supabase
        .from('weeks')
        .select('id')
        .eq('quarter', month)
        .eq('week_num', week)
        .maybeSingle();

      if (savedWeek?.id) {
        const { data: savedRows, error: savedRowsError } = await supabase
          .from('pacing_rows')
          .select('subject, day, in_class, lesson_num, type, hint_override')
          .eq('week_id', savedWeek.id);

        if (savedRowsError) throw savedRowsError;

        if (savedRows && savedRows.length > 0) {
          set({
            pacingData: buildSavedPacingData(month, week, savedRows as any[]),
            isLoading: false,
          });
          return;
        }
      }

      if (!GAS_URL) {
        set({ pacingData: null, isLoading: false });
        return;
      }

      const res = await fetch(`${GAS_URL}?month=${encodeURIComponent(month)}&week=${week}`, {
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const payload = raw.data || raw;

      const dates: string[] = payload.dates || [];
      const _days: string[] = payload.days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      const subjects: Record<string, PacingCell[]> = {};

      for (const [apiKey, values] of Object.entries(payload.subjects || {})) {
        const subjectName = API_SUBJECT_MAP[apiKey] || apiKey;
        if (!Array.isArray(values)) continue;

        subjects[subjectName] = (values).map((v) => {
          const val = String(v ?? '');
          const lower = val.toLowerCase();
          return {
            value: val,
            lessonNum: val.match(/\d+/)?.[0] || '',
            isTest: lower.includes('test'),
            isReview: lower.includes('review'),
            isNoClass: val === '-' || lower === 'no class' || val === '',
          };
        });
      }

      const pacing: PacingData = { dates, subjects };
      set({ pacingData: pacing, isLoading: false });
    } catch {
      set({ pacingData: null, isLoading: false });
    }
  },
}));
