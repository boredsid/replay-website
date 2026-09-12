import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
const state = vi.hoisted(() => ({ canWrite: true }));
vi.mock('@/lib/whoami', () => ({ useCanWrite: () => state.canWrite }));
import { fetchAdmin } from '@/lib/api';
import Programme from './Programme';

const EDITION = {
  id: 'e3', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  is_current: true, is_published: true,
};

const ITEMS = [
  {
    id: 'i1', title: 'Werewolf', day: '2026-09-12', start_time: '14:00:00', end_time: '16:00:00',
    is_all_day: false, section: 'programme', kind: 'social-game', public_status: 'published',
    signup_mode: 'app', capacity: 12, host_name: 'Priya', location: 'Table 3',
  },
  {
    id: 'i2', title: 'Quiz Night', day: '2026-09-13', start_time: '18:00:00', end_time: '19:00:00',
    is_all_day: false, section: 'programme', kind: 'quiz', public_status: 'draft',
    signup_mode: 'none', capacity: null, host_name: null, location: null,
  },
];

beforeEach(() => {
  state.canWrite = true;
  (fetchAdmin as any).mockReset();
  (fetchAdmin as any).mockImplementation((path: string) => {
    if (path.startsWith('/api/admin/editions')) return Promise.resolve({ editions: [EDITION] });
    if (path.startsWith('/api/admin/schedule')) return Promise.resolve({ items: ITEMS });
    return Promise.resolve({});
  });
});

function draw() {
  return render(<MemoryRouter><Programme /></MemoryRouter>);
}

describe('finding a programme item by name', () => {
  it('narrows the list to what was typed, whatever the case', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('Werewolf');

    await user.type(screen.getByLabelText('Search the programme'), 'QUIZ');
    expect(screen.getByText('Quiz Night')).toBeInTheDocument();
    expect(screen.queryByText('Werewolf')).not.toBeInTheDocument();
  });

  it('filters in the browser — it does not ask the Worker again', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('Werewolf');
    const before = (fetchAdmin as any).mock.calls.length;

    await user.type(screen.getByLabelText('Search the programme'), 'quiz');
    expect((fetchAdmin as any).mock.calls.length).toBe(before);
  });

  it('says nothing matched rather than claiming the edition has no programme', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('Werewolf');

    await user.type(screen.getByLabelText('Search the programme'), 'chess');
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument();
    expect(screen.queryByText('No programme items yet')).not.toBeInTheDocument();
  });

  it('is there for somebody who may only look, who gets no edition picker', async () => {
    state.canWrite = false;
    const user = userEvent.setup();
    draw();
    await screen.findByText('Werewolf');
    expect(screen.queryByLabelText('Edition')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Search the programme'), 'were');
    expect(screen.queryByText('Quiz Night')).not.toBeInTheDocument();
  });
});
