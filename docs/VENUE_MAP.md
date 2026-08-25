# Venue map

The floor map that appears on `/plan-your-visit` and on the attendee app's Map
tab. One definition, two surfaces.

## Where it lives

| File | Purpose |
|---|---|
| `src/lib/venue-map.ts` | Geometry in real-world metres, plus `buildVenueMapSvg()`. No framework, no dependencies. |
| `src/lib/venue-map.test.ts` | Geometry invariants (nothing overlaps, nothing escapes the floor) and rendering contract. |
| `src/components/VenueMap.astro` | Public-site section: the plan, the key, and the wall legend. |
| `app/src/components/VenueMap.tsx` | Attendee-app section. Imports the same module across the repo root. |

The app imports `../../../src/lib/venue-map` directly rather than keeping a
copy. Vite bundles it fine from outside the app root, and `npm run check:app`
typechecks it. A copy would drift the moment one surface got a correction.

## What is the source of truth

**The organiser sketch decides what is on the map and where it sits** — the five
zones, the Cassette Corridor down the middle, and the amenities down the service
side in the order and adjacency the sketch draws them. Nothing appears on the
map that the sketch does not show.

**The venue's CAD drawing is used for one thing: scale.** It fixes the outer
envelope at 42.4 m × 20.32 m, so proportions are honest and the scale bar means
something. The sketch's internal proportions are carried into that envelope
unchanged.

Concretely, `sketch(x0, y0, x1, y1)` takes pixel coordinates read off the
sketch and maps them into the real envelope. Every box in the module is written
that way, so the mapping back to the drawing stays inspectable — if the sketch
changes, edit the pixel numbers.

## Drawing language

Lifted wholesale from the earlier REPLAY venue-map artifact, which is the agreed
look. Its constants are converted from that artifact's 521px-wide viewBox into
metres (**1 artifact px = 0.039 m**), so the two stay visually identical.

| | Value |
|---|---|
| Sheet | `#FFF8E7`, `border-radius: 3px`, `box-shadow: 0 18px 48px rgb(40 36 26 / 0.22)` on a `#E9E3D5` ground — a printed sheet on a table |
| Floor / concourse | `#FFFDF7` / `#F7F3E9` |
| Zone tints | `#FCF2DC` `#FBE4E0` `#FDEBD6` `#E6F5EC` `#EFE9FB` |
| Room colours | Game Library `#A8E6CF`, Save Point `#FBDFC4`, Lifts `#FF6B6B`, snacks `#FFD166`, photo wall `#C3A6FF`, water `#4ECDC4`, campfire `#E2F4F2`, wet rooms `#EDE8DC` |
| Strokes | frame `0.273`, room `0.117`, wall `0.14`, fixture `0.07` |
| Type | zone `1.05` / 0.06em, feature `0.51` / 0.08em, concourse `0.47` / 0.2em at 0.6 opacity — all uppercase Space Grotesk |

Everything is outlined in ink. Pale tints mark the open play zones and Save
Point; full brand colour marks the small things people go looking for.

**No measurements anywhere** — not on zones, not as dimension lines. A test
asserts they stay off.

Only real walls are drawn: the rooms carry their own outlines, and the campfire
floor gets a single wall on its Save Point side because that is the only side it
has one. Everything else is open floor with no line at all.

### Furniture is illustrative

Each zone gets line art showing how it is used — table banks in Sandbox and
Spotlight, stalls and trading tables in Garage, a painting bench with puzzle and
origami tables in Ground Control, and the fifteen-seat Blood on the Clocktower
ring in Agatha's Cove. `zoneFurniture()` is the one place in the module where
looks beat precision, and the caption on both surfaces says so.

### One rendering gotcha

Labels are knocked out so they stay readable over furniture. `paint-order="stroke"`
is the tidy way to do that and **it is not honoured by every renderer** — where
it is ignored the knockout paints straight over the glyphs and eats them. It is
therefore drawn as two separate `<text>` elements, and a test asserts
`paint-order` never comes back.

## Coordinate system

```
x  across the floor   0 → 20.32 m    left = play zones, right = services
y  along  the floor   0 → 42.40 m    top  = wash basins, bottom = far end
```

Portrait, matching the sketch and a phone screen.

## What is on it

Play zones, down the left: **Sandbox**, **Garage**, **Spotlight**, **Ground
Control**, with **Agatha's Cove** beside Ground Control at the bottom, across
the foot of the corridor.

Concourse, top to bottom exactly as the sketch stacks it:

| | |
|---|---|
| **Wash basins** | room across the top, open to the corridor |
| **Water dispenser** | slim unit fixed to the corridor wall |
| **Toilet** | room hung off the wash basins and entered from them, so its door sits in that shared wall |
| **Game Library** | room with its bar counter facing the corridor |
| **Save Point** | entrance lobby (pastel, like the zones), registration desk across its head |
| **Lifts** | beside Save Point, not inside it |
| **Photo wall** | on the corridor wall, at the corner out of Save Point |
| *(open concourse)* | **unassigned floor** — see below |
| **Snack machine** | on the corridor wall, at the campfire corner |
| **Campfire** | the community table. Reaches across the foot of the corridor to meet Spotlight, which is why the corridor stops where it does |

The **Cassette Corridor** runs between the two sides.

### Zone names go in the middle

Each zone's name sits at the centre of its zone, and **the furniture is laid out
around that** — `zoneFurniture()` puts table banks above and below the middle,
never through it. Agatha's Cove has no table inside its ring for the same
reason: the name goes there. A test asserts no furniture rect crosses a zone's
centre line, so a layout change cannot quietly cover a name.

The graphics are drawn at `FS` (0.76) and kept sparse deliberately. They are
flavour — they say what a zone is for — and the name is what actually has to
read. If a zone starts to look busy, take furniture out rather than shrinking
the name.

### The second lines live in the key, not on the plan

`KEY_ITEMS` is what the key beside the map renders: the five play zones plus
Save Point and Campfire, each with one line on what happens there. **Those lines
never go on the drawing.** They were tried there and it crowded every zone —
the plan reads with names alone, and the detail belongs where there is room for
it. A test asserts no `KEY_ITEMS` blurb appears in the SVG.

### The text alternative rides in the SVG

There is no visible read-as-text block. `buildVenueMapSvg()` builds its `<desc>`
from `venueMapOutline()`, so the whole description sits in the accessibility
tree where a screen reader reaches it through `role="img"` and `aria-labelledby`.
That is the accessible alternative `docs/ATTENDEE_APP_PLAN.md` asks for; keep it
comprehensive when you change the plan.

A name that cannot letter across its zone at a readable size wraps onto two
lines rather than shrinking away. `labelWidth` on a zone overrides the width the
name has to fit — Agatha's Cove uses the clear width inside its ring, so
"Agatha's Cove" wraps.

### Two things the sketch gets right that are easy to lose

**The open concourse.** Between Save Point and the campfire the sketch shows
plain floor with no room and no tint — only the corridor wall carrying the photo
wall and the snack machine. `OPEN_CONCOURSE` exists to name that stretch so it
does not get filled in, and a test asserts it stays between the two.

**The alignments.** Save Point's north wall lines up with the Sandbox / Garage
division, and the campfire floor's south wall with Spotlight / Ground Control.
Both are deliberate in the sketch; a test holds them.

## Editing

Everything is data, expressed in sketch pixels via `sx()`, `sy()` and
`sketch()`. To move something, change its pixel numbers.

Before adding anything, decide which of the three lists it belongs in. Putting a
zone divider in `WALLS` tells someone they cannot walk between zones, which is
the one mistake this map cannot make.

- Room boxes (`WASH`, `TOILET`, `LIBRARY`, `LOBBY`, `LIFT_CORE`,
  `CAMPFIRE_ROOM`, `OPEN_CONCOURSE`) — in sketch pixels, converted by `boxRect()`.
- `MOUNTED` — the slim units fixed to the corridor wall.
- `ZONES` — pale tints with a name.
- `zoneFurniture()` — the illustrative line art, per zone.
- `AREAS` — the named list the page legend and the text alternative read from.

Zone labels auto-shrink to fit their bay; `ADVANCE` accounts for letterspacing,
so do not lower it or long names will overrun.

`venueMapOutline()` returns the plain-text description of the map. Both surfaces
render it under "Read the map as text"; it is the accessible alternative
`docs/ATTENDEE_APP_PLAN.md` asks for, and it stays correct automatically because
it is generated from the same data.

Run `npm test` after editing. The geometry tests catch overlapping zones and
rooms, anything that escapes the floor plate, the concourse stack falling out of
the sketch's order, the open stretch getting filled in, the sketch's alignments
drifting, and any measurement creeping back onto the drawing.

### One rounding gotcha

`sketch()` rounds both edges before taking the width, so two boxes the sketch
draws sharing a wall still share an exact edge. Rounding the width independently
leaves a millimetre of overlap, which the overlap tests will fail on.

## Open questions

- **The Forge** is named in organiser notes as a rest space but is not on the
  sketch, so it is not on the map.
- **Fire exits and stairs** are not marked. The sketch does not show them, and
  they should not be guessed — the CAD puts two 1.7 m exit doors on the far wall
  at the Sandbox end and a fire stair beside the lifts, if they are wanted.
- **A 125 mm step** exists at the lift lobby in the CAD (`+0.00LVL` to
  `+125.00LVL`). It matters for step-free routing and is currently unmarked.
