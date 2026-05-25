// Canvas Audit Validator - applies Thales OS canonical rules to raw audit JSON
// and returns a flat findings array.

export type Severity = 'ERROR' | 'WARN' | 'INFO';

export interface Finding {
  severity: Severity;
  course: string;
  category: 'page' | 'assignment' | 'structure';
  rule: string;
  expected: string;
  actual: string;
  field?: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const GROUP_RULES: Record<string, string> = {
  'Math:Lesson': 'Homework/Class Work',
  'Math:Test': 'Written Assessments',
  'Math:Fact Test': 'Fact Assessments',
  'Math:Study Guide': 'Homework/Class Work',
  'Reading:Lesson': 'Homework',
  'Reading:Test': 'Assessments',
  'Reading:Checkout': 'Check Out',
  'Spelling:Test': 'Assessments',
  'Language Arts:CP': 'Classwork/Homework',
  'Language Arts:Test': 'Assessments',
};

const PREFIX: Record<string, string> = {
  Math: 'SM5:',
  Reading: 'RM4:',
  Spelling: 'RM4:',
  'Language Arts': 'ELA4:',
};

function classifyAssignment(course: string, name: string): string | null {
  const n = name || '';
  if (course === 'Math') {
    if (/Fact Test/i.test(n)) return 'Fact Test';
    if (/Study Guide/i.test(n)) return 'Study Guide';
    if (/Test/i.test(n)) return 'Test';
    if (/Lesson\s+\d+/i.test(n)) return 'Lesson';
  }
  if (course === 'Reading') {
    if (/Spelling Test/i.test(n)) return null; // spelling handled separately
    if (/Checkout/i.test(n)) return 'Checkout';
    if (/Reading Test/i.test(n)) return 'Test';
    if (/Reading HW/i.test(n)) return 'Lesson';
  }
  if (course === 'Language Arts') {
    if (/Shurley Test/i.test(n)) return 'Test';
    if (/Classroom Practice/i.test(n)) return 'CP';
  }
  return null;
}

export function validateAudit(audit: any): Finding[] {
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  for (const [courseName, c] of Object.entries<any>(audit.courses || {})) {
    const page = c.page;

    // ======= PAGE RULES =======
    if (page) {
      // 1. published
      if (page.published === false) {
        push({
          severity: 'ERROR',
          course: courseName,
          category: 'page',
          rule: 'Page must be published',
          expected: 'true',
          actual: 'false',
          field: 'page.published',
        });
      }

      // 2. all 5 day blocks
      for (const d of page.missing_days || []) {
        push({
          severity: 'ERROR',
          course: courseName,
          category: 'page',
          rule: 'Page must contain all 5 day blocks',
          expected: `${d} block`,
          actual: 'missing',
          field: `page.day_blocks.${d}`,
        });
      }

      const isWeeklyContent = ['Math', 'Reading', 'Language Arts'].includes(courseName);
      if (isWeeklyContent) {
        // 3. Reminders
        if (!page.has_reminders_section) {
          push({
            severity: 'WARN',
            course: courseName,
            category: 'page',
            rule: 'Reminders section required',
            expected: '<h2>Reminders</h2>',
            actual: 'missing',
          });
        }
        // 4. Resources
        if (!page.has_resources_section) {
          push({
            severity: 'WARN',
            course: courseName,
            category: 'page',
            rule: 'Resources section required',
            expected: '<h2>Resources</h2>',
            actual: 'missing',
          });
        }
        // 8. Prefix
        const expectedPrefix = PREFIX[courseName];
        if (expectedPrefix && !page.body.includes(expectedPrefix)) {
          push({
            severity: 'WARN',
            course: courseName,
            category: 'page',
            rule: 'Subject prefix expected in page body',
            expected: expectedPrefix,
            actual: page.prefix_found,
          });
        }
      }

      // 5. History/Science no At Home
      if (['History', 'Science'].includes(courseName) && page.has_at_home_sections > 0) {
        push({
          severity: 'ERROR',
          course: courseName,
          category: 'page',
          rule: 'History/Science must NOT have At Home sections',
          expected: '0',
          actual: String(page.has_at_home_sections),
        });
      }

      // 6. Friday no At Home
      if (page.at_home_text_per_day?.Friday) {
        push({
          severity: 'ERROR',
          course: courseName,
          category: 'page',
          rule: 'Friday must not have At Home',
          expected: 'no Friday At Home',
          actual: 'present',
        });
      }

      // 7. Reading must have both labels in In Class blocks
      if (courseName === 'Reading') {
        const allInClass = Object.values(page.in_class_text_per_day || {}).join(' ');
        const hasCompanionLabel = /Spelling:/i.test(allInClass) || /Novel Study:/i.test(allInClass);
        if (!/Reading:/i.test(allInClass) || !hasCompanionLabel) {
          push({
            severity: 'WARN',
            course: courseName,
            category: 'page',
            rule: 'Reading page must label Reading: and Spelling:/Novel Study: in In Class',
            expected: 'Reading plus companion label present',
            actual: allInClass.slice(0, 120),
          });
        }
      }

      // 9. updated_at within 7 days
      if (page.updated_at) {
        const ageDays = (Date.now() - new Date(page.updated_at).getTime()) / 86400000;
        if (ageDays > 7) {
          push({
            severity: 'WARN',
            course: courseName,
            category: 'page',
            rule: 'Page updated within 7 days',
            expected: '< 7 days',
            actual: `${ageDays.toFixed(1)} days`,
          });
        }
      }
    } else {
      push({
        severity: 'ERROR',
        course: courseName,
        category: 'page',
        rule: 'Page exists for week',
        expected: 'page found',
        actual: 'missing',
      });
    }

    // ======= ASSIGNMENT RULES =======
    const assigns: any[] = c.assignments || [];

    // 21. History/Science zero assignments
    if (['History', 'Science'].includes(courseName) && assigns.length > 0) {
      push({
        severity: 'ERROR',
        course: courseName,
        category: 'assignment',
        rule: 'History/Science must have no assignments',
        expected: '0',
        actual: String(assigns.length),
      });
    }

    for (const a of assigns) {
      const kind = classifyAssignment(courseName, a.name);

      // 10. submission_types == ["on_paper"]
      const st = a.submission_types || [];
      if (!(st.length === 1 && st[0] === 'on_paper')) {
        push({
          severity: 'ERROR',
          course: courseName,
          category: 'assignment',
          rule: 'submission_types must be ["on_paper"]',
          expected: '["on_paper"]',
          actual: JSON.stringify(st),
          field: a.name,
        });
      }

      // 11/12/13. Study Guide rules
      if (kind === 'Study Guide') {
        if (a.grading_type !== 'pass_fail') {
          push({
            severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Study Guide grading_type must be pass_fail',
            expected: 'pass_fail', actual: String(a.grading_type), field: a.name,
          });
        }
        if (a.points_possible !== 0) {
          push({
            severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Study Guide points must be 0',
            expected: '0', actual: String(a.points_possible), field: a.name,
          });
        }
        if (!a.omit_from_final_grade) {
          push({
            severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Study Guide omit_from_final_grade must be true',
            expected: 'true', actual: String(a.omit_from_final_grade), field: a.name,
          });
        }
      } else {
        // grading_type intentionally not validated — `percent` is allowed
        // alongside `points` for this school. Do not flag.
        if (a.points_possible !== 100) {
          push({
            severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'points_possible must be 100',
            expected: '100', actual: String(a.points_possible), field: a.name,
          });
        }
      }

      // 14. due_at hour 23:59 ET
      if (a.due_at) {
        const due = new Date(a.due_at);
        // ET: UTC -5 (EST) or -4 (EDT). 23:59 ET = 03:59 or 04:59 UTC next day.
        const utcH = due.getUTCHours();
        const utcM = due.getUTCMinutes();
        const ok = (utcH === 3 || utcH === 4) && utcM === 59;
        if (!ok) {
          push({
            severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'due_at must be 23:59 ET',
            expected: '23:59 ET',
            actual: a.due_at, field: a.name,
          });
        }

        // 15. due_at not Friday unless Test
        const dayName = due.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
        if (dayName === 'Friday' && kind !== 'Test' && kind !== 'Fact Test') {
          push({
            severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Non-test assignments must not be due Friday',
            expected: 'Mon-Thu', actual: 'Friday', field: a.name,
          });
        }
      }

      // 16. Title prefix
      const expectedPrefix = PREFIX[courseName];
      if (expectedPrefix && !a.name?.startsWith(expectedPrefix)) {
        // Spelling lives in Reading course - check by prefix expectation
        push({
          severity: 'ERROR', course: courseName, category: 'assignment',
          rule: 'Title must use subject prefix',
          expected: expectedPrefix, actual: a.name, field: a.name,
        });
      }

      // 17. Group name canonical
      if (kind) {
        const isSpelling = courseName === 'Reading' && /Spelling/i.test(a.name);
        const groupKey = isSpelling ? 'Spelling:Test' : `${courseName}:${kind}`;
        const expectedGroup = GROUP_RULES[groupKey];
        if (expectedGroup && a.assignment_group_name !== expectedGroup) {
          push({
            severity: 'ERROR', course: courseName, category: 'assignment',
            rule: `Assignment group must be canonical for ${groupKey}`,
            expected: expectedGroup,
            actual: a.assignment_group_name || 'null',
            field: a.name,
          });
        }
      }

      // 23-30. Title format checks
      if (courseName === 'Math') {
        if (kind === 'Lesson' && !/^SM5:\s+Lesson\s+\d+\s+(Evens|Odds)$/.test(a.name)) {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Math lesson title format', expected: 'SM5: Lesson N Evens|Odds',
            actual: a.name, field: a.name });
        }
        if (kind === 'Test' && !/^SM5:\s+Lesson\s+\d+\s+Test$/.test(a.name)) {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Math test title format', expected: 'SM5: Lesson N Test',
            actual: a.name, field: a.name });
        }
      }
      if (courseName === 'Reading') {
        if (kind === 'Lesson' && !/^RM4:\s+Reading HW\s+\d+/.test(a.name)) {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Reading HW title format', expected: 'RM4: Reading HW N',
            actual: a.name, field: a.name });
        }
        if (kind === 'Test' && !/^RM4:\s+Reading Test\s+\d+/.test(a.name)) {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Reading Test title format', expected: 'RM4: Reading Test N',
            actual: a.name, field: a.name });
        }
        if (kind === 'Checkout' && !/^RM4:\s+Checkout\s+\d+/.test(a.name)) {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Checkout title format', expected: 'RM4: Checkout N',
            actual: a.name, field: a.name });
        }
        if (/Spelling Test/i.test(a.name) && !/^RM4:\s+Spelling Test\s+\d+/.test(a.name)) {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Spelling Test title format', expected: 'RM4: Spelling Test N',
            actual: a.name, field: a.name });
        }
      }
      if (courseName === 'Language Arts') {
        if (kind === 'CP' && !/^ELA4:\s+4A - Shurley English Classroom Practice\s+\d+/.test(a.name)) {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'ELA CP title format',
            expected: 'ELA4: 4A - Shurley English Classroom Practice N',
            actual: a.name, field: a.name });
        }
        if (kind === 'Test' && a.name !== 'ELA4: Shurley Test') {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'ELA test title format', expected: 'ELA4: Shurley Test',
            actual: a.name, field: a.name });
        }
        // 22. ELA non-CP non-Test should not exist
        if (kind === null) {
          push({ severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'ELA must only have CP or Test assignments',
            expected: 'CP or Test', actual: a.name, field: a.name });
        }
      }
    }

    // 18. Math test week: 3 assignments
    if (courseName === 'Math') {
      const mathTestPresent = assigns.some((a) => /Test/i.test(a.name) && !/Fact/i.test(a.name));
      if (mathTestPresent) {
        const factPresent = assigns.some((a) => /Fact Test/i.test(a.name));
        const sgPresent = assigns.some((a) => /Study Guide/i.test(a.name));
        if (!factPresent || !sgPresent || assigns.length < 3) {
          push({
            severity: 'ERROR', course: courseName, category: 'structure',
            rule: 'Math test week must include Test + Fact Test + Study Guide',
            expected: '3 assignments',
            actual: `${assigns.length} (test:${mathTestPresent} fact:${factPresent} sg:${sgPresent})`,
          });
        }
      }
    }

    // 19. Reading test week must have Checkout
    if (courseName === 'Reading') {
      const readingTest = assigns.some((a) => /Reading Test/i.test(a.name));
      if (readingTest) {
        const checkout = assigns.some((a) => /Checkout/i.test(a.name));
        if (!checkout) {
          push({
            severity: 'ERROR', course: courseName, category: 'structure',
            rule: 'Reading test week must include Checkout',
            expected: 'Checkout assignment present',
            actual: 'missing',
          });
        }
      }

      // 20. Spelling assignments must only be Tests
      for (const a of assigns) {
        if (/Spelling/i.test(a.name) && !/Spelling Test/i.test(a.name)) {
          push({
            severity: 'ERROR', course: courseName, category: 'assignment',
            rule: 'Spelling rows must only create Test assignments',
            expected: 'Spelling Test only', actual: a.name, field: a.name,
          });
        }
      }
    }

    // 31-34. Content rules
    if (page) {
      if (courseName === 'Math') {
        for (const day of DAYS) {
          const ah = page.at_home_text_per_day?.[day];
          if (ah && day !== 'Friday') {
            // Look for assignment URL in raw body day block (approximation)
            const hasLink = page.assignment_links_found?.length > 0;
            if (!hasLink) {
              push({
                severity: 'WARN', course: courseName, category: 'page',
                rule: 'Math At Home should link to assignment',
                expected: 'assignment URL present',
                actual: 'no link found',
                field: day,
              });
            }
            break;
          }
        }
      }
      if (courseName === 'Reading') {
        const allAH = Object.values(page.at_home_text_per_day || {}).join(' ');
        if (allAH && !/Workbook and Comprehension/i.test(allAH)) {
          push({
            severity: 'WARN', course: courseName, category: 'page',
            rule: 'Reading At Home should mention "Workbook and Comprehension"',
            expected: 'phrase present', actual: 'missing',
          });
        }
        // 33. Spelling first, Reading second per day
        for (const [day, txt] of Object.entries<string>(page.at_home_text_per_day || {})) {
          const sIdx = txt.search(/Spelling/i);
          const rIdx = txt.search(/Reading/i);
          if (sIdx >= 0 && rIdx >= 0 && sIdx > rIdx) {
            push({
              severity: 'WARN', course: courseName, category: 'page',
              rule: 'At Home order: Spelling first, Reading second',
              expected: 'Spelling before Reading',
              actual: 'Reading appears first',
              field: day,
            });
          }
        }
      }
      // 34. Test reminders
      if (['Math', 'Reading', 'Language Arts'].includes(courseName)) {
        const hasTest = assigns.some((a) => /Test/i.test(a.name));
        if (hasTest && !/test/i.test(page.reminder_text || '')) {
          push({
            severity: 'WARN', course: courseName, category: 'page',
            rule: 'Test weeks must mention test in Reminders',
            expected: '"test" in reminders',
            actual: 'missing',
          });
        }
      }
    }
  }

  return findings;
}

export function summarize(findings: Finding[]) {
  const errors = findings.filter((f) => f.severity === 'ERROR').length;
  const warnings = findings.filter((f) => f.severity === 'WARN').length;
  const info = findings.filter((f) => f.severity === 'INFO').length;
  const health = Math.max(0, 100 - errors * 5 - warnings * 2);
  return { errors, warnings, info, health };
}
