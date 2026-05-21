// src/components/SuccessScreen.tsx
export interface SuccessScreenProps {
  pending: boolean;
  editionName: string;
}

export function SuccessScreen({ pending, editionName }: SuccessScreenProps) {
  return (
    <div className="px-6 py-12 max-w-md mx-auto text-center">
      <h2 className="text-3xl font-bold mb-3">{pending ? 'Got it.' : 'You\'re in!'}</h2>
      <p className="text-gray-700 mb-4">
        {pending
          ? `We\'ll email you once we confirm your payment for ${editionName}.`
          : `Confirmation for ${editionName} is on its way to your inbox.`}
      </p>
      <a href="/" className="text-sm underline">Back to home</a>
    </div>
  );
}

export default SuccessScreen;
