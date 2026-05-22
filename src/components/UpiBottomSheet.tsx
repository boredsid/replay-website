export interface UpiBottomSheetProps {
  amount: number;
  upiId: string;
  payeeName: string;
  transactionRef: string;
  onPaid: () => void;
  onClose: () => void;
}

export function UpiBottomSheet({ amount, upiId, payeeName, transactionRef, onPaid, onClose }: UpiBottomSheetProps) {
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&tr=${encodeURIComponent(transactionRef)}&cu=INR`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(upiUrl)}`;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50">
      <div className="card-brutal card-brutal-lg bg-[var(--color-paper)] w-full md:max-w-md mx-0 md:mx-6 rounded-b-none md:rounded-2xl p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="pill pill-accent mb-2">Pay ₹{amount}</span>
            <h3 className="text-2xl mt-2">Scan or pay manually</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-2xl leading-none font-bold">✕</button>
        </div>
        <div className="card-flat p-3 mb-4 text-center">
          <img src={qrUrl} alt="UPI QR" className="mx-auto" width={240} height={240} />
        </div>
        <div className="space-y-1 mb-4 text-sm">
          <p><strong>UPI ID:</strong> {upiId}</p>
          <p><strong>Amount:</strong> ₹{amount}</p>
        </div>
        <p className="text-xs text-gray-600 mb-4">Pay using any UPI app. Once paid, click below — we'll email you after we confirm the payment manually.</p>
        <button onClick={onPaid} className="btn btn-primary btn-block">I've paid</button>
      </div>
    </div>
  );
}

export default UpiBottomSheet;
