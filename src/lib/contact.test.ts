import { describe, expect, it } from 'vitest';
import { BUSINESS_WHATSAPP_NUMBER, whatsappContactUrl } from './contact';

describe('whatsappContactUrl', () => {
  it('uses the REPLAY business number and encodes the message', () => {
    expect(BUSINESS_WHATSAPP_NUMBER).toBe('919606598024');
    expect(whatsappContactUrl('Hi, I have a question about REPLAY.')).toBe(
      'https://wa.me/919606598024?text=Hi%2C%20I%20have%20a%20question%20about%20REPLAY.',
    );
  });
});
