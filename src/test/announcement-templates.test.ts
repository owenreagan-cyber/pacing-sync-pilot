import { describe, expect, it } from 'vitest';
import {
  getReadingFluencyTarget,
  renderCombinedReadingSpellingBody,
  renderLanguageArtsChapterTestBody,
  renderMathTestBody,
  renderReadingTestBody,
  renderSpellingTestBody,
} from '@/lib/announcement-templates';

describe('announcement templates', () => {
  it('renders math test with warm teacher voice and dual study guide links', () => {
    const html = renderMathTestBody({
      lesson: '21',
      day: 'Friday',
      powerUp: 'Power Up 21',
      factCount: 40,
      blankStudyGuideUrl: 'https://example.com/blank',
      answerKeyUrl: 'https://example.com/key',
      reminderTone: 'early',
    });
    expect(html).toContain('Good afternoon, families');
    expect(html).toContain('40 Division facts');
    expect(html).toContain('Study Guide (Blank)');
    expect(html).toContain('Study Guide (Completed)');
    expect(html).toContain('Owen Reagan');
  });

  it('renders math test with Power Up attachment explicitly mentioned', () => {
    const html = renderMathTestBody({
      lesson: '15',
      day: 'Thursday',
      powerUp: 'Power Up 15',
    });
    expect(html).toContain('Power Up');
    expect(html).toContain('Study Guide (Blank)');
    expect(html).toContain('Study Guide (Completed)');
    // Even without URLs the placeholders must be present
    expect(html).toContain('attached');
  });

  it('renders reading and spelling as a cohesive combined parent update', () => {
    const html = renderCombinedReadingSpellingBody({
      weekLabel: 'Q4 Wk 6',
      reading: {
        lessonNum: '13',
        readingTestPhrases: ['tracking and tapping'],
        checkoutLesson: '13',
      },
      spelling: {
        testNum: 5,
        wordBank: {
          '1': ['a', 'b', 'c', 'd', 'e'],
          '2': ['f', 'g', 'h', 'i', 'j'],
          '3': ['k', 'l', 'm', 'n', 'o'],
          '4': ['p', 'q', 'r', 's', 't'],
          '5': ['u', 'v', 'w', 'x', 'y'],
          '6': ['z'],
        },
      },
    });
    expect(html).toContain('Q4 Wk 6');
    expect(html).toContain('Fluency goal');
    expect(html).toContain('Error Guide');
    expect(html).toContain('Challenge sentence');
    expect(html).toContain('Focus words (21–25)');
  });

  it('renders reading and language arts templates with target details', () => {
    const readingHtml = renderReadingTestBody({
      lessonNum: '13',
      readingTestPhrases: [],
      fluencyGoalWpm: 130,
      fluencyMaxErrors: 2,
      checkoutLesson: '13',
      blankStudyGuideUrl: 'https://example.com/r-blank',
      answerKeyUrl: 'https://example.com/r-key',
    });
    const laHtml = renderLanguageArtsChapterTestBody({
      chapterLabel: 'Chapter 8',
      testDay: 'Thursday',
    });
    expect(readingHtml).toContain('130 words per minute');
    expect(readingHtml).toContain('Error Guide');
    expect(readingHtml).toContain('fluency log');
    expect(readingHtml).toContain('Study Guide (Blank)');
    expect(laHtml).toContain('Language Arts Chapter Test');
    expect(laHtml).toContain('Chapter 8');
  });

  it('renders spelling standalone announcement with focus words', () => {
    const html = renderSpellingTestBody({
      testNum: 5,
      wordBank: {
        '1': ['a', 'b', 'c', 'd', 'e'],
        '2': ['f', 'g', 'h', 'i', 'j'],
        '3': ['k', 'l', 'm', 'n', 'o'],
        '4': ['p', 'q', 'r', 's', 't'],
        '5': ['u', 'v', 'w', 'x', 'y'],
      },
    });
    expect(html).toContain('Focus words (21–25)');
    expect(html).toContain('u, v, w, x, y');
    expect(html).toContain('Challenge sentence');
  });

  it('renders reading announcement with checkout lesson derived from test number (test 4 → lesson 40)', () => {
    const html = renderReadingTestBody({
      lessonNum: '4',
      readingTestPhrases: [],
    });
    expect(html).toContain('Lesson 40');
    expect(html).toContain('read to the flower from <strong>Lesson 40</strong>');
    expect(html).toContain('Fluency goal');
    expect(html).toContain('Error Guide');
    expect(html).toContain('fluency log');
  });

  it('renders reading test 14 without any Fluency Checkout section', () => {
    const html = renderReadingTestBody({
      lessonNum: '14',
      readingTestPhrases: [],
    });
    expect(html).not.toContain('Fluency Checkout');
    expect(html).not.toContain('Fluency goal');
    expect(html).not.toContain('fluency log');
  });
});

describe('getReadingFluencyTarget', () => {
  it('returns 100 wpm for tests 1–7 (Early Program)', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(getReadingFluencyTarget(n)).toEqual({ wpm: 100, maxErrors: 2 });
      expect(getReadingFluencyTarget(String(n))).toEqual({ wpm: 100, maxErrors: 2 });
    }
  });

  it('returns 115 wpm for tests 8–10 (Mid Program)', () => {
    for (const n of [8, 9, 10]) {
      expect(getReadingFluencyTarget(n)).toEqual({ wpm: 115, maxErrors: 2 });
      expect(getReadingFluencyTarget(String(n))).toEqual({ wpm: 115, maxErrors: 2 });
    }
  });

  it('returns 130 wpm for tests 11–13 (Advanced Program)', () => {
    for (const n of [11, 12, 13]) {
      expect(getReadingFluencyTarget(n)).toEqual({ wpm: 130, maxErrors: 2 });
      expect(getReadingFluencyTarget(String(n))).toEqual({ wpm: 130, maxErrors: 2 });
    }
  });

  it('returns 130 wpm for out-of-range high values (safe default)', () => {
    expect(getReadingFluencyTarget(14)).toEqual({ wpm: 130, maxErrors: 2 });
    expect(getReadingFluencyTarget(20)).toEqual({ wpm: 130, maxErrors: 2 });
  });

  it('returns 100 wpm for invalid / edge inputs (safe default)', () => {
    expect(getReadingFluencyTarget(0)).toEqual({ wpm: 100, maxErrors: 2 });
    expect(getReadingFluencyTarget(-1)).toEqual({ wpm: 100, maxErrors: 2 });
    expect(getReadingFluencyTarget(null)).toEqual({ wpm: 100, maxErrors: 2 });
    expect(getReadingFluencyTarget(undefined)).toEqual({ wpm: 100, maxErrors: 2 });
    expect(getReadingFluencyTarget('abc')).toEqual({ wpm: 100, maxErrors: 2 });
  });

  it('renders reading announcement with correct fluency text per test tier', () => {
    const html5 = renderReadingTestBody({ lessonNum: '5', readingTestPhrases: [], fluencyGoalWpm: getReadingFluencyTarget(5).wpm, fluencyMaxErrors: 2 });
    expect(html5).toContain('100 words per minute');

    const html9 = renderReadingTestBody({ lessonNum: '9', readingTestPhrases: [], fluencyGoalWpm: getReadingFluencyTarget(9).wpm, fluencyMaxErrors: 2 });
    expect(html9).toContain('115 words per minute');

    const html12 = renderReadingTestBody({ lessonNum: '12', readingTestPhrases: [], fluencyGoalWpm: getReadingFluencyTarget(12).wpm, fluencyMaxErrors: 2 });
    expect(html12).toContain('130 words per minute');
  });
});
