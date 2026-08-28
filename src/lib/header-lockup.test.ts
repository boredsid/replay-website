import { describe, expect, it } from 'vitest';
import { headerLockup } from './header-lockup';

const logo = (name: string, tier: string, inHeader = true) => ({ name, tier, inHeader });

describe('headerLockup', () => {
  it('credits the title sponsor and the association sponsor', () => {
    const lockup = headerLockup([
      logo('Somo Club', 'title'),
      logo('Mozaic', 'association'),
      logo('Indiqube', 'venue'),
      logo('Zolives', 'community'),
    ]);
    expect(lockup.presenter?.name).toBe('Somo Club');
    expect(lockup.associate?.name).toBe('Mozaic');
    expect(lockup.hasCredits).toBe(true);
  });

  it('carries one credit on its own', () => {
    const titleOnly = headerLockup([logo('Somo Club', 'title'), logo('Zolives', 'community')]);
    expect(titleOnly).toMatchObject({ presenter: { name: 'Somo Club' }, associate: null, hasCredits: true });

    const associationOnly = headerLockup([logo('Mozaic', 'association')]);
    expect(associationOnly).toMatchObject({ presenter: null, associate: { name: 'Mozaic' }, hasCredits: true });
  });

  it('leaves the header alone when neither tier is sold', () => {
    expect(headerLockup([logo('Indiqube', 'venue'), logo('Zolives', 'community')])).toEqual({
      presenter: null,
      associate: null,
      hasCredits: false,
    });
    expect(headerLockup([])).toMatchObject({ hasCredits: false });
  });

  it('leaves out a sponsor switched off in the console, tier or not', () => {
    const lockup = headerLockup([
      logo('Somo Club', 'title', false),
      logo('Mozaic', 'association', false),
      logo('Zolives', 'community'),
    ]);
    expect(lockup).toEqual({ presenter: null, associate: null, hasCredits: false });
  });

  it('keeps the credit that is switched on when the other is not', () => {
    const lockup = headerLockup([logo('Somo Club', 'title', false), logo('Mozaic', 'association')]);
    expect(lockup).toMatchObject({ presenter: null, associate: { name: 'Mozaic' }, hasCredits: true });
  });

  it('passes over a switched-off brand for one that is switched on', () => {
    const lockup = headerLockup([logo('Somo Club', 'title', false), logo('Dice Hard', 'title')]);
    expect(lockup.presenter?.name).toBe('Dice Hard');
  });

  it('takes the first brand when a tier somehow holds two', () => {
    const lockup = headerLockup([logo('Somo Club', 'title'), logo('Dice Hard', 'title')]);
    expect(lockup.presenter?.name).toBe('Somo Club');
  });
});
