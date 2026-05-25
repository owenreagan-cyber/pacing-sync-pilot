import { describe, expect, it } from 'vitest';
import { shouldExcludeResource } from './canvas-html';

describe('shouldExcludeResource', () => {
  it('excludes Reading workbook lesson PDFs', () => {
    expect(shouldExcludeResource('Reading Workbook Lesson 086.pdf')).toBe(true);
  });

  it('excludes Spelling workbook lesson PDFs', () => {
    expect(shouldExcludeResource('Spelling Workbook Lesson 086.pdf')).toBe(true);
  });

  it('does not exclude workbook part resources', () => {
    expect(shouldExcludeResource('Reading Workbook Part 1.pdf')).toBe(false);
    expect(shouldExcludeResource('Reading Workbook Part 2.pdf')).toBe(false);
  });
});
