import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PartnerInviteForm } from './PartnerInviteForm';
import type { ApiPartnerInvite } from '../lib/types';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2';

function invite(overrides: Partial<ApiPartnerInvite> = {}): ApiPartnerInvite {
  return {
    organization_name: 'Meeple Mart',
    offer_key: 'zone_sponsor',
    offer_label: 'Zone partner',
    kind: 'sponsorship',
    days_rule: 'weekend',
    days: ['day1', 'day2'],
    stage: 'lead',
    contact_name: null,
    phone: null,
    email: null,
    website_url: null,
    gstin: null,
    details: null,
    base_amount: 15000,
    gst_amount: 2700,
    total_amount: 17700,
    payment_required: true,
    payment_claimed: false,
    payment_reference: '11111111-1111-4111-8111-111111111111',
    edition: {
      name: 'REPLAY 3rd edition',
      venue: 'IndiQube Symphony',
      start_date: '2026-09-12',
      end_date: '2026-09-13',
      date_range: 'Sep 12 – Sep 13',
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('PartnerInviteForm', () => {
  it('shows the agreed package and price, then pays by UPI', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ invite: invite() }))
      .mockResolvedValueOnce(jsonResponse({ invite: invite({ stage: 'prospective', contact_name: 'Nikhil' }) }))
      .mockResolvedValueOnce(jsonResponse({ invite: invite({ stage: 'prospective', payment_claimed: true, email: 'nikhil@meeple.example' }) }));

    render(<PartnerInviteForm token={TOKEN} upiId="test@upi" />);

    await waitFor(() => expect(screen.getByText(/Meeple Mart/)).toBeInTheDocument());
    expect(screen.getByText('Zone partner · Sep 12 – Sep 13 · IndiQube Symphony')).toBeInTheDocument();
    expect(screen.getByText('₹17,700')).toBeInTheDocument();
    expect((global.fetch as any).mock.calls[0][0]).toBe(`https://api.replaycon.in/api/partner-invite/${TOKEN}`);

    await user.type(screen.getByLabelText('Primary contact'), 'Nikhil');
    await user.type(screen.getByLabelText('Partner phone'), '9876543210');
    await user.type(screen.getByLabelText('Partner email'), 'nikhil@meeple.example');
    await user.type(screen.getByLabelText('Partner activity details'), 'We are running the RPG zone.');
    await user.click(screen.getByRole('button', { name: /continue to upi/i }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const [, submitRequest] = (global.fetch as any).mock.calls[1];
    expect(JSON.parse(submitRequest.body)).toMatchObject({
      contact_name: 'Nikhil',
      phone: '9876543210',
      email: 'nikhil@meeple.example',
    });
    expect(screen.getByText('Pay ₹17700')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /i've paid/i }));
    await waitFor(() => expect(screen.getByText(/verifying the payment/i)).toBeInTheDocument());
    expect((global.fetch as any).mock.calls[2][0]).toBe(`https://api.replaycon.in/api/partner-invite/${TOKEN}/payment-claimed`);
  });

  it('asks a single-day offer which day it is', async () => {
    const user = userEvent.setup();
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ invite: invite({
        offer_key: 'standard_engagement', offer_label: 'Standard engagement', kind: 'community_engagement',
        days_rule: 'single', days: [], base_amount: 3000, gst_amount: 540, total_amount: 3540,
      }) }))
      .mockResolvedValueOnce(jsonResponse({ invite: invite({ stage: 'prospective', days: ['day2'] }) }));

    render(<PartnerInviteForm token={TOKEN} upiId="test@upi" />);
    await waitFor(() => expect(screen.getByLabelText('Sunday')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Sunday'));
    await user.type(screen.getByLabelText('Primary contact'), 'Asha');
    await user.type(screen.getByLabelText('Partner phone'), '9876543210');
    await user.type(screen.getByLabelText('Partner email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Partner activity details'), 'A three-hour session.');
    await user.click(screen.getByRole('button', { name: /continue to upi/i }));

    await waitFor(() => expect((global.fetch as any).mock.calls.length).toBe(2));
    expect(JSON.parse((global.fetch as any).mock.calls[1][1].body)).toMatchObject({ day: 'day2' });
  });

  it('explains an expired link instead of showing a form', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'invite_expired' }, 410));

    render(<PartnerInviteForm token={TOKEN} upiId="test@upi" />);

    await waitFor(() => expect(screen.getByText(/link has expired/i)).toBeInTheDocument());
    expect(screen.queryByLabelText('Primary contact')).not.toBeInTheDocument();
  });

  it('tells a confirmed partner there is nothing left to do', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({
      invite: invite({ stage: 'confirmed', contact_name: 'Nikhil', email: 'nikhil@meeple.example' }),
    }));

    render(<PartnerInviteForm token={TOKEN} upiId="test@upi" />);

    await waitFor(() => expect(screen.getByText('Meeple Mart is in.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /continue to upi/i })).not.toBeInTheDocument();
  });
});
