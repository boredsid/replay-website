// worker/src/registration-email.ts
import type { Env } from './index';
import { sendEmail } from './apps-script';
import type { EditionRow } from './editions';
import { dayLabel } from './editions';
import { editionOrdinal, shortDateRange, capitalize } from './format';
import { buildGoogleCalendarUrl, buildWhatsAppShareUrl } from './calendar';
import type { Day, PassType } from './validation';

export interface ConfirmationInput {
  name: string;
  email: string;
  passType: PassType;
  days: Day[];
  amountPaid: number;
  discount: number;
  tier: string | null;
}

export async function sendRegistrationConfirmation(
  env: Env,
  edition: EditionRow,
  input: ConfirmationInput,
): Promise<void> {
  const ord = editionOrdinal(edition.slug);
  const editionDisplayName = (ord ? `REPLAY ${ord}` : 'REPLAY').trim();
  await sendEmail(env, {
    template: 'replay-registration',
    to: input.email,
    subject: `${editionDisplayName} — registration confirmed`,
    variables: {
      name: input.name,
      edition_name: editionDisplayName,
      venue: edition.venue,
      date_range: shortDateRange(edition.start_date, edition.end_date),
      pass_type: input.passType,
      days_label: dayLabel(input.days),
      seats: 1,
      amount_paid: input.amountPaid,
      discount_applied: input.discount,
      guild_tier: capitalize(input.tier ?? ''),
      calendar_google_url: buildGoogleCalendarUrl(edition),
      calendar_ics_url: `https://api.replaycon.in/api/ics/${edition.slug}.ics`,
      schedule_url: 'https://replaycon.in/schedule',
      instagram_url: 'https://instagram.com/replaycon',
      whatsapp_share_url: buildWhatsAppShareUrl(edition),
    },
  });
}
