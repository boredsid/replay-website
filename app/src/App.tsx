import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScheduleCard } from './components/ScheduleCard';
import { Announcements } from './components/Announcements';
import { loadAgenda, saveAgenda, toggleAgenda } from './lib/agenda';
import { fetchBootstrap } from './lib/api';
import { filterSchedule, uniqueValues } from './lib/schedule';
import { formatClock, formatDate, getEventStatus, nowAndNext } from './lib/event-time';
import type { AppTab, BootstrapData, ScheduleFilters, ScheduleItem } from './types';

const TABS: Array<{ id: AppTab; label: string; icon: string }> = [
  { id: 'now', label: 'Now', icon: '◉' },
  { id: 'schedule', label: 'Schedule', icon: '▦' },
  { id: 'my-day', label: 'My Day', icon: '★' },
  { id: 'map', label: 'Map', icon: '⌖' },
  { id: 'info', label: 'Info', icon: 'i' },
];

const VALID_TABS = new Set(TABS.map((tab) => tab.id));

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function initialTab(): AppTab {
  const value = window.location.hash.replace(/^#/, '') as AppTab;
  return VALID_TABS.has(value) ? value : 'now';
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="empty-state"><span aria-hidden="true">◇</span><h2>{title}</h2><p>{children}</p></div>;
}

function List({
  items,
  saved,
  onToggle,
  compact = false,
}: {
  items: ScheduleItem[];
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
  compact?: boolean;
}) {
  return <div className="schedule-list">{items.map((item) => (
    <ScheduleCard key={item.id} item={item} saved={saved.has(item.id)} onToggle={onToggle} compact={compact} />
  ))}</div>;
}

function NowView({ data, saved, onToggle, now }: {
  data: BootstrapData;
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
  now: Date;
}) {
  if (!data.edition) {
    return <Empty title="No current edition">The next REPLAY event will appear here after organisers publish it.</Empty>;
  }
  const status = getEventStatus(data.edition, now);
  const programme = nowAndNext(data.schedule, data.edition, now);
  const venueConfirmed = data.edition.venue !== 'TBD';

  return (
    <>
      <section className={`now-hero now-hero--${status.state}`} aria-labelledby="now-heading">
        <div className="status-pill"><span />{status.label}</div>
        <h1 id="now-heading">{status.headline}</h1>
        <p>{status.detail}</p>
        <div className="now-hero__details">
          <div><small>Daily hours</small><strong>{formatClock(data.edition.daily_start_time)}–{formatClock(data.edition.daily_end_time)}</strong></div>
          <div><small>Venue</small><strong>{venueConfirmed ? data.edition.venue : 'To be announced'}</strong></div>
        </div>
      </section>

      <section className="screen-section" aria-labelledby="happening-heading">
        <div className="section-heading-row"><div><span className="eyebrow">Live programme</span><h2 id="happening-heading">Happening now</h2></div><span className="count-badge">{programme.happening.length}</span></div>
        {programme.happening.length ? <List items={programme.happening} saved={saved} onToggle={onToggle} compact /> : (
          <p className="inline-notice">Nothing timed is live right now. Check the full schedule for all-day activities and later sessions.</p>
        )}
      </section>

      <section className="screen-section" aria-labelledby="next-heading">
        <div className="section-heading-row"><div><span className="eyebrow">Up next</span><h2 id="next-heading">The next start time</h2></div></div>
        {programme.next.length ? <List items={programme.next} saved={saved} onToggle={onToggle} compact /> : (
          <p className="inline-notice">There are no more published programme starts after this point.</p>
        )}
      </section>
    </>
  );
}

function ScheduleView({ data, saved, onToggle }: {
  data: BootstrapData;
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const [filters, setFilters] = useState<ScheduleFilters>({ day: '', kind: '', location: '', query: '' });
  const items = useMemo(() => filterSchedule(data.schedule, filters, saved), [data.schedule, filters, saved]);
  const kinds = useMemo(() => uniqueValues(data.schedule, 'kind'), [data.schedule]);
  const locations = useMemo(() => uniqueValues(data.schedule, 'location'), [data.schedule]);

  if (!data.edition) return <Empty title="Schedule not published">The next edition needs to be published before its programme can appear.</Empty>;
  return (
    <>
      <header className="screen-header"><span className="eyebrow">Plan your tables</span><h1>Schedule</h1><p>Filter the public programme or search by activity, host, and place.</p></header>
      <section className="filter-panel" aria-label="Schedule filters">
        <label className="search-field"><span>Search</span><input type="search" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Game, host, activity…" /></label>
        <div className="filter-grid">
          <label><span>Day</span><select value={filters.day} onChange={(event) => setFilters({ ...filters, day: event.target.value })}><option value="">All days</option><option value={data.edition.start_date}>{formatDate(data.edition.start_date)}</option><option value={data.edition.end_date}>{formatDate(data.edition.end_date)}</option></select></label>
          <label><span>Category</span><select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">All categories</option>{kinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll('-', ' ')}</option>)}</select></label>
          <label><span>Location</span><select value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })}><option value="">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
        </div>
      </section>
      <div className="results-row"><strong>{items.length} result{items.length === 1 ? '' : 's'}</strong>{Object.values(filters).some(Boolean) && <button type="button" className="text-button" onClick={() => setFilters({ day: '', kind: '', location: '', query: '' })}>Clear filters</button>}</div>
      {items.length ? <List items={items} saved={saved} onToggle={onToggle} /> : <Empty title="No matching sessions">Try clearing a filter or using a broader search.</Empty>}
    </>
  );
}

function MyDayView({ data, saved, onToggle }: {
  data: BootstrapData;
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const items = filterSchedule(data.schedule, { day: '', kind: '', location: '', query: '', savedOnly: true }, saved);
  return (
    <>
      <header className="screen-header"><span className="eyebrow">Saved on this device</span><h1>My Day</h1><p>Your picks stay in this browser. No account or attendee profile is created.</p></header>
      {items.length ? <List items={items} saved={saved} onToggle={onToggle} /> : <Empty title="Your day is wide open">Use the star on a schedule item to save it here.</Empty>}
    </>
  );
}

function MapView({ data }: { data: BootstrapData }) {
  const venue = data.edition?.venue;
  const confirmed = Boolean(venue && venue !== 'TBD');
  const mapUrl = confirmed ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue}, Bangalore`)}` : '';
  return (
    <>
      <header className="screen-header"><span className="eyebrow">Find your table</span><h1>Map</h1><p>Venue and floor-plan information will stay available after the app has been loaded once.</p></header>
      <section className="map-card" aria-labelledby="venue-heading">
        <div className="map-card__art" aria-hidden="true"><span>⌖</span><i /><i /><i /></div>
        <div><span className="eyebrow">Venue</span><h2 id="venue-heading">{confirmed ? venue : 'To be announced'}</h2>{confirmed ? <a className="button button--dark" href={mapUrl} target="_blank" rel="noreferrer">Open in Google Maps ↗</a> : <p>The address, arrival route, transit, and parking details are still being confirmed.</p>}</div>
      </section>
      <section className="pending-card"><span className="tag tag--soft">Floor plan pending</span><h2>Rooms and help points come next.</h2><p>Organisers still need to publish the rooms, play zones, help desk, food/water, accessibility points, and exits. The app will not guess these locations.</p></section>
    </>
  );
}

function InfoView({ data }: { data: BootstrapData }) {
  const edition = data.edition;
  return (
    <>
      <header className="screen-header"><span className="eyebrow">Event essentials</span><h1>Info</h1><p>Keep this guidance handy for arrival and support.</p></header>
      {edition && <section className="fact-grid"><div><small>Dates</small><strong>{formatDate(edition.start_date)}–{formatDate(edition.end_date, { day: 'numeric', month: 'short' })}</strong></div><div><small>Hours</small><strong>{formatClock(edition.daily_start_time)}–{formatClock(edition.daily_end_time)}</strong></div><div><small>Venue</small><strong>{edition.venue === 'TBD' ? 'To be announced' : edition.venue}</strong></div></section>}
      <section className="info-stack">
        <article><span className="info-number">1</span><div><h2>Check in with your registered phone number.</h2><p>Keep your confirmation email available as a second reference, especially if somebody else booked for you.</p></div></article>
        <article><span className="info-number">2</span><div><h2>Ask for an orientation.</h2><p>If you are new to board games or visiting alone, the team can help you find the library, programme, and a suitable table.</p></div></article>
        <article><span className="info-number">3</span><div><h2>Confirm venue policies before travelling.</h2><p>Accessibility, food/water, age policy, re-entry, transport, prohibited items, and same-day support are still being finalised.</p><a className="text-link" href="https://replaycon.in/plan-your-visit/" target="_blank" rel="noreferrer">Read Plan Your Visit ↗</a></div></article>
      </section>
      <section className="help-card"><span className="eyebrow">Need help?</span><h2>Email the REPLAY team.</h2><p>The same-day escalation route will be added once an owner is assigned.</p><a className="button button--light" href="mailto:hello@replaycon.in">hello@replaycon.in</a></section>
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<AppTab>(initialTab);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<Set<string>>(() => loadAgenda(window.localStorage));
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const online = useOnline();
  const now = useMinuteClock();

  const load = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    try {
      setData(await fetchBootstrap(controller.signal));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'request_failed');
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onHash = () => setTab(initialTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  const changeTab = (next: AppTab) => {
    setTab(next);
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const handleToggle = (id: string) => {
    setSaved((current) => {
      const next = toggleAgenda(current, id);
      saveAgenda(window.localStorage, next);
      return next;
    });
  };
  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="topbar">
        <button type="button" className="brand" onClick={() => changeTab('now')} aria-label="REPLAY event app home"><span>R</span><strong>REPLAY</strong><small>EVENT APP</small></button>
        <div className="topbar__actions">{installPrompt && <button type="button" className="install-button" onClick={install}>Install</button>}<span className={`network-dot ${online ? '' : 'network-dot--offline'}`} title={online ? 'Online' : 'Offline'}><i />{online ? 'Live' : 'Offline'}</span></div>
      </header>
      {!online && <div className="offline-banner" role="status">You are offline. Showing the last event data saved on this device.</div>}

      <main id="main-content" className="main-content">
        {loading && !data ? <div className="loading-state" aria-live="polite"><span /><p>Loading the event…</p></div> : error && !data ? <div className="error-state" role="alert"><span>!</span><h1>We could not load the event.</h1><p>{online ? 'The event service is temporarily unavailable.' : 'Connect once to save the event for offline use.'}</p><button className="button button--dark" type="button" onClick={() => void load()}>Try again</button></div> : data ? (
          <>
            <Announcements announcements={data.announcements} timezone={data.timezone} />
            {tab === 'now' && <NowView data={data} saved={saved} onToggle={handleToggle} now={now} />}
            {tab === 'schedule' && <ScheduleView data={data} saved={saved} onToggle={handleToggle} />}
            {tab === 'my-day' && <MyDayView data={data} saved={saved} onToggle={handleToggle} />}
            {tab === 'map' && <MapView data={data} />}
            {tab === 'info' && <InfoView data={data} />}
            <p className="updated-at">Programme snapshot updated {new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: data.timezone }).format(new Date(data.generated_at))} IST</p>
          </>
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="Event app">
        {TABS.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => changeTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small>{item.id === 'my-day' && saved.size > 0 && <b>{saved.size}</b>}</button>)}
      </nav>
    </div>
  );
}
