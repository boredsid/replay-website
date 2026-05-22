export interface SuccessScreenProps {
  pending: boolean;
  editionName: string;
}

export function SuccessScreen({ pending, editionName }: SuccessScreenProps) {
  return (
    <div className="container-x section text-center max-w-xl">
      <div className="card-brutal card-brutal-lg p-10">
        <span className="pill pill-accent mb-4">{pending ? 'Pending' : 'Confirmed'}</span>
        <h2 className="text-4xl mb-4">{pending ? 'Got it.' : "You're in!"}</h2>
        <p className="text-gray-700 mb-8 text-lg">
          {pending
            ? `We'll email you once we confirm your payment for ${editionName}.`
            : `Confirmation for ${editionName} is on its way to your inbox.`}
        </p>
        <a href="/" className="btn btn-secondary">Back to home</a>
      </div>
    </div>
  );
}

export default SuccessScreen;
