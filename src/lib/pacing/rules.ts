/**
 * Client-side mirror of the assignment-creation rules enforced by the
 * `enforce_friday_rules` DB trigger and the canvas-deploy-assignment
 * edge function. See mem://business-rules/three-layer-enforcement —
 * these three sources must stay in sync.
 *
 * Extracted from PacingEntryPage.tsx (Step 1 refactor). Behavior
 * unchanged.
 */

export const LA_ASSIGNABLE_TYPES = new Set(['CP', 'Classroom Practice', 'Test']);

export function isLanguageArtsAssignable(type: string | null | undefined): boolean {
  return LA_ASSIGNABLE_TYPES.has(type ?? '');
}
