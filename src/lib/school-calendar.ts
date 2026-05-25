/**
 * School Calendar utilities — track no-school days, holidays, and testing windows
 * to prevent assignment/page deployment on invalid dates.
 */

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  event_type: string;
  label: string;
}

let _cache: CalendarEvent[] | null = null;

export async function loadSchoolCalendar(supabase: any): Promise<CalendarEvent[]> {
  if (_cache) return _cache;
  const { data } = await supabase
    .from('school_calendar')
    .select('date, event_type, label')
    .eq('school_year', '2025-2026')
    .order('date');
  _cache = (data || []).map((r: any) => ({ ...r, date: r.date as string }));
  return _cache;
}

export function clearSchoolCalendarCache(): void {
  _cache = null;
}

export function isNoSchoolDay(date: string, calendar: CalendarEvent[]): boolean {
  return calendar.some(
    (e) => e.date === date && ['holiday', 'no_school', 'track_out'].includes(e.event_type),
  );
}

export function isTestingWindow(date: string, calendar: CalendarEvent[]): boolean {
  return calendar.some((e) => e.date === date && e.event_type === 'testing_window');
}

export function getEventForDate(date: string, calendar: CalendarEvent[]): CalendarEvent | undefined {
  return calendar.find((e) => e.date === date);
}

export function getWeekEvents(weekDates: string[], calendar: CalendarEvent[]): CalendarEvent[] {
  return calendar.filter((e) => weekDates.includes(e.date));
}

export function hasNoSchoolInWeek(weekDates: string[], calendar: CalendarEvent[]): boolean {
  return weekDates.some((d) => isNoSchoolDay(d, calendar));
}

export function hasTestingWindowInWeek(weekDates: string[], calendar: CalendarEvent[]): boolean {
  return weekDates.some((d) => isTestingWindow(d, calendar));
}
