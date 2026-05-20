import { describe, expect, it, vi } from 'vitest';
import { generateCanvasPageHtml, type CanvasPageRow } from '@/lib/canvas-html';
import { validateFpkPage } from '@/lib/validators/fpk-validator';
import { generateAssignmentTitle } from '@/lib/assignment-logic';

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

  it("LA CP title is 'ELA4: Shurley English Classroom Practice 52'", () => {
    expect(generateAssignmentTitle('Language Arts', 'CP', '52', 'ELA4:')).toBe('ELA4: Shurley English Classroom Practice 52');
  });

  it("Config fallback prefix for Math is 'SM5:' with colon", async () => {
    const { loadConfig } = await import('@/lib/config');
    const config = await loadConfig();
    expect(config.assignmentPrefixes.Math).toBe('SM5:');
  });
});
