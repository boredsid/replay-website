import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PartnerPurchaseForm } from './PartnerPurchaseForm';
import type { EditionRow } from '../lib/types';

const EDITION: EditionRow = {
  id: 'e1', slug: 'replay-3', name: 'REPLAY', start_date: '2026-09-12', end_date: '2026-09-13',
  daily_start_time: '10:00:00', daily_end_time: '19:00:00', venue: 'TBD',
  capacity_per_day: { day1: 250, day2: 250 },
  pricing: { oneshot: 700, campaign: 1200, adventurer_cap: 1000 },
  partner_pricing: { gst_rate: 0.18, standard_booth: 8000, community_booth: 6500, standard_engagement: 3000, patron_engagement: 3500 },
  registration_status: 'open', is_current: true, is_published: true,
};

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
  vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({
      payment_reference: '11111111-1111-4111-8111-111111111111',
      base_amount: 3500,
      gst_amount: 630,
      final_amount: 4130,
      payment_required: true,
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      partner_id: '11111111-1111-4111-8111-111111111111',
      base_amount: 3500,
      gst_amount: 630,
      final_amount: 4130,
      payment_required: true,
    }), { status: 200 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('PartnerPurchaseForm', () => {
  it('previews a community-engagement purchase and records it only after the buyer claims payment', async () => {
    const user = userEvent.setup();
    render(<PartnerPurchaseForm edition={EDITION} upiId="test@upi" />);

    await user.selectOptions(screen.getByLabelText('Partner package'), 'patron_engagement');
    await user.click(screen.getByLabelText('Sunday'));
    await user.type(screen.getByLabelText('Organisation name'), 'Tabletop Club');
    await user.type(screen.getByLabelText('Primary contact'), 'Asha');
    await user.type(screen.getByLabelText('Partner phone'), '9876543210');
    await user.type(screen.getByLabelText('Partner email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Partner activity details'), 'A three-hour social deduction session.');
    await user.click(screen.getByRole('button', { name: /continue to upi/i }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Pay ₹4130')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [previewUrl, previewRequest] = (global.fetch as any).mock.calls[0];
    expect(previewUrl).toBe('https://api.replaycon.in/api/partner-purchase/preview');
    expect(JSON.parse(previewRequest.body)).toMatchObject({
      edition_id: 'e1',
      package_key: 'patron_engagement',
      days: ['day2'],
      organization_name: 'Tabletop Club',
    });

    await user.click(screen.getByRole('button', { name: "I've paid" }));
    await waitFor(() => expect(screen.getByText('Your partner request is in.')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [purchaseUrl, purchaseRequest] = (global.fetch as any).mock.calls[1];
    expect(purchaseUrl).toBe('https://api.replaycon.in/api/partner-purchase');
    expect(JSON.parse(purchaseRequest.body)).toMatchObject({
      partner_id: '11111111-1111-4111-8111-111111111111',
      expected_amount: 4130,
      package_key: 'patron_engagement',
    });
  });
});
