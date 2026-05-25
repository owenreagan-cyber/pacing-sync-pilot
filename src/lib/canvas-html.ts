/**
 * THALES OS — Canvas HTML Generator (KL / DesignPLUS template)
 */

import { injectFileLinks, injectAssignmentLink, type ContentMapEntry } from './auto-link';
import { COURSE_IDS, getCourseId } from './course-ids';
import { parseResources, type Resource } from '@/types/thales';
import type { CalendarEvent } from './school-calendar';
import { matchMultipleResources } from './content-map-matching';

const KL_WRAPPER = `id="kl_wrapper_3" class="kl_circle_left kl_wrapper" style="border-style: none;"`;
const KL_BANNER_H2 = `class="" style="color: #ffffff; background-color: #0065a7; text-align: center;"`;
const KL_BANNER_SPAN = `id="kl_banner_right" class="" style="color: #ffffff; background-color: #0065a7;"`;
const KL_SUBTITLE = `class="kl_subtitle"`;
const KL_REMINDERS_H3 = `class="" style="background-color: #c51062; color: #ffffff; border-color: #c51062;"`;
const KL_RESOURCES_H3 = `style="background-color: #00c0a5; color: #ffffff; border-color: #00c0a5;"`;
const KL_DAY_H3 = `class="" style="background-color: #0065a7; color: #ffffff; border-color: #0065a7;"`;
const KL_H4 = `class="kl_solid_border" style="color: #ffffff; background-color: #333333; padding-left: 40px; border-width: 0px; width: 60%;"`;
const KL_ICON_EXCLAIM = `<i class="fas fa-exclamation" aria-hidden="true"><span class="dp-icon-content" style="display: none;">&nbsp;</span></i>`;
const KL_ICON_QUESTION = `<i class="fas fa-question" aria-hidden="true"><span class="dp-icon-content" style="display: none;">&nbsp;</span></i>`;
const KL_ICON_SCHOOL = `<i class="fas fa-school" aria-hidden="true"><span class="dp-icon-content" style="display: none;">&nbsp;</span></i>`;

const DAY_BLOCK_IDS: Record<string, string> = {
  Monday:    'kl_custom_block_3',
  Tuesday:   'kl_custom_block_4',
  Wednesday: 'kl_custom_block_6',
  Thursday:  'kl_custom_block_2',
  Friday:    'kl_custom_block_1',
};

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export interface RedirectPageParams {
  thisSubject: 'History' | 'Science';
  activeSubject: 'History' | 'Science';
  weekNum: number;
  quarter: string;
  dateRange: string;
  quarterColor: string;
  reminderOverride?: string;
}

export interface CanvasPageRow {
  day: string;
  type: string | null;
  lesson_num: string | null;
  in_class: string | null;
  at_home: string | null;
  canvas_url: string | null;
  canvas_assignment_id: string | null;
  object_id: string | null;
  subject: string;
  resources: string | null;
}

export interface CanvasPageParams {
  subject: string;
  rows: CanvasPageRow[];
  quarter: string;
  weekNum: number;
  dateRange: string;
  subjectReminder: string;
  subjectResources: Resource[];
  quarterColor: string;
  contentMap?: ContentMapEntry[];
  calendarEvents?: CalendarEvent[];
  weekDates?: string[];
}

export interface ContactEntry {
  name: string;
  role: string;
  email: string;
}

export interface LinkEntry {
  label: string;
  url: string;
}

export interface HomeroomPageParams {
  weekNum: number;
  quarter: string;
  dateRange: string;
  quarterColor: string;
  calendarReminders: string;
  homeroomNotesHtml?: string;
  homeroomNotes?: string;
  birthdays?: string;
  schoolNews?: string;
  pointsOfContact?: ContactEntry[];
  quickLinks?: LinkEntry[];
  footer?: string;
}

export function stripLessonTitle(raw: string, _subject?: string): string {
  if (!raw) return '';
  const s = String(raw).trim();
  const unitChapter = s.match(
    /^(?:Science|History)\s+Unit:\s*([^.]+?)(?:\.{2,}|\s*\.\s|\s*,\s*)?\s*Chapter\s+(\d+)(?:\s*:\s*[^]*)?$/i,
  );
  if (unitChapter) {
    const unit = unitChapter[1].trim().replace(/[.\s]+$/, '');
    return `${unit}, Chapter ${unitChapter[2]}`;
  }
  const shurley = s.match(/Chapter\s+(\d+)\s*,\s*Lesson\s+(\d+)/i);
  if (shurley) return `Chapter ${shurley[1]}, Lesson ${shurley[2]}`;
  const saxon = s.match(/^Saxon\s+Math\s+(Lesson\s+\d+)/i);
  if (saxon) return saxon[1].replace(/\s+/g, ' ');
  const readingSpelling = s.match(/^([A-Za-z]+)\s+Lesson\s+(\d+)/);
  if (readingSpelling) return `${readingSpelling[1]} Lesson ${readingSpelling[2]}`;
  const bareLesson = s.match(/^(Lesson\s+\d+)/i);
  if (bareLesson) return bareLesson[1].replace(/\s+/g, ' ');
  const cut = s.split(/\s+[-–—]\s+|\.{2,}/)[0].trim();
  return cut || s;
}

function atHomeLabel(subject: string): string {
  return subject === 'Math' ? 'Homework' : 'At Home';
}

/**
 * Returns true for resource labels that should be suppressed from the UI:
 *   - "Reading Workbook Lesson NNN.pdf" / "Spelling Workbook Lesson NNN.pdf" (individual lesson pages)
 *   - R_SG_006.pdf, R_SG_007*, R_SG_008*, R_SG_009.pdf
 */
export function shouldExcludeResource(label: string): boolean {
  if (/(Reading|Spelling) Workbook Lesson \d{1,3}\.pdf/i.test(label)) return true;
  if (/^R_SG_006\.pdf$/i.test(label)) return true;
  if (/^R_SG_007/i.test(label)) return true;
  if (/^R_SG_008/i.test(label)) return true;
  if (/^R_SG_009\.pdf$/i.test(label)) return true;
  return false;
}

function renderResource(r: Resource & { url?: string | string[] }): string {
  const urls = Array.isArray(r.url) ? r.url.filter(Boolean) : (r.url ? [r.url] : []);
  if (urls.length === 0) return `    <p><strong>${r.label}</strong></p>`;
  return urls.map((rawUrl, index) => {
    const title = urls.length > 1 ? `${r.label} ${index + 1}` : r.label;
    // Assignment URLs get Canvas assignment-link markup; file URLs get the file-link markup.
    if (rawUrl.includes('/assignments/')) {
      const apiEndpoint = rawUrl.replace('/courses/', '/api/v1/courses/');
      return `    <p><a title="${title}" href="${rawUrl}" data-course-type="assignments" data-published="true" data-api-endpoint="${apiEndpoint}" data-api-returntype="Assignment">${title}</a></p>`;
    }
    const clean = rawUrl
      .replace(/\/download\?.*$/, '')
      .replace(/\?wrap=1$/, '');
    const apiEndpoint = clean.replace(
      /^(https?:\/\/[^/]+)\/courses\/(\d+)\/files\//,
      '$1/api/v1/courses/$2/files/',
    );
    return `    <p><a class="instructure_file_link instructure_scribd_file inline_disabled" `
      + `title="${title}" href="${clean}?wrap=1" target="_blank" rel="noopener" `
      + `data-api-endpoint="${apiEndpoint}" data-api-returntype="File">${title}</a></p>`;
  }).join('\n');
}

function calendarDayLabel(
  dayIndex: number,
  weekDates: string[] | undefined,
  calendarEvents: CalendarEvent[] | undefined,
): string | null {
  if (!weekDates || !calendarEvents || weekDates.length === 0 || calendarEvents.length === 0) return null;
  const date = weekDates[dayIndex];
  if (!date) return null;
  const event = calendarEvents.find((e) => e.date === date);
  if (!event) return null;
  const labels: Record<string, string> = {
    testing_window:  'No Class - CLT Testing',
    holiday:         'No School',
    track_out:       'No School',
    teacher_workday: 'No School',
    half_day:        'Half Day',
    early_release:   'Early Release',
    no_school:       'No School',
  };
  return labels[event.event_type] ?? null;
}

export function generateRedirectPageHtml(params: RedirectPageParams): string {
  const { thisSubject, activeSubject, weekNum, quarter, dateRange } = params;
  const courseId = COURSE_IDS[activeSubject as keyof typeof COURSE_IDS];
  const courseUrl = `https://thalesacademy.instructure.com/courses/${courseId}`;
  return `<div ${KL_WRAPPER}>
  <div id="kl_banner" class="">
    <h2 ${KL_BANNER_H2}><span ${KL_BANNER_SPAN}>${thisSubject} — Weekly Agenda</span></h2>
    <p ${KL_SUBTITLE}>${quarter}, Week ${weekNum} | ${dateRange}</p>
  </div>
  <div id="kl_custom_block_0" class="">
    ${params.reminderOverride
      ? `<p>${params.reminderOverride}</p>`
      : `<p>We are currently in <strong>${activeSubject}</strong> this unit.</p>
    <p>Please visit the <a href="${courseUrl}" target="_blank" rel="noopener">${activeSubject} Canvas course</a> for this week's agenda.</p>`}
  </div>
  <div id="kl_custom_block_5" class="">
    <p>&nbsp;</p>
  </div>
  <div id="kl_custom_block_3" class="">
    <h3 ${KL_DAY_H3}>${KL_ICON_SCHOOL}Monday&nbsp;</h3>
    <p><em>No Class</em></p>
  </div>
  <div id="kl_custom_block_4" class="">
    <h3 ${KL_DAY_H3}>${KL_ICON_SCHOOL}Tuesday&nbsp;</h3>
    <p><em>No Class</em></p>
  </div>
  <div id="kl_custom_block_6" class="">
    <h3 ${KL_DAY_H3}>${KL_ICON_SCHOOL}Wednesday&nbsp;</h3>
    <p><em>No Class</em></p>
  </div>
  <div id="kl_custom_block_2" class="">
    <h3 ${KL_DAY_H3}>${KL_ICON_SCHOOL}Thursday&nbsp;</h3>
    <p><em>No Class</em></p>
  </div>
  <div id="kl_custom_block_1" class="">
    <h3 ${KL_DAY_H3}>${KL_ICON_SCHOOL}Friday&nbsp;</h3>
    <p><em>No Class</em></p>
  </div>
</div>`;
}

export function generateCanvasPageHtml(params: CanvasPageParams): string {
  const {
    subject,
    rows,
    quarter,
    weekNum,
    dateRange,
    subjectReminder,
    subjectResources,
    contentMap = [],
    calendarEvents = [],
    weekDates = [],
  } = params;
  const isReadingLayout = subject === 'Reading' || subject === 'Reading & Spelling';

  const parts: string[] = [];

  const formatLessonText = (row: CanvasPageRow | undefined): string => {
    if (!row) return '';
    const raw = (row.in_class || '').trim();
    if (!raw) return '';
    let txt = stripLessonTitle(raw, row.subject);
    txt = injectFileLinks(txt, contentMap, row.subject);
    if (row.canvas_url) {
      return `<a title="${txt}" href="${row.canvas_url}" data-course-type="assignments" data-published="true" data-api-endpoint="${row.canvas_url.replace('/courses/', '/api/v1/courses/')}" data-api-returntype="Assignment">${txt}</a>`;
    }
    return txt;
  };

  const matchesLessonNumber = (value: string | null | undefined, lessonNum: string | null | undefined): boolean => {
    const rawValue = (value || '').trim();
    const rawLessonNum = (lessonNum || '').trim();
    if (!rawValue || !rawLessonNum) return false;
    const num = Number.parseInt(rawLessonNum, 10);
    if (!Number.isFinite(num)) return false;
    return new RegExp(`(?:^|\\D)0*${num}(?:\\D|$)`, 'i').test(rawValue);
  };

  const findSpellingFallbackText = (lessonNum: string | null | undefined): string => {
    const entry = contentMap.find((candidate) => {
      if (candidate.subject !== 'Spelling') return false;
      return (
        matchesLessonNumber(candidate.canonical_name, lessonNum) ||
        matchesLessonNumber(candidate.lesson_ref, lessonNum)
      );
    });
    if (!entry) return '';
    const raw = (entry.canonical_name || entry.lesson_ref || '').trim();
    if (!raw) return '';
    let txt = stripLessonTitle(raw, 'Spelling');
    txt = injectFileLinks(txt, contentMap, 'Spelling');
    if (entry.canvas_url && !txt.includes('<a ')) {
      return `<a href="${entry.canvas_url}" target="_blank" style="color: inherit; text-decoration: underline;">${txt}</a>`;
    }
    return txt;
  };

  parts.push(`<div ${KL_WRAPPER}>`);
  parts.push(`  <div id="kl_banner" class="">`);
  parts.push(`    <h2 ${KL_BANNER_H2}><span ${KL_BANNER_SPAN}>Weekly Agenda</span></h2>`);
  parts.push(`    <p ${KL_SUBTITLE}>${quarter}, Week ${weekNum} | ${dateRange}</p>`);
  parts.push(`  </div>`);
  parts.push(`  <div id="kl_custom_block_0" class="">`);
  parts.push(`    <h3 ${KL_REMINDERS_H3}>${KL_ICON_EXCLAIM}Reminders</h3>`);
  if (subjectReminder && subjectReminder.trim()) {
    for (const line of subjectReminder.split('\n').map((l) => l.trim()).filter(Boolean)) {
      parts.push(`    <p>${line}</p>`);
    }
  }
  if (subject === 'Math') {
    const testRow = rows.find((row) =>
      (row.type || '').toLowerCase().includes('test')
      && row.lesson_num,
    );
    const testNum = Number.parseInt((testRow?.lesson_num || '').trim(), 10);
    if (Number.isFinite(testNum)) {
      const pad2 = String(testNum).padStart(2, '0');
      const blankStudyGuide = contentMap.find((entry) => {
        const url = entry.canvas_url || '';
        if (!url || entry.subject !== 'Math') return false;
        const summary = `${entry.lesson_ref || ''} ${entry.canonical_name || ''} ${url}`.toLowerCase();
        const isStudyGuide = summary.includes('studyguide') || (summary.includes('study') && summary.includes('guide'));
        const matchesTest = matchesLessonNumber(summary, String(testNum));
        const hasCompletedMarker = /%[^%]*completed[^%]*%/i.test(url);
        const isBlank = summary.includes('blank') || !hasCompletedMarker;
        return isStudyGuide && matchesTest && isBlank;
      });
      const completedStudyGuide = contentMap.find((entry) => {
        const url = entry.canvas_url || '';
        if (!url || entry.subject !== 'Math') return false;
        const summary = `${entry.lesson_ref || ''} ${entry.canonical_name || ''} ${url}`.toLowerCase();
        const isStudyGuide = summary.includes('studyguide') || (summary.includes('study') && summary.includes('guide'));
        const matchesTest = matchesLessonNumber(summary, String(testNum));
        const isCompleted = /%[^%]*completed[^%]*%/i.test(url);
        return isStudyGuide && matchesTest && isCompleted;
      });
      if (blankStudyGuide?.canvas_url || completedStudyGuide?.canvas_url) {
        parts.push('    <ul>');
        if (blankStudyGuide?.canvas_url) {
          parts.push(`      <li><a href="${blankStudyGuide.canvas_url}">M_SG_${pad2}_Blank.pdf</a> - Blank</li>`);
        }
        if (completedStudyGuide?.canvas_url) {
          parts.push(`      <li><a href="${completedStudyGuide.canvas_url}">M_SG_${pad2}_Completed.pdf</a> - Answers</li>`);
        }
        parts.push('    </ul>');
      }
    }
  }
  parts.push(`  </div>`);

  parts.push(`  <div id="kl_custom_block_5" class="">`);
  if (subject === 'Math') {
    // Math Resources: show only the Saxon Math Textbook and current-week Lesson Odds links.
    const textbookEntry = contentMap.find((e) => e.lesson_ref === 'Math_Textbook' && e.canvas_url);
    const mathResources: Resource[] = [];
    if (textbookEntry?.canvas_url) {
      mathResources.push({ label: 'Saxon Math Textbook', url: textbookEntry.canvas_url });
    }
    const seenLessonOdds = new Set<string>();
    for (const row of rows) {
      if (!row.canvas_url) continue;
      const rowType = (row.type || '').toLowerCase();
      const isLessonRow = rowType.includes('lesson') || /\blesson\b/i.test(row.in_class || '');
      if (!isLessonRow) continue;
      const n = Number.parseInt((row.lesson_num || '').trim(), 10);
      if (!Number.isFinite(n)) continue;
      const label = `Lesson ${n} Odds`;
      if (seenLessonOdds.has(label)) continue;
      seenLessonOdds.add(label);
      mathResources.push({ label, url: row.canvas_url });
    }
    if (mathResources.length > 0) {
      parts.push(`    <h3 ${KL_RESOURCES_H3}>${KL_ICON_QUESTION}Resources&nbsp;</h3>`);
      for (const r of mathResources) {
        parts.push(renderResource(r));
      }
    }
    parts.push(`    <p>&nbsp;</p>`);
  } else {
    const mergedResources: Resource[] = [...subjectResources];
    const seen = new Set(subjectResources.map((r) => `${r.group || ''}::${r.label}::${r.url || ''}`));
    for (const row of rows) {
      if (!row.resources) continue;
      for (const r of parseResources(row.resources)) {
        const key = `${r.group || ''}::${r.label}::${r.url || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          mergedResources.push(r);
        }
      }
    }
    for (const row of rows) {
      for (const group of matchMultipleResources(contentMap, row.subject, row.lesson_num)) {
        for (const resource of group.resources) {
          const groupedResource: Resource = {
            ...resource,
            group: group.label,
          };
          const key = `${groupedResource.group || ''}::${groupedResource.label}::${groupedResource.url || ''}`;
          if (!seen.has(key)) {
            seen.add(key);
            mergedResources.push(groupedResource);
          }
        }
      }
    }
    // Remove individual lesson workbook pages and blocked study-guide files.
    // Only "Workbook Part 1.pdf" and "Workbook Part 2.pdf" entries survive.
    const filteredResources = mergedResources.filter((r) => !shouldExcludeResource(r.label));
    if (filteredResources.length > 0) {
      parts.push(`    <h3 ${KL_RESOURCES_H3}>${KL_ICON_QUESTION}Resources&nbsp;</h3>`);
      let currentGroup: string | undefined = undefined;
      for (const r of filteredResources) {
        if (r.group && r.group !== currentGroup) {
          currentGroup = r.group;
          parts.push(`    <p><strong>${r.group}:</strong></p>`);
        }
        parts.push(renderResource(r));
      }
      parts.push(`    <p>&nbsp;</p>`);
    } else {
      parts.push(`    <p>&nbsp;</p>`);
    }
  }
  parts.push(`  </div>`);

  for (let di = 0; di < DAYS_ORDER.length; di++) {
    const day = DAYS_ORDER[di];
    const dayRows = rows.filter((r) => r.day === day);
    const blockId = DAY_BLOCK_IDS[day];
    const isFriday = day === 'Friday';
    const readingRow = isReadingLayout ? dayRows.find((r) => r.subject === 'Reading') : undefined;
    const spellingRow = isReadingLayout ? dayRows.find((r) => r.subject === 'Spelling') : undefined;
    const row = readingRow ?? spellingRow ?? dayRows[0];
    const calLabel = calendarDayLabel(di, weekDates, calendarEvents);

    parts.push(`  <div id="${blockId}" class="">`);
    parts.push(`    <h3 ${KL_DAY_H3}>${KL_ICON_SCHOOL}${day}&nbsp;</h3>`);

    if (dayRows.length === 0) {
      parts.push(`    <p><em>${calLabel ?? 'No Class'}</em></p>`);
      parts.push(`  </div>`);
      continue;
    }

    const explicitNoClass =
      row.type === 'X' || row.type === 'No Class' || row.type === '-' ||
      ((row.in_class || '').trim() === '' && (row.type || '').trim() === '');

    if (explicitNoClass && !calLabel) {
      const label = row.type === 'X' ? 'No School' : 'No Class';
      parts.push(`    <p><em>${label}</em></p>`);
      parts.push(`  </div>`);
      continue;
    }

    if (calLabel && (!row.in_class || row.in_class.trim() === '')) {
      parts.push(`    <p><em>${calLabel}</em></p>`);
      parts.push(`  </div>`);
      continue;
    }

    if (isReadingLayout) {
      const readingText = formatLessonText(readingRow);
      const spellingText = formatLessonText(spellingRow) || findSpellingFallbackText(spellingRow?.lesson_num || readingRow?.lesson_num);
      parts.push(`    <p><strong>Reading:</strong> ${readingText}</p>`);
      parts.push(`    <p><strong>Spelling:</strong> ${spellingText}</p>`);
      if (isFriday && new Set(dayRows.map((r) => r.subject)).size > 1) {
        parts.push(`    <p><em>No homework over the weekend &mdash; enjoy! &#127881;</em></p>`);
      } else if (isFriday) {
        parts.push(`    <p><em>No homework over the weekend.</em></p>`);
      }
      parts.push(`  </div>`);
      continue;
    }

    parts.push(`    <h4 ${KL_H4}><strong>In Class</strong></h4>`);
    for (const r of dayRows) {
      const raw = (r.in_class || '').trim();
      if (!raw) continue;
      let txt = formatLessonText(r);
      if (!r.canvas_url) txt = `<span>${txt}</span>`;
      parts.push(`    <p>${txt}</p>`);
    }
    if (isFriday && new Set(dayRows.map((r) => r.subject)).size > 1) {
      parts.push(`    <p><em>No homework over the weekend &mdash; enjoy! &#127881;</em></p>`);
    }
    parts.push(`    <p>&nbsp;</p>`);

    if (!isFriday) {
      const atHomeFragments: string[] = [];
      const hasMultipleSubjectsAH = new Set(dayRows.map((r) => r.subject)).size > 1;
      for (const r of dayRows) {
        const raw = (r.at_home || '').trim();
        if (!raw) continue;
        let txt = stripLessonTitle(raw, r.subject);
        txt = injectFileLinks(txt, contentMap, r.subject);
        const shouldLink = Boolean(r.canvas_url) && (r.subject === 'Math' || r.subject === 'Reading' || r.subject === 'Spelling');
        const sPfx = hasMultipleSubjectsAH ? `<strong>${r.subject}:</strong> ` : '';
        if (shouldLink) {
          atHomeFragments.push(
            `    <p>${sPfx}<a title="${txt}" href="${r.canvas_url!}" data-course-type="assignments" data-published="true" data-api-endpoint="${r.canvas_url!.replace('/courses/', '/api/v1/courses/')}" data-api-returntype="Assignment">${txt}</a></p>`
          );
        } else {
          atHomeFragments.push(`    <p>${sPfx}${txt}</p>`);
        }
      }
      if (atHomeFragments.length > 0) {
        parts.push(`    <h4 ${KL_H4}><strong>${atHomeLabel(row.subject)}</strong></h4>`);
        parts.push(atHomeFragments.join('\n'));
        parts.push(`    <p>&nbsp;</p>`);
      }
    }
    parts.push(`  </div>`);
  }
  parts.push(`</div>`);
  return parts.join('\n');
}

export function generateHomeroomPageHtml(params: HomeroomPageParams): string {
  const {
    dateRange,
    homeroomNotesHtml,
    homeroomNotes,
    birthdays,
    calendarReminders,
    schoolNews,
    pointsOfContact = [],
    quickLinks = [],
    footer = 'Thales Academy Grade 4A &mdash; Mr. Reagan',
  } = params;
  const parts: string[] = [];

  parts.push(`<div style="background: linear-gradient(135deg,#6644bb,#0065a7); color: #fff; padding: 24px; border-radius: 12px; text-align: center;">
  <h1 style="margin: 0;">📬 Homeroom Newsletter</h1>
  <p style="margin: 8px 0 0;">${dateRange || 'This Week'}</p>
</div>`);

  const notesBody = homeroomNotesHtml?.trim() || (
    homeroomNotes?.trim()
      ? homeroomNotes.split('\n').filter(Boolean).map(l => `  <p>${l}</p>`).join('\n')
      : ''
  );
  if (notesBody) {
    parts.push(`<div style="margin: 16px 0; padding: 16px; background: #f8f6ff; border-radius: 8px; border-left: 4px solid #6644bb;">
  <h3 style="margin: 0 0 8px; color: #6644bb;">📝 Homeroom Notes</h3>
${notesBody}
</div>`);
  }

  if (schoolNews?.trim()) {
    parts.push(`<div style="margin: 16px 0; padding: 16px; background: #f0f4f8; border-radius: 8px; border-left: 4px solid #1a365d;">
  <h3 style="margin: 0 0 8px; color: #1a365d;">🏫 School News</h3>
  ${schoolNews.trim()}
</div>`);
  }

  if (birthdays?.trim()) {
    const lines = birthdays
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `  <p style="margin: 0;">${l}</p>`)
      .join('\n');
    parts.push(`<div style="margin: 16px 0; padding: 16px; background: #fff8f0; border-radius: 8px; border-left: 4px solid #c87800;">
  <h3 style="margin: 0 0 8px; color: #c87800;">🎂 Birthdays 🎂</h3>
  <p style="margin: 0;">Happy Birthday to:</p>
${lines}
</div>`);
  }

  if (pointsOfContact.length > 0) {
    const items = pointsOfContact
      .map(
        (c) =>
          `    <li style="margin-bottom: 4px;"><strong>${c.name}${c.role ? ` (${c.role})` : ''}:</strong> <a href="mailto:${c.email}">${c.email}</a></li>`,
      )
      .join('\n');
    parts.push(`<div style="margin: 16px 0; padding: 16px; background: #f2f2f2; border-radius: 8px; border-left: 4px solid #4a5568;">
  <h3 style="margin: 0 0 8px; color: #2d3748;">📞 Points of Contact</h3>
  <p style="font-size: 13px; margin-bottom: 12px;">Your first point of contact should be your child's classroom teacher for academic or behavior concerns. Below are other helpful contacts:</p>
  <ul style="list-style-type: none; padding-left: 0; font-size: 14px;">
${items}
  </ul>
</div>`);
  }

  if (calendarReminders?.trim()) {
    const lines = calendarReminders
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `  <div dir="ltr">${l}</div>`)
      .join('\n');
    parts.push(`<div style="margin: 16px 0;">
  <h3 style="color: #6644bb; border-bottom: 2px solid #6644bb; padding-bottom: 4px;">Mark Your Calendars</h3>
${lines}
</div>`);
  }

  if (quickLinks.length > 0) {
    const links = quickLinks
      .map((l) => `  <p dir="ltr"><a href="${l.url}" target="_blank" rel="noopener">${l.label}</a></p>`)
      .join('\n');
    parts.push(`<div style="margin: 16px 0; border-top: 1px solid #ddd; padding-top: 16px;">
  <h3 style="color: #6644bb;">🔗 Quick Links</h3>
${links}
</div>`);
  }

  parts.push(`<div style="text-align: center; margin-top: 24px; padding: 16px; color: #888; font-size: 12px;">${footer}</div>`);

  return parts.join('\n');
}

void getCourseId;
void injectAssignmentLink;
