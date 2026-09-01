// Offline queue for check-in actions.
//
// The venue network is the thing most likely to fail on the day, and the desk
// cannot stop working while it does. Every action is written here first with an
// id generated on the device, then sent. A replay after reconnect collides on
// that id server-side and returns the original event, so flushing twice checks
// nobody in twice — which is why there is no merge logic in this file.

export interface QueuedCheckIn {
  /** Primary key. Generated before the first send attempt, never regenerated. */
  client_event_id: string;
  path: string;
  body: Record<string, unknown>;
  /** For the desk to see how stale the backlog is. */
  queued_at: string;
  attempts: number;
}

export interface QueueStore {
  add(entry: QueuedCheckIn): Promise<void>;
  list(): Promise<QueuedCheckIn[]>;
  remove(clientEventId: string): Promise<void>;
  update(entry: QueuedCheckIn): Promise<void>;
}

const DB_NAME = 'replay-admin';
const STORE = 'check-in-queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'client_event_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export const indexedDbStore: QueueStore = {
  add: (entry) => tx('readwrite', (s) => s.put(entry)).then(() => undefined),
  update: (entry) => tx('readwrite', (s) => s.put(entry)).then(() => undefined),
  remove: (id) => tx('readwrite', (s) => s.delete(id)).then(() => undefined),
  list: () => tx<QueuedCheckIn[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedCheckIn[]>),
};

/** In-memory store, for tests and for browsers where IndexedDB is unavailable. */
export function memoryStore(): QueueStore {
  const entries = new Map<string, QueuedCheckIn>();
  return {
    add: async (entry) => { entries.set(entry.client_event_id, entry); },
    update: async (entry) => { entries.set(entry.client_event_id, entry); },
    remove: async (id) => { entries.delete(id); },
    list: async () => [...entries.values()],
  };
}

export type SendResult =
  | { ok: true }
  /** The server refused on the merits — retrying will never help. */
  | { ok: false; permanent: true; error: string }
  /** The network or the server failed — keep it and try again. */
  | { ok: false; permanent: false };

export interface FlushOutcome {
  sent: number;
  /** Entries dropped because the server will never accept them. */
  rejected: Array<{ entry: QueuedCheckIn; error: string }>;
  remaining: number;
}

/**
 * Sends everything queued, oldest first.
 *
 * A permanent rejection is dropped rather than retried forever — a check-in for
 * a day the ticket does not cover will fail identically at every attempt, and a
 * queue that never drains hides the entries that could still succeed. The caller
 * surfaces those to the operator instead.
 */
export async function flushQueue(
  store: QueueStore,
  send: (entry: QueuedCheckIn) => Promise<SendResult>,
): Promise<FlushOutcome> {
  const entries = (await store.list()).sort((a, b) => a.queued_at.localeCompare(b.queued_at));
  const rejected: FlushOutcome['rejected'] = [];
  let sent = 0;

  for (const entry of entries) {
    const result = await send(entry);
    if (result.ok) {
      await store.remove(entry.client_event_id);
      sent += 1;
      continue;
    }
    if (result.permanent) {
      await store.remove(entry.client_event_id);
      rejected.push({ entry, error: result.error });
      continue;
    }
    // Transient: keep it, but record that we tried so a stuck entry is visible.
    await store.update({ ...entry, attempts: entry.attempts + 1 });
  }

  return { sent, rejected, remaining: (await store.list()).length };
}

/**
 * A 4xx means the request itself is wrong and will stay wrong; a 0 or 5xx means
 * the network or the server is having a moment. Only the second is worth
 * keeping.
 */
export function isPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500;
}
