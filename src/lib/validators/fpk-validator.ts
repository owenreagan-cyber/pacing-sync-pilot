export type Severity = 'critical' | 'warning' | 'info';
export interface ValidationIssue { severity: Severity; code: string; message: string; }
export interface ValidationResult { pass: boolean; issues: ValidationIssue[]; }

const REQUIRED_BLOCKS = ['kl_wrapper_3', 'kl_custom_block_0', 'kl_custom_block_5', 'kl_custom_block_3', 'kl_custom_block_4', 'kl_custom_block_6', 'kl_custom_block_2', 'kl_custom_block_1', 'kl_banner'];
const COURSE_RESOURCE_MAP: Record<string, number[]> = { Math: [21957], Reading: [21919], Spelling: [21919], 'Language Arts': [21944], History: [21934], Science: [21970], Homeroom: [22254] };

export function validateFpkPage(html: string, subject: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  
  for (const blockId of REQUIRED_BLOCKS) {
    const count = (html.match(new RegExp(`id="${blockId}"`, 'g')) || []).length;
    if (count === 0) issues.push({ severity: 'critical', code: 'MISSING_BLOCK', message: `Missing ${blockId}` });
    else if (count > 1) issues.push({ severity: 'critical', code: 'DUPLICATE_BLOCK', message: `Duplicate ${blockId}` });
  }

  const block1Match = html.match(/id="kl_custom_block_1"[^>]*>([\s\S]*?)(?=<div id="kl_custom_block_(?!1)|<\/div>\s*<\/div>)/);
  if (block1Match && (block1Match[1].includes('kl_custom_block_5') || block1Match[1].includes('kl_custom_block_3'))) {
    issues.push({ severity: 'critical', code: 'WRONG_NESTING', message: 'kl_custom_block_1 is acting as a wrapper' });
  }

  const allowedCourseIds = COURSE_RESOURCE_MAP[subject] || [];
  const courseIdMatches = html.match(/\/courses\/(\d+)\//g) || [];
  const seenCourseIds = [...new Set(courseIdMatches.map(m => parseInt(m.match(/(\d+)/)![1])))];
  for (const id of seenCourseIds) {
    if (!allowedCourseIds.includes(id)) issues.push({ severity: 'critical', code: 'CROSS_COURSE_LEAK', message: `Unauthorized Course ID ${id}` });
  }

  const textContent = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
  if (textContent.length < 50) issues.push({ severity: 'critical', code: 'EMPTY_PAGE', message: 'Empty page body' });

  if (!html.includes('kl_custom_block_0') || html.match(/id="kl_custom_block_0"[^>]*>\s*<h3[^>]*>[^<]*<\/h3>\s*<\/div>/)) issues.push({ severity: 'warning', code: 'EMPTY_REMINDERS', message: 'Reminders empty' });
  if (html.match(/id="kl_custom_block_5"[^>]*>\s*<p>&nbsp;<\/p>\s*<\/div>/)) issues.push({ severity: 'warning', code: 'EMPTY_RESOURCES', message: 'Resources empty' });

  return { pass: issues.filter(i => i.severity === 'critical').length === 0, issues };
}
