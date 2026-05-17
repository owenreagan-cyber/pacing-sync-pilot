import { describe, expect, it } from 'vitest';
import {
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
    expect(html).toContain('Study Guide (Answer Key)');
    expect(html).toContain('Owen Reagan');
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
});
