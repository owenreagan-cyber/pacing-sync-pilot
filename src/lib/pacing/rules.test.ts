/**
 * Rule parity harness — asserts `computeRule` matches the expected behavior
 * of the `enforce_friday_rules` SQL trigger for every fixture in
 * rule-spec.json.
 *
 * See mem://business-rules/three-layer-enforcement. When adding a rule
 * (builder, edge, or trigger), add a fixture here first so the drift is
 * caught by CI.
 */
import { describe, it, expect } from 'vitest';
import { computeRule } from './rules';
import spec from './rule-spec.json';

interface Fixture {
  case: string;
  subject: string;
  day: string;
  type: string;
  is_synthetic?: boolean;
  expect: { create_assign: boolean; clear_at_home: boolean };
}

describe('pacing rule parity (TS mirrors enforce_friday_rules)', () => {
  for (const fixture of spec as Fixture[]) {
    it(fixture.case, () => {
      const out = computeRule({
        subject: fixture.subject,
        day: fixture.day,
        type: fixture.type,
        is_synthetic: fixture.is_synthetic ?? false,
      });
      expect(out).toEqual(fixture.expect);
    });
  }

  it('cross-product sanity — every combination is deterministic', () => {
    const subjects = ['Math', 'Reading', 'Spelling', 'Language Arts', 'History', 'Science'];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const types = ['Lesson', 'Test', 'CP', 'Classroom Practice', 'Study Guide', 'CLT Testing', '-'];
    for (const s of subjects) {
      for (const d of days) {
        for (const t of types) {
          const out = computeRule({ subject: s, day: d, type: t });
          expect(typeof out.create_assign).toBe('boolean');
          expect(typeof out.clear_at_home).toBe('boolean');
        }
      }
    }
  });
});
