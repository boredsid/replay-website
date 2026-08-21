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
  it('keeps four phone-sized primary tabs and a More action', () => {
    renderAt();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Programme' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Announcements' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editions' })).not.toBeInTheDocument();
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
