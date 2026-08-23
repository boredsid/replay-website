import { it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Leads from './Leads';

const LEAD = {
  id: 'l1', edition_id: 'e3', phone: '9876543210', name: 'Bo', step_reached: 'phone_entered',
  created_at: '2026-06-01', converted_at: null, editions: { slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12' },
};

function mockLeadRequests(leads = [LEAD]) {
  (fetchAdmin as any).mockImplementation((path: string) => path === '/api/admin/editions'
    ? Promise.resolve({ editions: [{ id: 'e3', slug: 'replay-3', name: 'REPLAY', is_current: true }] })
    : Promise.resolve({ leads }));
}

it('renders leads', async () => {
  mockLeadRequests();
  render(<Leads />);
  await waitFor(() => expect(screen.getAllByText('Bo')).toHaveLength(2));
  expect(screen.getByText('phone_entered')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Edition' })).toHaveValue('all');
  expect(screen.getByRole('combobox', { name: 'Conversion status' })).toHaveValue('active');
  expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
});

it('links each lead to WhatsApp with a prefilled message', async () => {
  mockLeadRequests();
  render(<Leads />);
  const links = await screen.findAllByRole('link', { name: 'Message Bo on WhatsApp' });
  expect(links).toHaveLength(2); // table row + mobile card
  expect(links[0]).toHaveAttribute('href', expect.stringContaining('https://wa.me/919876543210?text=Hi%20Bo!'));
});

it('downloads a CSV of the listed leads', async () => {
  mockLeadRequests();
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:leads');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  render(<Leads />);
  fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));

  expect(click).toHaveBeenCalled();
  const blob = createObjectURL.mock.calls[0][0];
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(text).toContain('name,phone,edition,step_reached,converted_at,created_at\nBo,9876543210,replay-3,phone_entered,,2026-06-01');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:leads');

  click.mockRestore();
  vi.unstubAllGlobals();
});

it('disables export when there are no leads', async () => {
  mockLeadRequests([]);
  render(<Leads />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled());
});

it('reloads leads when the conversion filter changes', async () => {
  mockLeadRequests();
  render(<Leads />);
  const filter = await screen.findByRole('combobox', { name: 'Conversion status' });
  fireEvent.change(filter, { target: { value: 'all' } });
  await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith('/api/admin/leads?edition=all&conversion=all'));
});
