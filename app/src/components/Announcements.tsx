import type { AnnouncementData } from '../types';

const AUDIENCE_LABEL: Record<AnnouncementData['audience'], string> = {
  all: 'Everyone',
  day1: 'Day 1 attendees',
  day2: 'Day 2 attendees',
};

const SEVERITY_LABEL: Record<AnnouncementData['severity'], string> = {
  info: 'Event update',
  urgent: 'Important update',
  incident: 'Safety notice',
};

function noticeTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

export function Announcements({ announcements, timezone }: {
  announcements: AnnouncementData[];
  timezone: string;
}) {
  if (!announcements.length) return null;

  return (
    <section className="announcement-stack" aria-labelledby="announcements-heading">
      <div className="announcement-stack__heading">
        <span className="eyebrow">From the event team</span>
        <h2 id="announcements-heading">Live updates</h2>
      </div>
      {announcements.map((announcement) => (
        <article
          key={announcement.id}
          className={`announcement announcement--${announcement.severity}`}
          role={announcement.severity === 'info' ? 'status' : 'alert'}
        >
          <div className="announcement__marker" aria-hidden="true">
            {announcement.severity === 'incident' ? '!' : announcement.severity === 'urgent' ? '↑' : 'i'}
          </div>
          <div>
            <div className="announcement__meta">
              <span>{SEVERITY_LABEL[announcement.severity]}</span>
              <span>{AUDIENCE_LABEL[announcement.audience]}</span>
            </div>
            <h3>{announcement.title}</h3>
            <p>{announcement.body}</p>
            <small>
              Posted {noticeTime(announcement.starts_at, timezone)}
              {announcement.ends_at ? ` · Until ${noticeTime(announcement.ends_at, timezone)}` : ''}
            </small>
          </div>
        </article>
      ))}
    </section>
  );
}
