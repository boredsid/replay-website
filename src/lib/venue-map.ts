/**
 * venue-map
 * -----------------------------------------------------------------------
 * Single source of truth for the REPLAY floor plan.
 *
 * THE ORGANISER SKETCH IS THE SOURCE OF TRUTH for what is on this plan and
 * where it sits. Nothing appears that the sketch does not show. The venue's
 * CAD drawing is used for ONE thing: the outer envelope, 42.4 m by 20.32 m,
 * so the proportions are honest.
 *
 * The drawing language comes from the earlier REPLAY venue-map artifact: a
 * printed sheet, heavy ink outlines, pale tints for the open play zones and
 * full brand colour for the rooms people go looking for. See the rendering
 * section below, and `docs/VENUE_MAP.md`.
 *
 * Coordinates are metres:
 *
 *   x runs ACROSS the floor,  0 -> 20.32 m   (left = play zones, right = concourse)
 *   y runs ALONG  the floor,  0 -> 42.40 m   (top = wash basins, bottom = far end)
 *
 * Every box is written as `sx()` / `sy()` / `sketch()` carrying the pixel
 * coordinates read off the sketch, so the mapping back to the drawing stays
 * inspectable. Re-reading the sketch is how you edit this file.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A room, in sketch pixels, before it is scaled into the floor. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface VenueZone {
  id: string;
  name: string;
  /** One line on what the zone is for. Wraps to fit. */
  blurb: string;
  /** Pale tint. Identifies the zone; never implies a wall. */
  fill: string;
  rect: Rect;
  /**
   * Width the name has to fit into, when that is narrower than the zone —
   * Agatha's Cove has to letter inside its ring of seats.
   */
  labelWidth?: number;
}

/** Outer envelope, in metres. The one thing taken from the CAD drawing. */
export const FLOOR = { width: 20.32, length: 42.4 } as const;

/** Perimeter wall thickness. */
export const WALL = 0.3;

/** Usable floor inside the perimeter wall. */
export const INSIDE = {
  x0: WALL,
  y0: WALL,
  x1: FLOOR.width - WALL,
  y1: FLOOR.length - WALL,
} as const;

/** The sketch's drawing area, in its own pixels. */
const SKETCH = { x0: 98, x1: 860, y0: 60, y1: 1425 } as const;

const SX = (INSIDE.x1 - INSIDE.x0) / (SKETCH.x1 - SKETCH.x0);
const SY = (INSIDE.y1 - INSIDE.y0) / (SKETCH.y1 - SKETCH.y0);

const round = (v: number): number => Number(v.toFixed(3));

/** An x read off the sketch, in metres. */
export const sx = (x: number): number => round(INSIDE.x0 + (x - SKETCH.x0) * SX);
/** A y read off the sketch, in metres. */
export const sy = (y: number): number => round(INSIDE.y0 + (y - SKETCH.y0) * SY);

/**
 * Convert a box read off the sketch into metres.
 *
 * Both edges are rounded before the size is taken, so two things the sketch
 * draws sharing an edge still share an exact edge here. Rounding the width
 * independently leaves a millimetre of overlap or gap between them.
 */
const rectOf = (b: Box): Rect => ({
  x: sx(b.x0),
  y: sy(b.y0),
  w: round(sx(b.x1) - sx(b.x0)),
  h: round(sy(b.y1) - sy(b.y0)),
});

// ---------------------------------------------------------------------------
// Bands and zones
// ---------------------------------------------------------------------------

/** Where the play-zone side meets the corridor. No wall. */
export const HALL_EDGE = sx(428);
/** The corridor's far side. The rooms' front wall, and what the wall-mounted
 *  water dispenser, photo wall and snack machine are fixed to. */
export const SERVICE_EDGE = sx(518);
/** How far a wall-mounted unit stands out into the corridor. */
const MOUNT_X = sx(502);

/**
 * The sketch lines Save Point's north wall up with the Sandbox / Garage
 * division, and the campfire floor's south wall with Spotlight / Ground
 * Control. Those alignments are deliberate — keep them.
 */
const Y_SANDBOX_GARAGE = sy(487);
const Y_GARAGE_SPOTLIGHT = sy(800);
const Y_SPOTLIGHT_GROUND = sy(1115);

const hallBay = (y0: number, y1: number): Rect => ({
  x: INSIDE.x0,
  y: y0,
  w: round(HALL_EDGE - INSIDE.x0),
  h: round(y1 - y0),
});

export const ZONES: VenueZone[] = [
  { id: 'sandbox', name: 'Sandbox', blurb: 'Open tables for the game library and playtesting', fill: '#FCF2DC', rect: hallBay(INSIDE.y0, Y_SANDBOX_GARAGE) },
  {
    id: 'garage',
    name: 'Garage',
    blurb: 'Retail stores, booths and trading card games',
    fill: '#FBE4E0',
    rect: hallBay(Y_SANDBOX_GARAGE, Y_GARAGE_SPOTLIGHT),
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    blurb: 'Highlight events, TTRPGs and more',
    fill: '#FDEBD6',
    rect: hallBay(Y_GARAGE_SPOTLIGHT, Y_SPOTLIGHT_GROUND),
  },
  {
    id: 'ground-control',
    name: 'Ground Control',
    blurb: 'Jigsaw puzzles and murder mystery',
    fill: '#E6F5EC',
    rect: hallBay(Y_SPOTLIGHT_GROUND, INSIDE.y1),
  },
  {
    id: 'agathas-cove',
    name: "Agatha's Cove",
    blurb: 'Blood on the Clocktower',
    fill: '#EFE9FB',
    // Clear width inside the ring of seats.
    labelWidth: 4.6,
    rect: {
      x: HALL_EDGE,
      y: Y_SPOTLIGHT_GROUND,
      w: round(sx(760) - HALL_EDGE),
      h: round(INSIDE.y1 - Y_SPOTLIGHT_GROUND),
    },
  },
];

/** The corridor. A route through open floor, not a walled passage. */
export const CORRIDOR: Rect = {
  x: HALL_EDGE,
  y: INSIDE.y0,
  w: round(SERVICE_EDGE - HALL_EDGE),
  // Stops at the campfire floor, which reaches across to meet Spotlight.
  h: round(sy(940) - INSIDE.y0),
};

// ---------------------------------------------------------------------------
// Rooms down the concourse, top to bottom, exactly as the sketch stacks them
// ---------------------------------------------------------------------------

export const WASH: Box = { x0: 518, y0: 60, x1: 860, y1: 190 };
/** Hung off the wash basins, and entered from them. */
export const TOILET: Box = { x0: 750, y0: WASH.y1, x1: 860, y1: 330 };
export const LIBRARY: Box = { x0: 540, y0: 262, x1: 645, y1: 487 };
/** Save Point: the entrance lobby. Stops short of the east wall; the lifts
 *  take the rest. */
export const LOBBY: Box = { x0: 518, y0: 487, x1: 800, y1: 645 };
export const LIFT_CORE: Box = { x0: 800, y0: 525, x1: 860, y1: 615 };
/** The campfire floor. Only the bottom stretch — see OPEN_CONCOURSE. */
export const CAMPFIRE_ROOM: Box = { x0: 428, y0: 940, x1: 860, y1: 1115 };

/**
 * The sketch leaves this stretch of the concourse unassigned: it is floor
 * between Save Point and the campfire, with the photo wall and the snack
 * machine fixed to the corridor wall along it. It carries no tint because it
 * is not a zone.
 */
export const OPEN_CONCOURSE: Box = { x0: 518, y0: 645, x1: 860, y1: 940 };

/** Units fixed to the corridor wall, standing proud of it into the corridor. */
export const MOUNTED = [
  { id: 'water-dispenser', name: 'Water', y0: 198, y1: 260, fill: '#4ECDC4' },
  { id: 'photo-wall', name: 'Photo wall', y0: 650, y1: 748, fill: '#C3A6FF' },
  { id: 'snack-machine', name: 'Snacks', y0: 843, y1: 940, fill: '#FFD166' },
] as const;

export const mountedRect = (m: { y0: number; y1: number }): Rect =>
  rectOf({ x0: 502, y0: m.y0, x1: 518, y1: m.y1 });

/** The Game Library's bar, facing the corridor. */
export const LIBRARY_BAR: Box = { x0: 518, y0: 262, x1: 540, y1: 480 };
/** The registration desk, across the head of Save Point. */
export const REGISTRATION: Box = { x0: 583, y0: 490, x1: 712, y1: 520 };
/** The community table. */
export const CAMPFIRE_TABLE: Box = { x0: 570, y0: 990, x1: 800, y1: 1055 };
/** Seats round the community table, four each side. */
export const CAMPFIRE_SEATS = [602, 662, 720, 777];

/** The Blood on the Clocktower ring: one table, fifteen seats around it. */
/**
 * The Blood on the Clocktower ring. No table in the middle: the zone's name
 * goes there.
 */
export const COVE_RING = { cx: 13.136, cy: 37.354, rSeats: 2.7, seats: 12 } as const;

/** The named spaces, for the page legend and the text alternative. */
export const AREAS = [
  { id: 'wash-basins', name: 'Wash basins', detail: 'open to the corridor' },
  { id: 'water-dispenser', name: 'Water dispenser', detail: 'on the corridor wall' },
  { id: 'toilet', name: 'Toilet', detail: null },
  { id: 'game-library', name: 'Game Library', detail: 'bar counter onto the corridor' },
  { id: 'save-point', name: 'Save Point', detail: 'entrance lobby + registration' },
  { id: 'lifts', name: 'Lifts', detail: 'you arrive here' },
  { id: 'photo-wall', name: 'Photo wall', detail: 'corner out of Save Point' },
  { id: 'snack-machine', name: 'Snack machine', detail: 'corner of the campfire floor' },
  { id: 'campfire', name: 'Campfire', detail: 'the community table' },
] as const;

/**
 * The key beside the map: the five play zones, plus the two other places
 * people go looking for. Each carries a line on what happens there.
 *
 * These lines live in the key, not on the drawing — the plan stays legible
 * with names alone, and the detail belongs where there is room to read it.
 */
export const KEY_ITEMS: Array<{ id: string; name: string; blurb: string; fill: string }> = [
  ...ZONES.map((z) => ({ id: z.id, name: z.name, blurb: z.blurb, fill: z.fill })),
  {
    id: 'save-point',
    name: 'Save Point',
    blurb: 'Entrance lobby and registration',
    fill: '#FBDFC4',
  },
  {
    id: 'campfire',
    name: 'Campfire',
    blurb: 'For the long rest, at the community table',
    fill: '#E2F4F2',
  },
];

export const area = (r: Rect): number => r.w * r.h;
export const boxRect = rectOf;

/**
 * Plain-text description of the plan. This is the accessible alternative the
 * attendee-app plan asks for, and it is also what gets read out when the SVG
 * cannot render at all.
 */
export function venueMapOutline(): { heading: string; items: string[] }[] {
  return [
    {
      heading: 'Play zones',
      items: ZONES.map((z) => z.name),
    },
    {
      heading: 'Getting around',
      items: [
        'The play side is one large room. The zones are separated by decor, not walls, so you can walk straight between them.',
        'The Cassette Corridor runs down the middle, with the play zones on one side and everything else on the other.',
        'The lifts open into Save Point, the entrance lobby, a little under halfway down. Check in there, then out onto the floor.',
        'Below Save Point the concourse is open floor, with the photo wall and the snack machine on the corridor wall, before the campfire floor at the far end.',
      ],
    },
    {
      heading: 'Along the concourse, top to bottom',
      items: AREAS.map((a) => `${a.name}${a.detail ? ` — ${a.detail}` : ''}`),
    },
  ];
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------
//
// The drawing language is lifted from the REPLAY venue-map artifact: a printed
// sheet, heavy ink outlines, pale tints for the open play zones and full brand
// colour for the rooms you look for. Every constant below is that artifact's
// value converted from its 521px-wide viewBox into metres (1 artifact px =
// 0.039 m), so the two stay visually identical.

const INK = '#1A1A1A';
const FLOOR_FILL = '#FFFDF7';
/** The concourse: everything on the far side of the play zones. */
const CONCOURSE = '#F7F3E9';
const ROOM_NEUTRAL = '#EDE8DC';

const C_LIBRARY = '#A8E6CF';
const C_REGISTRATION = '#FBDFC4';
const C_LIFTS = '#FF6B6B';
const C_COMMUNAL = '#E2F4F2';

/** Stroke weights, in metres. */
const W_FRAME = 0.273;
const W_ROOM = 0.117;
const W_WALL = 0.14;
const W_FIXTURE = 0.07;
const RX = 0.156;

/** Type sizes, in metres. */
const T_ZONE = 1.05;
const T_FEATURE = 0.51;
const T_CONCOURSE = 0.47;
const T_SMALL = 0.47;

const PAD = 0.9;

const SVG_STYLE = `
  .fp-zone{font-family:var(--font-heading),'Space Grotesk',sans-serif;font-weight:700;font-size:${T_ZONE}px;letter-spacing:${
    T_ZONE * 0.06
  }px;fill:${INK}}
  .fp-feature{font-family:var(--font-heading),'Space Grotesk',sans-serif;font-weight:600;font-size:${T_FEATURE}px;letter-spacing:${
    T_FEATURE * 0.08
  }px;fill:${INK}}
  .fp-concourse{font-family:var(--font-heading),'Space Grotesk',sans-serif;font-weight:600;font-size:${T_CONCOURSE}px;letter-spacing:${
    T_CONCOURSE * 0.2
  }px;fill:${INK};opacity:0.6}
  .fp-small{font-family:var(--font-heading),'Space Grotesk',sans-serif;font-weight:600;font-size:${T_SMALL}px;letter-spacing:${
    T_SMALL * 0.05
  }px;fill:${INK}}
`;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (v: number): string => Number(v.toFixed(3)).toString();

const rect = (r: Rect, attrs: string): string =>
  `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" ${attrs}/>`;

/** Advance width of the label face including letterspacing, per font size. */
const ADVANCE = 0.72;

const fitFontSize = (text: string, available: number, max: number, min: number): number => {
  const ideal = available / Math.max(text.length * ADVANCE, 1);
  return Math.max(min, Math.min(max, ideal));
};

// --- furniture -------------------------------------------------------------
//
// Everything below is drawn at FURNITURE_SCALE. The graphics are flavour —
// they say what a zone is for — and the zone's name is what actually has to
// read, so the furniture stays small and keeps well clear of the middle.

const FS = 0.76;
const SEAT = round(0.5 * FS);
const SEAT_GAP = round(0.3 * FS);

const FURN = `fill="${FLOOR_FILL}" stroke="${INK}" stroke-width="${W_FIXTURE}" stroke-linejoin="round"`;

const seat = (cx: number, cy: number, deg = 0, s = SEAT): string =>
  `<rect x="${n(cx - s / 2)}" y="${n(cy - s / 2)}" width="${n(s)}" height="${n(
    s * 0.84,
  )}" rx="0.12" ${FURN}${deg ? ` transform="rotate(${n(deg)} ${n(cx)} ${n(cy)})"` : ''}/>`;

/** A rectangular table with a row of seats along each long side. */
const tableSeats = (cx: number, cy: number, w: number, h: number, perSide: number): string => {
  const out = [
    `<rect x="${n(cx - w / 2)}" y="${n(cy - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${RX}" ${FURN}/>`,
  ];
  const step = w / perSide;
  for (let i = 0; i < perSide; i += 1) {
    const x = cx - w / 2 + step * (i + 0.5);
    out.push(seat(x, cy - h / 2 - SEAT_GAP), seat(x, cy + h / 2 + SEAT_GAP));
  }
  return out.join('');
};

/** A round table ringed with seats. */
/** A ring of seats. `rTable` of 0 leaves the middle clear. */
const roundSeats = (
  cx: number,
  cy: number,
  rTable: number,
  rSeats: number,
  count: number,
): string => {
  const out = rTable > 0 ? [`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rTable)}" ${FURN}/>`] : [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    out.push(
      seat(cx + Math.cos(a) * rSeats, cy + Math.sin(a) * rSeats, (a * 180) / Math.PI + 90, SEAT),
    );
  }
  return out.join('');
};

/** A vendor stall: a pitch with its counter facing the aisle. */
const stall = (x: number, y: number, w: number, h: number): string =>
  [
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RX}" fill="${CONCOURSE}" stroke="${INK}" stroke-width="${W_FIXTURE}" stroke-linejoin="round"/>`,
    `<rect x="${n(x + w - 0.38)}" y="${n(y + 0.16)}" width="0.38" height="${n(h - 0.32)}" rx="0.1" ${FURN}/>`,
  ].join('');

function zoneFurniture(id: string): string {
  const out: string[] = [];

  // Every layout below leaves the middle of its zone clear, because that is
  // where the zone's name goes.

  // Sandbox and Spotlight: banks of four-seat tables, two rows either side of
  // the name.
  if (id === 'sandbox' || id === 'spotlight') {
    const cols = [2.0, 4.55, 7.1];
    const rows = id === 'sandbox' ? [2.6, 4.4, 9.3, 11.1] : [24.35, 25.95, 29.6, 31.2];
    for (const cx of cols) for (const cy of rows) out.push(tableSeats(cx, cy, 1.14, 0.68, 2));
  }

  // Garage: stalls down the outer wall, long trading tables beside them.
  if (id === 'garage') {
    for (const y of [14.3, 15.7, 19.5, 20.9]) out.push(stall(0.6, y, 1.4, 1.2));
    for (const cy of [15.5, 20.7]) out.push(tableSeats(5.5, cy, 2.66, 0.72, 4));
  }

  // Ground Control: a painting bench above the name, puzzle and origami tables
  // below it.
  if (id === 'ground-control') {
    out.push(`<rect x="1.5" y="34.7" width="5.0" height="0.68" rx="${RX}" ${FURN}/>`);
    for (let i = 0; i < 6; i += 1) out.push(seat(2.0 + i * 0.88, 35.95));
    for (let i = 0; i < 7; i += 1) {
      out.push(
        `<circle cx="${n(1.9 + i * 0.72)}" cy="35.04" r="0.12" fill="none" stroke="${INK}" stroke-width="0.05" opacity="0.55"/>`,
      );
    }
    out.push(tableSeats(2.3, 39.6, 1.18, 1.18, 1), tableSeats(4.6, 39.6, 1.18, 1.18, 1));
    out.push(roundSeats(6.75, 39.6, 0.6, 1.06, 4));
  }

  // Agatha's Cove: a ring of seats round a clear middle, where the name goes.
  if (id === 'agathas-cove') {
    out.push(roundSeats(COVE_RING.cx, COVE_RING.cy, 0, COVE_RING.rSeats, COVE_RING.seats));
  }

  return out.join('');
}

export interface VenueMapSvgOptions {
  /** id prefix so two maps on one page do not collide. */
  idPrefix?: string;
  /** Accessible name. Rendered into a <title> element. */
  title?: string;
  /** Longer description. Rendered into a <desc> element. */
  description?: string;
}

/**
 * Build the plan as a standalone SVG string.
 *
 * Returned markup is self-contained and framework-free so the Astro site and
 * the React attendee app render byte-identical plans from one definition.
 * Every value interpolated here comes from the module constants above, so the
 * string is safe to inject.
 */
export function buildVenueMapSvg(options: VenueMapSvgOptions = {}): string {
  const {
    idPrefix = 'venue-map',
    title = 'REPLAY floor plan',
    description = venueMapOutline()
      .map((section) => `${section.heading}. ${section.items.join(' ')}`)
      .join(' '),
  } = options;

  const titleId = `${idPrefix}-title`;
  const descId = `${idPrefix}-desc`;
  const vb = [-PAD, -PAD, FLOOR.width + PAD * 2, FLOOR.length + PAD * 2].map(n).join(' ');

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="venue-map__svg" role="img" aria-labelledby="${titleId} ${descId}">`,
    `<title id="${titleId}">${esc(title)}</title>`,
    `<desc id="${descId}">${esc(description)}</desc>`,
    `<style>${SVG_STYLE}</style>`,
  ];

  // --- floor surfaces ------------------------------------------------------
  parts.push(
    rect({ x: 0, y: 0, w: FLOOR.width, h: FLOOR.length }, `fill="${FLOOR_FILL}"`),
    rect(
      { x: HALL_EDGE, y: 0, w: round(FLOOR.width - HALL_EDGE), h: FLOOR.length },
      `fill="${CONCOURSE}"`,
    ),
    '<g class="venue-map__zones">',
    ...ZONES.map(
      (z) =>
        `<g class="venue-map__zone" data-zone="${esc(z.id)}">${rect(z.rect, `fill="${z.fill}"`)}</g>`,
    ),
    '</g>',
  );

  // --- rooms ---------------------------------------------------------------
  const room = (b: Box, fill: string): string =>
    rect(boxRect(b), `fill="${fill}" stroke="${INK}" stroke-width="${W_ROOM}" stroke-linejoin="round"`);

  parts.push(
    '<g class="venue-map__rooms">',
    // The campfire floor is open to the corridor and to Agatha's Cove, so it
    // is a tint with one wall rather than an outlined room.
    rect(boxRect(CAMPFIRE_ROOM), `fill="${C_COMMUNAL}"`),
    room(WASH, ROOM_NEUTRAL),
    room(TOILET, ROOM_NEUTRAL),
    room(LIBRARY, C_LIBRARY),
    room(LOBBY, C_REGISTRATION),
    room(LIFT_CORE, C_LIFTS),
    '</g>',
  );

  // --- furniture -----------------------------------------------------------
  parts.push('<g class="venue-map__furniture">');
  for (const z of ZONES) parts.push(zoneFurniture(z.id));

  const wash = boxRect(WASH);
  const toilet = boxRect(TOILET);
  const library = boxRect(LIBRARY);
  const lobby = boxRect(LOBBY);
  const campfire = boxRect(CAMPFIRE_ROOM);

  // Wash basin counter and its bowls.
  parts.push(
    `<rect x="${n(wash.x + 0.35)}" y="${n(wash.y + 0.3)}" width="${n(
      wash.w - 0.7,
    )}" height="0.7" rx="${RX}" ${FURN}/>`,
  );
  for (const x of [570, 645, 715, 787]) {
    parts.push(
      `<ellipse cx="${n(sx(x))}" cy="${n(wash.y + 0.65)}" rx="0.3" ry="0.21" fill="none" stroke="${INK}" stroke-width="0.06"/>`,
    );
  }

  // Toilet fittings.
  parts.push(
    `<rect x="${n(toilet.x + toilet.w - 1.05)}" y="${n(toilet.y + 0.55)}" width="0.6" height="0.8" rx="0.26" ${FURN}/>`,
    `<rect x="${n(toilet.x + toilet.w - 1.05)}" y="${n(toilet.y + toilet.h - 1.3)}" width="0.66" height="0.44" rx="0.16" ${FURN}/>`,
  );

  // Game Library: the bar facing the corridor, shelving on the back wall.
  const bar = boxRect(LIBRARY_BAR);
  parts.push(
    rect(bar, `fill="${FLOOR_FILL}" stroke="${INK}" stroke-width="${W_FIXTURE}" stroke-linejoin="round"`),
    `<rect x="${n(library.x + library.w - 0.72)}" y="${n(library.y + 0.5)}" width="0.46" height="${n(
      library.h - 1.15,
    )}" rx="0.1" ${FURN}/>`,
  );

  // Save Point: the registration desk across the head of the lobby.
  const desk = boxRect(REGISTRATION);
  parts.push(rect(desk, `rx="${RX}" ${FURN}`));

  // Lift cars.
  const core = boxRect(LIFT_CORE);
  const carH = round((core.h - 0.5) / 2);
  for (const cy of [core.y + 0.18, core.y + core.h - 0.18 - carH]) {
    const car = { x: round(core.x + 0.16), y: round(cy), w: round(core.w - 0.32), h: carH };
    parts.push(
      rect(car, `fill="${FLOOR_FILL}" stroke="${INK}" stroke-width="${W_FIXTURE}" stroke-linejoin="round"`),
      `<path d="M ${n(car.x)} ${n(car.y)} L ${n(car.x + car.w)} ${n(car.y + car.h)} M ${n(
        car.x + car.w,
      )} ${n(car.y)} L ${n(car.x)} ${n(car.y + car.h)}" fill="none" stroke="${INK}" stroke-width="0.06" opacity="0.5"/>`,
    );
  }

  // The community table, ringed with chairs.
  const table = boxRect(CAMPFIRE_TABLE);
  parts.push(rect(table, `rx="${RX}" ${FURN}`));
  for (const px of CAMPFIRE_SEATS) {
    parts.push(seat(sx(px), round(table.y - SEAT_GAP)), seat(sx(px), round(table.y + table.h + SEAT_GAP)));
  }
  parts.push('</g>');

  // --- walls ---------------------------------------------------------------
  // The corridor wall along the open stretch of concourse, which the photo
  // wall and the snack machine are fixed to. The rooms carry their own.
  const openTop = sy(OPEN_CONCOURSE.y0);
  const openBottom = sy(OPEN_CONCOURSE.y1);
  parts.push(
    `<g class="venue-map__walls" stroke="${INK}" stroke-width="${W_WALL}" stroke-linecap="square">`,
    `<line x1="${n(SERVICE_EDGE)}" y1="${n(openTop)}" x2="${n(SERVICE_EDGE)}" y2="${n(openBottom)}"/>`,
    `<line x1="${n(campfire.x)}" y1="${n(campfire.y)}" x2="${n(campfire.x + campfire.w)}" y2="${n(
      campfire.y,
    )}"/>`,
    '</g>',
  );

  // Toilet door. It hangs off the wash basins and is entered from them, so the
  // door sits in its north wall and swings into the room.
  const doorW = 0.95;
  const doorX = round(toilet.x + 0.75);
  parts.push(
    `<g class="venue-map__doors" fill="none" stroke="${INK}" stroke-width="0.075">`,
    `<line x1="${n(doorX)}" y1="${n(toilet.y)}" x2="${n(doorX)}" y2="${n(toilet.y + doorW)}"/>`,
    `<path d="M ${n(doorX)} ${n(toilet.y + doorW)} A ${doorW} ${doorW} 0 0 0 ${n(
      doorX + doorW,
    )} ${n(toilet.y)}" opacity="0.55"/>`,
    '</g>',
  );

  // --- units fixed to the corridor wall ------------------------------------
  parts.push('<g class="venue-map__mounted">');
  for (const m of MOUNTED) {
    parts.push(
      rect(
        mountedRect(m),
        `data-mounted="${esc(m.id)}" rx="0.1" fill="${m.fill}" stroke="${INK}" stroke-width="${W_FIXTURE}" stroke-linejoin="round"`,
      ),
    );
  }
  parts.push('</g>');

  // --- frame ---------------------------------------------------------------
  parts.push(
    rect(
      { x: 0, y: 0, w: FLOOR.width, h: FLOOR.length },
      `fill="none" stroke="${INK}" stroke-width="${W_FRAME}" stroke-linejoin="miter"`,
    ),
  );

  // --- labels --------------------------------------------------------------
  // `paint-order` is not honoured by every renderer, and where it is ignored
  // the knockout paints straight over the glyphs and eats them. Emit the
  // knockout and the letter as two texts instead.
  const label = (
    cx: number,
    cy: number,
    text: string,
    cls: string,
    knockout: string | null,
    size?: number,
    spin?: string,
  ): string => {
    const style = size ? ` style="font-size:${n(size)}px"` : '';
    const body = `x="${n(cx)}" y="${n(cy)}" class="${cls}" text-anchor="middle"${style}${spin ?? ''}`;
    const front = `<text ${body}>${esc(text)}</text>`;
    if (!knockout) return front;
    return (
      `<text ${body} fill="none" stroke="${knockout}" stroke-width="0.35" stroke-linejoin="round">${esc(
        text,
      )}</text>` + front
    );
  };

  parts.push('<g class="venue-map__labels">');

  // Zone names sit dead centre of their zone; the furniture above is laid out
  // to leave that middle clear. A name that cannot letter across its zone at a
  // readable size wraps onto two lines rather than shrinking away.
  for (const z of ZONES) {
    const avail = z.labelWidth ?? z.rect.w - 1.1;
    const words = z.name.split(' ');
    const single = fitFontSize(z.name, avail, T_ZONE, 0.5);
    const lines =
      single < 0.7 && words.length > 1
        ? [words.slice(0, -1).join(' '), words[words.length - 1]]
        : [z.name];
    const longest = Math.max(...lines.map((l) => l.length));
    const size = fitFontSize('x'.repeat(longest), avail, T_ZONE, 0.5);
    const cx = round(z.rect.x + z.rect.w / 2);
    const cy = z.rect.y + z.rect.h / 2;
    const top = cy - ((lines.length - 1) * size * 1.05) / 2 + size * 0.35;
    lines.forEach((line, i) => {
      parts.push(
        label(cx, round(top + i * size * 1.05), line.toUpperCase(), 'fp-zone', z.fill, size),
      );
    });
  }

  const corrCx = round(CORRIDOR.x + CORRIDOR.w / 2);
  const corrCy = round((CORRIDOR.y + CORRIDOR.y + CORRIDOR.h) / 2);
  parts.push(
    label(
      corrCx,
      corrCy,
      'CASSETTE CORRIDOR',
      'fp-concourse',
      CONCOURSE,
      undefined,
      ` transform="rotate(-90 ${n(corrCx)} ${n(corrCy)})"`,
    ),
    label(round(wash.x + wash.w / 2), round(wash.y + wash.h - 1.05), 'WASH BASINS', 'fp-feature', ROOM_NEUTRAL),
    label(round(toilet.x + toilet.w / 2), round(toilet.y + 2.05), 'TOILET', 'fp-feature', ROOM_NEUTRAL),
    label(round(lobby.x + lobby.w / 2 - 0.4), round(lobby.y + 2.65), 'SAVE POINT', 'fp-feature', C_REGISTRATION),
    label(round(table.x + table.w / 2), round(table.y + table.h / 2 + 0.22), 'CAMPFIRE', 'fp-feature', FLOOR_FILL),
  );

  // The wall-mounted units are slim, so their names sit beside them.
  for (const m of MOUNTED) {
    const r = mountedRect(m);
    parts.push(
      label(
        round(SERVICE_EDGE + 0.4 + m.name.length * T_SMALL * ADVANCE * 0.5),
        round(r.y + r.h / 2 + 0.18),
        m.name.toUpperCase(),
        'fp-small',
        CONCOURSE,
      ),
    );
  }

  // Game Library, turned along the room the way the artifact turns it.
  const libCx = round(library.x + library.w / 2);
  const libCy = round(library.y + library.h / 2);
  parts.push(
    label(libCx, libCy, 'GAME LIBRARY', 'fp-feature', C_LIBRARY, undefined, ` transform="rotate(90 ${n(
      libCx,
    )} ${n(libCy)})"`),
  );

  // Lifts, turned inside the core.
  const liftCx = round(core.x + core.w / 2);
  const liftCy = round(core.y + core.h / 2);
  parts.push(
    label(liftCx, liftCy, 'LIFTS', 'fp-small', C_LIFTS, undefined, ` transform="rotate(90 ${n(
      liftCx,
    )} ${n(liftCy)})"`),
  );

  parts.push('</g>', '</svg>');

  return parts.join('');
}
