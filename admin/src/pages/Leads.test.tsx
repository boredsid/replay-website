import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Leads from './Leads';

it('renders leads', async () => {
  (fetchAdmin as any).mockResolvedValue({ leads: [{ id: 'l1', phone: '9876543210', name: 'Bo', step_reached: 'phone_entered', created_at: '2026-06-01', converted_at: null }] });
  render(<Leads />);
  await waitFor(() => expect(screen.getAllByText('Bo')).toHaveLength(2));
  expect(screen.getAllByText('phone_entered')).toHaveLength(2);
  expect(screen.queryByText('Converted')).not.toBeInTheDocument();
  expect(screen.queryByText('Not converted')).not.toBeInTheDocument();
});
