import { describe, it, expect } from 'vitest';
import { SPONSOR_TIERS, tierHolders, tierStatus, type SponsorTier } from './sponsor-tiers';

const tier = (key: string): SponsorTier => {
  const found = SPONSOR_TIERS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no tier ${key}`);
  return found;
};

describe('tierHolders', () => {
  it('keeps only the sponsors on that tier', () => {
    const sponsors = [
      { name: 'Indiqube', tier: 'venue' },
      { name: 'Meeple Syrup', tier: 'association' },
      { name: 'Zenwood', tier: 'gaming' },
    ];
    expect(tierHolders(sponsors, 'venue')).toEqual(['Indiqube']);
    expect(tierHolders(sponsors, 'title')).toEqual([]);
  });

  it('ignores a row with no usable name', () => {
    expect(tierHolders([{ name: '  ', tier: 'venue' }], 'venue')).toEqual([]);
  });
});

describe('tierStatus', () => {
  it('leaves a tier open while nobody holds it', () => {
    expect(tierStatus(tier('title'), [{ name: 'Indiqube', tier: 'venue' }], '3rd edition')).toBeNull();
  });

  it('closes an exclusive tier as soon as one sponsor holds it', () => {
    const status = tierStatus(tier('venue'), [{ name: 'Indiqube', tier: 'venue' }], '3rd edition');
    expect(status).toEqual({
      label: 'Closed for REPLAY 3rd edition',
      detail: 'Indiqube is the venue partner for this edition.',
    });
  });

  it('closes the association tier on its own sponsor, not the venue’s', () => {
    const sponsors = [
      { name: 'Indiqube', tier: 'venue' },
      { name: 'Meeple Syrup', tier: 'association' },
    ];
    expect(tierStatus(tier('association'), sponsors, '3rd edition')?.detail).toBe(
      'Meeple Syrup is the association partner for this edition.',
    );
  });

  it('keeps a three-slot tier open until all three are taken', () => {
    const two = [
      { name: 'Alpha', tier: 'zone' },
      { name: 'Beta', tier: 'zone' },
    ];
    expect(tierStatus(tier('zone'), two, '3rd edition')).toBeNull();
    const three = [...two, { name: 'Gamma', tier: 'zone' }];
    expect(tierStatus(tier('zone'), three, '3rd edition')?.detail).toBe(
      'Alpha, Beta and Gamma are the zone partners for this edition.',
    );
  });

  it('never closes an uncapped tier', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `Venue ${i}`, tier: 'gaming' }));
    expect(tierStatus(tier('gaming'), many, '3rd edition')).toBeNull();
  });

  it('drops the edition from the label when the slug carries no number', () => {
    expect(tierStatus(tier('venue'), [{ name: 'Indiqube', tier: 'venue' }], '')?.label).toBe(
      'Closed for this edition',
    );
  });
});
