import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import BottomTabBar from './BottomTabBar';

function renderAt(path = '/', moreOpen = false) {
  const onOpenMore = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomTabBar moreOpen={moreOpen} onOpenMore={onOpenMore} />
    </MemoryRouter>,
  );
  return onOpenMore;
}

describe('BottomTabBar', () => {
  it('keeps the on-the-day screens on the bar and a More action', () => {
    // The bar is what staff use standing up: checking someone in, lending a
    // game, looking up a ticket, sending an urgent notice. The programme is
    // read on a laptop and lives under More.
    renderAt();
    for (const name of ['Dashboard', 'Check in', 'Game library', 'Registrations', 'Announcements']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Programme' })).not.toBeInTheDocument();
  });

  it('opens the More sheet and reflects its expanded state', () => {
    const onOpenMore = renderAt('/users', true);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveClass('text-primary');
    fireEvent.click(more);
    expect(onOpenMore).toHaveBeenCalledOnce();
  });
});
