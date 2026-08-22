import { it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
vi.mock('@/lib/api', () => ({ fetchAdmin: vi.fn(), showApiError: vi.fn() }));
import { fetchAdmin } from '@/lib/api';
import Leads from './Leads';

const LEAD = { id: 'l1', phone: '9876543210', name: 'Bo', step_reached: 'phone_entered', created_at: '2026-06-01', converted_at: null };

it('renders leads', async () => {
  (fetchAdmin as any).mockResolvedValue({ leads: [LEAD] });
  render(<Leads />);
  await waitFor(() => expect(screen.getAllByText('Bo')).toHaveLength(2));
  expect(screen.getAllByText('phone_entered')).toHaveLength(2);
  expect(screen.queryByText('Converted')).not.toBeInTheDocument();
  expect(screen.queryByText('Not converted')).not.toBeInTheDocument();
});

it('links each lead to WhatsApp with a prefilled message', async () => {
  (fetchAdmin as any).mockResolvedValue({ leads: [LEAD] });
  render(<Leads />);
  const links = await screen.findAllByRole('link', { name: 'Message Bo on WhatsApp' });
  expect(links).toHaveLength(2); // table row + mobile card
  expect(links[0]).toHaveAttribute('href', expect.stringContaining('https://wa.me/919876543210?text=Hi%20Bo!'));
});

it('downloads a CSV of the listed leads', async () => {
  (fetchAdmin as any).mockResolvedValue({ leads: [LEAD] });
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
  expect(text).toContain('name,phone,step_reached,created_at\nBo,9876543210,phone_entered,2026-06-01');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:leads');

  click.mockRestore();
  vi.unstubAllGlobals();
});

it('disables export when there are no leads', async () => {
  (fetchAdmin as any).mockResolvedValue({ leads: [] });
  render(<Leads />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled());
});
