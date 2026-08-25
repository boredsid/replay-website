import { render } from '@testing-library/react';
import { KEY_ITEMS } from '../../../src/lib/venue-map';
import { VenueMap } from './VenueMap';

it('keys every place with the line saying what happens there', () => {
  const { container } = render(<VenueMap />);

  const rows = container.querySelectorAll('.venue-map__zone-item');
  expect(rows).toHaveLength(KEY_ITEMS.length);

  KEY_ITEMS.forEach((item, i) => {
    expect(rows[i].textContent).toContain(item.name);
    // The second line lives here, beside the map, not on the drawing.
    expect(rows[i].textContent).toContain(item.blurb);
  });
});

it('keeps the second lines off the drawing itself', () => {
  const { container } = render(<VenueMap />);

  const svg = container.querySelector('svg')!.outerHTML;
  for (const item of KEY_ITEMS) expect(svg).not.toContain(item.blurb);
});

it('carries the map as text in the drawing’s own description', () => {
  const { container } = render(<VenueMap />);

  // The visible read-as-text block is gone, so the SVG description is the
  // whole accessible alternative.
  const desc = container.querySelector('desc');
  expect(desc?.textContent?.length ?? 0).toBeGreaterThan(400);
  expect(desc?.textContent).toContain('Cassette Corridor');

  const svg = container.querySelector('svg');
  expect(svg?.getAttribute('role')).toBe('img');
  expect(svg?.getAttribute('aria-labelledby')).toContain('app-venue-map-title');
});
