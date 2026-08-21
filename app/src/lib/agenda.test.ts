import { describe, expect, it } from 'vitest';
import { loadAgenda, saveAgenda, toggleAgenda, type StorageLike } from './agenda';

function memoryStorage(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
  };
}

describe('device-local My Day', () => {
  it('loads only valid saved IDs and survives malformed storage', () => {
    expect([...loadAgenda(memoryStorage('["a","b",3,""]'))]).toEqual(['a', 'b']);
    expect([...loadAgenda(memoryStorage('{not-json'))]).toEqual([]);
  });

  it('toggles and persists a deterministic set without mutating the input', () => {
    const original = new Set(['b']);
    const added = toggleAgenda(original, 'a');
    expect([...original]).toEqual(['b']);
    expect([...added]).toEqual(['b', 'a']);

    const storage = memoryStorage();
    saveAgenda(storage, added);
    expect(storage.value).toBe('["a","b"]');
    expect([...toggleAgenda(added, 'b')]).toEqual(['a']);
  });
});
