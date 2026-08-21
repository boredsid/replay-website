import type { ScheduleFilters, ScheduleItem } from '../types';

export function filterSchedule(
  items: ScheduleItem[],
  filters: ScheduleFilters,
  savedIds: ReadonlySet<string> = new Set(),
): ScheduleItem[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (filters.savedOnly && !savedIds.has(item.id)) return false;
    if (filters.day && item.day !== filters.day) return false;
    if (filters.kind && item.kind !== filters.kind) return false;
    if (filters.location && item.location !== filters.location) return false;
    if (!needle) return true;
    const haystack = [item.title, item.description, item.location, item.host_name, item.kind]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    return haystack.includes(needle);
  });
}
export function uniqueValues(items: ScheduleItem[], key: 'kind' | 'location'): string[] {
  return [...new Set(items.map((item) => item[key]).filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b));
}
