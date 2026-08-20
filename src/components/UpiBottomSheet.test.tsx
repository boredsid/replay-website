import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpiBottomSheet } from './UpiBottomSheet';

describe('UpiBottomSheet', () => {
  it('hides the UPI ID and offers Google Pay, PhonePe, and Paytm buttons', () => {
    render(
      <UpiBottomSheet
        amount={700}
        upiId="test@upi"
        payeeName="REPLAY Convention"
        transactionRef="registration-123"
        onPaid={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText(/UPI ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText('test@upi')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open your UPI app/i })).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: /pay with google pay/i })).toHaveAttribute(
      'href',
      'tez://upi/pay?pa=test%40upi&pn=REPLAY%20Convention&am=700&tr=registration-123&cu=INR',
    );
    expect(screen.getByRole('link', { name: /pay with phonepe/i })).toHaveAttribute(
      'href',
      'phonepe://pay?pa=test%40upi&pn=REPLAY%20Convention&am=700&tr=registration-123&cu=INR',
    );
    expect(screen.getByRole('link', { name: /pay with paytm/i })).toHaveAttribute(
      'href',
      'paytmmp://pay?pa=test%40upi&pn=REPLAY%20Convention&am=700&tr=registration-123&cu=INR',
    );
  });
});
