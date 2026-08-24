export const BUSINESS_WHATSAPP_NUMBER = '919606598024';

export function whatsappContactUrl(message: string): string {
  return `https://wa.me/${BUSINESS_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
