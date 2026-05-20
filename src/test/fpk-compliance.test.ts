import { describe, it, expect } from 'vitest';
import { generateCanvasPageHtml, type CanvasPageRow } from '@/lib/canvas-html';
import { validateFpkPage } from '@/lib/validators/fpk-validator';
import { generateAssignmentTitle } from '@/lib/assignment-logic';

describe('FPK Compliance Tests', () => {
  describe('Canvas Page HTML Structure', () => {
    it('should generate HTML with all 9 required FPK blocks', () => {
      const rows: CanvasPageRow[] = [
        {
          day: 'Monday',
          type: null,
          lesson_num: '1',
          in_class: 'Saxon Math Lesson 1',
          at_home: 'Saxon Math Lesson 1 Odds',
          canvas_url: null,
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Math',
          resources: null,
        },
      ];

      const html = generateCanvasPageHtml({
        subject: 'Math',
        rows,
        quarter: 'Q1',
        weekNum: 1,
        dateRange: 'Sept 1–5',
        subjectReminder: 'Test Friday',
        subjectResources: [],
        quarterColor: '#0065a7',
      });

      const validation = validateFpkPage(html, 'Math');
      expect(validation.pass).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it('should include all 9 required block IDs', () => {
      const rows: CanvasPageRow[] = [
        {
          day: 'Monday',
          type: null,
          lesson_num: '5',
          in_class: 'Lesson 5',
          at_home: 'Homework',
          canvas_url: null,
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Math',
          resources: null,
        },
      ];

      const html = generateCanvasPageHtml({
        subject: 'Math',
        rows,
        quarter: 'Q1',
        weekNum: 1,
        dateRange: 'Sept 1–5',
        subjectReminder: '',
        subjectResources: [],
        quarterColor: '#0065a7',
      });

      expect(html).toContain('id="kl_wrapper_3"');
      expect(html).toContain('id="kl_banner"');
      expect(html).toContain('id="kl_custom_block_0"');
      expect(html).toContain('id="kl_custom_block_5"');
      expect(html).toContain('id="kl_custom_block_3"');
      expect(html).toContain('id="kl_custom_block_4"');
      expect(html).toContain('id="kl_custom_block_6"');
      expect(html).toContain('id="kl_custom_block_2"');
      expect(html).toContain('id="kl_custom_block_1"');
    });

    it('kl_custom_block_1 should be Friday (not a wrapper)', () => {
      const rows: CanvasPageRow[] = [
        {
          day: 'Friday',
          type: null,
          lesson_num: '5',
          in_class: 'Friday Activity',
          at_home: null, // Friday has no at_home
          canvas_url: null,
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Math',
          resources: null,
        },
      ];

      const html = generateCanvasPageHtml({
        subject: 'Math',
        rows,
        quarter: 'Q1',
        weekNum: 1,
        dateRange: 'Sept 1–5',
        subjectReminder: '',
        subjectResources: [],
        quarterColor: '#0065a7',
      });

      const fridayMatch = html.match(/id="kl_custom_block_1"[^>]*>([\s\S]*?)(<\/div>)/);
      expect(fridayMatch).toBeTruthy();
      if (fridayMatch) {
        const fridayContent = fridayMatch[1];
        expect(fridayContent).toContain('Friday');
        expect(fridayContent).not.toContain('kl_custom_block_5');
        expect(fridayContent).not.toContain('kl_custom_block_3');
      }
    });

    it('should fail validation on cross-course leakage', () => {
      const html = `
        <div id="kl_wrapper_3">
          <div id="kl_banner"><h2>Weekly Agenda</h2></div>
          <div id="kl_custom_block_0"><h3>Reminders</h3></div>
          <div id="kl_custom_block_5"><p>&nbsp;</p></div>
          <div id="kl_custom_block_3"><p><a href="https://thalesacademy.instructure.com/courses/99999/assignments/1">Bad Link</a></p></div>
          <div id="kl_custom_block_4"><p>Tuesday</p></div>
          <div id="kl_custom_block_6"><p>Wednesday</p></div>
          <div id="kl_custom_block_2"><p>Thursday</p></div>
          <div id="kl_custom_block_1"><p>Friday content here with lots of text to pass minimum length</p></div>
        </div>
      `;

      const validation = validateFpkPage(html, 'Math');
      expect(validation.pass).toBe(false);
      const crossCourseLeak = validation.issues.find(i => i.code === 'CROSS_COURSE_LEAK');
      expect(crossCourseLeak).toBeTruthy();
      expect(crossCourseLeak?.message).toContain('99999');
    });

    it('should allow valid course IDs for Math', () => {
      const html = `
        <div id="kl_wrapper_3">
          <div id="kl_banner"><h2>Weekly Agenda</h2></div>
          <div id="kl_custom_block_0"><h3>Reminders</h3></div>
          <div id="kl_custom_block_5"><p>&nbsp;</p></div>
          <div id="kl_custom_block_3"><p><a href="https://thalesacademy.instructure.com/courses/21957/assignments/1">Math Assignment</a></p></div>
          <div id="kl_custom_block_4"><p>Tuesday</p></div>
          <div id="kl_custom_block_6"><p>Wednesday</p></div>
          <div id="kl_custom_block_2"><p>Thursday</p></div>
          <div id="kl_custom_block_1"><p>Friday content here with lots of text to pass minimum length check</p></div>
        </div>
      `;

      const validation = validateFpkPage(html, 'Math');
      expect(validation.pass).toBe(true);
      expect(validation.issues.filter(i => i.code === 'CROSS_COURSE_LEAK')).toHaveLength(0);
    });

    it('should omit empty At Home sections', () => {
      const rows: CanvasPageRow[] = [
        {
          day: 'Monday',
          type: null,
          lesson_num: '1',
          in_class: 'Lesson 1',
          at_home: '', // Empty at_home should not render
          canvas_url: null,
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Math',
          resources: null,
        },
      ];

      const html = generateCanvasPageHtml({
        subject: 'Math',
        rows,
        quarter: 'Q1',
        weekNum: 1,
        dateRange: 'Sept 1–5',
        subjectReminder: '',
        subjectResources: [],
        quarterColor: '#0065a7',
      });

      const mondayMatch = html.match(/id="kl_custom_block_3"[^>]*>([\s\S]*?)(<\/div>)/);
      expect(mondayMatch).toBeTruthy();
      if (mondayMatch) {
        const mondayContent = mondayMatch[1];
        // Should have "In Class" but not "Homework" header
        expect(mondayContent).toContain('In Class');
        const homeworkCount = (mondayContent.match(/Homework/g) || []).length;
        expect(homeworkCount).toBe(0);
      }
    });

    it('should fail on empty page body (< 50 chars text)', () => {
      const html = `
        <div id="kl_wrapper_3">
          <div id="kl_banner"><h2>Weekly Agenda</h2></div>
          <div id="kl_custom_block_0"><h3>Reminders</h3></div>
          <div id="kl_custom_block_5"><p>&nbsp;</p></div>
          <div id="kl_custom_block_3"><p></p></div>
          <div id="kl_custom_block_4"><p></p></div>
          <div id="kl_custom_block_6"><p></p></div>
          <div id="kl_custom_block_2"><p></p></div>
          <div id="kl_custom_block_1"><p></p></div>
        </div>
      `;

      const validation = validateFpkPage(html, 'Math');
      expect(validation.pass).toBe(false);
      const emptyPage = validation.issues.find(i => i.code === 'EMPTY_PAGE');
      expect(emptyPage).toBeTruthy();
    });
  });

  describe('Assignment Title Generation', () => {
    it('generateAssignmentTitle: Math Odds', () => {
      const title = generateAssignmentTitle('Math', null, '115', 'SM5');
      expect(title).toBe('SM5 Lesson 115 Odds');
    });

    it('generateAssignmentTitle: Math Evens', () => {
      const title = generateAssignmentTitle('Math', null, '120', 'SM5');
      expect(title).toBe('SM5 Lesson 120 Evens');
    });

    it('generateAssignmentTitle: Math Test', () => {
      const title = generateAssignmentTitle('Math', 'Test', '42', 'SM5');
      expect(title).toBe('SM5 Lesson 42 Test');
    });

    it('generateAssignmentTitle: Math Fact Test', () => {
      const title = generateAssignmentTitle('Math', 'Fact Test', '50', 'SM5');
      expect(title).toBe('SM5 Lesson 50 Fact Test');
    });

    it('generateAssignmentTitle: Math Study Guide', () => {
      const title = generateAssignmentTitle('Math', 'Study Guide', '30', 'SM5');
      expect(title).toBe('SM5 Lesson 30 Study Guide');
    });

    it('generateAssignmentTitle: Math hint override evens', () => {
      const title = generateAssignmentTitle('Math', null, '115', 'SM5', 'evens');
      expect(title).toBe('SM5 Lesson 115 Evens');
    });

    it('generateAssignmentTitle: Math hint override none', () => {
      const title = generateAssignmentTitle('Math', null, '115', 'SM5', 'none');
      expect(title).toBe('SM5 Lesson 115');
    });

    it('generateAssignmentTitle: Reading HW', () => {
      const title = generateAssignmentTitle('Reading', null, '25', 'L');
      expect(title).toBe('L Reading HW 25');
    });

    it('generateAssignmentTitle: Reading Mastery Test', () => {
      const title = generateAssignmentTitle('Reading', 'Test', '8', 'L');
      expect(title).toBe('L Mastery Test 8');
    });

    it('generateAssignmentTitle: Spelling Test', () => {
      const title = generateAssignmentTitle('Spelling', 'Test', '15', 'SP');
      expect(title).toBe('SP Spelling Test 3');
    });

    it('generateAssignmentTitle: Spelling HW', () => {
      const title = generateAssignmentTitle('Spelling', null, '20', 'SP');
      expect(title).toBe('SP Spelling 20');
    });

    it('generateAssignmentTitle: Language Arts Shurley Test', () => {
      const title = generateAssignmentTitle('Language Arts', 'Test', '5', 'LA');
      expect(title).toBe('LA Shurley Test');
    });

    it('generateAssignmentTitle: Language Arts Classroom Practice', () => {
      const title = generateAssignmentTitle('Language Arts', 'CP', '12', 'LA');
      expect(title).toBe('LA Shurley English Classroom Practice 12');
    });

    it('generateAssignmentTitle: Language Arts English', () => {
      const title = generateAssignmentTitle('Language Arts', null, '8', 'LA');
      expect(title).toBe('LA English 8');
    });
  });
});
