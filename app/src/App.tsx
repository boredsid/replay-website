import { useEffect, useMemo, useRef, useState } from 'react';
import { ScheduleCard } from './components/ScheduleCard';
import { Announcements } from './components/Announcements';
import { VenueMap } from './components/VenueMap';
import { loadAgenda, saveAgenda, toggleAgenda } from './lib/agenda';
import { visibleAnnouncements } from './lib/announcements';
import { isStale, useEventData } from './lib/use-event-data';
import Pass from './components/Pass';
import Wizard from './components/Wizard';
import InstallBox from './components/InstallBox';
import { loadDevice, type Device } from './lib/device';
import { isStandalone, watchInstallPrompt } from './lib/pwa';
import { loadWizard, resolveWizard, saveWizard, type WizardState, type WizardStep } from './lib/wizard';
import { filterSchedule, uniqueValues } from './lib/schedule';
import { formatClock, formatDate, getEventStatus, nowAndNext } from './lib/event-time';
import type { AppTab, BootstrapData, EditionData, ScheduleFilters, ScheduleItem } from './types';

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

function MyDayView({ data, saved, onToggle, device, onPaired, onUnpaired }: {
  data: BootstrapData;
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
  device: Device | null;
  onPaired: (device: Device) => void;
  onUnpaired: () => void;
}) {
  const items = filterSchedule(data.schedule, { day: '', kind: '', location: '', query: '', savedOnly: true }, saved);
  return (
    <>
      <header className="screen-header"><span className="eyebrow">Saved on this device</span><h1>My Day</h1><p>Your picks stay in this browser. No account or attendee profile is created.</p></header>
      {items.length ? <List items={items} saved={saved} onToggle={onToggle} /> : <Empty title="Your day is wide open">Use the star on a schedule item to save it here.</Empty>}
      <Pass device={device} onPaired={onPaired} onUnpaired={onUnpaired} />
    </>
  );
}

/** A labelled block that renders nothing until organisers publish the value. */
function Detail({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <div className="detail-block"><small>{label}</small><p>{value}</p></div>;
}

/** Joins two related values, tolerating either half being unpublished. */
function place(name?: string | null, distance?: string | null): string | null {
  return [name, distance].filter(Boolean).join(' · ') || null;
}

/**
 * Resolve a transit block's heading and body.
 *
 * In practice organisers use the `_name` column as a heading ("Nearest Metro
 * Station") and put the actual place and walking time in the `_distance`
 * column, which is how the public Plan Your Visit page renders them.
 * Concatenating the two produces a redundant line, so follow that convention
 * and fall back to the generic label when only one half is published.
 */
function transitDetail(label: string, name?: string | null, distance?: string | null):
  { label: string; value: string } | null {
  const value = distance || name;
  if (!value) return null;
  return { label: distance && name ? name : label, value };
}

function mapsHref(edition: EditionData): string {
  // Prefer the pin organisers actually published. A name search resolves an
  // office park by guesswork, which is the wrong answer to give someone who is
  // already on the road.
  if (edition.google_maps_url) return edition.google_maps_url;
  const target = edition.venue_address || `${edition.venue}, Bangalore`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
}

function MapView({ data }: { data: BootstrapData }) {
  const edition = data.edition;
  const confirmed = Boolean(edition && edition.venue && edition.venue !== 'TBD');
  const metro = transitDetail('Nearest metro', edition?.nearest_metro_name, edition?.nearest_metro_distance);
  const bus = transitDetail('Nearest bus stop', edition?.nearest_bus_stop_name, edition?.nearest_bus_stop_distance);
  const parking = place(edition?.parking_availability, edition?.parking_charges);
  const hasRoute = Boolean(metro || bus || parking);

  return (
    <>
      <header className="screen-header"><span className="eyebrow">Find your table</span><h1>Getting there</h1><p>Saved on this device, so it still works when the venue network does not.</p></header>

      <section className="map-card" aria-labelledby="venue-heading">
        <div className="map-card__art" aria-hidden="true"><span>⌖</span><i /><i /><i /></div>
        <div>
          <span className="eyebrow">Venue</span>
          <h2 id="venue-heading">{confirmed ? edition!.venue : 'To be announced'}</h2>
          {edition?.venue_address && <p className="map-card__address">{edition.venue_address}</p>}
          {confirmed && edition
            ? <a className="button button--dark" href={mapsHref(edition)} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
            : <p>The address, arrival route, transit, and parking details are still being confirmed.</p>}
        </div>
      </section>

      {(edition?.entrance_details || edition?.check_in_location) && (
        <section className="screen-section" aria-labelledby="arrival-heading">
          <div className="section-heading-row"><div><span className="eyebrow">On arrival</span><h2 id="arrival-heading">Finding the door</h2></div></div>
          <div className="detail-stack">
            <Detail label="Entrance" value={edition?.entrance_details} />
            <Detail label="Check-in" value={edition?.check_in_location} />
          </div>
        </section>
      )}

      {hasRoute && (
        <section className="screen-section" aria-labelledby="route-heading">
          <div className="section-heading-row"><div><span className="eyebrow">Public transport</span><h2 id="route-heading">Choose your route</h2></div></div>
          <div className="detail-stack">
            {metro && <Detail label={metro.label} value={metro.value} />}
            {bus && <Detail label={bus.label} value={bus.value} />}
            <Detail label="Parking" value={parking} />
          </div>
        </section>
      )}

      <VenueMap />
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
        <article><span className="info-number">1</span><div><h2>Check in with your registered phone number.</h2><p>{edition?.check_in_location || 'Keep your confirmation email available as a second reference, especially if somebody else booked for you.'}</p></div></article>
        <article><span className="info-number">2</span><div><h2>Ask for an orientation.</h2><p>If you are new to board games or visiting alone, the team can help you find the library, programme, and a suitable table.</p></div></article>
      </section>

      {edition?.game_library_process && (
        <section className="screen-section" aria-labelledby="library-heading">
          <div className="section-heading-row"><div><span className="eyebrow">Game library</span><h2 id="library-heading">Borrowing a game</h2></div></div>
          <div className="detail-stack"><div className="detail-block"><p>{edition.game_library_process}</p></div></div>
        </section>
      )}

      {edition && (
        <section className="screen-section" aria-labelledby="at-venue-heading">
          <div className="section-heading-row"><div><span className="eyebrow">At the venue</span><h2 id="at-venue-heading">Food, water and access</h2></div></div>
          <div className="detail-stack">
            <Detail label="Food" value={edition.food_details} />
            <Detail label="Water" value={edition.water_details} />
            {/* Accessibility always renders. Someone planning around an access
                need is worse off with silence than with an honest "not
                confirmed yet, ask us" and a route to a human. */}
            <div className="detail-block">
              <small>Accessibility</small>
              {edition.accessibility_details
                ? <p>{edition.accessibility_details}</p>
                : <p>Step-free access, accessible toilets, seating, sensory considerations, and accommodation contacts are still being confirmed. <a className="text-link" href="mailto:hello@replaycon.in">Email us</a> if you need to plan around a specific requirement.</p>}
            </div>
          </div>
        </section>
      )}

      <section className="info-stack">
        <article><span className="info-number">!</span><div><h2>Some policies are still being confirmed.</h2><p>Age policy, guardian rules, re-entry, last entry, and prohibited items are not final. Check before you travel.</p><a className="text-link" href="https://replaycon.in/plan-your-visit/" target="_blank" rel="noreferrer">Read Plan Your Visit ↗</a></div></article>
      </section>

      <section className="help-card">
        <span className="eyebrow">Need help?</span>
        <h2>{edition?.help_on_the_day ? 'Find us on the day.' : 'Email the REPLAY team.'}</h2>
        <p>{edition?.help_on_the_day || 'The same-day escalation route will be added once an owner is assigned.'}</p>
        <a className="button button--light" href="mailto:hello@replaycon.in">hello@replaycon.in</a>
      </section>
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<AppTab>(initialTab);
  const [saved, setSaved] = useState<Set<string>>(() => loadAgenda(window.localStorage));
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [device, setDevice] = useState<Device | null>(() => loadDevice());
  const [wizard, setWizard] = useState<WizardState>(() => loadWizard(window.localStorage));
  // A step the attendee asked for outright, as opposed to onboarding. Pairing
  // ends the wizard forever, but someone already paired can still be reading
  // this in a browser tab and wanting the install steps.
  const [askedFor, setAskedFor] = useState<WizardStep | null>(null);
  // Reset on every load on purpose: in a browser the nudge is meant to appear
  // each time the app is opened, and dismissing it should only quiet it for the
  // sitting it was dismissed in.
  const [dismissedThisOpen, setDismissedThisOpen] = useState(false);
  const standalone = useMemo(() => isStandalone(), []);
  const online = useOnline();
  const now = useMinuteClock();
  const { data, error, loading, refreshing, fetchedAt, refresh } = useEventData();
  const mainRef = useRef<HTMLElement>(null);

  // Recomputed against the minute clock so a notice aimed at the other day
  // disappears when the date rolls over, without needing a refetch.
  const notices = useMemo(
    () => (data ? visibleAnnouncements(data.announcements, data.edition, now) : []),
    [data, now],
  );
  const stale = isStale(fetchedAt, now.getTime());

  useEffect(() => {
    const onHash = () => setTab(initialTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    // Module-level capture: the event fires once and early, often before the
    // wizard has mounted, so it has to be caught and replayed rather than
    // listened for from inside a component.
    watchInstallPrompt();
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  const updateWizard = (next: WizardState) => {
    setWizard(next);
    saveWizard(window.localStorage, next);
  };

  const changeTab = (next: AppTab) => {
    setTab(next);
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Without this a keyboard or screen-reader user stays parked in the old
    // tab's content while the visible screen changes underneath them.
    mainRef.current?.focus();
  };
  const handleToggle = (id: string) => {
    setSaved((current) => {
      const next = toggleAgenda(current, id);
      saveAgenda(window.localStorage, next);
      return next;
    });
  };
  const install = async () => {
    // Only Chromium ever gives us a prompt. Everywhere else -- iOS above all --
    // the honest answer is to show the steps, which the wizard already words
    // per platform.
    if (!installPrompt) {
      setAskedFor('install');
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const snapshot = data && fetchedAt !== null
    ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: data.timezone }).format(new Date(fetchedAt))
    : null;

  const wizardView = resolveWizard(wizard, { paired: device !== null, standalone });
  const inBrowser = !standalone;
  const setupIncomplete = device === null;

  // Setup wins whenever both would apply: its first step is the install
  // instructions anyway, and it carries on to pairing afterwards.
  const showWizard = !dismissedThisOpen
    && setupIncomplete
    && (inBrowser || wizardView.open);
  const showInstallBox = !dismissedThisOpen && !showWizard && inBrowser;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {/* In a browser the wizard reappears on every open until setup is done,
          so the prompt actually reaches people before the event. Once installed
          it reverts to a one-off, dismissed for good via stored state. */}
      {(showWizard || askedFor) && (
        <Wizard
          step={askedFor ?? wizardView.step}
          standalone={standalone}
          onStep={(step) => (askedFor ? setAskedFor(step) : updateWizard({ ...wizard, step }))}
          onDismiss={() => {
            setAskedFor(null);
            setDismissedThisOpen(true);
            updateWizard({ ...wizard, dismissed: true });
          }}
          onPaired={(next) => {
            setDevice(next);
            setAskedFor(null);
            updateWizard({ ...wizard, dismissed: true });
          }}
        />
      )}
      {showInstallBox && <InstallBox onDismiss={() => setDismissedThisOpen(true)} />}
      <header className="topbar">
        <button type="button" className="brand" onClick={() => changeTab('now')} aria-label="REPLAY event app home"><span>R</span><strong>REPLAY</strong><small>EVENT APP</small></button>
        <div className="topbar__actions">
          {/* Only once the app is on the home screen. Until then the install
              nudge takes the slot: before the event nobody can pair anyway, so
              "Finish setup" would otherwise sit there for everyone, permanently
              hiding the one prompt that can actually be acted on. */}
          {wizardView.showResume && standalone && (
            <button
              type="button"
              className="install-button"
              onClick={() => updateWizard({ step: 'pair', dismissed: false })}
            >
              Finish setup
            </button>
          )}
          <button type="button" className="refresh-button" onClick={refresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing event data' : 'Refresh event data'}>
            <span aria-hidden="true" className={refreshing ? 'refresh-button__icon refresh-button__icon--spinning' : 'refresh-button__icon'}>↻</span>
          </button>
          <span className={`network-dot ${online ? '' : 'network-dot--offline'}`} title={online ? 'Online' : 'Offline'}><i />{online ? 'Live' : 'Offline'}</span>
        </div>
      </header>
      {!online && <div className="offline-banner" role="status">You are offline. Showing the last event data saved on this device.</div>}
      {online && stale && data && <div className="offline-banner offline-banner--stale" role="status">This event data is more than 10 minutes old. <button type="button" className="text-button" onClick={refresh}>Refresh now</button></div>}

      <main id="main-content" className="main-content" ref={mainRef} tabIndex={-1}>
        {loading && !data ? <div className="loading-state" aria-live="polite"><span /><p>Loading the event…</p></div> : error && !data ? <div className="error-state" role="alert"><span>!</span><h1>We could not load the event.</h1><p>{online ? 'The event service is temporarily unavailable.' : 'Connect once to save the event for offline use.'}</p><button className="button button--dark" type="button" onClick={refresh}>Try again</button></div> : data ? (
          <>
            <Announcements announcements={notices} timezone={data.timezone} />
            {tab === 'now' && <NowView data={data} saved={saved} onToggle={handleToggle} now={now} />}
            {tab === 'schedule' && <ScheduleView data={data} saved={saved} onToggle={handleToggle} />}
            {tab === 'my-day' && <MyDayView data={data} saved={saved} onToggle={handleToggle} device={device} onPaired={setDevice} onUnpaired={() => setDevice(null)} />}
            {tab === 'map' && <MapView data={data} />}
            {tab === 'info' && <InfoView data={data} />}
            <p className="updated-at" aria-live="polite">
              {snapshot ? `Updated ${snapshot} IST` : 'Updating…'}
              {error ? ' · last refresh failed' : ''}
            </p>
          </>
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="Event app">
        {TABS.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => changeTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small>{item.id === 'my-day' && saved.size > 0 && <b>{saved.size}</b>}</button>)}
      </nav>
    </div>
  );
}
