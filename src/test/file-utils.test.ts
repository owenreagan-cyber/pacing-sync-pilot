import { describe, it, expect } from 'vitest';
import {
  formatBatchProgress,
  parseBatchProgress,
  paginate,
  totalPages,
  groupByStatus,
  isAlreadyFormattedDisplayName,
  BATCH_MODE_THRESHOLD,
  PAGE_SIZE,
  BATCH_SIZE,
} from '../lib/file-utils';

describe('file-utils', () => {
  describe('parseBatchProgress', () => {
    it('parses a job row into progress', () => {
      const job = {
        files_processed: 23,
        files_total: 200,
        batch_cursor: '2026-05-01T00:00:00Z',
        status: 'running',
      };
      const result = parseBatchProgress(job);
      expect(result.filesProcessed).toBe(23);
      expect(result.filesTotal).toBe(200);
      expect(result.cursor).toBe('2026-05-01T00:00:00Z');
      expect(result.status).toBe('running');
    });

    it('handles null/undefined job gracefully', () => {
      const result = parseBatchProgress(null);
      expect(result.filesProcessed).toBe(0);
      expect(result.filesTotal).toBe(0);
      expect(result.cursor).toBeNull();
      expect(result.status).toBe('idle');
    });
  });

  describe('formatBatchProgress', () => {
    it('formats progress with percentage', () => {
      const result = formatBatchProgress({ filesProcessed: 23, filesTotal: 200, cursor: null, status: 'running' });
      expect(result).toBe('23/200 analyzed (12% complete)');
    });

    it('returns a message when no files to process', () => {
      const result = formatBatchProgress({ filesProcessed: 0, filesTotal: 0, cursor: null, status: 'idle' });
      expect(result).toBe('No files to process');
    });

    it('shows 100% when all done', () => {
      const result = formatBatchProgress({ filesProcessed: 50, filesTotal: 50, cursor: null, status: 'success' });
      expect(result).toBe('50/50 analyzed (100% complete)');
    });
  });

  describe('paginate', () => {
    const items = Array.from({ length: 55 }, (_, i) => i + 1);

    it('returns first page', () => {
      const page = paginate(items, 1, 10);
      expect(page).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('returns last partial page', () => {
      const page = paginate(items, 6, 10);
      expect(page).toEqual([51, 52, 53, 54, 55]);
    });

    it('returns empty array for out-of-range page', () => {
      const page = paginate(items, 10, 10);
      expect(page).toEqual([]);
    });
  });

  describe('totalPages', () => {
    it('computes correct page count', () => {
      expect(totalPages(55, 10)).toBe(6);
      expect(totalPages(50, 10)).toBe(5);
      expect(totalPages(0, 10)).toBe(1);
      expect(totalPages(1, 10)).toBe(1);
    });
  });

  describe('groupByStatus', () => {
    it('groups files by status', () => {
      const files = [
        { canvas_file_id: '1', status: 'PENDING' },
        { canvas_file_id: '2', status: 'PENDING' },
        { canvas_file_id: '3', status: 'APPROVED' },
      ];
      const groups = groupByStatus(files);
      expect(groups['PENDING']).toHaveLength(2);
      expect(groups['APPROVED']).toHaveLength(1);
    });

    it('handles empty array', () => {
      const groups = groupByStatus([]);
      expect(Object.keys(groups)).toHaveLength(0);
    });
  });

  describe('constants', () => {
    it('has correct values', () => {
      expect(BATCH_MODE_THRESHOLD).toBe(50);
      expect(PAGE_SIZE).toBe(10);
      expect(BATCH_SIZE).toBe(25);
    });
  });

  describe('isAlreadyFormattedDisplayName', () => {
    it('returns true when name has spaces and no underscores', () => {
      expect(isAlreadyFormattedDisplayName('Saxon Math Lesson 66.pdf')).toBe(true);
    });

    it('returns false when name has underscores', () => {
      expect(isAlreadyFormattedDisplayName('Saxon_Math_Lesson_66.pdf')).toBe(false);
    });

    it('returns false when name has no spaces', () => {
      expect(isAlreadyFormattedDisplayName('SaxonMathLesson66.pdf')).toBe(false);
    });
  });
});
