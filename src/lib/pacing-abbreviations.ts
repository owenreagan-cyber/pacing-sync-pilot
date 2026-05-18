/**
 * Master Pacing Abbreviation & Normalization Engine
 * 
 * Automatically expands shorthand notation found in pacing guides:
 * - "L 45" → "Lesson 45"
 * - "CP 2" → "Classroom Practice 2"
 * - "AP 4" → "Activity Page 4"
 * - "12.2" → "Chapter 12, Lesson 2"
 * - "Ch2" → "Chapter 2"
 * - Removes page numbers: "Lesson 45, page 12" → "Lesson 45"
 * 
 * Used by:
 * - Google Sheets import parser
 * - Pacing entry validation
 * - All display renderers throughout the dashboard
 */

/**
 * Abbreviation mapping for common pacing shorthand
 */
const ABBREVIATION_MAP: Record<string, string> = {
  'L': 'Lesson',
  'l': 'Lesson',
  'CP': 'Classroom Practice',
  'cp': 'Classroom Practice',
  'AP': 'Activity Page',
  'ap': 'Activity Page',
  'SG': 'Study Guide',
  'sg': 'Study Guide',
  'T': 'Test',
  't': 'Test',
  'Ch': 'Chapter',
  'ch': 'Chapter',
  'Chap': 'Chapter',
  'chap': 'Chapter',
};

/**
 * Normalize a single pacing entry by expanding abbreviations and removing extraneous info
 * 
 * Examples:
 * - "L 45" → "Lesson 45"
 * - "CP 2, page 15" → "Classroom Practice 2"
 * - "12.2" → "Chapter 12, Lesson 2" (for LA)
 * - "Ch2" → "Chapter 2"
 * - "-" → "-"
 * - "" → ""
 * - "No Class" → "No Class"
 * - "Review" → "Review"
 */
export function normalizePacingEntry(input: string | null | undefined): string {
  if (!input) return '';

  let text = String(input).trim();
  if (!text || text === '-') return text;

  // Remove page number references: ", page X", " page X", ", p. X", etc.
  text = text.replace(/,?\s*(?:page|p\.?)\s*\d+/gi, '');

  // Handle special cases first
  if (text.toLowerCase() === 'no class') return 'No Class';
  if (text.toLowerCase() === 'test') return 'Test';
  if (text.toLowerCase() === 'review') return 'Review';
  if (text.toLowerCase() === '-') return '-';

  // Match abbreviation at start with optional spaces/punctuation
  // Patterns:
  // - "L 45" or "L45"
  // - "CP 2" or "CP2"
  // - "12.2" (chapter.lesson for LA)
  // - "Ch2" or "Ch 2" or "Chapter 2"

  // Pattern 1: "L 45" or "L45" (Lesson)
  const lessonMatch = text.match(/^L\s*(\d+)\s*$/i);
  if (lessonMatch) {
    return `Lesson ${lessonMatch[1]}`;
  }

  // Pattern 2: "CP 2" or "CP2" (Classroom Practice)
  const cpMatch = text.match(/^CP\s*(\d+)\s*$/i);
  if (cpMatch) {
    return `Classroom Practice ${cpMatch[1]}`;
  }

  // Pattern 3: "AP 4" or "AP4" (Activity Page)
  const apMatch = text.match(/^AP\s*(\d+)\s*$/i);
  if (apMatch) {
    return `Activity Page ${apMatch[1]}`;
  }

  // Pattern 4: "SG 5" or "SG5" (Study Guide)
  const sgMatch = text.match(/^SG\s*(\d+)\s*$/i);
  if (sgMatch) {
    return `Study Guide ${sgMatch[1]}`;
  }

  // Pattern 5: "12.2" → "Chapter 12, Lesson 2"
  const dotMatch = text.match(/^(\d+)\.(\d+)$/);
  if (dotMatch) {
    return `Chapter ${dotMatch[1]}, Lesson ${dotMatch[2]}`;
  }

  // Pattern 6: "Ch2" or "Ch 2" or "Chapter 2"
  const chMatch = text.match(/^Ch(?:apter)?\s*(\d+)\s*$/i);
  if (chMatch) {
    return `Chapter ${chMatch[1]}`;
  }

  // Pattern 7: "T 5" or "Test 5"
  const testMatch = text.match(/^T(?:est)?\s*(\d+)\s*$/i);
  if (testMatch) {
    return `Test ${testMatch[1]}`;
  }

  // Pattern 8: "Fact Test" or "FT"
  if (text.toLowerCase().includes('fact test') || text.toUpperCase() === 'FT') {
    return 'Fact Test';
  }

  // Pattern 9: "Study Guide" or "SG" (covered above but as fallback)
  if (text.toLowerCase().includes('study guide')) {
    const numMatch = text.match(/\d+/);
    return numMatch ? `Study Guide ${numMatch[0]}` : 'Study Guide';
  }

  // Pattern 10: "Checkout" or "Fluency Check" (Reading)
  if (text.toLowerCase().includes('checkout') || text.toLowerCase().includes('fluency')) {
    return 'Checkout';
  }

  // Pattern 11: Plain lesson number "45"
  if (/^\d+$/.test(text)) {
    return text; // Keep as-is, type will determine context
  }

  // Expand known abbreviations at the start
  for (const [abbr, full] of Object.entries(ABBREVIATION_MAP)) {
    const regex = new RegExp(`^${abbr}\\s+(.+)$`, 'i');
    const match = text.match(regex);
    if (match) {
      return `${full} ${match[1]}`;
    }
  }

  // If nothing matched, return trimmed version
  return text.trim();
}

/**
 * Extract the lesson/chapter number from a normalized or raw pacing entry
 * 
 * Examples:
 * - "Lesson 45" → "45"
 * - "Classroom Practice 2" → "2"
 * - "Chapter 12, Lesson 2" → "12"
 * - "Chapter 5" → "5"
 * - "45" → "45"
 */
export function extractLessonNumber(input: string | null | undefined): string | null {
  if (!input) return null;

  const text = String(input).trim();
  const match = text.match(/\d+/);
  return match ? match[0] : null;
}

/**
 * Expand a type label to its full form
 * 
 * Examples:
 * - "T" → "Test"
 * - "CP" → "Classroom Practice"
 * - "SG" → "Study Guide"
 */
export function expandType(type: string | null | undefined): string | null {
  if (!type) return null;

  const normalized = String(type).trim();

  if (normalized === '-' || normalized === 'No Class') return normalized;

  const map: Record<string, string> = {
    'L': 'Lesson',
    'CP': 'Classroom Practice',
    'AP': 'Activity Page',
    'SG': 'Study Guide',
    'T': 'Test',
    'FT': 'Fact Test',
    'Co': 'Checkout',
  };

  return map[normalized] || normalized;
}

/**
 * Build a display-friendly string for a pacing cell
 * 
 * Combines type and lesson number intelligently
 * Used when rendering pacing info throughout the dashboard
 * 
 * Examples:
 * - ("Lesson", "45") → "Lesson 45"
 * - ("Classroom Practice", "2") → "Classroom Practice 2"
 * - ("Test", "10") → "Test 10"
 * - ("", "45") → "45"
 * - (null, "45") → "45"
 */
export function buildDisplayText(type: string | null | undefined, lessonNum: string | null | undefined): string {
  const t = (type || '').trim();
  const n = (lessonNum || '').trim();

  if (!t && !n) return '';
  if (!t) return n;
  if (!n) return t;

  // Special cases
  if (t === '-' || t === 'No Class') return t;
  if (t === 'Review') return t;

  return `${t} ${n}`;
}

/**
 * Validate if a pacing entry is "operational" (not no-class, no-instruction, etc.)
 */
export function isOperationalPacingEntry(input: string | null | undefined): boolean {
  if (!input) return false;

  const normalized = normalizePacingEntry(input).toLowerCase();
  return !['no class', '-', ''].includes(normalized);
}
