import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchAdmin = vi.fn();
vi.mock('@/lib/api', () => ({
  fetchAdmin: (...args: unknown[]) => fetchAdmin(...args),
  showApiError: vi.fn(),
}));
vi.mock('@/components/RebuildSiteButton', () => ({ default: () => <button type="button">Rebuild site</button> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Catalogue from './Catalogue';
import type { CatalogueGameRow } from '@/lib/types';

function game(overrides: Partial<CatalogueGameRow> = {}): CatalogueGameRow {
  return {
    id: 'a', key: 'bgg-1', bgg_id: 1, title: 'Catan', year: 1995, thumb: 'https://cf.geekdo-images.com/x.jpg',
    min_players: 3, max_players: 4, min_time: 60, max_time: 90, rating: 7.1, weight: 2.3, best_with: [4],
    source: 'bgg', shelf_status: 'on_shelf', off_shelf_note: null, off_shelf_at: null, off_shelf_by: null,
    copies_override: null, copies_actual: 2, copies: 2,
    ...overrides,
  };
}

const GAMES = [
  game({ owners: [{ owner: 'Siddhant', copies: 1 }, { owner: 'Vinto100', copies: 1 }] }),
  game({
    id: 'b', key: 'bgg-2', bgg_id: 2, title: 'Inis', shelf_status: 'off_shelf', off_shelf_note: 'not coming', copies: 1, copies_actual: 1,
    owners: [{ owner: 'Vinto100', copies: 1 }],
  }),
  game({ id: 'c', key: 'title-shasn', bgg_id: null, title: 'Shasn', thumb: null, source: 'bgc', owners: [{ owner: 'BGC', copies: 2 }] }),
  game({ id: 'd', key: 'manual-proto', bgg_id: null, title: 'Studio Prototype', thumb: null, source: 'manual', owners: [] }),
];

beforeEach(() => {
  fetchAdmin.mockReset();
  fetchAdmin.mockResolvedValue({ games: GAMES });
});

const show = () => render(<MemoryRouter><Catalogue /></MemoryRouter>);

describe('the catalogue list', () => {
  it('shows everything, on the shelf and off it', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    expect(screen.getByText('Inis')).toBeInTheDocument();
  });

  /** The count the public page would show, which is the question being asked. */
  it('counts what is on the shelf separately from what was taken off', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/3 on the shelf/)).toBeInTheDocument());
    expect(screen.getByText(/1 taken off/)).toBeInTheDocument();
  });

  it('says why a game was taken off', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/not coming/)).toBeInTheDocument());
  });

  it('narrows to the games somebody removed', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Off the shelf' }));
    expect(screen.getByText('Inis')).toBeInTheDocument();
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();
  });

  /**
   * The art-less list is the work queue for linking club titles to their BGG
   * entry, so a game already off the shelf must not clutter it — nobody needs
   * to find a picture for a box that is not coming.
   */
  it('lists games needing box art, ignoring ones already removed', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'No box art' }));
    expect(screen.getByText('Shasn')).toBeInTheDocument();
    expect(screen.queryByText('Inis')).not.toBeInTheDocument();
  });

  it('finds a game by title', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Search the catalogue'), 'shas');
    expect(screen.getByText('Shasn')).toBeInTheDocument();
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();
  });

  it('narrows to one owner’s games', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Filter by owner'), 'Siddhant');
    expect(screen.getByText('Catan')).toBeInTheDocument();
    expect(screen.queryByText('Inis')).not.toBeInTheDocument();
    expect(screen.queryByText('Shasn')).not.toBeInTheDocument();
  });

  /** "What is Vinto bringing" — and whether any of it has been taken off. */
  it('combines the owner with the shelf filters', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Filter by owner'), 'Vinto100');
    await userEvent.click(screen.getByRole('button', { name: 'Off the shelf' }));
    expect(screen.getByText('Inis')).toBeInTheDocument();
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();
  });

  it('counts each owner’s games in the picker, and the boxes behind a selection', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Vinto100 (2)' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Filter by owner'), 'BGC');
    expect(screen.getByText(/showing 1 game from BGC, 2 copies/)).toBeInTheDocument();
  });

  /** A game added by hand has no source to name an owner; it must stay findable. */
  it('finds the games nobody is recorded as lending', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Catan')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Filter by owner'), 'No owner recorded (1)');
    expect(screen.getByText('Studio Prototype')).toBeInTheDocument();
    expect(screen.queryByText('Catan')).not.toBeInTheDocument();
  });

  it('names who lends each game on its row', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Shasn')).toBeInTheDocument());
    const row = screen.getByText('Shasn').closest('li') as HTMLElement;
    expect(within(row).getByText(/BGC ×2/)).toBeInTheDocument();
  });

  it('marks the games a sync will never touch', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Studio Prototype')).toBeInTheDocument());
    // Scoped to the row: "Added by hand" is also a filter chip.
    const row = screen.getByText('Studio Prototype').closest('li') as HTMLElement;
    expect(within(row).getByText('Added by hand')).toBeInTheDocument();
  });

  /**
   * The library page is built ahead of time, so a removal is not live until a
   * rebuild. Saying so on the page is the difference between a confused
   * organiser and one who knows to press the button.
   */
  it('says changes need a rebuild, and offers the button', async () => {
    show();
    await waitFor(() => expect(screen.getByText(/reach replaycon.in on the next rebuild/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Rebuild site' })).toBeInTheDocument();
  });
});
