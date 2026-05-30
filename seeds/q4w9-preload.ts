/**
 * Q4 Week 9 (Jun 1–5, 2026) — Preload Seed Data
 * Built from teacher-provided pacing table using Q4W6/Q4 conventions.
 */

export const Q4W9_WEEK_CONFIG = {
  quarter: 'Q4',
  week_num: 9,
  date_range: 'Jun 1, 2026 – Jun 5, 2026',
  reminders: null,
  resources: null,
};

export const Q4W9_PACING_ROWS = [
  // Math
  { subject: 'Math', day: 'Monday', type: 'Lesson', lesson_num: '120', in_class: 'Lesson 120', at_home: null, create_assign: true, is_synthetic: false },
  { subject: 'Math', day: 'Tuesday', type: 'Investigation', lesson_num: '12', in_class: 'Investigation 12 / Study Guide', at_home: null, create_assign: true, is_synthetic: false },
  { subject: 'Math', day: 'Wednesday', type: 'Test', lesson_num: '23', in_class: 'Math Test — Lesson 23', at_home: null, create_assign: true, is_synthetic: false },
  { subject: 'Math', day: 'Thursday', type: 'Lesson', lesson_num: null, in_class: 'Review', at_home: null, create_assign: true, is_synthetic: false },
  { subject: 'Math', day: 'Friday', type: 'Test', lesson_num: null, in_class: 'EOY Test', at_home: null, create_assign: true, is_synthetic: false },

  // Reading (Spelling class ended; reading novel lessons continue)
  { subject: 'Reading', day: 'Monday', type: 'Lesson', lesson_num: '5', in_class: 'NOVEL 5-7', at_home: null, create_assign: true, is_synthetic: false },
  { subject: 'Reading', day: 'Tuesday', type: 'Lesson', lesson_num: '8', in_class: 'NOVEL 8-10', at_home: null, create_assign: true, is_synthetic: false },
  { subject: 'Reading', day: 'Wednesday', type: 'Lesson', lesson_num: '11', in_class: 'NOVEL 11-12', at_home: null, create_assign: true, is_synthetic: false },
  { subject: 'Reading', day: 'Thursday', type: 'Lesson', lesson_num: '12', in_class: 'NOVEL 12-15', at_home: null, create_assign: true, is_synthetic: false },
  { subject: 'Reading', day: 'Friday', type: 'Lesson', lesson_num: '15', in_class: 'NOVEL 15-18', at_home: null, create_assign: false, is_synthetic: false },

  // Spelling ended
  { subject: 'Spelling', day: 'Monday', type: 'No Class', lesson_num: null, in_class: 'NOVEL', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Spelling', day: 'Tuesday', type: 'No Class', lesson_num: null, in_class: 'NOVEL', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Spelling', day: 'Wednesday', type: 'No Class', lesson_num: null, in_class: 'NOVEL', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Spelling', day: 'Thursday', type: 'No Class', lesson_num: null, in_class: 'NOVEL', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Spelling', day: 'Friday', type: 'No Class', lesson_num: null, in_class: 'NOVEL', at_home: null, create_assign: false, is_synthetic: false },

  // Language Arts (Shurley English)
  { subject: 'Language Arts', day: 'Monday', type: 'Lesson', lesson_num: null, in_class: 'How To Writing', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Language Arts', day: 'Tuesday', type: 'Lesson', lesson_num: null, in_class: 'How To Writing', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Language Arts', day: 'Wednesday', type: 'Lesson', lesson_num: null, in_class: 'Narrative w/ Dialogue', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Language Arts', day: 'Thursday', type: 'Lesson', lesson_num: null, in_class: 'Narrative w/ Dialogue', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Language Arts', day: 'Friday', type: 'Lesson', lesson_num: null, in_class: 'Narrative w/ Dialogue', at_home: null, create_assign: false, is_synthetic: false },

  // History
  { subject: 'History', day: 'Monday', type: 'Lesson', lesson_num: '9', in_class: 'CH 9', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'History', day: 'Tuesday', type: 'Lesson', lesson_num: '9', in_class: 'CH 9', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'History', day: 'Wednesday', type: 'Lesson', lesson_num: null, in_class: 'Review', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'History', day: 'Thursday', type: 'Test', lesson_num: null, in_class: 'Unit Test', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'History', day: 'Friday', type: 'Lesson', lesson_num: null, in_class: 'Activity', at_home: null, create_assign: false, is_synthetic: false },

  // Science
  { subject: 'Science', day: 'Monday', type: 'No Class', lesson_num: null, in_class: 'No Class', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Science', day: 'Tuesday', type: 'No Class', lesson_num: null, in_class: 'No Class', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Science', day: 'Wednesday', type: 'No Class', lesson_num: null, in_class: 'No Class', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Science', day: 'Thursday', type: 'No Class', lesson_num: null, in_class: 'No Class', at_home: null, create_assign: false, is_synthetic: false },
  { subject: 'Science', day: 'Friday', type: 'No Class', lesson_num: null, in_class: 'No Class', at_home: null, create_assign: false, is_synthetic: false },
];
