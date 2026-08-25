/**
 * VenueMap
 * -----------------------------------------------------------------
 * Floor map on the attendee app's Map tab.
 *
 * The drawing comes from the same module the public site uses, so both
 * surfaces show one map rather than two that drift apart. It is inline
 * SVG with no external requests, which is what makes it usable when the
 * venue network is not.
 */
import { KEY_ITEMS, buildVenueMapSvg } from '../../../src/lib/venue-map';

const svg = buildVenueMapSvg({ idPrefix: 'app-venue-map' });

export function VenueMap() {
  return (
    <section className="screen-section venue-map" aria-labelledby="venue-map-heading">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">The floor</span>
          <h2 id="venue-map-heading">Where everything is</h2>
        </div>
      </div>

      <figure className="venue-map__figure">
        <div
          className="venue-map__frame"
          // Markup is generated from the static geometry module, not from
          // anything the network or a person supplied.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </figure>

      <h3 className="venue-map__key-heading">Play zones</h3>
      <ul className="venue-map__zone-list">
        {KEY_ITEMS.map((item) => (
          <li key={item.id} className="venue-map__zone-item">
            <span
              className="venue-map__swatch"
              style={{ background: item.fill }}
              aria-hidden="true"
            />
            <span>
              <strong>{item.name}</strong>
              <small>{item.blurb}</small>
            </span>
          </li>
        ))}
      </ul>

    </section>
  );
}
