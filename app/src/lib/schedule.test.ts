import { describe, expect, it } from 'vitest';
import { filterSchedule, uniqueValues } from './schedule';
import type { ScheduleItem } from '../types';

const items: ScheduleItem[] = [
  {
    id: 'one', day: '2026-09-12', start_time: '10:00:00', end_time: '11:00:00',
    title: 'Learn Azul', description: 'A friendly teach', location: 'Library', kind: 'workshop',
    section: 'programme', is_all_day: false, host_name: 'Nia', signup_mode: 'walk-in',
    signup_url: null, public_status: 'published', display_order: 0,
  },
  {
    id: 'two', day: '2026-09-13', start_time: '12:00:00', end_time: '13:00:00',
    title: 'Puzzle race', description: null, location: 'Main Hall', kind: 'puzzle',
    section: 'programme', is_all_day: false, host_name: null, signup_mode: 'on-site',
    signup_url: null, public_status: 'published', display_order: 0,
  },
];

describe('schedule filters', () => {
  it('combines day, category, location, and free-text filters', () => {
    expect(filterSchedule(items, {
      day: '2026-09-12', kind: 'workshop', location: 'Library', query: 'nia',
    }).map((item) => item.id)).toEqual(['one']);
    expect(filterSchedule(items, {
      day: '', kind: '', location: '', query: 'friendly',
    }).map((item) => item.id)).toEqual(['one']);
  });

  it('supports a saved-only agenda without affecting the public list', () => {
    expect(filterSchedule(items, {
      day: '', kind: '', location: '', query: '', savedOnly: true,
    }, new Set(['two'])).map((item) => item.id)).toEqual(['two']);
  });

  it('builds sorted category and location options', () => {
    expect(uniqueValues(items, 'kind')).toEqual(['puzzle', 'workshop']);
    expect(uniqueValues(items, 'location')).toEqual(['Library', 'Main Hall']);
  });
});
