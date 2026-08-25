import { cn } from '@/lib/utils';

export type Status = 'confirmed' | 'pending' | 'cancelled' | 'paid' | 'draft' | 'published' | 'lead' | 'prospective';

const styles: Record<Status, string> = {
  confirmed: 'bg-status-confirmed text-status-confirmed-foreground',
  lead: 'bg-status-lead text-status-lead-foreground',
  prospective: 'bg-status-prospective text-status-prospective-foreground',
  pending: 'bg-status-pending text-status-pending-foreground',
  cancelled: 'bg-status-cancelled text-status-cancelled-foreground',
  paid: 'bg-status-paid text-status-paid-foreground',
  draft: 'bg-status-draft text-status-draft-foreground',
  published: 'bg-status-published text-status-published-foreground',
};

const labels: Record<Status, string> = {
  confirmed: 'Confirmed',
  lead: 'Lead',
  prospective: 'Prospective',
  pending: 'Pending',
  cancelled: 'Cancelled',
  paid: 'Paid',
  draft: 'Draft',
  published: 'Published',
};

interface Props { status: Status; className?: string }

export function StatusBadge({ status, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        styles[status],
        className,
      )}
    >
      {labels[status]}
    </span>
  );
}
