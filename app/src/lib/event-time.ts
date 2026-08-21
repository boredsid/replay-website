import type { EditionData, ScheduleItem } from '../types';

const IST_OFFSET = '+05:30';

function instant(date: string, time: string): number {
  return new Date(`${date}T${time.slice(0, 8)}${IST_OFFSET}`).getTime();
}

function relativeDuration(milliseconds: number): string {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'}`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function formatClock(time: string | null): string {
  if (!time) return 'All day';
  const [hourText, minute] = time.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  const value = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    ...(options ?? { weekday: 'short', day: 'numeric', month: 'short' }),
  }).format(value);
}

export type EventState = 'upcoming' | 'opens-today' | 'open' | 'between-days' | 'ended';

export interface EventStatus {
  state: EventState;
  label: string;
  headline: string;
  detail: string;
}

export function getEventStatus(edition: EditionData, now = new Date()): EventStatus {
  const current = now.getTime();
  const firstOpen = instant(edition.start_date, edition.daily_start_time);
  const firstClose = instant(edition.start_date, edition.daily_end_time);
  const finalOpen = instant(edition.end_date, edition.daily_start_time);
  const finalClose = instant(edition.end_date, edition.daily_end_time);

  if (current < firstOpen) {
    const sameIstDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now) === edition.start_date;
    return {
      state: sameIstDate ? 'opens-today' : 'upcoming',
      label: sameIstDate ? 'Opens today' : 'Coming up',
      headline: sameIstDate ? `Doors open at ${formatClock(edition.daily_start_time)}` : `REPLAY starts in ${relativeDuration(firstOpen - current)}`,
      detail: `${formatDate(edition.start_date)}–${formatDate(edition.end_date, { day: 'numeric', month: 'short' })}`,
    };
  }
  if (current < firstClose) {
    return { state: 'open', label: 'Open now', headline: 'REPLAY is underway', detail: `Open until ${formatClock(edition.daily_end_time)}` };
  }
  if (current < finalOpen) {
    return { state: 'between-days', label: 'Back tomorrow', headline: 'Day one has wrapped', detail: `Doors reopen at ${formatClock(edition.daily_start_time)}` };
  }
  if (current < finalClose) {
    return { state: 'open', label: 'Open now', headline: 'REPLAY is underway', detail: `Open until ${formatClock(edition.daily_end_time)}` };
  }
  return { state: 'ended', label: 'Event complete', headline: 'This edition has wrapped', detail: 'Thanks for playing with us.' };
}

function itemWindow(item: ScheduleItem, edition: EditionData): [number, number] {
  if (item.is_all_day || !item.start_time || !item.end_time) {
    return [instant(item.day, edition.daily_start_time), instant(item.day, edition.daily_end_time)];
  }
  return [instant(item.day, item.start_time), instant(item.day, item.end_time)];
}

export function nowAndNext(items: ScheduleItem[], edition: EditionData, now = new Date()): {
  happening: ScheduleItem[];
  next: ScheduleItem[];
} {
  const current = now.getTime();
  const active = items.filter((item) => item.public_status !== 'cancelled');
  const happening = active.filter((item) => {
    const [start, end] = itemWindow(item, edition);
    return start <= current && current < end;
  });
  const future = active
    .map((item) => ({ item, start: itemWindow(item, edition)[0] }))
    .filter(({ start }) => start > current)
    .sort((a, b) => a.start - b.start || a.item.display_order - b.item.display_order);
  const nextStart = future[0]?.start;
  return {
    happening,
    next: nextStart === undefined ? [] : future.filter(({ start }) => start === nextStart).map(({ item }) => item),
  };
}
