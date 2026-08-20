const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!MONTHS[month - 1] || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function weekdayName(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return 'Event day';
  return WEEKDAYS[new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()];
}

export function eventDayLabel(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  return `${weekdayName(iso)}, ${MONTHS[parsed.month - 1]} ${parsed.day}`;
}

export function calendarDate(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;
  return `${MONTHS[parsed.month - 1]} ${parsed.day}, ${parsed.year}`;
}

export function clockTime(value: string): string {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return minute === '00' ? `${displayHour} ${suffix}` : `${displayHour}:${minute} ${suffix}`;
}
