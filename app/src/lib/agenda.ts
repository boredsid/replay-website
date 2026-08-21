const AGENDA_KEY = 'replay:my-day:v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function loadAgenda(storage: StorageLike): Set<string> {
  try {
    const value = JSON.parse(storage.getItem(AGENDA_KEY) ?? '[]');
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0));
  } catch {
    return new Set();
  }
}

export function saveAgenda(storage: StorageLike, ids: ReadonlySet<string>): void {
  try {
    storage.setItem(AGENDA_KEY, JSON.stringify([...ids].sort()));
  } catch {
    // A blocked/full local store must not make the public schedule unusable.
  }
}

export function toggleAgenda(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
