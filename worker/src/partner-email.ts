import type { Env } from './index';
import type { EditionRow } from './editions';
import { sendEmail } from './apps-script';
import { dayLabel } from './editions';
import { editionOrdinal, shortDateRange } from './format';
import { PARTNER_PACKAGE_LABELS, type PartnerPackageKey } from './partner-pricing';

export interface PartnerConfirmationInput {
  organizationName: string;
  contactName: string;
  email: string;
  packageKey: PartnerPackageKey;
  days: Array<'day1' | 'day2'>;
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  details: string | null;
}

export async function sendPartnerConfirmation(
  env: Env,
  edition: EditionRow,
  input: PartnerConfirmationInput,
): Promise<void> {
  const ordinal = editionOrdinal(edition.slug);
  const editionName = (ordinal ? `REPLAY ${ordinal}` : 'REPLAY').trim();
  await sendEmail(env, {
    template: 'replay-partner',
    to: input.email,
    subject: `${editionName} — partner booking confirmed`,
    variables: {
      contact_name: input.contactName,
      organization_name: input.organizationName,
      edition_name: editionName,
      venue: edition.venue,
      date_range: shortDateRange(edition.start_date, edition.end_date),
      package_name: PARTNER_PACKAGE_LABELS[input.packageKey],
      days_label: dayLabel(input.days),
      base_amount: input.baseAmount.toLocaleString('en-IN'),
      gst_amount: input.gstAmount.toLocaleString('en-IN'),
      total_amount: input.totalAmount.toLocaleString('en-IN'),
      details: input.details ?? '',
      contact_url: 'https://replaycon.in/contact',
    },
  });
}
