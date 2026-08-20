import { describe, it, expect } from 'vitest';
import {
  sanitizePhone,
  parsePaymentStatus,
  parsePassAndDays,
  parseGuildTier,
  parseOrderItems,
  normalizeChannel,
  expectedBase,
  mapReplay1Registration,
  mapReplay2Registration,
  mapReplay2Order,
  assignWalkinPhones,
  type EditionPricing,
  type UserUpsert,
} from './mappers';

const R2_PRICING: EditionPricing = {
  oneshot: 800,
  campaign: 1400,
  adventurer_cap: 1000,
};

describe('sanitizePhone', () => {
  it('keeps last 10 digits, stripping +91 and spaces', () => {
    expect(sanitizePhone('+91 98765 43210')).toBe('9876543210');
  });
  it('returns empty for too-short input', () => {
    expect(sanitizePhone('12345')).toBe('');
  });
  it('returns empty for non-string', () => {
    expect(sanitizePhone(undefined)).toBe('');
  });
});

describe('parsePaymentStatus', () => {
  it('maps Paid to confirmed', () => expect(parsePaymentStatus('Paid')).toBe('confirmed'));
  it('maps Cancelled (two L) to cancelled', () => expect(parsePaymentStatus('Cancelled')).toBe('cancelled'));
  it('maps Canceled (one L) to cancelled', () => expect(parsePaymentStatus('Canceled')).toBe('cancelled'));
  it('maps Pending to pending', () => expect(parsePaymentStatus('Pending')).toBe('pending'));
  it('defaults blank to pending', () => expect(parsePaymentStatus('')).toBe('pending'));
});

describe('parsePassAndDays', () => {
  it('maps One Shot + Saturday to oneshot day1', () => {
    expect(parsePassAndDays('One Shot (Day Pass)', 'Saturday, Apr 18')).toEqual({ pass_type: 'oneshot', days: ['day1'] });
  });
  it('maps One Shot + Sunday to oneshot day2', () => {
    expect(parsePassAndDays('One Shot (Day Pass)', 'Sunday, Apr 19')).toEqual({ pass_type: 'oneshot', days: ['day2'] });
  });
  it('maps Campaign + Both days to campaign both days', () => {
    expect(parsePassAndDays('Campaign (2-Day Pass)', 'Both days')).toEqual({ pass_type: 'campaign', days: ['day1', 'day2'] });
  });
});

describe('parseGuildTier', () => {
  it('parses Guildmaster', () => expect(parseGuildTier('Guildmaster (100% off)')).toBe('guildmaster'));
  it('parses Adventurer', () => expect(parseGuildTier('Adventurer (71% off)')).toBe('adventurer'));
  it('returns null for Credits Used', () => expect(parseGuildTier('150 Credits Used')).toBeNull());
  it('returns null for blank', () => expect(parseGuildTier('')).toBeNull());
});

describe('parseOrderItems', () => {
  it('parses a valid order array', () => {
    const raw = '[{"name":"Exploding Kittens","qty":1,"price":789}]';
    expect(parseOrderItems(raw)).toEqual([{ name: 'Exploding Kittens', qty: 1, price: 789 }]);
  });
  it('throws on malformed item', () => {
    expect(() => parseOrderItems('[{"name":"x"}]')).toThrow();
  });
  it('throws on non-array', () => {
    expect(() => parseOrderItems('{"name":"x"}')).toThrow();
  });
});

describe('normalizeChannel', () => {
  it('defaults to website', () => expect(normalizeChannel('Website')).toBe('website'));
  it('detects swiggy', () => expect(normalizeChannel('Swiggy')).toBe('swiggy'));
  it('detects whatsaround', () => expect(normalizeChannel('WhatsAround')).toBe('whatsaround'));
});

describe('expectedBase', () => {
  it('oneshot single day times seats', () => {
    expect(expectedBase(R2_PRICING, 'oneshot', ['day1'], 2)).toBe(1600);
  });
  it('campaign uses campaign price times seats', () => {
    expect(expectedBase(R2_PRICING, 'campaign', ['day1', 'day2'], 1)).toBe(1400);
  });
});

describe('mapReplay1Registration', () => {
  it('maps a paid single-day row', () => {
    const row = { Timestamp: '2026-01-26 10:56:08', 'Phone Number': '8879621486', Name: 'Aalhad', Status: 'Paid', Seats: '1', Paid: '800' };
    const out = mapReplay1Registration(row)!;
    expect(out.user).toEqual({ phone: '8879621486', name: 'Aalhad', email: null });
    expect(out.registration).toMatchObject({
      user_phone: '8879621486', pass_type: 'oneshot', days: ['day1'], seats: 1,
      amount_paid: 800, discount_applied: 0, guild_tier_at_purchase: null,
      payment_status: 'confirmed', source: { channel: 'website' },
    });
  });
  it('uses placeholder phone and preserves guest_name when phone is blank', () => {
    const out = mapReplay1Registration({ Timestamp: '2026-01-31 10:00:00', 'Phone Number': '', Name: 'Pragya', Status: 'Paid', Seats: '1', Paid: '800' })!;
    expect(out.user).toEqual({ phone: '0000000000', name: null, email: null });
    expect(out.registration.user_phone).toBe('0000000000');
    expect(out.registration.source).toEqual({ channel: 'website', guest_name: 'Pragya' });
  });
});

describe('mapReplay2Registration', () => {
  it('maps a campaign row with adventurer discount', () => {
    const row = { Name: 'Chai', Phone: '7898847988', Email: 'c@x.com', 'Pass Type': 'Campaign (2-Day Pass)', Day: 'Both days', Quantity: '1', Paid: '400', Discount: 'Adventurer (71% off)', 'Payment Status': 'Paid', 'Seats used': '2', Source: 'Website' };
    const out = mapReplay2Registration(row, R2_PRICING)!;
    expect(out.user).toEqual({ phone: '7898847988', name: 'Chai', email: 'c@x.com' });
    expect(out.registration).toMatchObject({
      pass_type: 'campaign', days: ['day1', 'day2'], seats: 1, amount_paid: 400,
      discount_applied: 1000, guild_tier_at_purchase: 'adventurer',
      payment_status: 'confirmed', source: { channel: 'website' },
    });
  });
  it('uses Quantity not Seats used for seats', () => {
    const row = { Name: 'X', Phone: '9000000000', Email: '', 'Pass Type': 'Campaign (2-Day Pass)', Day: 'Both days', Quantity: '1', Paid: '1400', Discount: '', 'Payment Status': 'Paid', 'Seats used': '2', Source: 'Website' };
    const out = mapReplay2Registration(row, R2_PRICING)!;
    expect(out.registration.seats).toBe(1);
    expect(out.registration.discount_applied).toBe(0);
  });
  it('uses placeholder phone and preserves guest_name for a phone-less walk-in', () => {
    const row = { Name: 'Amandeep Singh', Phone: '', Email: '', 'Pass Type': 'One Shot (Day Pass)', Day: 'Saturday, Apr 18', Quantity: '1', Paid: '800', Discount: 'None', 'Payment Status': 'Paid', 'Seats used': '1', Source: 'Website' };
    const out = mapReplay2Registration(row, R2_PRICING)!;
    expect(out.user).toEqual({ phone: '0000000000', name: null, email: null });
    expect(out.registration).toMatchObject({
      user_phone: '0000000000', pass_type: 'oneshot', days: ['day1'], seats: 1,
      amount_paid: 800, discount_applied: 0, payment_status: 'confirmed',
      source: { channel: 'website', guest_name: 'Amandeep Singh' },
    });
  });
});

describe('mapReplay2Order', () => {
  it('maps an order row with parsed items', () => {
    const row = { Name: 'Pratik', Phone: '7742251441', Email: 'p@x.com', 'Order Details': '[{"name":"Forest Friends","qty":1,"price":399}]', 'Amount paid': '399', 'Payment Status': 'Paid' };
    const out = mapReplay2Order(row)!;
    expect(out.user.phone).toBe('7742251441');
    expect(out.order).toMatchObject({
      user_phone: '7742251441', total: 399, payment_status: 'confirmed', source: { channel: 'website' },
      items: [{ name: 'Forest Friends', qty: 1, price: 399 }],
    });
  });
});

describe('assignWalkinPhones', () => {
  const u = (phone: string, name: string | null = null, email: string | null = null): UserUpsert => ({ phone, name, email });

  it('gives each walk-in its own sequential synthetic phone + named user, leaving real-phone rows untouched', () => {
    const a = { user: u('0000000000'), target: { user_phone: '0000000000', source: { channel: 'website' as const, guest_name: 'Amandeep' } } };
    const b = { user: u('9876543210', 'Real', 'r@x.com'), target: { user_phone: '9876543210', source: { channel: 'website' as const } } };
    const c = { user: u('0000000000'), target: { user_phone: '0000000000', source: { channel: 'website' as const, guest_name: 'Avinash' } } };
    const next = assignWalkinPhones([a, b, c], 0);
    expect(next).toBe(2);
    expect(a.user).toEqual({ phone: '0000000000', name: 'Amandeep', email: null });
    expect(a.target.user_phone).toBe('0000000000');
    expect(b.user).toEqual({ phone: '9876543210', name: 'Real', email: 'r@x.com' }); // untouched
    expect(b.target.user_phone).toBe('9876543210');
    expect(c.user).toEqual({ phone: '0000000001', name: 'Avinash', email: null });
    expect(c.target.user_phone).toBe('0000000001');
  });

  it('continues numbering from the start argument (chaining across lists)', () => {
    const a = { user: u('0000000000'), target: { user_phone: '0000000000', source: { channel: 'website' as const, guest_name: 'X' } } };
    const next = assignWalkinPhones([a], 5);
    expect(next).toBe(6);
    expect(a.user.phone).toBe('0000000005');
    expect(a.target.user_phone).toBe('0000000005');
  });
});
