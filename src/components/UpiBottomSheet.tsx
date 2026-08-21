import { useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export interface UpiBottomSheetProps {
  amount: number;
  upiId: string;
  payeeName: string;
  transactionRef: string;
  onPaid: () => void | Promise<void>;
  onClose: () => void;
  isSubmitting?: boolean;
  error?: string | null;
}

function buildUpiUrl(
  scheme: string,
  path: string,
  amount: number,
  upiId: string,
  payeeName: string,
  transactionRef: string,
): string {
  return `${scheme}://${path}pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&tr=${encodeURIComponent(transactionRef)}&cu=INR`;
}

export function UpiBottomSheet({
  amount,
  upiId,
  payeeName,
  transactionRef,
  onPaid,
  onClose,
  isSubmitting = false,
  error = null,
}: UpiBottomSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&tr=${encodeURIComponent(transactionRef)}&cu=INR`;
  const gpayUrl = buildUpiUrl('tez', 'upi/', amount, upiId, payeeName, transactionRef);
  const phonepeUrl = buildUpiUrl('phonepe', '', amount, upiId, payeeName, transactionRef);
  const paytmUrl = buildUpiUrl('paytmmp', '', amount, upiId, payeeName, transactionRef);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      if (!dialog?.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="upi-dialog-title"
      aria-describedby="upi-dialog-description"
      onCancel={(event) => { event.preventDefault(); if (!isSubmitting) onClose(); }}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/50"
    >
      <div className="flex min-h-full items-end justify-center md:items-center">
        <div className="card-brutal card-brutal-lg bg-[var(--color-paper)] w-full md:max-w-md mx-0 md:mx-6 rounded-b-none md:rounded-2xl p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="pill pill-accent mb-2">Pay ₹{amount}</span>
            <h2 id="upi-dialog-title" className="text-2xl mt-2">Scan or pay with an app</h2>
          </div>
          <button onClick={onClose} disabled={isSubmitting} aria-label="Close" className="text-2xl leading-none font-bold disabled:opacity-50">✕</button>
        </div>
        <div className="card-flat p-3 mb-4 text-center">
          <QRCodeSVG
            value={upiUrl}
            size={240}
            level="M"
            marginSize={2}
            title={`UPI payment QR for ₹${amount}`}
            className="mx-auto h-auto max-w-full"
          />
        </div>
        <div className="space-y-1 mb-4 text-sm">
          <p><strong>Amount:</strong> ₹{amount}</p>
        </div>
        <p id="upi-dialog-description" className="text-xs text-gray-600 mb-4">Pay using any UPI app. Once paid, click below — we'll email you after we confirm the payment manually.</p>
        <div className="mb-4">
          <p className="label-brutal text-center mb-3">Or pay directly with</p>
          <div className="grid grid-cols-3 gap-3">
            <a
              href={gpayUrl}
              aria-label="Pay with Google Pay"
              className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
              style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
            >
              <img src="/payment-app-icons/gpay.png" alt="Google Pay" className="max-h-10 max-w-[80%] object-contain" />
            </a>
            <a
              href={phonepeUrl}
              aria-label="Pay with PhonePe"
              className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
              style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
            >
              <img src="/payment-app-icons/phonepe.png" alt="PhonePe" className="max-h-10 max-w-[80%] object-contain" />
            </a>
            <a
              href={paytmUrl}
              aria-label="Pay with Paytm"
              className="flex items-center justify-center h-16 rounded-xl no-underline transition-transform hover:-translate-x-[2px] hover:-translate-y-[2px]"
              style={{ background: '#FFFFFF', border: '3px solid #1A1A1A', boxShadow: '4px 4px 0 #1A1A1A' }}
            >
              <img src="/payment-app-icons/paytm.jpg" alt="Paytm" className="max-h-10 max-w-[80%] object-contain" />
            </a>
          </div>
        </div>
        {error && <p role="alert" className="mb-4 text-sm font-medium text-[var(--color-error)]">{error}</p>}
        <button onClick={onPaid} disabled={isSubmitting} className="btn btn-primary btn-block">
          {isSubmitting ? 'Recording…' : "I've paid"}
        </button>
        </div>
      </div>
    </dialog>
  );
}

export default UpiBottomSheet;
