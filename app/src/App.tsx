import { useEffect, useMemo, useRef, useState } from 'react';
import { ScheduleCard } from './components/ScheduleCard';
import { Announcements } from './components/Announcements';
import { VenueMap } from './components/VenueMap';
import { loadAgenda, saveAgenda, toggleAgenda } from './lib/agenda';
import { visibleAnnouncements } from './lib/announcements';
import { isStale, useEventData } from './lib/use-event-data';
import IdCard from './components/IdCard';
import { Radio, CalendarDays, Star, Map as MapIcon, IdCard as IdIcon, type LucideIcon } from 'lucide-react';
import Wizard from './components/Wizard';
import InstallBox from './components/InstallBox';
import { clearDevice, loadDevice, type Device } from './lib/device';
import { bySession, cancelSignup, fetchSignups, signUp, type Signup } from './lib/signups';
import { mergeSaved, pushSaved, pushUnsaved } from './lib/saved';
import { fetchPushState, reconcilePush, type PushState } from './lib/push';
import PushPrompt from './components/PushPrompt';
import { isStandalone, watchInstallPrompt } from './lib/pwa';
import { loadWizard, resolveWizard, saveWizard, type WizardState, type WizardStep } from './lib/wizard';
import { filterSchedule, uniqueValues } from './lib/schedule';
import { formatClock, formatDate, getEventStatus, nowAndNext } from './lib/event-time';
import type { AppTab, BootstrapData, EditionData, ScheduleFilters, ScheduleItem } from './types';

// Drawn icons rather than Unicode glyphs: the glyphs came from whatever face
// happened to have them, so their weights and optical sizes never matched.
const TABS: Array<{ id: AppTab; label: string; icon: LucideIcon }> = [
  { id: 'now', label: 'Now', icon: Radio },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'my-day', label: 'My Day', icon: Star },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'info', label: 'ID', icon: IdIcon },
];

const VALID_TABS = new Set(TABS.map((tab) => tab.id));

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Push state as the server has it, corrected by what this browser actually holds.
 *
 * The server answers per attendee, so a subscription made on a previous install
 * makes it say "subscribed" to a phone that holds nothing. Reconciling here is
 * what keeps the switch honest and re-registers a browser that quietly lost its
 * subscription.
 */
async function livePushState(device: Device): Promise<PushState | null> {
  const state = await fetchPushState(device);
  return state ? reconcilePush(device, state) : null;
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
  hideDescription = false,
  booking,
}: {
  items: ScheduleItem[];
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
  compact?: boolean;
  hideDescription?: boolean;
  booking?: BookingProps;
}) {
  return <div className="schedule-list">{items.map((item) => (
    <ScheduleCard
      key={item.id}
      item={item}
      saved={saved.has(item.id)}
      onToggle={onToggle}
      compact={compact}
      hideDescription={hideDescription}
      signup={booking?.signups.get(item.id)}
      canBook={booking?.canBook ?? false}
      busy={booking?.busy === item.id}
      onBook={booking?.onBook}
      onCancelBooking={booking?.onCancelBooking}
    />
  ))}</div>;
}

/** Booking state threaded down to every card, or absent when unpaired. */
interface BookingProps {
  signups: Map<string, Signup>;
  canBook: boolean;
  busy: string | null;
  onBook: (id: string) => void;
  onCancelBooking: (id: string) => void;
}

function NowView({ data, saved, onToggle, now, booking }: {
  data: BootstrapData;
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
  now: Date;
  booking: BookingProps;
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
        {programme.happening.length ? <List items={programme.happening} saved={saved} onToggle={onToggle} booking={booking} compact /> : (
          <p className="inline-notice">Nothing timed is live right now. Check the full schedule for all-day activities and later sessions.</p>
        )}
      </section>

      <section className="screen-section" aria-labelledby="next-heading">
        <div className="section-heading-row"><div><span className="eyebrow">Up next</span><h2 id="next-heading">The next start time</h2></div></div>
        {programme.next.length ? <List items={programme.next} saved={saved} onToggle={onToggle} booking={booking} compact /> : (
          <p className="inline-notice">There are no more published programme starts after this point.</p>
        )}
      </section>
    </>
  );
}

function ScheduleView({ data, saved, onToggle, booking }: {
  data: BootstrapData;
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
  booking: BookingProps;
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
      {items.length ? <List items={items} saved={saved} onToggle={onToggle} booking={booking} /> : <Empty title="No matching sessions">Try clearing a filter or using a broader search.</Empty>}
    </>
  );
}

function MyDayView({ data, saved, onToggle, booking }: {
  data: BootstrapData;
  saved: ReadonlySet<string>;
  onToggle: (id: string) => void;
  booking: BookingProps;
}) {
  // Saved or booked. Booking a session is a stronger signal than starring one,
  // so it belongs here without needing a star as well -- and that is what made
  // starring look like a prerequisite.
  const items = data.schedule.filter((item) => saved.has(item.id) || booking.signups.has(item.id));
  return (
    <>
      <header className="screen-header"><span className="eyebrow">Saved on this device</span><h1>My Day</h1><p>Your picks stay in this browser. No account or attendee profile is created.</p></header>
      {items.length
        ? <List items={items} saved={saved} onToggle={onToggle} booking={booking} hideDescription />
        : <Empty title="Your day is wide open">Star a schedule item, or book a place, and it will appear here.</Empty>}
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

/**
 * The floor plan on its own.
 *
 * Once someone is inside, how to reach the venue is the one thing on this page
 * they definitely no longer need — and it was pushing the plan they do need
 * below the fold.
 */
function VenueMapOnly() {
  return (
    <>
      <header className="screen-header">
        <span className="eyebrow">You are here</span>
        <h1>Where everything is</h1>
        <p>Saved on this device, so it still works when the venue network does not.</p>
      </header>
      <VenueMap />
    </>
  );
}

/**
 * The one piece of the old Info tab worth carrying forward.
 *
 * Everything else there duplicated Plan Your Visit; knowing who to ask when
 * something goes wrong does not.
 */
function HelpCard({ data }: { data: BootstrapData }) {
  const edition = data.edition;
  return (
    <section className="help-card">
      <span className="eyebrow">Need help?</span>
      <h2>{edition?.help_on_the_day ? 'Find us on the day.' : 'Email the REPLAY team.'}</h2>
      <p>{edition?.help_on_the_day || 'The same-day escalation route will be added once an owner is assigned.'}</p>
      <a className="button button--light" href="mailto:hello@replaycon.in">hello@replaycon.in</a>
    </section>
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
  const [signups, setSignups] = useState<Signup[]>([]);
  const [bookingBusy, setBookingBusy] = useState<string | null>(null);
  const [bookingNote, setBookingNote] = useState<string | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  // Set only when a booking just landed someone on a waitlist, which is the one
  // moment asking about notifications makes obvious sense.
  const [pushAsk, setPushAsk] = useState<string | null>(null);
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

  useEffect(() => {
    if (!device) { setSignups([]); return; }
    // Null means the request failed; keep whatever is on screen rather than
    // blanking someone's bookings because the venue wifi dipped.
    void fetchSignups(device).then((rows) => { if (rows) setSignups(rows); });
    void livePushState(device).then(setPush);
    // Stars made before pairing -- which is most of them, since people plan
    // before they arrive -- exist only on this phone, and the reminder cron
    // cannot see a phone. Union, so pairing a second device adds rather than
    // replaces, and a null result leaves the local list untouched.
    void mergeSaved(device, loadAgenda(window.localStorage)).then((union) => {
      if (!union) return;
      saveAgenda(window.localStorage, union);
      setSaved(union);
    });
  }, [device]);

  const refreshSignups = async (current: Device) => {
    const rows = await fetchSignups(current);
    if (rows) setSignups(rows);
  };

  const book = async (scheduleItemId: string) => {
    if (!device) return;
    setBookingBusy(scheduleItemId);
    setBookingNote(null);
    const result = await signUp(device, scheduleItemId);
    if (result.ok) {
      setBookingNote(result.status === 'confirmed'
        ? 'Booked. It is in My Day.'
        : `You are number ${result.queue_position} on the waitlist.`);
      if (result.status === 'waitlisted') {
        const session = data?.schedule.find((s) => s.id === scheduleItemId);
        setPushAsk(session?.title ?? 'that session');
      }
      await refreshSignups(device);
    } else if (result.error === 'not_checked_in') {
      setBookingNote('Check in at the desk first, then this will work.');
    } else if (result.error === 'unauthorised') {
      // The token is dead, so the honest thing is to send them back to setup.
      clearDevice();
      setDevice(null);
      setBookingNote('Your setup expired. Ask the desk for a new code.');
    } else if (result.error === 'offline') {
      setBookingNote('No connection. Try again in a moment.');
    } else {
      setBookingNote('That did not work. Try again shortly.');
    }
    setBookingBusy(null);
  };

  const cancelBooking = async (scheduleItemId: string) => {
    if (!device) return;
    setBookingBusy(scheduleItemId);
    setBookingNote(null);
    const result = await cancelSignup(device, scheduleItemId);
    if (result.ok) {
      setBookingNote('Given up. Somebody on the waitlist may have taken it.');
      await refreshSignups(device);
    } else {
      setBookingNote(result.error === 'offline'
        ? 'No connection. Try again in a moment.'
        : 'That did not work. Try again shortly.');
    }
    setBookingBusy(null);
  };

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
      // Best-effort, and deliberately not awaited: the star is already saved
      // locally, so the screen is correct either way. What a failed sync costs
      // is the reminder, and the next start retries the whole set anyway.
      if (device) void (next.has(id) ? pushSaved(device, id) : pushUnsaved(device, id));
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

  const booking = {
    signups: bySession(signups),
    canBook: device !== null,
    busy: bookingBusy,
    onBook: book,
    onCancelBooking: cancelBooking,
  };

  const wizardView = resolveWizard(wizard, { paired: device !== null, standalone });
  const inBrowser = !standalone;
  const setupIncomplete = device === null;

  // Setup wins whenever both would apply: its first step is the install
  // instructions anyway, and it carries on to pairing afterwards.
  // A browser tab reopens the wizard on every visit until setup is done, but
  // only while setup is unfinished: once paired, whether anything is still
  // pending is the wizard view's call.
  const showWizard = !dismissedThisOpen
    && (setupIncomplete ? (inBrowser || wizardView.open) : wizardView.open);
  const showInstallBox = !dismissedThisOpen && !showWizard && inBrowser;
  // The way back after dismissing. Shown whenever setup is unfinished and
  // nothing is already on screen -- without it, dismissing the box in a browser
  // tab leaves no route to pairing until the next reload.
  const showFinishSetup = setupIncomplete && !showWizard && !askedFor;

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
          device={device}
          push={push}
          onPushEnabled={() => setPush(push ? { ...push, subscribed: true } : push)}
          onStep={(step) => (askedFor ? setAskedFor(step) : updateWizard({ ...wizard, step }))}
          onDismiss={() => {
            setAskedFor(null);
            setDismissedThisOpen(true);
            updateWizard({ ...wizard, dismissed: true });
          }}
          onPaired={(next) => {
            setDevice(next);
            setAskedFor(null);
            // Not dismissed here any more: pairing leads on to the notifications
            // step, which is the whole point of asking there rather than later.
            void livePushState(next).then(setPush);
          }}
        />
      )}
      {showInstallBox && <InstallBox onDismiss={() => setDismissedThisOpen(true)} />}
      <header className="topbar">
        <button type="button" className="brand" onClick={() => changeTab('now')} aria-label="REPLAY event app home"><strong>REPLAY</strong><small>EVENT APP</small></button>
        <div className="topbar__actions">
          {showFinishSetup && (
            <button
              type="button"
              className="install-button"
              onClick={() => setAskedFor('pair')}
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
            {device && push && pushAsk && (
              <PushPrompt
                device={device}
                push={push}
                sessionTitle={pushAsk}
                onDone={(subscribed) => {
                  setPushAsk(null);
                  if (subscribed) setPush({ ...push, subscribed: true });
                }}
              />
            )}
            {bookingNote && (
              <p className="booking-note" role="status">
                {bookingNote}
                <button type="button" className="text-button" onClick={() => setBookingNote(null)}>Dismiss</button>
              </p>
            )}
            {tab === 'now' && <><NowView data={data} saved={saved} onToggle={handleToggle} now={now} booking={booking} /><HelpCard data={data} /></>}
            {tab === 'schedule' && <ScheduleView data={data} saved={saved} onToggle={handleToggle} booking={booking} />}
            {tab === 'my-day' && <MyDayView data={data} saved={saved} onToggle={handleToggle} booking={booking} />}
            {tab === 'map' && (device ? <VenueMapOnly /> : <MapView data={data} />)}
            {tab === 'info' && <IdCard device={device} onPaired={setDevice} push={push} onPushChange={setPush} />}
            <p className="updated-at" aria-live="polite">
              {snapshot ? `Updated ${snapshot} IST` : 'Updating…'}
              {error ? ' · last refresh failed' : ''}
            </p>
          </>
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="Event app">
        {TABS.map((item) => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => changeTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}><span aria-hidden="true"><item.icon size={18} strokeWidth={2.25} /></span><small>{item.label}</small>{item.id === 'my-day' && saved.size > 0 && <b>{saved.size}</b>}</button>)}
      </nav>
    </div>
  );
}
