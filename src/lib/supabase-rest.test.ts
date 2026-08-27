import { describe, expect, it } from 'vitest';
import { restUrl } from './supabase-rest';

describe('restUrl', () => {
  it('joins a project URL and a PostgREST path', () => {
    expect(restUrl('https://project.supabase.co', 'sponsors?select=id')).toBe(
      'https://project.supabase.co/rest/v1/sponsors?select=id',
    );
  });

  it('survives the trailing space the Pages env var carries', () => {
    expect(restUrl('https://project.supabase.co ', 'editions?select=id')).toBe(
      'https://project.supabase.co/rest/v1/editions?select=id',
    );
  });

  it('survives a trailing slash and a leading one on the path', () => {
    expect(restUrl('https://project.supabase.co/', '/sponsors')).toBe(
      'https://project.supabase.co/rest/v1/sponsors',
    );
  });

  it('produces something fetch can parse', () => {
    expect(() => new URL(restUrl(' https://project.supabase.co\n', 'sponsors'))).not.toThrow();
  });
});
