export const BUSINESS_WHATSAPP_NUMBER = '919606598024';

/**
 * The same number as it should be read aloud, for anywhere the number itself
 * is the label rather than the destination — the app's help card, for one.
 * Kept beside the dialling form so the two can never drift apart.
 */
export const BUSINESS_WHATSAPP_DISPLAY = '+91 96065 98024';

export function whatsappContactUrl(message: string): string {
  return `https://wa.me/${BUSINESS_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
