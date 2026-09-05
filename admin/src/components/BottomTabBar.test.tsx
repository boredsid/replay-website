import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import BottomTabBar from './BottomTabBar';

// The bar is role-aware now, and a bare render has no provider — which is
// correctly an empty bar, not a useful test.
const roles = vi.hoisted(() => ({ current: ['admin'] as string[] }));
vi.mock('@/lib/whoami', () => ({
  useWhoAmI: () => ({ email: 'a@x.com', roles: roles.current }),
}));

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


describe('what a volunteer sees', () => {
  it('shows the check-in desk its own screens, plus what everyone may read', () => {
    // A hidden link is politeness, not enforcement — the Worker refuses these
    // routes regardless — but offering a link that 403s is its own bug.
    roles.current = ['check_in'];
    renderAt();
    expect(screen.getByRole('link', { name: 'Check in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    // Readable by everyone on staff; the page itself hides its write actions.
    expect(screen.getByRole('link', { name: 'Announcements' })).toBeInTheDocument();
    // Somebody else's desk, though.
    expect(screen.queryByRole('link', { name: 'Game library' })).not.toBeInTheDocument();
    roles.current = ['admin'];
  });

  it('shows a basic admin everything except the staff page', () => {
    roles.current = ['basic_admin'];
    renderAt();
    expect(screen.getByRole('link', { name: 'Check in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Game library' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
    roles.current = ['admin'];
  });

  it('shows the library desk its own', () => {
    roles.current = ['library'];
    renderAt();
    expect(screen.getByRole('link', { name: 'Game library' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Check in' })).not.toBeInTheDocument();
    roles.current = ['admin'];
  });

  it('shows somebody with two roles both of them', () => {
    roles.current = ['check_in', 'library'];
    renderAt();
    expect(screen.getByRole('link', { name: 'Check in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Game library' })).toBeInTheDocument();
    roles.current = ['admin'];
  });
});
