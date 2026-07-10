/**
 * Public barrel for the pacing library.
 *
 * Single import surface for consumers that reason about pacing rows —
 * the entry page, the page builder, the assignment builder, the wizard
 * step contracts, and edge-function-facing helpers. See .lovable/plan.md
 * Part 3 for the redesign these files belong to.
 */

export {
  SUBJECTS,
  DAYS,
  SUBJECT_TYPES,
  emptyDay,
  initWeekData,
} from './types';
export type { Subject, Day, DayData, WeekData } from './types';

export {
  LA_ASSIGNABLE_TYPES,
  isLanguageArtsAssignable,
  computeRule,
} from './rules';
export type { RuleInput, RuleOutput } from './rules';

export {
  buildInClass,
  buildAtHome,
  buildResourceRefs,
  buildAllResourceRefs,
} from './derive';

export {
  assignmentPlan,
  pageModel,
  announcementPlan,
  resourceCoverage,
} from './select';
export type {
  PacingRowLike,
  AssignmentPlanItem,
  AnnouncementPlanItem,
  ResourceCoverageItem,
} from './select';
