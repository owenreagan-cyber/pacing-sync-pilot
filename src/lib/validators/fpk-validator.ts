export type Severity = 'critical' | 'warning';
export interface ValidationIssue { severity: Severity; code: string; message: string; }
export interface ValidationResult { pass: boolean; issues: ValidationIssue[]; }

const REQUIRED_IDS = ['kl_wrapper_3','kl_custom_block_0','kl_custom_block_5',
  'kl_custom_block_3','kl_custom_block_4','kl_custom_block_6',
  'kl_custom_block_2','kl_custom_block_1','kl_banner'];

const ALLOWED_COURSE_IDS: Record<string, number[]> = {
  Math: [21957], Reading: [21919], Spelling: [21919],
  'Language Arts': [21944], History: [21934], Science: [21970], Homeroom: [22254],
};

export function validateFpkPage(html: string, subject: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const id of REQUIRED_IDS) {
    const n = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
    if (n === 0) issues.push({ severity: 'critical', code: 'MISSING_BLOCK', message: `"${id}" not found` });
    else if (n > 1) issues.push({ severity: 'critical', code: 'DUPLICATE_ID', message: `"${id}" appears ${n} times` });
  }
  const allowed = ALLOWED_COURSE_IDS[subject] || [];
  const leaked = [...new Set((html.match(/\/courses\/(\d+)\//g) || [])
    .map(m => parseInt(m.replace(/\D/g, '')))
    .filter(id => !allowed.includes(id))
  )];
  for (const id of leaked) {
    issues.push({ severity: 'critical', code: 'CROSS_COURSE_LEAK',
      message: `Course ${id} found in ${subject} page (not authorized)` });
  }
  const textContent = (() => {
    if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
      const doc = new window.DOMParser().parseFromString(html, 'text/html');
      return doc.body.textContent || '';
    }
    return html.split('<').map((segment) => {
      const close = segment.indexOf('>');
      return close >= 0 ? segment.slice(close + 1) : segment;
    }).join('');
  })();
  if (textContent.replace(/&nbsp;|\s/g, '').length < 30)
    issues.push({ severity: 'critical', code: 'EMPTY_PAGE', message: 'Page appears empty' });
  return { pass: issues.filter(i => i.severity === 'critical').length === 0, issues };
}
