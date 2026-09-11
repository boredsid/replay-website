// The venue projector at /floor-display. See `src/lib/floor-display.ts` for
// every decision about what the screen says; this file only draws it and runs
// the clocks: a 1 Hz tick, a feed poll, and rotations derived from the time so
// nothing drifts out of step after a day of running.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import './FloorDisplay.css';
import {
  firstSessionOf,
  formatDuration,
  formatTime,
  istClock,
  mockOffset,
  nextBanner,
  pageAt,
  phaseAt,
  programmeAt,
  shuffled,
  statLines,
  toMinutes,
  type Banner,
  type DisplayFeed,
  type FeedAnnouncement,
  type FeedStats,
  type Phase,
  type StatLine,
} from '../lib/floor-display';
import { ATTENDEE_APP_URL } from '../lib/app-link';

interface Partner {
  name: string;
  src: string;
  tier: string;
  tierLabel: string;
  /** The generated tile's size, and the mark's box centred inside it. */
  tile: { width: number; height: number };
  mark: { width: number; height: number };
}

/** Never blow a mark up past this — the tiles are rasters, and a projector magnifies blur. */
const MAX_MARK_UPSCALE = 1.75;
const LOGO_RETRY_MS = 60_000;

interface Props {
  fallback: DisplayFeed;
  partners: Partner[];
  workerUrl: string;
}

const STAGE_W = 1920;
const STAGE_H = 1080;
const POLL_MS = 15_000;
const PAGE_MS = 10_000;
const PARTNER_MS = 7_000;
const SPOTLIGHT_MS = 12_000;
const BANNER_MS = 7_000;
const BANNER_GAP_MS = 1_500;
/** Arrivals older than this on first load are history, not news. */
const STALE_ARRIVAL_MS = 90_000;
const NOW_PAGE = 6;
const NEXT_PAGE = 3;
const KEY_STORAGE = 'floor-display-key';

const KIND_LABEL: Record<string, string> = {
  workshop: 'Workshop',
  tournament: 'Tournament',
  'open-play': 'Open play',
  meal: 'Meal',
  talk: 'Talk',
  ttrpg: 'TTRPG',
  'story-game': 'Story game',
  puzzle: 'Puzzle',
  quiz: 'Quiz',
  'social-game': 'Social game',
  playtest: 'Playtest',
  'publisher-showcase': 'Showcase',
  booth: 'Booth',
  food: 'Food',
  merch: 'Merch',
  amenity: 'Amenity',
  special: 'Special event',
};

// The same colour per kind as the public Schedule page's pills.
const KIND_COLOR: Record<string, string> = {
  workshop: '#4ECDC4',
  tournament: '#FF6B6B',
  'open-play': '#FFD166',
  meal: '#A8E6CF',
  talk: '#C3A6FF',
  ttrpg: '#C3A6FF',
  'story-game': '#C3A6FF',
  puzzle: '#4ECDC4',
  quiz: '#FFD166',
  'social-game': '#FF6B6B',
  playtest: '#A8E6CF',
  'publisher-showcase': '#F47B20',
  booth: '#F47B20',
  food: '#A8E6CF',
  merch: '#FFD166',
  amenity: '#4ECDC4',
  special: '#C3A6FF',
};

const DEMO_NAMES = ['Priya', 'Arjun', 'Meera', 'Kabir', 'Ananya', 'Rohan', 'Zoya', 'Dev', 'Ishita', 'Nikhil', 'Tara', 'Farhan'];
const CONFETTI_COLORS = ['#F47B20', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#C3A6FF', '#FFD166'];

/** Small seeded PRNG, so each pass through the partners is a fresh but repeatable order. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readKey(param: string | null): string | null {
  try {
    if (param) localStorage.setItem(KEY_STORAGE, param);
    return param || localStorage.getItem(KEY_STORAGE);
  } catch {
    return param;
  }
}

function useStageScale() {
  const [box, setBox] = useState({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    const fit = () => {
      const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
      setBox({ scale, x: (window.innerWidth - STAGE_W * scale) / 2, y: (window.innerHeight - STAGE_H * scale) / 2 });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return box;
}

/** Keep the projector laptop from dimming mid-afternoon. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        // Not supported, or refused: the laptop's own power settings apply.
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void request(); };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}

/**
 * Fetch and decode every logo as soon as the page opens.
 *
 * Without this each logo downloads only when its slide comes round, so a wifi
 * drop an hour in leaves the partner card blank for every logo not yet seen.
 * Preloaded, they sit in the image cache and the rotation survives going
 * offline. A logo that fails is left out of the rotation — better skipped than
 * shown as an empty white card — and tried again a minute later.
 */
function useLoadedLogos(partners: Partner[]): Partner[] {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const held = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    const timers: number[] = [];
    const load = (src: string) => {
      const img = new Image();
      img.onload = () => setFailed((prev) => {
        if (!prev.has(src)) return prev;
        const next = new Set(prev);
        next.delete(src);
        return next;
      });
      img.onerror = () => {
        setFailed((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));
        timers.push(window.setTimeout(() => load(src), LOGO_RETRY_MS));
      };
      img.src = src;
      held.current.push(img);
    };
    partners.forEach((partner) => load(partner.src));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [partners]);

  return useMemo(() => partners.filter((partner) => !failed.has(partner.src)), [partners, failed]);
}

function demoStats(minutes: number): FeedStats {
  const n = Math.max(0, Math.round(minutes - 540));
  return {
    checked_in_today: Math.min(260, 40 + n),
    checked_in_total: Math.min(260, 40 + n),
    arrivals: { last_1h: 18, last_2h: 44, last_3h: 71, today: 140, total: 140 },
    loans: { last_1h: 9, last_2h: 17, last_3h: 26, today: 38, total: 38 },
    games_out_now: 14,
    top_game_today: { title: 'Cascadia', count: 5 },
    bookings: { last_1h: 6, last_2h: 11, last_3h: 15, today: 42, total: 318 },
  };
}

export default function FloorDisplay({ fallback, partners, workerUrl }: Props) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const demo = params.has('demo');
  // `?api=http://localhost:8787` points the screen at `wrangler dev`.
  const api = params.get('api') || workerUrl;
  const key = useMemo(() => readKey(params.get('key')), [params]);
  const offset = useMemo(() => mockOffset(params.get('at'), Date.now()), [params]);

  const [now, setNow] = useState(() => Date.now() + offset);
  const [feed, setFeed] = useState<DisplayFeed>(fallback);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [banner, setBanner] = useState<(Banner & { shownAt: number }) | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const queue = useRef<string[]>([]);
  const seen = useRef(new Set<string>());
  const firstPoll = useRef(true);
  const bannerUntil = useRef(0);
  const nextBannerAt = useRef(0);

  const stage = useStageScale();
  const showable = useLoadedLogos(partners);
  useWakeLock();

  // 1 Hz clock. Everything that rotates is derived from it.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset]);

  // Poll the feed. A failed poll keeps the last good data on screen.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${api}/api/display/feed`, {
          headers: key ? { Authorization: `Bearer ${key}` } : undefined,
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`feed ${res.status}`);
        const next = (await res.json()) as DisplayFeed;
        if (cancelled) return;
        setFeed(next);
        setLastOk(Date.now());
      } catch (err) {
        console.warn('[floor-display] feed poll failed; keeping the last data', err);
      }
    };
    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [api, key]);

  // New arrivals join the banner queue once each.
  useEffect(() => {
    const realNow = Date.now();
    for (const arrival of feed.arrivals ?? []) {
      if (seen.current.has(arrival.id)) continue;
      seen.current.add(arrival.id);
      if (firstPoll.current && realNow - Date.parse(arrival.at) > STALE_ARRIVAL_MS) continue;
      queue.current.push(arrival.name);
    }
    if (lastOk !== null) firstPoll.current = false;
  }, [feed, lastOk]);

  // Rehearsal: somebody walks in every 15 seconds.
  useEffect(() => {
    if (!demo) return;
    let i = 0;
    const id = window.setInterval(() => {
      queue.current.push(DEMO_NAMES[i % DEMO_NAMES.length]);
      i += 1;
      // Every fifth beat, a door rush.
      if (i % 5 === 0) queue.current.push(...DEMO_NAMES.slice(0, 6));
    }, 15_000);
    return () => window.clearInterval(id);
  }, [demo]);

  // Banner scheduler, on the clock tick.
  useEffect(() => {
    const t = Date.now();
    if (banner && t >= bannerUntil.current) {
      setBanner(null);
      nextBannerAt.current = t + BANNER_GAP_MS;
      return;
    }
    if (!banner && t >= nextBannerAt.current) {
      const result = nextBanner(queue.current);
      if (result) {
        queue.current = result.rest;
        bannerUntil.current = t + BANNER_MS;
        setBanner({ ...result.banner, shownAt: t });
      }
    }
  }, [now, banner]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const clock = istClock(new Date(now));
  const phase = phaseAt(feed.edition, clock);
  const live = phase.kind === 'live';
  const programme = programmeAt(feed.schedule, clock);

  const demoSeverity = params.get('demo');
  const announcements = useMemo<FeedAnnouncement[]>(() => {
    if (!demo || feed.announcements.length > 0) return feed.announcements;
    const stamp = new Date().toISOString();
    const notice = (id: string, severity: FeedAnnouncement['severity'], title: string, body: string): FeedAnnouncement =>
      ({ id, severity, title, body, starts_at: stamp, ends_at: null, updated_at: stamp });
    const list = [notice('demo-info', 'info', 'Lunch is served', 'The food counter by Ground Control is open until 3 PM.')];
    if (demoSeverity === 'urgent') list.push(notice('demo-urgent', 'urgent', 'Catan Tournament moved', 'Now in Spotlight, starting 2:30 PM. Players, head over!'));
    if (demoSeverity === 'incident') list.push(notice('demo-incident', 'incident', 'Please keep the fire exit clear', 'The corridor by the lifts must stay free of bags and chairs.'));
    return list;
  }, [demo, demoSeverity, feed.announcements]);

  const incident = announcements.filter((a) => a.severity === 'incident');
  const urgent = announcements.filter((a) => a.severity === 'urgent');
  const info = announcements.filter((a) => a.severity === 'info');
  const stats = demo && !feed.stats ? demoStats(clock.minutes) : feed.stats;
  const lines = statLines(stats, live);

  const spotlight: Array<{ type: 'notice'; notice: FeedAnnouncement } | { type: 'stat'; stat: StatLine } | { type: 'app' }> = [];
  // Interleave notices with stats so a notice comes round at least every other slot.
  const maxLen = Math.max(info.length, lines.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (info[i]) spotlight.push({ type: 'notice', notice: info[i] });
    if (lines[i]) spotlight.push({ type: 'stat', stat: lines[i] });
  }
  spotlight.push({ type: 'app' });
  const spot = spotlight[Math.floor(now / SPOTLIGHT_MS) % spotlight.length];
  const spotKey = spot.type === 'notice' ? spot.notice.id : spot.type === 'stat' ? spot.stat.id : 'app';

  // Partners: a fresh shuffle every pass.
  const pass = showable.length > 0 ? Math.floor(now / PARTNER_MS / showable.length) : 0;
  const order = useMemo(() => shuffled(showable, mulberry32(pass + 7)), [showable, pass]);
  const partner = order.length > 0 ? order[Math.floor(now / PARTNER_MS) % order.length] : null;

  const dateLabel = new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const [clockDigits, clockSuffix] = formatTime(clock.minutes, { compact: false }).split(' ');
  const stale = lastOk !== null && Date.now() - lastOk > 60_000;
  const namesOff = Boolean(key) && lastOk !== null && !feed.names_enabled;

  const stageStyle: CSSProperties = {
    width: STAGE_W,
    height: STAGE_H,
    transform: `translate(${stage.x}px, ${stage.y}px) scale(${stage.scale})`,
  };

  return (
    <div
      className="fd-viewport"
      onClick={() => { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {}); }}
    >
      <div className="fd-stage" style={stageStyle}>
        <header className="fd-header">
          <img src="/replay-logo.png" alt="REPLAY" className="fd-logo" />
          <div className="fd-date">
            {'dayNumber' in phase && <span className="fd-daychip">Day {phase.dayNumber}</span>}
            <span>{dateLabel}</span>
          </div>
          <div className="fd-clock" aria-label="Time in Bengaluru">
            {clockDigits}
            <span className="fd-clock__suffix">{clockSuffix}</span>
          </div>
        </header>

        {incident.length > 0 && (
          <div className="fd-incident" role="alert">
            <span className="fd-incident__tag">Important</span>
            <strong>{incident[0].title}</strong>
            <span className="fd-incident__body">{incident[0].body}</span>
          </div>
        )}

        <main className="fd-main">
          <section className="fd-programme">
            {live ? (
              <LiveProgramme programme={programme} now={now} />
            ) : (
              <PhaseHero phase={phase} feed={feed} date={clock.date} />
            )}
          </section>

          <aside className={`fd-rail${urgent.length > 0 ? ' fd-rail--urgent' : ''}`}>
            <div className="fd-partner">
              <div className="fd-eyebrow fd-eyebrow--ink">Thank you, partners</div>
              {partner ? (
                <div className="fd-partner__slide" key={`${pass}-${partner.name}`}>
                  <div className="fd-partner__tier">{partner.tierLabel}</div>
                  <div className="fd-partner__logo">
                    <div
                      className="fd-partner__window"
                      style={{
                        '--ratio': partner.mark.width / partner.mark.height,
                        '--max-w': `${Math.round(partner.mark.width * MAX_MARK_UPSCALE)}px`,
                        '--tile-w': partner.tile.width / partner.mark.width,
                      } as CSSProperties}
                    >
                      <img src={partner.src} alt={partner.name} />
                    </div>
                  </div>
                  <div className="fd-partner__name">{partner.name}</div>
                  <div className="fd-partner__timer"><i style={{ animationDuration: `${PARTNER_MS}ms` }} /></div>
                </div>
              ) : (
                <div className="fd-partner__slide"><img src="/replay-logo.png" alt="" className="fd-partner__fallback" /></div>
              )}
            </div>

            {urgent.length > 0 && (
              <div className="fd-urgent" key={urgent[Math.floor(now / SPOTLIGHT_MS) % urgent.length].id}>
                <div className="fd-eyebrow fd-eyebrow--ink">Heads up</div>
                <h3>{urgent[Math.floor(now / SPOTLIGHT_MS) % urgent.length].title}</h3>
                <p>{urgent[Math.floor(now / SPOTLIGHT_MS) % urgent.length].body}</p>
              </div>
            )}

            <div className={`fd-spot fd-spot--${spot.type}`} key={spotKey}>
              {spot.type === 'notice' && (
                <>
                  <div className="fd-eyebrow fd-eyebrow--ink">Announcement</div>
                  <h3 className="fd-spot__title">{spot.notice.title}</h3>
                  <p className="fd-spot__body">{spot.notice.body}</p>
                </>
              )}
              {spot.type === 'stat' && (
                <>
                  <div className="fd-eyebrow fd-eyebrow--ink">On the floor</div>
                  <div className="fd-stat__value">{spot.stat.value}</div>
                  <p className="fd-stat__text">{spot.stat.text}</p>
                </>
              )}
              {spot.type === 'app' && (
                <>
                  <div className="fd-eyebrow fd-eyebrow--ink">In your pocket</div>
                  <h3 className="fd-spot__title">Book sessions, borrow games, find your way.</h3>
                  <p className="fd-spot__body">It’s all in the REPLAY app — <strong>{ATTENDEE_APP_URL.replace('https://', '')}</strong></p>
                </>
              )}
            </div>
          </aside>
        </main>

        {banner && <ArrivalBanner banner={banner} />}

        <div className={`fd-status${stale ? ' fd-status--stale' : ''}`} title={stale ? 'Feed unreachable' : 'Live'}>
          {namesOff && <span>names off</span>}
          {demo && <span>demo</span>}
          <i />
        </div>
        {!fullscreen && <div className="fd-hint">Click anywhere for full screen</div>}
      </div>
    </div>
  );
}

function LiveProgramme({ programme, now }: { programme: ReturnType<typeof programmeAt>; now: number }) {
  const tick = Math.floor(now / PAGE_MS);
  const nowPage = pageAt(programme.live, NOW_PAGE, tick);
  const nextPage = pageAt(programme.next, NEXT_PAGE, tick);
  const nextSoonest = programme.next[0];

  return (
    <>
      <div className="fd-section-head">
        <h2 className="fd-heading"><span className="fd-live-dot" />Happening now</h2>
        <span className="fd-count">{programme.live.length} {programme.live.length === 1 ? 'session' : 'sessions'}</span>
        <PageDots page={nowPage.page} pages={nowPage.pages} />
      </div>

      {programme.live.length === 0 ? (
        <div className="fd-empty">
          <h3>Between sessions</h3>
          <p>
            Open tables are always on — grab a game from the library.
            {nextSoonest && <> Next up at <strong>{formatTime(nextSoonest.start)}</strong>.</>}
          </p>
        </div>
      ) : (
        <div className="fd-now-grid" key={`now-${nowPage.page}`}>
          {nowPage.items.map((item) => (
            <article className="fd-card" key={item.id} style={{ '--kind': KIND_COLOR[item.kind] ?? '#FFD166' } as CSSProperties}>
              <div className="fd-card__meta">
                <span className="fd-pill">{KIND_LABEL[item.kind] ?? item.kind}</span>
                {item.location && <span className="fd-card__loc">{item.location}</span>}
                <span className="fd-card__left">{formatDuration(item.minutesLeft)} left</span>
              </div>
              <h3 className="fd-card__title">{item.title}</h3>
              <div className="fd-card__progress"><i style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>
            </article>
          ))}
        </div>
      )}

      <div className="fd-section-head fd-section-head--next">
        <h2 className="fd-heading fd-heading--next">Up next</h2>
        {programme.next.length > 0 && <span className="fd-count">next 2 hours</span>}
        <PageDots page={nextPage.page} pages={nextPage.pages} />
      </div>
      <div className="fd-next" key={`next-${nextPage.page}`}>
        {programme.next.length === 0 && <div className="fd-next__none">Nothing new starts in the next two hours. Keep playing!</div>}
        {nextPage.items.map((item) => (
          <div className={`fd-next__row${item.public_status === 'cancelled' ? ' is-cancelled' : ''}`} key={item.id}>
            <span className="fd-next__time">
              {formatTime(item.start)}
              <small>in {formatDuration(item.minutesUntil)}</small>
            </span>
            <span className="fd-next__title">{item.title}</span>
            <span className="fd-next__loc">{item.location}</span>
            {item.public_status === 'cancelled'
              ? <span className="fd-pill fd-pill--cancelled">Cancelled</span>
              : <span className="fd-pill" style={{ '--kind': KIND_COLOR[item.kind] ?? '#FFD166' } as CSSProperties}>{KIND_LABEL[item.kind] ?? item.kind}</span>}
          </div>
        ))}
      </div>

      {programme.allDay.length > 0 && (
        <div className="fd-allday">
          <span className="fd-allday__label">All day</span>
          <div className="fd-allday__window">
            {/* Two copies, scrolled by half, make a seamless ticker. */}
            <div className="fd-allday__track" style={{ animationDuration: `${Math.max(20, programme.allDay.length * 9)}s` }}>
              {[0, 1].map((copy) =>
                programme.allDay.map((item) => (
                  <span className="fd-allday__chip" key={`${copy}-${item.id}`} aria-hidden={copy === 1}>
                    {item.title}
                    {item.location && <em> · {item.location}</em>}
                  </span>
                )),
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PhaseHero({ phase, feed, date }: { phase: Phase; feed: DisplayFeed; date: string }) {
  const open = formatTime(toMinutes(feed.edition?.daily_start_time) ?? 9 * 60);

  if (phase.kind === 'pre-doors') {
    const seconds = Math.max(0, Math.ceil(phase.minutesToOpen * 60));
    const hh = Math.floor(seconds / 3600);
    const mm = Math.floor((seconds % 3600) / 60);
    const ss = seconds % 60;
    const first = firstSessionOf(feed.schedule, date);
    // The morning's opening sessions: whatever starts in the first two hours
    // after the earliest one.
    const morning = first
      ? programmeAt(feed.schedule, { date, minutes: first.start - 0.5 }, 120).next.slice(0, NEXT_PAGE + 1)
      : [];
    return (
      <div className="fd-hero fd-hero--doors">
        <div className="fd-eyebrow">Day {phase.dayNumber} · Doors open at {open}</div>
        <h1 className="fd-hero__title">Doors open in</h1>
        {/* Units, not colons: "18:30" on a wall reads as half past six. */}
        <div className="fd-countdown">
          {hh > 0 && <>{hh}<small>h</small> </>}
          {String(mm).padStart(hh > 0 ? 2 : 1, '0')}<small>m</small> {String(ss).padStart(2, '0')}<small>s</small>
        </div>
        {morning.length > 0 && (
          <div className="fd-morning">
            <div className="fd-eyebrow">First up</div>
            {morning.map((item) => (
              <div className={`fd-next__row${item.public_status === 'cancelled' ? ' is-cancelled' : ''}`} key={item.id}>
                <span className="fd-next__time">{formatTime(item.start)}</span>
                <span className="fd-next__title">{item.title}</span>
                <span className="fd-next__loc">{item.location}</span>
                <span className="fd-pill" style={{ '--kind': KIND_COLOR[item.kind] ?? '#FFD166' } as CSSProperties}>{KIND_LABEL[item.kind] ?? item.kind}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (phase.kind === 'countdown') {
    return (
      <div className="fd-hero">
        <div className="fd-eyebrow">Bengaluru’s board-game convention</div>
        <h1 className="fd-hero__title">{phase.days === 1 ? 'See you tomorrow!' : `${phase.days} days to go`}</h1>
        <p className="fd-hero__sub">Doors open at {open}. Pack your dice.</p>
      </div>
    );
  }
  if (phase.kind === 'overnight') {
    return (
      <div className="fd-hero">
        <div className="fd-eyebrow">That’s a wrap on day one</div>
        <h1 className="fd-hero__title">GG, everyone!</h1>
        <p className="fd-hero__sub">Doors open again at {open} tomorrow. Rest up, adventurer.</p>
      </div>
    );
  }
  if (phase.kind === 'wrapped') {
    return (
      <div className="fd-hero">
        <div className="fd-eyebrow">That’s REPLAY</div>
        <h1 className="fd-hero__title">Thanks for playing!</h1>
        <p className="fd-hero__sub">See you at the next one.</p>
      </div>
    );
  }
  return (
    <div className="fd-hero">
      <h1 className="fd-hero__title">REPLAY</h1>
      <p className="fd-hero__sub">Setting up the tables…</p>
    </div>
  );
}

function PageDots({ page, pages }: { page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <span className="fd-dots" aria-hidden="true">
      {Array.from({ length: pages }, (_, i) => <i key={i} className={i === page ? 'is-on' : ''} />)}
    </span>
  );
}

function ArrivalBanner({ banner }: { banner: Banner & { shownAt: number } }) {
  const pieces = useMemo(() => {
    const rand = mulberry32(banner.shownAt);
    return Array.from({ length: 48 }, (_, i) => ({
      left: `${rand() * 100}%`,
      delay: `${rand() * 0.9}s`,
      duration: `${2.4 + rand() * 1.6}s`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      rotate: `${rand() * 360}deg`,
      drift: `${(rand() - 0.5) * 240}px`,
      wide: rand() > 0.5,
    }));
  }, [banner.shownAt]);

  return (
    <div className="fd-arrival" key={banner.shownAt} role="status">
      <div className="fd-confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <i
            key={i}
            className={p.wide ? 'is-wide' : ''}
            style={{
              left: p.left,
              background: p.color,
              animationDelay: p.delay,
              animationDuration: p.duration,
              '--r': p.rotate,
              '--drift': p.drift,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className="fd-arrival__band">
        <span className="fd-arrival__tag">{banner.names.length > 1 ? `+${banner.names.length} players` : 'New player'}</span>
        <p className="fd-arrival__message">{banner.message}</p>
      </div>
    </div>
  );
}
