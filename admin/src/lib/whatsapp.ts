// admin/src/lib/whatsapp.ts
// Leads are captured as bare 10-digit Indian numbers (see the leads_phone_format
// check constraint), so wa.me links need the country code prefixed.

export function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') ? digits : `91${digits}`;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const rest = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (rest.length !== 10) return `+91 ${rest}`;
  return `+91 ${rest.slice(0, 5)} ${rest.slice(5)}`;
}

export function leadWhatsappUrl(phone: string, name?: string | null): string {
  const greeting = name?.trim() ? `Hi ${name.trim()}!` : 'Hi!';
  const text = `${greeting} Saw you started booking tickets for REPLAY — anything I can help with?`;
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}
