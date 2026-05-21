// src/components/UpiBottomSheet.tsx
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
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-md p-6">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-xl font-bold">Pay ₹{amount}</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-500">✕</button>
        </div>
        <div className="text-center mb-4">
          <img src={qrUrl} alt="UPI QR" className="mx-auto" width={240} height={240} />
        </div>
        <p className="text-sm text-gray-700 mb-2"><strong>UPI ID:</strong> {upiId}</p>
        <p className="text-sm text-gray-700 mb-4"><strong>Amount:</strong> ₹{amount}</p>
        <p className="text-xs text-gray-500 mb-4">Pay using any UPI app. Once paid, click below — we'll email you after we confirm the payment manually.</p>
        <button onClick={onPaid} className="w-full bg-[var(--color-replay-orange)] text-white py-3 rounded font-bold">I've paid</button>
      </div>
    </div>
  );
}

export default UpiBottomSheet;
