import { useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export interface UpiBottomSheetProps {
  amount: number;
  upiId: string;
  payeeName: string;
  transactionRef: string;
  onPaid: () => void;
  onClose: () => void;
}

export function UpiBottomSheet({ amount, upiId, payeeName, transactionRef, onPaid, onClose }: UpiBottomSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&tr=${encodeURIComponent(transactionRef)}&cu=INR`;

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
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/50"
    >
      <div className="flex min-h-full items-end justify-center md:items-center">
        <div className="card-brutal card-brutal-lg bg-[var(--color-paper)] w-full md:max-w-md mx-0 md:mx-6 rounded-b-none md:rounded-2xl p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="pill pill-accent mb-2">Pay ₹{amount}</span>
            <h2 id="upi-dialog-title" className="text-2xl mt-2">Scan or pay manually</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none font-bold">✕</button>
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
          <p><strong>UPI ID:</strong> {upiId}</p>
          <p><strong>Amount:</strong> ₹{amount}</p>
        </div>
        <p id="upi-dialog-description" className="text-xs text-gray-600 mb-4">Pay using any UPI app. Once paid, click below — we'll email you after we confirm the payment manually.</p>
        <a href={upiUrl} className="btn btn-secondary btn-block mb-3">Open your UPI app</a>
        <button onClick={onPaid} className="btn btn-primary btn-block">I've paid</button>
        </div>
      </div>
    </dialog>
  );
}

export default UpiBottomSheet;
