import { createContext, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { COURSE_IDS, TOGETHER_LOGIC_COURSE_ID } from './course-ids';

export interface AutoLogic {
  mathEvenOdd: boolean;
  mathTestTriple: boolean;
  readingTestPhrases: string[];
  fridayNoHomework: boolean;
  historyScienceNoAssign: boolean;
  frontPageProtection: boolean;
  pagePublishDefault: boolean;
  togetherLogicCourseId: number;
}

export interface AppConfig {
  courseIds: Record<string, number>;
  assignmentPrefixes: Record<string, string>;
  quarterColors: Record<string, string>;
  powerUpMap: Record<string, string>;
  spellingWordBank: Record<string, string[]>;
  autoLogic: AutoLogic;
  canvasBaseUrl: string;
}

export const ConfigContext = createContext<AppConfig | null>(null);

export function useConfig(): AppConfig | null {
  return useContext(ConfigContext);
}

export function useRequiredConfig(): AppConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error('Config not loaded');
  return config;
}

export async function loadConfig(): Promise<AppConfig> {
  const { data, error } = await supabase
    .from('system_config')
    .select('*')
    .eq('id', 'current')
    .single();

  if (error || !data) {
    console.warn('system_config row missing — using built-in defaults');
    return {
      courseIds: { Math: 21957, Reading: 21919, Spelling: 21919, 'Language Arts': 21944, History: 21934, Science: 21970, Homeroom: 22254 },
      assignmentPrefixes: { Math: 'SM5:', Reading: 'RM4:', Spelling: 'RM4:', 'Language Arts': 'ELA4:', History: 'Hist:', Science: 'Sci:' },
      quarterColors: { Q1: '#00c0a5', Q2: '#0065a7', Q3: '#6644bb', Q4: '#c87800' },
      powerUpMap: {} as Record<string, string>,
      spellingWordBank: {},
      autoLogic: {
        mathEvenOdd: true, mathTestTriple: true, readingTestPhrases: [],
        fridayNoHomework: true, historyScienceNoAssign: true,
        frontPageProtection: true, pagePublishDefault: false,
        togetherLogicCourseId: TOGETHER_LOGIC_COURSE_ID,
      },
      canvasBaseUrl: 'https://thalesacademy.instructure.com',
    };
  }

  const autoLogic = data.auto_logic as unknown as AutoLogic;
  const powerUpMap = data.power_up_map as Record<string, string>;
  return {
    // Hardcoded course IDs always win over DB values to prevent drift
    courseIds: { ...(data.course_ids as Record<string, number>), ...COURSE_IDS },
    assignmentPrefixes: data.assignment_prefixes as Record<string, string>,
    quarterColors: data.quarter_colors as Record<string, string>,
    powerUpMap,
    spellingWordBank: data.spelling_word_bank as Record<string, string[]>,
    autoLogic: { ...autoLogic, togetherLogicCourseId: TOGETHER_LOGIC_COURSE_ID },
    canvasBaseUrl: data.canvas_base_url || 'https://thalesacademy.instructure.com',
  };
}
