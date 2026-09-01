import type { ScheduleItem } from '../types';
import { formatClock, formatDate } from '../lib/event-time';

function titleCase(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function ScheduleCard({
  item,
  saved,
  onToggle,
  compact = false,
}: {
  item: ScheduleItem;
  saved: boolean;
  onToggle: (id: string) => void;
  compact?: boolean;
}) {
  const cancelled = item.public_status === 'cancelled';
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
          {item.signup_mode === 'app' && <span className="tag tag--soft">Bookable</span>}
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
        </div>
      </div>
    </article>
  );
}
