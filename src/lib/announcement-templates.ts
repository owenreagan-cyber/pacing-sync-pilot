import { expandSpellingTest } from './together-logic';

const SUBJECT_HEX: Record<string, string> = {
  Math: '#ea580c',
  Reading: '#2563eb',
  Spelling: '#2563eb',
  'Language Arts': '#10b981',
};

function wrapper(subject: string, inner: string): string {
  const color = SUBJECT_HEX[subject] || '#475569';
  return `<div class="kl_wrapper" style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;border-top:6px solid ${color};padding:16px;background:#ffffff;">${inner}</div>`;
}

function banner(subject: string, title: string): string {
  const color = SUBJECT_HEX[subject] || '#475569';
  return `<div class="kl_banner" style="background:${color};color:#fff;padding:14px 18px;border-radius:6px;margin-bottom:16px;"><h2 style="margin:0;font-size:20px;">${title}</h2></div>`;
}

function linkPair(blankUrl?: string, answerKeyUrl?: string): string {
  const links: string[] = [];
  if (blankUrl) links.push(`<a href="${blankUrl}" style="color:#0f172a;font-weight:700;">Study Guide (Blank)</a>`);
  if (answerKeyUrl) links.push(`<a href="${answerKeyUrl}" style="color:#0f172a;font-weight:700;">Study Guide (Answer Key)</a>`);
  if (links.length === 0) return '';
  return `<p><strong>Study Links:</strong> ${links.join(' &nbsp;|&nbsp; ')}</p>`;
}

export interface MathTestContext {
  lesson: string;
  day: string;
  powerUp?: string;
  factCount?: number;
  factTestLabel?: string;
  blankStudyGuideUrl?: string;
  answerKeyUrl?: string;
  reminderTone?: 'early' | 'urgent';
  teacherName?: string;
}

export interface ReadingTestContext {
  lessonNum?: string | null;
  readingTestPhrases: string[];
  fluencyGoalWpm?: number;
  fluencyMaxErrors?: number;
  checkoutLesson?: string;
  blankStudyGuideUrl?: string;
  answerKeyUrl?: string;
  teacherName?: string;
}

export interface SpellingTestContext {
  testNum: number;
  wordBank: Record<string, string[]>;
  challengeSentence?: string;
  teacherName?: string;
}

export interface LanguageArtsChapterTestContext {
  chapterLabel: string;
  testDay?: string;
  blankStudyGuideUrl?: string;
  answerKeyUrl?: string;
  teacherName?: string;
}

export interface CombinedTestContext {
  reading?: ReadingTestContext;
  spelling?: SpellingTestContext;
  weekLabel?: string;
}

/**
 * Returns the fluency target (wpm and maxErrors) for a given Reading test number.
 * Tests 1–7:  100 wpm, 2 errors  (Early Program)
 * Tests 8–10: 115 wpm, 2 errors  (Mid Program)
 * Tests 11+:  130 wpm, 2 errors  (Advanced Program)
 * Falls back to 100 wpm for invalid / out-of-range values.
 */
export function getReadingFluencyTarget(testNum: string | number | null | undefined): { wpm: number; maxErrors: number } {
  const n = typeof testNum === 'string' ? parseInt(testNum, 10) : (testNum ?? NaN);
  if (!Number.isFinite(n) || n < 1) return { wpm: 100, maxErrors: 2 };
  if (n <= 7)  return { wpm: 100, maxErrors: 2 };
  if (n <= 10) return { wpm: 115, maxErrors: 2 };
  return { wpm: 130, maxErrors: 2 };
}

export function renderMathTestBody(ctx: MathTestContext): string {
  const toneLine = ctx.reminderTone === 'urgent'
    ? `<p><strong>Quick reminder:</strong> our Math assessment is coming up very soon.</p>`
    : `<p>Good afternoon, families! I wanted to send a warm heads-up about our upcoming Math assessment.</p>`;
  const factCount = ctx.factCount ?? 40;
  const factLabel = ctx.factTestLabel || `${factCount} Division facts`;

  return wrapper('Math', `
    ${banner('Math', `Math Test — Lesson ${ctx.lesson}`)}
    ${toneLine}
    <p>Students will test on <strong>Lesson ${ctx.lesson}</strong> on <strong>${ctx.day}</strong>.</p>
    <ul>
      <li><strong>Power Up focus:</strong> ${ctx.powerUp || 'Review all recent Power Up skills'}</li>
      <li><strong>Fact focus:</strong> ${factLabel}</li>
    </ul>
    ${linkPair(ctx.blankStudyGuideUrl, ctx.answerKeyUrl)}
    <p>Please have your child complete the blank guide first, then check with the answer key.</p>
    <p>Thank you for your support at home!<br/>${ctx.teacherName || 'Owen Reagan'}</p>
  `);
}

export function renderReadingTestBody(ctx: ReadingTestContext): string {
  const lessonLine = ctx.lessonNum
    ? `<p>We are preparing for <strong>Reading Mastery Test ${ctx.lessonNum}</strong>.</p>`
    : `<p>We are preparing for our Reading Mastery test this week.</p>`;
  const phrases = ctx.readingTestPhrases.length
    ? ctx.readingTestPhrases
    : ['tracking and tapping', 'fluency and comprehension'];
  const phraseList = phrases.map((p) => `<strong>${p}</strong>`).join(', ');
  const wpm = ctx.fluencyGoalWpm ?? 130;
  const maxErrors = ctx.fluencyMaxErrors ?? 2;

  return wrapper('Reading', `
    ${banner('Reading', `Reading Mastery Test ${ctx.lessonNum || ''}`.trim())}
    <p>Hi parents, I hope your week is going well!</p>
    ${lessonLine}
    <p>Students will be assessed on ${phraseList}.</p>
    <p><strong>Fluency goal:</strong> ${wpm} words per minute with ${maxErrors} or fewer errors.</p>
    <p>Please practice nightly with your child and have them track each timed read in a fluency log (date, words read, errors).</p>
    <p>The checkout passage will come from lesson <strong>${ctx.checkoutLesson || ctx.lessonNum || 'current reading lesson'}</strong>.</p>
    ${linkPair(ctx.blankStudyGuideUrl, ctx.answerKeyUrl)}
    <p>Thank you for partnering with me!<br/>${ctx.teacherName || 'Owen Reagan'}</p>
  `);
}

export function renderSpellingTestBody(ctx: SpellingTestContext): string {
  const exp = expandSpellingTest(ctx.testNum, ctx.wordBank);
  const focus = exp.focusWords.length
    ? exp.focusWords.join(', ')
    : '(focus words not yet in word bank)';
  const all = exp.allWords.length
    ? exp.allWords.join(', ')
    : '(word bank empty for these lessons)';
  const challengeSentence = ctx.challengeSentence
    || (exp.focusWords.length >= 2
      ? `Challenge sentence: "I can spell ${exp.focusWords[0]} and ${exp.focusWords[1]} correctly in my writing."`
      : 'Challenge sentence: "I can use my spelling words correctly in a complete sentence."');

  return wrapper('Spelling', `
    ${banner('Spelling', `Spelling Test ${exp.testNum}`)}
    <p>Hi families! We are getting ready for <strong>Spelling Test ${exp.testNum}</strong>.</p>
    <p><strong>Covered lessons:</strong> ${exp.coveredRangeLabel}</p>
    <p><strong>Focus words (21–25):</strong> ${focus}</p>
    <p><strong>Full word list:</strong> ${all}</p>
    <p><strong>${challengeSentence}</strong></p>
    <p>Keep practicing a little each night—you are doing great work!<br/>${ctx.teacherName || 'Owen Reagan'}</p>
  `);
}

export function renderLanguageArtsChapterTestBody(ctx: LanguageArtsChapterTestContext): string {
  return wrapper('Language Arts', `
    ${banner('Language Arts', `Language Arts Chapter Test — ${ctx.chapterLabel}`)}
    <p>Good afternoon! Our Language Arts class is preparing for a chapter test.</p>
    <p><strong>Chapter:</strong> ${ctx.chapterLabel}${ctx.testDay ? ` &nbsp;|&nbsp; <strong>Test day:</strong> ${ctx.testDay}` : ''}</p>
    <p>Please review class notes, vocabulary, and key skills from this chapter together.</p>
    ${linkPair(ctx.blankStudyGuideUrl, ctx.answerKeyUrl)}
    <p>Thank you for your support!<br/>${ctx.teacherName || 'Owen Reagan'}</p>
  `);
}

export function renderCombinedReadingSpellingBody(ctx: CombinedTestContext): string {
  const sections: string[] = [];
  if (ctx.weekLabel) sections.push(`<h3 style="margin-bottom:12px;">${ctx.weekLabel} — Reading &amp; Spelling Update</h3>`);
  if (ctx.reading) sections.push(renderReadingTestBody(ctx.reading));
  if (ctx.spelling) sections.push(renderSpellingTestBody(ctx.spelling));
  return sections.join('\n');
}

export function buildCombinedTitle(weekLabel?: string): string {
  return weekLabel ? `${weekLabel} — Reading & Spelling Tests` : 'Reading & Spelling Tests — Reminder';
}
