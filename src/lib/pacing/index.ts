/**
 * Public barrel for the pacing library.
 *
 * The goal of this module is to be the single import surface for any
 * consumer that needs to reason about pacing rows — the entry page,
 * the page builder, the assignment builder, and (eventually) selectors
 * feeding the deployment wizard. See .lovable/plan.md Part 3 for the
 * broader refactor these files belong to.
 */

export {
  SUBJECTS,
  DAYS,
  SUBJECT_TYPES,
  emptyDay,
  initWeekData,
} from './types';
export type { Subject, Day, DayData, WeekData } from './types';

export { LA_ASSIGNABLE_TYPES, isLanguageArtsAssignable } from './rules';

export {
  buildInClass,
  buildAtHome,
  buildResourceRefs,
  buildAllResourceRefs,
} from './derive';
