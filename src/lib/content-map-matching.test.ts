import { describe, expect, it } from 'vitest';
import { matchMultipleResources } from './content-map-matching';
import { generateCanvasPageHtml } from './canvas-html';
import type { ContentMapEntry } from './auto-link';

const contentMap: ContentMapEntry[] = [
  { subject: 'Math', lesson_ref: 'Math_StudyGuide_23_Blank', canonical_name: 'Study Guide 23 Blank', canvas_url: 'https://x/courses/1/files/sg23b' },
  { subject: 'Math', lesson_ref: 'Math_StudyGuide_23_Completed', canonical_name: 'Study Guide 23 Key', canvas_url: 'https://x/courses/1/files/sg23k' },
  { subject: 'Math', lesson_ref: 'Math_PowerUp_E', canonical_name: 'Power Up E', canvas_url: 'https://x/courses/1/files/pue' },
  { subject: 'Math', lesson_ref: 'Math_Textbook', canonical_name: 'Math Textbook', canvas_url: 'https://x/courses/1/files/tb' },
  { subject: 'Math', lesson_ref: 'Math_Lesson_023', canonical_name: 'Lesson 23 Textbook', canvas_url: 'https://x/courses/1/files/l23' },
  { subject: 'Math', lesson_ref: 'Math_Reteaching_L021', canonical_name: 'Reteaching 21-30', canvas_url: 'https://x/courses/1/files/rt' },
  { subject: 'Math', lesson_ref: 'Math_Mastery_023', canonical_name: 'Mastery Worksheet 23', canvas_url: 'https://x/courses/1/files/ws' },
];

describe('matchMultipleResources', () => {
  it('returns grouped resources for math lessons', () => {
    const groups = matchMultipleResources(contentMap, 'Math', '23');
    const categories = groups.map((g) => g.category);
    expect(categories).toContain('study_guide');
    expect(categories).toContain('power_up');
    expect(categories).toContain('textbook');
    expect(categories).toContain('reteaching');
    expect(categories).toContain('worksheet');
    expect(groups.find((g) => g.category === 'study_guide')?.resources.length).toBe(2);
  });
});

describe('generateCanvasPageHtml resource grouping', () => {
  it('renders only Saxon Math Textbook and Lesson Odds links for Math', () => {
    const html = generateCanvasPageHtml({
      subject: 'Math',
      rows: [
        {
          day: 'Monday',
          type: 'Lesson',
          lesson_num: '117',
          in_class: 'Lesson 117',
          at_home: '',
          canvas_url: 'https://x/courses/1/assignments/117',
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Math',
          resources: null,
        },
        {
          day: 'Tuesday',
          type: 'Lesson',
          lesson_num: '23',
          in_class: 'Lesson 23',
          at_home: '',
          canvas_url: null,
          canvas_assignment_id: null,
          object_id: null,
          subject: 'Math',
          resources: null,
        },
      ],
      quarter: 'Q4',
      weekNum: 5,
      dateRange: '2026-01-01 – 2026-01-05',
      subjectReminder: '',
      subjectResources: [{
        label: 'Packet',
        url: ['https://x/courses/1/files/a', 'https://x/courses/1/files/b'] as unknown as string,
      }],
      quarterColor: '#0065a7',
      contentMap,
    });
    // Only Saxon Math Textbook and Lesson 117 Odds should appear in the resources block
    expect(html).toContain('Saxon Math Textbook');
    expect(html).toContain('Lesson 117 Odds');
    // Power Ups, Study Guides, and subjectResources Packet must not appear
    expect(html).not.toContain('<strong>Study Guides:</strong>');
    expect(html).not.toContain('Study Guide 23 Blank');
    expect(html).not.toContain('<strong>Power Ups:</strong>');
    expect(html).not.toContain('Packet 1');
    expect(html).not.toContain('Packet 2');
    // Lesson 23 has no canvas_url so no Odds link for it
    expect(html).not.toContain('Lesson 23 Odds');
  });

  it('injects math study guide links into reminders when a test row exists', () => {
    const mathStudyGuideMap: ContentMapEntry[] = [
      {
        subject: 'Math',
        lesson_ref: 'Math_StudyGuide_23_Blank',
        canonical_name: 'M_SG_23_Blank.pdf',
        canvas_url: 'https://x/courses/1/files/M_SG_23_Blank.pdf',
      },
      {
        subject: 'Math',
        lesson_ref: 'Math_StudyGuide_23_Completed',
        canonical_name: 'M_SG_23_Completed.pdf',
        canvas_url: 'https://x/courses/1/files/M_SG_23_%20Completed%20.pdf',
      },
      {
        subject: 'Math',
        lesson_ref: 'Math_StudyGuide_24_Completed',
        canonical_name: 'M_SG_24_Completed.pdf',
        canvas_url: 'https://x/courses/1/files/M_SG_24_%20Completed%20.pdf',
      },
    ];

    const html = generateCanvasPageHtml({
      subject: 'Math',
      rows: [{
        day: 'Thursday',
        type: 'Test',
        lesson_num: '23',
        in_class: 'Unit Test',
        at_home: '',
        canvas_url: null,
        canvas_assignment_id: null,
        object_id: null,
        subject: 'Math',
        resources: null,
      }],
      quarter: 'Q4',
      weekNum: 5,
      dateRange: '2026-01-01 – 2026-01-05',
      subjectReminder: 'Bring calculator',
      subjectResources: [],
      quarterColor: '#0065a7',
      contentMap: mathStudyGuideMap,
    });

    expect(html).toContain('<ul>');
    expect(html).toContain('<li><a href="https://x/courses/1/files/M_SG_23_Blank.pdf">M_SG_23_Blank.pdf</a> - Blank</li>');
    expect(html).toContain('<li><a href="https://x/courses/1/files/M_SG_23_%20Completed%20.pdf">M_SG_23_Completed.pdf</a> - Answers</li>');
    expect(html).not.toContain('M_SG_24_Completed.pdf</a> - Answers');
  });
});
