/**
 * Google Sheets Sync Module
 * 
 * Fetches pacing data from a Google Sheets CSV export and converts it
 * to the annual_pacing_master format with abbreviation normalization.
 */

import { normalizePacingEntry } from './pacing-abbreviations';

interface MasterCell {
  school_year: string;
  quarter: string;
  week_num: number;
  subject: string;
  day: string;
  type: string | null;
  lesson_num: string | null;
  in_class: string | null;
  at_home: string | null;
}

const SUBJECTS = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/**
 * Detect subject from a label (e.g., "Saxon Math", "Reading Mastery")
 */
function detectSubject(label: string): string | null {
  const l = label.toLowerCase().trim();
  
  if (l.includes('math') || l.includes('saxon') || l.includes('sm5')) return 'Math';
  if (l.includes('reading') || l.includes('rm4')) return 'Reading';
  if (l.includes('spelling')) return 'Spelling';
  if (l.includes('language') || l.includes('english') || l.includes('ela') || l.includes('shurley')) 
    return 'Language Arts';
  if (l.includes('history')) return 'History';
  if (l.includes('science')) return 'Science';
  
  // Try exact match
  return SUBJECTS.find(s => s.toLowerCase() === l) || null;
}

/**
 * Parse CSV data and extract pacing cells
 */
function parseCsvData(csvText: string): MasterCell[] {
  const lines = csvText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const cells: MasterCell[] = [];

  let currentQuarter = '';
  let currentWeek = 0;
  let weekLessonMap: Record<string, Record<string, string>> = {};

  for (const line of lines) {
    const cols = line.split(',').map(col => col.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;

    const firstCol = cols[0];

    // Detect week header (e.g., "Week 1", "Aug 18 - Aug 22")
    if (/^week\s*\d+/i.test(firstCol) || /[A-Za-z]{3}\s*\d+\s*[-–]/i.test(firstCol)) {
      // Parse week number if available
      const weekMatch = firstCol.match(/week\s*(\d+)/i);
      if (weekMatch) {
        currentWeek = parseInt(weekMatch[1]);
        // Try to infer quarter (rough heuristic)
        if (currentWeek <= 9) currentQuarter = 'Q1';
        else if (currentWeek <= 18) currentQuarter = 'Q2';
        else if (currentWeek <= 27) currentQuarter = 'Q3';
        else currentQuarter = 'Q4';
      }
      weekLessonMap = {};
      continue;
    }

    // Detect subject row
    const subject = detectSubject(firstCol);
    if (!subject || currentWeek === 0) continue;

    // Extract 5-day pacing for this subject
    for (let i = 0; i < DAYS.length; i++) {
      const dayCol = cols[i + 1] || '';
      const normalized = normalizePacingEntry(dayCol);

      if (!normalized) continue;

      weekLessonMap[subject] = weekLessonMap[subject] || {};
      weekLessonMap[subject][DAYS[i]] = normalized;

      // Parse type and lesson_num
      let type: string | null = null;
      let lesson_num: string | null = null;

      if (normalized === '-' || normalized === 'No Class') {
        type = '-';
      } else if (normalized.toLowerCase().includes('test')) {
        type = 'Test';
        const numMatch = normalized.match(/\d+/);
        lesson_num = numMatch ? numMatch[0] : null;
      } else if (normalized.toLowerCase().includes('study guide')) {
        type = 'Study Guide';
        const numMatch = normalized.match(/\d+/);
        lesson_num = numMatch ? numMatch[0] : null;
      } else if (normalized.toLowerCase().includes('classroom practice')) {
        type = 'Classroom Practice';
        const numMatch = normalized.match(/\d+/);
        lesson_num = numMatch ? numMatch[0] : null;
      } else if (normalized.toLowerCase().includes('activity page')) {
        type = 'Activity Page';
        const numMatch = normalized.match(/\d+/);
        lesson_num = numMatch ? numMatch[0] : null;
      } else if (normalized.toLowerCase().includes('lesson')) {
        type = 'Lesson';
        const numMatch = normalized.match(/\d+/);
        lesson_num = numMatch ? numMatch[0] : null;
      } else if (normalized.toLowerCase().includes('chapter')) {
        type = 'Lesson';
        const numMatch = normalized.match(/chapter\s*(\d+)/i);
        lesson_num = numMatch ? numMatch[1] : null;
      } else if (/^\d+$/.test(normalized)) {
        type = 'Lesson';
        lesson_num = normalized;
      } else {
        type = 'Lesson';
        lesson_num = normalized;
      }

      cells.push({
        school_year: new Date().getFullYear() + '-' + (new Date().getFullYear() + 1),
        quarter: currentQuarter,
        week_num: currentWeek,
        subject,
        day: DAYS[i],
        type,
        lesson_num,
        in_class: null,
        at_home: null,
      });
    }
  }

  return cells;
}

/**
 * Fetch a Google Sheets CSV and parse it
 * Supports both public URLs and direct CSV exports
 */
export async function fetchGoogleSheetsPacing(
  csvUrl: string,
  schoolYear?: string
): Promise<MasterCell[]> {
  try {
    // Convert URL if needed (handle /export?format=csv)
    let url = csvUrl.trim();
    
    // If it's a regular Google Sheets URL, convert to CSV export
    if (url.includes('docs.google.com/spreadsheets') && !url.includes('/export')) {
      const sheetId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      const gid = url.match(/[#&]gid=([0-9]+)/)?.[1] || '0';
      if (sheetId) {
        url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      }
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const csvText = await response.text();
    let cells = parseCsvData(csvText);

    // Override school year if provided
    if (schoolYear) {
      cells = cells.map(c => ({ ...c, school_year: schoolYear }));
    }

    return cells;
  } catch (err) {
    console.error('Failed to fetch Google Sheets:', err);
    throw err;
  }
}

/**
 * Parse CSV text directly (useful for pasted data)
 */
export function parseGoogleSheetsCsv(csvText: string, schoolYear: string): MasterCell[] {
  const cells = parseCsvData(csvText);
  return cells.map(c => ({ ...c, school_year: schoolYear }));
}
