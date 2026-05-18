/**
 * Q4 Week 7 (May 18–22, 2026) — Preload Seed Data
 * TypeScript seed objects for pacing_rows table.
 * 
 * Week Configuration:
 * - Quarter: Q4
 * - Week Number: 7
 * - Date Range: May 18, 2026 – May 22, 2026 (Monday–Friday)
 * 
 * Rules Applied:
 * - Math Thursday: Test (Lesson 22) → Triple Logic: Written Test, Fact Test, Study Guide
 * - Language Arts: "How To Writing Unit" applied to all 5 days (Day 1–5)
 * - History: "Early Presidents" unit included in type/description
 * - Science: "No Class" all 5 days (redirects to History/Science logic)
 * - Friday: create_assign forced to false (except Tests), no at_home content
 * - All actionable assignments: create_assign = true
 */

export const Q4W7_WEEK_CONFIG = {
  quarter: 'Q4',
  week_num: 7,
  date_range: 'May 18, 2026 – May 22, 2026',
  reminders: null,
  resources: null,
};

/**
 * Core pacing_rows records (non-synthetic)
 * Synthetic rows (Fact Test, Study Guide from Math Triple Logic) are inserted separately.
 */
export const Q4W7_PACING_ROWS = [
  // ============ MATH ============
  {
    subject: 'Math',
    day: 'Monday',
    type: 'Lesson',
    lesson_num: '113',
    in_class: 'Lesson 113',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Math',
    day: 'Tuesday',
    type: 'Lesson',
    lesson_num: '114',
    in_class: 'Lesson 114',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Math',
    day: 'Wednesday',
    type: 'Lesson',
    lesson_num: '115',
    in_class: 'Lesson 115',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Math',
    day: 'Thursday',
    type: 'Test',
    lesson_num: '22',
    in_class: 'Math Test — Lesson 22',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
    // Triple Logic: Generates (1) Written Test same day, (2) Fact Test same day, (3) Study Guide day-before (clamp to Wed)
  },
  {
    subject: 'Math',
    day: 'Friday',
    type: 'Lesson',
    lesson_num: '116',
    in_class: 'Lesson 116',
    at_home: null,
    create_assign: false, // Friday: no homework
    is_synthetic: false,
  },

  // ============ READING ============
  {
    subject: 'Reading',
    day: 'Monday',
    type: 'Lesson',
    lesson_num: '133',
    in_class: 'Reading Lesson 133',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Reading',
    day: 'Tuesday',
    type: 'Lesson',
    lesson_num: '134',
    in_class: 'Reading Lesson 134',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Reading',
    day: 'Wednesday',
    type: 'Lesson',
    lesson_num: '135',
    in_class: 'Reading Lesson 135',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Reading',
    day: 'Thursday',
    type: 'Lesson',
    lesson_num: '136',
    in_class: 'Reading Lesson 136',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Reading',
    day: 'Friday',
    type: 'Lesson',
    lesson_num: '137',
    in_class: 'Reading Lesson 137',
    at_home: null,
    create_assign: false, // Friday: no homework
    is_synthetic: false,
  },

  // ============ SPELLING ============
  {
    subject: 'Spelling',
    day: 'Monday',
    type: 'Lesson',
    lesson_num: '116',
    in_class: 'Spelling Lesson 116',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Spelling',
    day: 'Tuesday',
    type: 'Lesson',
    lesson_num: '117',
    in_class: 'Spelling Lesson 117',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Spelling',
    day: 'Wednesday',
    type: 'Lesson',
    lesson_num: '118',
    in_class: 'Spelling Lesson 118',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Spelling',
    day: 'Thursday',
    type: 'Lesson',
    lesson_num: '119',
    in_class: 'Spelling Lesson 119',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Spelling',
    day: 'Friday',
    type: 'Test',
    lesson_num: '120',
    in_class: 'Spelling Test — Lesson 120',
    at_home: null,
    create_assign: true, // Exception: Tests on Friday create assignments
    is_synthetic: false,
  },

  // ============ LANGUAGE ARTS (How To Writing Unit) ============
  {
    subject: 'Language Arts',
    day: 'Monday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'How To Writing Unit — Day 1',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Language Arts',
    day: 'Tuesday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'How To Writing Unit — Day 2',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Language Arts',
    day: 'Wednesday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'How To Writing Unit — Day 3',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Language Arts',
    day: 'Thursday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'How To Writing Unit — Day 4',
    at_home: null,
    create_assign: true,
    is_synthetic: false,
  },
  {
    subject: 'Language Arts',
    day: 'Friday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'How To Writing Unit — Day 5',
    at_home: null,
    create_assign: false, // Friday: no homework
    is_synthetic: false,
  },

  // ============ HISTORY (Early Presidents Unit) ============
  {
    subject: 'History',
    day: 'Monday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'Early Presidents: Chapter 6',
    at_home: null,
    create_assign: false, // History: never deploy assignments (historyScienceNoAssign=true)
    is_synthetic: false,
  },
  {
    subject: 'History',
    day: 'Tuesday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'Early Presidents: Chapter 6',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },
  {
    subject: 'History',
    day: 'Wednesday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'Early Presidents: Chapter 7',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },
  {
    subject: 'History',
    day: 'Thursday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'Early Presidents: Chapter 7',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },
  {
    subject: 'History',
    day: 'Friday',
    type: 'Lesson',
    lesson_num: null,
    in_class: 'Early Presidents: Activity',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },

  // ============ SCIENCE (No Class — History Redirect) ============
  {
    subject: 'Science',
    day: 'Monday',
    type: 'No Class',
    lesson_num: null,
    in_class: 'No Class',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },
  {
    subject: 'Science',
    day: 'Tuesday',
    type: 'No Class',
    lesson_num: null,
    in_class: 'No Class',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },
  {
    subject: 'Science',
    day: 'Wednesday',
    type: 'No Class',
    lesson_num: null,
    in_class: 'No Class',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },
  {
    subject: 'Science',
    day: 'Thursday',
    type: 'No Class',
    lesson_num: null,
    in_class: 'No Class',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },
  {
    subject: 'Science',
    day: 'Friday',
    type: 'No Class',
    lesson_num: null,
    in_class: 'No Class',
    at_home: null,
    create_assign: false,
    is_synthetic: false,
  },
];

/**
 * Synthetic rows generated by Math Triple Logic (Test on Thursday Lesson 22)
 * These rows link to the Thursday Math Test via parent_row_id.
 * They bypass Friday + LA rules via the is_synthetic flag in the DB trigger.
 * 
 * In a real deployment:
 * - (1) Written Test — same day (Thursday)
 * - (2) Fact Test — same day (Thursday, synthetic)
 * - (3) Study Guide — day-before (Wednesday, synthetic, omit_from_final=true)
 * 
 * Note: parent_row_id will be populated after the main row is inserted.
 */
export const Q4W7_SYNTHETIC_ROWS = [
  // Fact Test (same day as Test — Thursday)
  {
    subject: 'Math',
    day: 'Thursday',
    type: 'Fact Test',
    lesson_num: '22',
    in_class: 'Math Fact Test — Lesson 22',
    at_home: null,
    create_assign: true,
    is_synthetic: true,
    parent_row_id: null, // Will be set to Thursday Math Test row id
  },
  // Study Guide (day-before Test — Wednesday)
  {
    subject: 'Math',
    day: 'Wednesday',
    type: 'Study Guide',
    lesson_num: '22',
    in_class: 'Study Guide — Lesson 22',
    at_home: null,
    create_assign: true,
    is_synthetic: true,
    parent_row_id: null, // Will be set to Thursday Math Test row id
  },
];

/**
 * SQL Insert Statements (Alternative Format)
 * 
 * If seeding via direct SQL instead of TypeScript ORM:
 * 
 * BEGIN;
 * 
 * -- Insert week record
 * INSERT INTO public.weeks (quarter, week_num, date_range, reminders, resources)
 * VALUES ('Q4', 7, 'May 18, 2026 – May 22, 2026', NULL, NULL)
 * ON CONFLICT (quarter, week_num) DO NOTHING
 * RETURNING id;
 * 
 * -- Insert 30 pacing_rows (non-synthetic) — note: replace {WEEK_ID} with actual week.id
 * INSERT INTO public.pacing_rows
 * (week_id, subject, day, type, lesson_num, in_class, at_home, create_assign, is_synthetic, deploy_status)
 * VALUES
 *   ('{WEEK_ID}', 'Math', 'Monday', 'Lesson', '113', 'Lesson 113', NULL, true, false, 'PENDING'),
 *   ('{WEEK_ID}', 'Math', 'Tuesday', 'Lesson', '114', 'Lesson 114', NULL, true, false, 'PENDING'),
 *   ... [truncated for brevity — see Q4W7_PACING_ROWS array above]
 * 
 * COMMIT;
 * 
 * -- Retrieve Thursday Math Test row id, then insert synthetic rows:
 * INSERT INTO public.pacing_rows
 * (week_id, subject, day, type, lesson_num, in_class, at_home, create_assign, is_synthetic, parent_row_id, deploy_status)
 * VALUES
 *   ('{WEEK_ID}', 'Math', 'Thursday', 'Fact Test', '22', 'Math Fact Test — Lesson 22', NULL, true, true, '{THURSDAY_TEST_ROW_ID}', 'PENDING'),
 *   ('{WEEK_ID}', 'Math', 'Wednesday', 'Study Guide', '22', 'Study Guide — Lesson 22', NULL, true, true, '{THURSDAY_TEST_ROW_ID}', 'PENDING');
 */

/**
 * Supabase Upsert Pattern (TypeScript)
 * 
 * import { supabase } from '@/integrations/supabase/client';
 * 
 * export async function seedQ4W7() {
 *   // 1. Upsert week
 *   const { data: week, error: weekErr } = await supabase
 *     .from('weeks')
 *     .upsert(Q4W7_WEEK_CONFIG, { onConflict: 'quarter,week_num' })
 *     .select('id')
 *     .single();
 * 
 *   if (weekErr || !week) throw new Error(`Week upsert failed: ${weekErr?.message}`);
 * 
 *   // 2. Prepare pacing rows with week_id
 *   const rows = Q4W7_PACING_ROWS.map(r => ({
 *     ...r,
 *     week_id: week.id,
 *     deploy_status: 'PENDING',
 *   }));
 * 
 *   // 3. Upsert main rows
 *   const { error: rowsErr } = await supabase
 *     .from('pacing_rows')
 *     .upsert(rows, { onConflict: 'week_id,subject,day' });
 * 
 *   if (rowsErr) throw new Error(`Rows upsert failed: ${rowsErr.message}`);
 * 
 *   // 4. Retrieve Thursday Math Test row for parent_row_id
 *   const { data: testRow } = await supabase
 *     .from('pacing_rows')
 *     .select('id')
 *     .eq('week_id', week.id)
 *     .eq('subject', 'Math')
 *     .eq('day', 'Thursday')
 *     .eq('type', 'Test')
 *     .single();
 * 
 *   if (!testRow) throw new Error('Thursday Math Test row not found');
 * 
 *   // 5. Insert synthetic rows with parent_row_id
 *   const syntheticRows = Q4W7_SYNTHETIC_ROWS.map(r => ({
 *     ...r,
 *     week_id: week.id,
 *     parent_row_id: testRow.id,
 *     deploy_status: 'PENDING',
 *   }));
 * 
 *   const { error: syntheticErr } = await supabase
 *     .from('pacing_rows')
 *     .insert(syntheticRows);
 * 
 *   if (syntheticErr) throw new Error(`Synthetic rows insert failed: ${syntheticErr.message}`);
 * 
 *   return { weekId: week.id, rowsUpserted: rows.length, syntheticRowsInserted: syntheticRows.length };
 * }
 */
