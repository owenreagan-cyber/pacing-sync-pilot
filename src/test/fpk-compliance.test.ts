import { describe, expect, it, vi } from 'vitest';
import { generateCanvasPageHtml, type CanvasPageRow } from '@/lib/canvas-html';
import { validateFpkPage } from '@/lib/validators/fpk-validator';
import { generateAssignmentTitle } from '@/lib/assignment-logic';
import { getReadingFluencyTarget } from '@/lib/announcement-templates';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'missing' } }),
    }),
  },
}));

describe('FPK compliance', () => {
  const rows: CanvasPageRow[] = [
    { day: 'Monday', type: null, lesson_num: '1', in_class: 'Lesson 1', at_home: 'HW 1', canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Math', resources: null },
    { day: 'Tuesday', type: null, lesson_num: '2', in_class: 'Lesson 2', at_home: 'HW 2', canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Math', resources: null },
    { day: 'Wednesday', type: null, lesson_num: '3', in_class: 'Lesson 3', at_home: 'HW 3', canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Math', resources: null },
    { day: 'Thursday', type: null, lesson_num: '4', in_class: 'Lesson 4', at_home: 'HW 4', canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Math', resources: null },
    { day: 'Friday', type: null, lesson_num: '5', in_class: 'Lesson 5', at_home: null, canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Math', resources: null },
  ];

  function buildHtml() {
    return generateCanvasPageHtml({
      subject: 'Math',
      rows,
      quarter: 'Q1',
      weekNum: 1,
      dateRange: 'Sept 1-5',
      subjectReminder: 'Bring folders',
      subjectResources: [],
      quarterColor: '#0065a7',
    });
  }

  it('generateCanvasPageHtml produces all required block IDs exactly once', () => {
    const html = buildHtml();
    const required = ['kl_wrapper_3', 'kl_custom_block_0', 'kl_custom_block_5', 'kl_custom_block_3', 'kl_custom_block_4', 'kl_custom_block_6', 'kl_custom_block_2', 'kl_custom_block_1', 'kl_banner'];
    for (const id of required) {
      expect((html.match(new RegExp(`id="${id}"`, 'g')) || []).length).toBe(1);
    }
  });

  it('Friday block is kl_custom_block_1 (not kl_custom_block_7)', () => {
    const html = buildHtml();
    expect(html).toContain('id="kl_custom_block_1"');
    expect(html).not.toContain('id="kl_custom_block_7"');
    expect(html).toContain('id="kl_custom_block_1" class="">\n    <h3');
    expect(html).toContain('Friday');
  });

  it('has no kl_custom_block_1 outer wrapper and keeps resources as sibling of reminders', () => {
    const html = buildHtml();
    const remindersIndex = html.indexOf('id="kl_custom_block_0"');
    const resourcesIndex = html.indexOf('id="kl_custom_block_5"');
    const fridayIndex = html.indexOf('id="kl_custom_block_1"');
    expect(remindersIndex).toBeGreaterThan(-1);
    expect(resourcesIndex).toBeGreaterThan(remindersIndex);
    expect(fridayIndex).toBeGreaterThan(resourcesIndex);
  });

  it('detects cross-course leakage', () => {
    const html = `
      <div id="kl_wrapper_3">
        <div id="kl_banner"></div>
        <div id="kl_custom_block_0"></div>
        <div id="kl_custom_block_5"></div>
        <div id="kl_custom_block_3"><a href="https://thalesacademy.instructure.com/courses/99999/assignments/1">bad</a></div>
        <div id="kl_custom_block_4"></div>
        <div id="kl_custom_block_6"></div>
        <div id="kl_custom_block_2"></div>
        <div id="kl_custom_block_1">Enough visible text to avoid empty page validation errors in this test.</div>
      </div>
    `;
    const result = validateFpkPage(html, 'Math');
    expect(result.pass).toBe(false);
    expect(result.issues.some((i) => i.code === 'CROSS_COURSE_LEAK')).toBe(true);
  });

  it('fails validation for worst-case malformed HTML', () => {
    const malformedHtml = `
      <div id="kl_banner"></div>
      <div id="kl_custom_block_0">
        <div id="kl_custom_block_3">
          <a href="https://thalesacademy.instructure.com/courses/99999/assignments/1">bad</a>
        </div>
      </div>
      <div id="kl_custom_block_5"></div>
      <div id="kl_custom_block_4"></div>
      <div id="kl_custom_block_6"></div>
      <div id="kl_custom_block_2"></div>
      <div id="kl_custom_block_1">Enough visible text to avoid empty page validation errors in this test.</div>
    `;
    const result = validateFpkPage(malformedHtml, 'Math');
    expect(result.pass).toBe(false);
    expect(
      result.issues.some(
        (i) => i.severity === 'critical' && (i.code === 'MISSING_BLOCK' || i.code === 'WRONG_NESTING'),
      ),
    ).toBe(true);
  });

  it("LA CP title is 'ELA4: 4A - Shurley English Classroom Practice 52'", () => {
    expect(generateAssignmentTitle('Language Arts', 'CP', '52', 'ELA4:')).toBe('ELA4: 4A - Shurley English Classroom Practice 52');
  });

  it("Config fallback prefix for Math is 'SM5:' with colon", async () => {
    const { loadConfig } = await import('@/lib/config');
    const config = await loadConfig();
    expect(config.assignmentPrefixes.Math).toBe('SM5:');
  });

  it('renders Reading pages as combined Reading and Spelling daily blocks', () => {
    const html = generateCanvasPageHtml({
      subject: 'Reading & Spelling',
      rows: [
        { day: 'Monday', type: null, lesson_num: '11', in_class: 'Reading Lesson 11', at_home: null, canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Reading', resources: null },
        { day: 'Monday', type: null, lesson_num: '11', in_class: 'Spelling Lesson 11', at_home: null, canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Spelling', resources: null },
      ],
      quarter: 'Q1',
      weekNum: 1,
      dateRange: 'Sept 1-5',
      subjectReminder: '',
      subjectResources: [],
      quarterColor: '#0065a7',
    });

    expect(html).toContain('<div id="kl_custom_block_3" class="">');
    expect(html).toContain('<p><strong>Reading:</strong> Reading Lesson 11</p>');
    expect(html).toContain('<p><strong>Spelling:</strong> Spelling Lesson 11</p>');
    expect(html).not.toContain('<strong>In Class</strong>');
    expect(html).not.toContain('<strong>At Home</strong>');
  });

  it('falls back to contentMap for missing daily Spelling content on Reading pages', () => {
    const html = generateCanvasPageHtml({
      subject: 'Reading',
      rows: [
        { day: 'Monday', type: null, lesson_num: '12', in_class: 'Reading Lesson 12', at_home: null, canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Reading', resources: null },
      ],
      quarter: 'Q1',
      weekNum: 1,
      dateRange: 'Sept 1-5',
      subjectReminder: '',
      subjectResources: [],
      quarterColor: '#0065a7',
      contentMap: [
        { subject: 'Spelling', lesson_ref: 'Spelling Lesson 12', canonical_name: 'Spelling Lesson 12', canvas_url: 'https://x/courses/1/files/sp12' },
      ],
    });

    expect(html).toContain('<p><strong>Reading:</strong> Reading Lesson 12</p>');
    expect(html).toContain('<p><strong>Spelling:</strong> <a href="https://x/courses/1/files/sp12"');
    expect(html).toContain('Spelling Lesson 12</a></p>');
  });

  it('keeps non-Reading subjects on the existing isolated layout', () => {
    const html = buildHtml();

    expect(html).toContain('<strong>In Class</strong>');
    expect(html).toContain('<strong>Homework</strong>');
    expect(html).not.toContain('<p><strong>Reading:</strong>');
    expect(html).not.toContain('<p><strong>Spelling:</strong>');
  });

  describe('Reading + Spelling combined page', () => {
    it('adds Reading and Spelling labels in the in-class content when both subjects are present on the same day', () => {
      const html = generateCanvasPageHtml({
        subject: 'Reading & Spelling',
        rows: [
          { day: 'Monday', type: null, lesson_num: '11', in_class: 'Reading Lesson 11', at_home: null, canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Reading', resources: null },
          { day: 'Monday', type: null, lesson_num: '11', in_class: 'Spelling Lesson 11', at_home: null, canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Spelling', resources: null },
        ],
        quarter: 'Q1',
        weekNum: 1,
        dateRange: 'Sept 1-5',
        subjectReminder: '',
        subjectResources: [],
        quarterColor: '#0065a7',
      });

      expect(html).toContain('<p><strong>Reading:</strong> Reading Lesson 11</p>');
      expect(html).toContain('<p><strong>Spelling:</strong> Spelling Lesson 11</p>');
    });

    it('adds a friendly weekend homework message for Friday combined pages', () => {
      const html = generateCanvasPageHtml({
        subject: 'Reading & Spelling',
        rows: [
          { day: 'Friday', type: null, lesson_num: '12', in_class: 'Reading Lesson 12', at_home: null, canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Reading', resources: null },
          { day: 'Friday', type: null, lesson_num: '12', in_class: 'Spelling Lesson 12', at_home: null, canvas_url: null, canvas_assignment_id: null, object_id: null, subject: 'Spelling', resources: null },
        ],
        quarter: 'Q1',
        weekNum: 1,
        dateRange: 'Sept 1-5',
        subjectReminder: '',
        subjectResources: [],
        quarterColor: '#0065a7',
      });

      expect(html).toContain('No homework over the weekend');
    });

    it('returns 130 wpm fluency target for reading tests 11 and higher', () => {
      expect(getReadingFluencyTarget(11).wpm).toBe(130);
      expect(getReadingFluencyTarget(18).wpm).toBe(130);
      expect(getReadingFluencyTarget('14').wpm).toBe(130);
    });
  });
});
