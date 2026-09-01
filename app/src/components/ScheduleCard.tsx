import type { ScheduleItem } from '../types';
import { formatClock, formatDate } from '../lib/event-time';
import { seatsLabel, type Signup } from '../lib/signups';

function titleCase(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function ScheduleCard({
  item,
  saved,
  onToggle,
  compact = false,
  signup,
  canBook = false,
  busy = false,
  onBook,
  onCancelBooking,
}: {
  item: ScheduleItem;
  saved: boolean;
  onToggle: (id: string) => void;
  compact?: boolean;
  /** This attendee's booking for this session, if they have one. */
  signup?: Signup;
  /** False until a device is paired; booking is not offered before then. */
  canBook?: boolean;
  busy?: boolean;
  onBook?: (id: string) => void;
  onCancelBooking?: (id: string) => void;
}) {
  const cancelled = item.public_status === 'cancelled';
  const bookable = item.signup_mode === 'app' && !cancelled;
  const seats = seatsLabel(item.seats_remaining);
  return (
    <article className={`schedule-card ${cancelled ? 'schedule-card--cancelled' : ''}`}>
      <div className="schedule-card__time">
        <strong>{item.is_all_day ? 'All day' : formatClock(item.start_time)}</strong>
        {!compact && <span>{formatDate(item.day)}</span>}
      </div>
      <div className="schedule-card__body">
        <div className="tag-row">
          <span className="tag">{titleCase(item.kind)}</span>
          {cancelled && <span className="tag tag--cancelled">Cancelled</span>}
          {bookable && <span className="tag tag--soft">Bookable</span>}
          {bookable && seats && (
            <span className={`tag ${item.seats_remaining === 0 ? 'tag--cancelled' : ''}`}>{seats}</span>
          )}
        </div>
        <h3>{item.title}</h3>
        {(item.location || item.host_name) && (
          <p className="schedule-card__meta">
            {[item.location, item.host_name ? `Hosted by ${item.host_name}` : null].filter(Boolean).join(' · ')}
          </p>
        )}
        {!compact && item.description && <p>{item.description}</p>}
        <div className="schedule-card__actions">
          <button
            type="button"
            className={`save-button ${saved ? 'save-button--saved' : ''}`}
            onClick={() => onToggle(item.id)}
            disabled={cancelled && !saved}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${item.title} from My Day` : `Save ${item.title} to My Day`}
          >
            {saved ? '★ Saved' : cancelled ? 'Unavailable' : '☆ My Day'}
          </button>
          {bookable && canBook && (
            signup
              ? (
                <button
                  type="button"
                  className="save-button save-button--saved"
                  disabled={busy}
                  onClick={() => onCancelBooking?.(item.id)}
                  aria-label={`Give up your place in ${item.title}`}
                >
                  {signup.status === 'confirmed' ? '✓ Booked' : '⏳ Waiting'}
                </button>
              )
              : (
                <button
                  type="button"
                  className="save-button"
                  disabled={busy}
                  onClick={() => onBook?.(item.id)}
                  aria-label={`Book a place in ${item.title}`}
                >
                  {item.seats_remaining === 0 ? 'Join waitlist' : 'Book'}
                </button>
              )
          )}
        </div>
      </div>
    </article>
  );
}
