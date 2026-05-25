import { describe, expect, it } from 'vitest';
import { generateCanvasPageHtml, shouldExcludeResource } from './canvas-html';

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

  it('renders smart-renamed shared Reading resources for combined pages', () => {
    const html = generateCanvasPageHtml({
      subject: 'Reading & Spelling',
      rows: [
        {
          day: 'Tuesday',
          type: 'Lesson',
          lesson_num: '138',
          in_class: 'Reading Lesson 138',
          at_home: null,
          canvas_url: null,
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Reading',
          resources: null,
        },
        {
          day: 'Tuesday',
          type: 'Lesson',
          lesson_num: null,
          in_class: 'Novel Study: Because of Winn Dixie: Chapters 1-2',
          at_home: null,
          canvas_url: null,
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Spelling',
          resources: null,
        },
      ],
      quarter: 'Q4',
      weekNum: 8,
      dateRange: 'May 25–May 29, 2026',
      subjectReminder: '',
      subjectResources: [],
      quarterColor: '#0065a7',
      contentMap: [
        { subject: 'Reading', lesson_ref: 'Reading_Glossary_A', canonical_name: 'Reading Glossary: Book A.pdf', canvas_url: 'https://x/courses/1/files/gl-a' },
        { subject: 'Reading', lesson_ref: 'Reading_Glossary_B', canonical_name: 'Reading Glossary: Book B.pdf', canvas_url: 'https://x/courses/1/files/gl-b' },
        { subject: 'Reading', lesson_ref: 'Reading_Glossary_C', canonical_name: 'Reading Glossary: Book C.pdf', canvas_url: 'https://x/courses/1/files/gl-c' },
        { subject: 'Reading', lesson_ref: 'Reading_Book_L001', canonical_name: 'Reading Book Lessons 1-25.pdf', canvas_url: 'https://x/courses/1/files/book-001' },
        { subject: 'Reading', lesson_ref: 'Reading_Book_L026', canonical_name: 'Reading Book Lessons 26-50.pdf', canvas_url: 'https://x/courses/1/files/book-026' },
        { subject: 'Reading', lesson_ref: 'Reading_Book_L051', canonical_name: 'Reading Book Lessons 51-77.pdf', canvas_url: 'https://x/courses/1/files/book-051' },
        { subject: 'Reading', lesson_ref: 'Reading_Book_L078', canonical_name: 'Reading Book Lessons 78-105.pdf', canvas_url: 'https://x/courses/1/files/book-078' },
        { subject: 'Reading', lesson_ref: 'Reading_Book_L106', canonical_name: 'Reading Book Lessons 106-140.pdf', canvas_url: 'https://x/courses/1/files/book-106' },
        { subject: 'Reading', lesson_ref: 'Reading_Workbook_Part1', canonical_name: 'Workbook Part 1.pdf', canvas_url: 'https://x/courses/1/files/wb-1' },
        { subject: 'Reading', lesson_ref: 'Reading_Workbook_Part2', canonical_name: 'Workbook Part 2.pdf', canvas_url: 'https://x/courses/1/files/wb-2' },
        { subject: 'Spelling', lesson_ref: 'Spelling_Master_List', canonical_name: 'Spelling Master Word List.pdf', canvas_url: 'https://x/courses/1/files/sp-master' },
      ],
    });

    expect(html).toContain('<strong>Textbooks:</strong>');
    expect(html).toContain('Glossary A');
    expect(html).toContain('Glossary B');
    expect(html).toContain('Glossary C');
    expect(html).toContain('Reading Textbook Lessons 1-25.pdf');
    expect(html).toContain('Reading Textbook Lessons 106-140.pdf');
    expect(html).toContain('<strong>Workbooks:</strong>');
    expect(html).toContain('R_WB_Part1_L001-077.pdf');
    expect(html).toContain('Workbook_Part2_L078-140.pdf');
    expect(html).toContain('<strong>Spelling Master List:</strong>');
    expect(html).toContain('Spelling Master Word List.pdf');
    expect(html).not.toContain('Reading Glossary: Book A.pdf');
  });

  it('renders Math homework fallback as a clickable canonical assignment link', () => {
    const html = generateCanvasPageHtml({
      subject: 'Math',
      rows: [
        {
          day: 'Monday',
          type: 'Lesson',
          lesson_num: '117',
          in_class: 'Lesson 117',
          at_home: null,
          canvas_url: 'https://x/courses/1/assignments/117',
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Math',
          resources: null,
        },
      ],
      quarter: 'Q4',
      weekNum: 7,
      dateRange: '2026-04-01 – 2026-04-05',
      subjectReminder: '',
      subjectResources: [],
      quarterColor: '#0065a7',
      contentMap: [],
    });

    expect(html).toContain('<h4 class="kl_solid_border" style="color: #ffffff; background-color: #333333; padding-left: 40px; border-width: 0px; width: 60%;"><strong>Homework</strong></h4>');
    expect(html).toContain('title="SM 5 Lesson 117 Odds" href="https://x/courses/1/assignments/117"');
  });

  it('builds assignment links from canvas_assignment_id when canvas_url is missing', () => {
    const html = generateCanvasPageHtml({
      subject: 'Reading & Spelling',
      rows: [
        {
          day: 'Monday',
          type: 'Lesson',
          lesson_num: '117',
          in_class: 'Reading Lesson 117',
          at_home: '',
          canvas_url: null,
          canvas_assignment_id: '9117',
          object_id: null,
          subject: 'Reading',
          resources: null,
        },
      ],
      quarter: 'Q4',
      weekNum: 7,
      dateRange: '2026-04-01 – 2026-04-05',
      subjectReminder: '',
      subjectResources: [],
      quarterColor: '#0065a7',
      contentMap: [],
    });

    expect(html).toContain('href="https://thalesacademy.instructure.com/courses/21919/assignments/9117"');
    expect(html).toContain('>RM 4 Lesson 117 Workbook and Comprehension Questions</a>');
  });
});
