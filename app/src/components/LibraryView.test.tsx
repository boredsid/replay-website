import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LibraryView, { type CatalogueGame } from './LibraryView';
import type { LibraryState } from '../lib/library';
import type { Device } from '../lib/device';

const requestGame = vi.fn();
const cancelRequest = vi.fn();
vi.mock('../lib/library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/library')>()),
  requestGame: (...args: unknown[]) => requestGame(...args),
  cancelRequest: (...args: unknown[]) => cancelRequest(...args),
}));

const DEVICE: Device = {
  token: 't', qr_token: 'q', display_name: 'Siddhant', expires_at: '2026-12-31T00:00:00Z',
};

function game(overrides: Partial<CatalogueGame> & Pick<CatalogueGame, 'key' | 'title'>): CatalogueGame {
  return {
    bggId: null, year: null, thumb: null, rating: null, bestWith: [], copies: 1,
    minPlayers: null, maxPlayers: null, minTime: null, maxTime: null, weight: null,
    ...overrides,
  };
}

const CATALOGUE: CatalogueGame[] = [
  game({ key: 'bgg-1', title: 'Catan', minPlayers: 3, maxPlayers: 4, minTime: 60, maxTime: 90, weight: 2.3 }),
  game({ key: 'bgg-2', title: 'Wingspan', minPlayers: 1, maxPlayers: 5, minTime: 40, maxTime: 70, weight: 2.4 }),
  game({ key: 'bgg-3', title: 'Hive', minPlayers: 2, maxPlayers: 2, minTime: 20, maxTime: 20, weight: 1.9 }),
];

function state(overrides: Partial<LibraryState> = {}): LibraryState {
  return { can_borrow: true, unavailable: [], hold: null, loan: null, ...overrides };
}

function renderView(overrides: Partial<Parameters<typeof LibraryView>[0]> = {}) {
  const onChanged = vi.fn();
  const onFinishSetup = vi.fn();
  const onShowMap = vi.fn();
  render(
    <LibraryView
      device={DEVICE}
      state={state()}
      catalogue={CATALOGUE}
      catalogueError={false}
      onChanged={onChanged}
      onFinishSetup={onFinishSetup}
      onShowMap={onShowMap}
      {...overrides}
    />,
  );
  return { onChanged, onFinishSetup, onShowMap };
}

beforeEach(() => { requestGame.mockReset(); cancelRequest.mockReset(); });

describe('browsing', () => {
  it('offers a reservation on a free game', async () => {
    renderView();
    expect(screen.getByRole('button', { name: 'Reserve Catan' })).toBeInTheDocument();
  });

  it('shows a game that is all out rather than hiding it', async () => {
    // Knowing a game exists but is taken beats the shelf appearing to lack it.
    renderView({ state: state({ unavailable: ['bgg-1'] }) });
    expect(screen.getByText('Catan')).toBeInTheDocument();
    expect(screen.getByText('All out')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reserve Catan' })).not.toBeInTheDocument();
  });

  it('filters by name', async () => {
    renderView();
    await userEvent.type(screen.getByPlaceholderText('Game name…'), 'wing');
    expect(screen.getByText('Wingspan')).toBeInTheDocument();
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();
  });

  it('filters by how many people are actually at the table', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: '2', pressed: false }));
    expect(screen.getByText('Hive')).toBeInTheDocument();
    expect(screen.getByText('Wingspan')).toBeInTheDocument();
    // Catan needs three.
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();
  });

  it('filters by how long there is to play', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Under 30 min' }));
    expect(screen.getByText('Hive')).toBeInTheDocument();
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();
  });

  it('filters by how heavy the rulebook is', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(screen.getByText('Hive')).toBeInTheDocument();
    expect(screen.queryByText('Wingspan')).not.toBeInTheDocument();
  });

  it('stacks filters, and clears them all at once', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: '2', pressed: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Under 30 min' }));
    expect(screen.getByText(/^1 game$/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Catan')).toBeInTheDocument();
    expect(screen.getByText('Wingspan')).toBeInTheDocument();
  });

  it('toggles a chip off when tapped twice', async () => {
    // Chips toggle rather than cycle: tapping "2" again means "never mind".
    renderView();
    const two = screen.getByRole('button', { name: '2', pressed: false });
    await userEvent.click(two);
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2', pressed: true }));
    expect(screen.getByText('Catan')).toBeInTheDocument();
  });

  it('reserves the title that was tapped', async () => {
    requestGame.mockResolvedValue({ ok: true, expires_at: '', copy_number: 1 });
    const { onChanged } = renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Reserve Wingspan' }));
    expect(requestGame).toHaveBeenCalledWith(DEVICE, 'bgg-2');
    expect(onChanged).toHaveBeenCalled();
  });

  it('goes back to the top, where the card telling you what to do is', async () => {
    // A reservation made from row forty is otherwise made into the void.
    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollTo });
    requestGame.mockResolvedValue({ ok: true, expires_at: '', copy_number: 1 });
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Reserve Catan' }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });

  it('stays put when the reservation failed', async () => {
    // Nothing appeared at the top, so there is nothing up there to look at.
    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollTo });
    requestGame.mockResolvedValue({ ok: false, error: 'no_copy_available' });
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Reserve Catan' }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('says what to do when the last copy just went', async () => {
    requestGame.mockResolvedValue({ ok: false, error: 'no_copy_available' });
    const { onChanged } = renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Reserve Catan' }));
    expect(await screen.findByText(/Someone got the last copy/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('when the shelf state never arrived', () => {
  it('offers nothing rather than a button the server would refuse', () => {
    // Null state means the fetch failed or never ran. Offering Reserve here
    // would produce an error the attendee cannot act on.
    renderView({ state: null });
    expect(screen.queryByRole('button', { name: /^Reserve/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
  });
});

describe('one game at a time', () => {
  it('offers no reservations while something is already held', () => {
    renderView({ state: state({
      hold: { loan_id: 'l1', title_key: 'bgg-1', title: 'Catan', copy_number: 1, expires_at: new Date(Date.now() + 180_000).toISOString() },
    }) });
    expect(screen.queryByRole('button', { name: /^Reserve/ })).not.toBeInTheDocument();
  });

  it('offers no reservations while something is out', () => {
    renderView({ state: state({
      loan: { loan_id: 'l1', title_key: 'bgg-1', title: 'Catan', copy_number: 1, due_at: new Date(Date.now() + 3_600_000).toISOString(), overdue: false },
    }) });
    expect(screen.queryByRole('button', { name: /^Reserve/ })).not.toBeInTheDocument();
  });
});

describe('a held game', () => {
  const held = state({
    hold: { loan_id: 'l1', title_key: 'bgg-1', title: 'Catan', copy_number: 2, expires_at: new Date(Date.now() + 180_000).toISOString() },
  });

  it('counts down and says where to go', () => {
    renderView({ state: held });
    expect(screen.getByText(/3 min to collect it/)).toBeInTheDocument();
    expect(screen.getByText(/Show your ID at the Game Library/)).toBeInTheDocument();
  });

  it('still tells them to try when the hold has lapsed', () => {
    // Per the desk's rule: a lapsed hold on a copy still on the shelf is
    // handed over anyway, so this must not read as a dead end.
    renderView({ state: state({
      hold: { loan_id: 'l1', title_key: 'bgg-1', title: 'Catan', copy_number: 2, expires_at: new Date(Date.now() - 60_000).toISOString() },
    }) });
    expect(screen.getByText(/if it is still on the shelf/)).toBeInTheDocument();
  });

  it('lets them change their mind, so a mis-tap does not cost five minutes', async () => {
    cancelRequest.mockResolvedValue(true);
    const { onChanged } = renderView({ state: held });
    await userEvent.click(screen.getByRole('button', { name: 'Change my mind' }));
    expect(cancelRequest).toHaveBeenCalledWith(DEVICE);
    expect(onChanged).toHaveBeenCalled();
  });

  it('drops the card immediately rather than after two round trips', async () => {
    // The prop still says a hold exists -- the refetch has not happened yet.
    // Waiting for it reads as the tap not having registered.
    cancelRequest.mockResolvedValue(true);
    renderView({ state: held });
    await userEvent.click(screen.getByRole('button', { name: 'Change my mind' }));
    expect(screen.queryByLabelText('Game you have reserved')).not.toBeInTheDocument();
    expect(screen.queryByText(/held for you/)).not.toBeInTheDocument();
  });

  it('puts the card back when the cancel did not go through', async () => {
    // Optimism has to be reversible, or a failed request quietly loses a hold
    // the attendee still has.
    cancelRequest.mockResolvedValue(false);
    renderView({ state: held });
    await userEvent.click(screen.getByRole('button', { name: 'Change my mind' }));
    expect(await screen.findByText(/still held/)).toBeInTheDocument();
    expect(screen.getByLabelText('Game you have reserved')).toBeInTheDocument();
  });
});

describe('a game that is out', () => {
  it('says how long is left', () => {
    renderView({ state: state({
      loan: { loan_id: 'l1', title_key: 'bgg-1', title: 'Catan', copy_number: 1, due_at: new Date(Date.now() + 5_400_000).toISOString(), overdue: false },
    }) });
    expect(screen.getByText(/1h 30m left/)).toBeInTheDocument();
  });

  it('says so plainly when it is late', () => {
    renderView({ state: state({
      loan: { loan_id: 'l1', title_key: 'bgg-1', title: 'Catan', copy_number: 1, due_at: new Date(Date.now() - 60_000).toISOString(), overdue: true },
    }) });
    expect(screen.getByText('Due back now')).toBeInTheDocument();
  });
});

describe('before setup', () => {
  it('points an unpaired device at the desk', async () => {
    const { onFinishSetup } = renderView({ device: null });
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(onFinishSetup).toHaveBeenCalled();
  });

  it('says browsing works even when borrowing does not', () => {
    renderView({ state: state({ can_borrow: false }) });
    expect(screen.getByText(/Browsing works either way/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reserve/ })).not.toBeInTheDocument();
    // The shelf is still readable.
    expect(screen.getByText('Catan')).toBeInTheDocument();
  });

  it('explains a catalogue that could not load', () => {
    renderView({ catalogue: null, catalogueError: true });
    expect(screen.getByText(/catalogue could not be loaded/i)).toBeInTheDocument();
  });
});


describe('finding the counter', () => {
  it('names where to go, not just "the library counter"', () => {
    // Useless to somebody who has never been in the building, which on day one
    // is everybody.
    renderView();
    expect(screen.getAllByText(/bar counter onto the corridor/).length).toBeGreaterThan(0);
  });

  it('sends them to the map', async () => {
    const { onShowMap } = renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Find it on the map' }));
    expect(onShowMap).toHaveBeenCalled();
  });

  it('offers the map to somebody who has not set up yet either', async () => {
    const { onShowMap } = renderView({ device: null });
    await userEvent.click(screen.getByRole('button', { name: 'Where is it?' }));
    expect(onShowMap).toHaveBeenCalled();
  });

  it('shows the organisers\' own borrowing note when they have written one', () => {
    renderView({ process: 'Two-hour loans during the tournament block.' });
    expect(screen.getByText(/Two-hour loans/)).toBeInTheDocument();
  });

  it('says nothing extra when they have not', () => {
    renderView({ process: null });
    expect(document.querySelector('.library-process')).toBeNull();
  });
});
