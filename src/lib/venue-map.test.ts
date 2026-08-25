import { describe, expect, it } from 'vitest';
import {
  AREAS,
  CAMPFIRE_ROOM,
  KEY_ITEMS,
  CORRIDOR,
  COVE_RING,
  FLOOR,
  HALL_EDGE,
  INSIDE,
  LIBRARY,
  LIFT_CORE,
  LOBBY,
  MOUNTED,
  OPEN_CONCOURSE,
  SERVICE_EDGE,
  TOILET,
  WASH,
  ZONES,
  area,
  boxRect,
  buildVenueMapSvg,
  mountedRect,
  sx,
  sy,
  venueMapOutline,
  type Box,
  type Rect,
} from './venue-map';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - 1e-6 &&
  b.x < a.x + a.w - 1e-6 &&
  a.y < b.y + b.h - 1e-6 &&
  b.y < a.y + a.h - 1e-6;

const inside = (r: Rect): boolean =>
  r.x >= -1e-6 &&
  r.y >= -1e-6 &&
  r.x + r.w <= FLOOR.width + 1e-6 &&
  r.y + r.h <= FLOOR.length + 1e-6;

const ROOMS: Array<[string, Box]> = [
  ['wash', WASH],
  ['toilet', TOILET],
  ['library', LIBRARY],
  ['lobby', LOBBY],
  ['lifts', LIFT_CORE],
  ['campfire', CAMPFIRE_ROOM],
  ['open', OPEN_CONCOURSE],
];

describe('venue map geometry', () => {
  it('keeps everything inside the floor plate', () => {
    for (const [, b] of ROOMS) expect(inside(boxRect(b))).toBe(true);
    for (const z of ZONES) expect(inside(z.rect)).toBe(true);
    expect(inside(CORRIDOR)).toBe(true);
  });

  it('puts the play zones on one side of the corridor and the rooms on the other', () => {
    for (const z of ZONES.filter((z) => z.id !== 'agathas-cove')) {
      expect(z.rect.x + z.rect.w).toBeLessThanOrEqual(HALL_EDGE + 1e-6);
    }
    for (const [name, b] of ROOMS) {
      // The campfire floor is the one exception: it reaches across the foot of
      // the corridor to meet Spotlight.
      const edge = name === 'campfire' ? HALL_EDGE : SERVICE_EDGE;
      expect([name, sx(b.x0) >= edge - 1e-6]).toEqual([name, true]);
    }
  });

  it("runs Agatha's Cove across the foot of the corridor, as the sketch draws it", () => {
    const cove = ZONES.find((z) => z.id === 'agathas-cove')!;
    const ground = ZONES.find((z) => z.id === 'ground-control')!;
    expect(cove.rect.y).toBeCloseTo(ground.rect.y, 2);
    expect(cove.rect.x).toBeCloseTo(ground.rect.x + ground.rect.w, 2);
    // It crosses the corridor line, which is exactly why there is no wall there.
    expect(cove.rect.x + cove.rect.w).toBeGreaterThan(SERVICE_EDGE);
  });

  it('does not let zones overlap each other', () => {
    for (let i = 0; i < ZONES.length; i += 1) {
      for (let j = i + 1; j < ZONES.length; j += 1) {
        const [a, b] = [ZONES[i], ZONES[j]];
        expect([a.id, b.id, overlaps(a.rect, b.rect)]).toEqual([a.id, b.id, false]);
      }
    }
  });

  it('fills the hall completely, leaving no sliver between zones', () => {
    const hall = ZONES.filter((z) => z.id !== 'agathas-cove');
    expect(hall[0].rect.y).toBeCloseTo(INSIDE.y0, 3);
    expect(hall[hall.length - 1].rect.y + hall[hall.length - 1].rect.h).toBeCloseTo(INSIDE.y1, 3);
    for (let i = 1; i < hall.length; i += 1) {
      expect(hall[i].rect.y).toBeCloseTo(hall[i - 1].rect.y + hall[i - 1].rect.h, 3);
    }
  });

  it('does not let concourse rooms overlap each other', () => {
    for (let i = 0; i < ROOMS.length; i += 1) {
      for (let j = i + 1; j < ROOMS.length; j += 1) {
        const [an, ab] = ROOMS[i];
        const [bn, bb] = ROOMS[j];
        // The lifts sit alongside Save Point, not inside it.
        expect([an, bn, overlaps(boxRect(ab), boxRect(bb))]).toEqual([an, bn, false]);
      }
    }
  });

  it('hangs the toilet off the wash basins, entered from them', () => {
    expect(TOILET.y0).toBe(WASH.y1);
    const svg = buildVenueMapSvg();
    const doors = svg.slice(svg.indexOf('venue-map__doors'), svg.indexOf('venue-map__mounted'));
    const toilet = boxRect(TOILET);
    // The leaf hangs from the north wall, so it runs down into the room.
    const leaf = /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/.exec(doors)!;
    expect(Number(leaf[1])).toBeCloseTo(Number(leaf[3]), 3);
    expect(Number(leaf[2])).toBeCloseTo(toilet.y, 2);
    expect(Number(leaf[4])).toBeGreaterThan(toilet.y);
  });

  it('stacks the concourse in the order the sketch draws it', () => {
    const order: Array<[string, number]> = [
      ['wash', WASH.y1],
      ['toilet', TOILET.y1],
      ['library', LIBRARY.y1],
      ['lobby', LOBBY.y1],
      ['open', OPEN_CONCOURSE.y1],
      ['campfire', CAMPFIRE_ROOM.y1],
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect([order[i][0], order[i][1] > order[i - 1][1]]).toEqual([order[i][0], true]);
    }
  });

  it('leaves the concourse between Save Point and the campfire unassigned', () => {
    // The sketch shows plain floor there. Tinting it would invent a zone.
    expect(OPEN_CONCOURSE.y0).toBe(LOBBY.y1);
    expect(OPEN_CONCOURSE.y1).toBe(CAMPFIRE_ROOM.y0);
    expect(sy(OPEN_CONCOURSE.y1) - sy(OPEN_CONCOURSE.y0)).toBeGreaterThan(5);
  });

  it('hangs the water dispenser, photo wall and snack machine on the corridor wall', () => {
    expect(MOUNTED.map((m) => m.id)).toEqual(['water-dispenser', 'photo-wall', 'snack-machine']);
    for (const m of MOUNTED) {
      const r = mountedRect(m);
      // Slim units standing proud of the wall, not rooms.
      expect([m.id, r.w < 0.6]).toEqual([m.id, true]);
      expect([m.id, r.x + r.w]).toEqual([m.id, SERVICE_EDGE]);
    }
    // The photo wall sits just out of Save Point; snacks at the campfire corner.
    const photo = MOUNTED.find((m) => m.id === 'photo-wall')!;
    const snack = MOUNTED.find((m) => m.id === 'snack-machine')!;
    expect(photo.y0).toBeGreaterThanOrEqual(LOBBY.y1);
    expect(snack.y1).toBe(CAMPFIRE_ROOM.y0);
  });

  it('lines Save Point and the campfire up with the play-zone divisions', () => {
    // Deliberate in the sketch: keep it.
    expect(sy(LOBBY.y0)).toBeCloseTo(ZONES[1].rect.y, 3);
    expect(sy(CAMPFIRE_ROOM.y1)).toBeCloseTo(ZONES[3].rect.y, 3);
  });

  it('stops Save Point short of the east wall so the lifts can sit beside it', () => {
    expect(LOBBY.x1).toBe(LIFT_CORE.x0);
    expect(sx(LIFT_CORE.x1)).toBeCloseTo(INSIDE.x1, 3);
  });

  it('stops the corridor where the campfire floor reaches across to Spotlight', () => {
    expect(CORRIDOR.x).toBeCloseTo(HALL_EDGE, 3);
    expect(CORRIDOR.x + CORRIDOR.w).toBeCloseTo(SERVICE_EDGE, 3);
    expect(CORRIDOR.y + CORRIDOR.h).toBeCloseTo(sy(CAMPFIRE_ROOM.y0), 3);
    // And the campfire floor runs all the way to the play side.
    expect(sx(CAMPFIRE_ROOM.x0)).toBeCloseTo(HALL_EDGE, 3);
  });

  it('leaves every zone big enough to seat a table bank', () => {
    for (const z of ZONES) expect(area(z.rect)).toBeGreaterThan(50);
  });

  it('rings Agatha’s Cove with a playable table, centred and clear of its edges', () => {
    // Blood on the Clocktower runs 5-15 to a table.
    expect(COVE_RING.seats).toBeGreaterThanOrEqual(5);
    expect(COVE_RING.seats).toBeLessThanOrEqual(15);

    const cove = ZONES.find((z) => z.id === 'agathas-cove')!.rect;
    expect(COVE_RING.cx).toBeCloseTo(cove.x + cove.w / 2, 2);
    expect(COVE_RING.cy).toBeCloseTo(cove.y + cove.h / 2, 2);

    // A metre of breathing room round the ring on every side.
    const reach = COVE_RING.rSeats + 0.3;
    expect(COVE_RING.cx - reach - cove.x).toBeGreaterThan(1);
    expect(cove.x + cove.w - (COVE_RING.cx + reach)).toBeGreaterThan(1);
    expect(COVE_RING.cy - reach - cove.y).toBeGreaterThan(1);
    expect(cove.y + cove.h - (COVE_RING.cy + reach)).toBeGreaterThan(1);
  });

  it('keeps the flavour graphics clear of the middle, where the name goes', () => {
    const svg = buildVenueMapSvg();
    const furniture = svg.slice(
      svg.indexOf('venue-map__furniture'),
      svg.indexOf('venue-map__walls'),
    );
    // Nothing drawn across a zone's centre line, so every name lands on clear
    // tint. Only rects inside the zone count — the concourse has its own
    // furniture at the same heights.
    const boxes = [...furniture.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));

    for (const z of ZONES.filter((z) => z.id !== 'agathas-cove')) {
      const cy = z.rect.y + z.rect.h / 2;
      const crossing = boxes.filter(
        (b) =>
          b.x >= z.rect.x - 1e-6 &&
          b.x + b.w <= z.rect.x + z.rect.w + 1e-6 &&
          b.y < cy + 0.45 &&
          b.y + b.h > cy - 0.45,
      );
      expect([z.id, crossing.length]).toEqual([z.id, 0]);
    }
  });
});

describe('venue map rendering', () => {
  it('renders a self-contained, labelled svg', () => {
    const svg = buildVenueMapSvg({ idPrefix: 'test-map' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-labelledby="test-map-title test-map-desc"');
    expect(svg).not.toContain('http://www.w3.org/1999/xlink');
  });

  it('draws the sheet in the artifact’s language', () => {
    const svg = buildVenueMapSvg();
    expect(svg).toContain('stroke-width="0.273"');
    expect(svg).toContain('#1A1A1A');
    for (const brand of ['#A8E6CF', '#FF6B6B', '#FFD166', '#C3A6FF', '#4ECDC4']) {
      expect(svg).toContain(brand);
    }
    // Save Point is a pastel like the zones, not a saturated block.
    expect(svg).toContain('#FBDFC4');
    expect(svg).not.toContain('#F47B20');
  });

  it('leaves the middle of Agatha’s Cove clear for its name', () => {
    const svg = buildVenueMapSvg();
    const ring = COVE_RING;
    // No table circle at the ring's centre.
    expect(svg).not.toContain(`<circle cx="${ring.cx}" cy="${ring.cy}"`);
  });

  it('keeps the second lines in the key, not on the drawing', () => {
    const svg = buildVenueMapSvg();
    // The plan reads with names alone; the detail belongs beside it, where
    // there is room for it.
    for (const item of KEY_ITEMS) expect([item.id, svg.includes(item.blurb)]).toEqual([item.id, false]);
    // Every zone and both extra places carry one.
    expect(KEY_ITEMS).toHaveLength(ZONES.length + 2);
    for (const item of KEY_ITEMS) expect(item.blurb.length).toBeGreaterThan(10);
  });

  it('carries the whole text alternative in the svg description', () => {
    const svg = buildVenueMapSvg();
    const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(svg)?.[1] ?? '';
    // The visible read-as-text block is gone, so this is all of it.
    expect(desc.length).toBeGreaterThan(400);
    expect(desc).toContain('Cassette Corridor');
    for (const z of ZONES) expect(desc).toContain(z.name);
  });

  it('carries no measurements anywhere', () => {
    const svg = buildVenueMapSvg();
    expect(svg).not.toMatch(/>\s*[\d.]+\s*m\s*</);
    expect(svg).not.toContain('×');
    expect(svg).not.toContain('m²');
    const outline = venueMapOutline()
      .flatMap((s) => s.items)
      .join(' ');
    expect(outline).not.toContain('square metres');
  });

  it('centres each zone name in its zone, wrapping rather than shrinking away', () => {
    const svg = buildVenueMapSvg();
    for (const z of ZONES) {
      const cy = z.rect.y + z.rect.h / 2;
      // Every line of the name sits within half a line of the zone's middle.
      const ys = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)" class="fp-zone"/g)]
        .map((m) => Number(m[1]))
        .filter((y) => Math.abs(y - cy) < 1.6);
      expect([z.id, ys.length > 0]).toEqual([z.id, true]);
    }
    // Agatha's Cove has to letter inside its ring, so it wraps.
    expect(svg).toContain(">AGATHA'S<");
    expect(svg).toContain('>COVE<');
  });

  it('names every zone and every room on the plan', () => {
    const svg = buildVenueMapSvg();
    for (const z of ZONES) {
      expect(svg).toContain(`data-zone="${z.id}"`);
      // A long name may wrap, so check its first word rather than the whole.
      expect(svg).toContain(z.name.split(' ')[0].toUpperCase());
    }
    for (const m of MOUNTED) {
      expect(svg).toContain(`data-mounted="${m.id}"`);
      expect(svg).toContain(m.name.toUpperCase());
    }
    for (const l of ['WASH BASINS', 'TOILET', 'GAME LIBRARY', 'SAVE POINT', 'LIFTS', 'CAMPFIRE']) {
      expect(svg).toContain(l);
    }
    expect(svg).toContain('CASSETTE CORRIDOR');
  });

  it('knocks labels out with two passes, since paint-order is not honoured everywhere', () => {
    const svg = buildVenueMapSvg();
    // A knockout painted over the glyph instead of under it eats the letters.
    expect(svg).not.toContain('paint-order');
    expect(svg).toContain('stroke-linejoin="round"');
    for (const z of ZONES) {
      const first = z.name.split(' ')[0].toUpperCase();
      expect([z.id, svg.split(first).length - 1 >= 2]).toEqual([z.id, true]);
    }
  });

  it('escapes text rather than trusting it as markup', () => {
    const svg = buildVenueMapSvg({ title: 'a & b <script>' });
    expect(svg).toContain('a &amp; b &lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('scopes ids so two maps can share a page', () => {
    const a = buildVenueMapSvg({ idPrefix: 'one' });
    const b = buildVenueMapSvg({ idPrefix: 'two' });
    expect(a).toContain('id="one-title"');
    expect(b).toContain('id="two-title"');
    expect(a).not.toContain('id="two-title"');
  });
});

describe('venue map text alternative', () => {
  it('describes the zones, the route and every area', () => {
    const outline = venueMapOutline();
    expect(outline).toHaveLength(3);
    const flat = outline.flatMap((s) => s.items).join(' ');
    for (const z of ZONES) expect(flat).toContain(z.name);
    for (const a of AREAS) expect(flat).toContain(a.name);
    expect(flat).toContain('Cassette Corridor');
    // The two facts that matter most for finding your way.
    expect(flat).toContain('one large room');
    expect(flat).toContain('lifts open into Save Point');
  });
});
