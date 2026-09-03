import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpiBottomSheet } from './UpiBottomSheet';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function useUserAgent(userAgent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

function renderSheet() {
  return render(
    <UpiBottomSheet
      amount={700}
      upiId="test@upi"
      payeeName="REPLAY Convention"
      transactionRef="a3ebf554-3623-45c8-9169-438cab3224dd"
      onPaid={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

// The reference reaches the UPI app with its hyphens stripped: NPCI declines a
// transaction reference containing special characters, and a raw UUID is also a
// character over the 35-character cap.
const QUERY = 'pa=test%40upi&pn=REPLAY%20Convention&am=700.00&tr=a3ebf554362345c89169438cab3224dd&cu=INR';

describe('UpiBottomSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the UPI ID', () => {
    useUserAgent(IOS_UA);
    renderSheet();

    expect(screen.queryByText(/UPI ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText('test@upi')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open your UPI app/i })).not.toBeInTheDocument();
  });

  it('offers per-app custom schemes off Android', () => {
    useUserAgent(IOS_UA);
    renderSheet();

    expect(screen.getByRole('link', { name: /pay with google pay/i })).toHaveAttribute(
      'href',
      `tez://upi/pay?${QUERY}`,
    );
    expect(screen.getByRole('link', { name: /pay with phonepe/i })).toHaveAttribute(
      'href',
      `phonepe://pay?${QUERY}`,
    );
    expect(screen.getByRole('link', { name: /pay with paytm/i })).toHaveAttribute(
      'href',
      `paytmmp://pay?${QUERY}`,
    );
  });

  // Chrome for Android refuses a bare `tez://` link with ERR_UNKNOWN_URL_SCHEME,
  // so each app has to be addressed by package through an intent URI instead.
  it('addresses each app by package through an intent URI on Android', () => {
    useUserAgent(ANDROID_UA);
    renderSheet();

    expect(screen.getByRole('link', { name: /pay with google pay/i })).toHaveAttribute(
      'href',
      `intent://pay?${QUERY}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`,
    );
    expect(screen.getByRole('link', { name: /pay with phonepe/i })).toHaveAttribute(
      'href',
      `intent://pay?${QUERY}#Intent;scheme=upi;package=com.phonepe.app;end`,
    );
    expect(screen.getByRole('link', { name: /pay with paytm/i })).toHaveAttribute(
      'href',
      `intent://pay?${QUERY}#Intent;scheme=upi;package=net.one97.paytm;end`,
    );
  });
});
