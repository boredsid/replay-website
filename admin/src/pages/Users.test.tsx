import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Users from './Users';

beforeEach(() => (fetchAdmin as any).mockReset());

it('lists users', async () => {
  (fetchAdmin as any).mockResolvedValue({ users: [{ phone: '9876543210', name: 'Asha', email: null, notes: null, created_at: '2026-01-01', registration_count: 2 }] });
  render(<MemoryRouter><Users /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Asha')).toBeInTheDocument());
  expect(screen.getByText('9876543210')).toBeInTheDocument();
});
