export interface SuccessScreenProps {
  pending: boolean;
  editionName: string;
}

const WHATSAPP_COMMUNITY_URL = 'https://chat.whatsapp.com/KMfBSQORNArFC88yvJs5ha?mode=gi_t';

export function SuccessScreen({ pending, editionName }: SuccessScreenProps) {
  return (
    <div className="py-6 text-center">
      <span className="pill pill-accent mb-4">{pending ? 'Pending' : 'Confirmed'}</span>
      <h2 className="text-4xl mb-4">{pending ? 'Got it.' : "You're in!"}</h2>
      <p className="text-gray-700 mb-8 text-lg">
        {pending
          ? `We'll email you once we confirm your payment for ${editionName}.`
          : `Confirmation for ${editionName} is on its way to your inbox.`}
      </p>
      <div className="flex flex-col items-center gap-3">
        <a
          href={WHATSAPP_COMMUNITY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn max-w-full whitespace-normal text-sm no-underline"
          style={{ background: '#25D366', color: '#1A1A1A' }}
        >
          Join the REPLAY WhatsApp community to stay updated
        </a>
        <a href="/" className="btn btn-secondary">Back to home</a>
      </div>
    </div>
  );
}

export default SuccessScreen;
