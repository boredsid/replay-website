import { describe, it, expect, vi } from 'vitest';
import {
  flushQueue,
  isPermanentFailure,
  memoryStore,
  type QueuedCheckIn,
  type SendResult,
} from './check-in-queue';

function entry(id: string, queuedAt: string): QueuedCheckIn {
  return {
    client_event_id: id,
    path: '/api/admin/check-in',
    body: { attendee_id: 'a1', day: 'day1', kind: 'in', client_event_id: id },
    queued_at: queuedAt,
    attempts: 0,
  };
}

async function seeded(entries: QueuedCheckIn[]) {
  const store = memoryStore();
  for (const e of entries) await store.add(e);
  return store;
}

describe('flushQueue', () => {
  it('sends everything and empties the queue', async () => {
    const store = await seeded([entry('a', '2026-09-12T09:00:00Z'), entry('b', '2026-09-12T09:01:00Z')]);
    const send = vi.fn<(entry: QueuedCheckIn) => Promise<SendResult>>().mockResolvedValue({ ok: true });

    const outcome = await flushQueue(store, send);

    expect(outcome).toMatchObject({ sent: 2, remaining: 0 });
    expect(outcome.rejected).toEqual([]);
  });

  it('sends oldest first, so the desk’s order survives the outage', async () => {
    const store = await seeded([entry('later', '2026-09-12T09:05:00Z'), entry('earlier', '2026-09-12T09:00:00Z')]);
    const order: string[] = [];
    const send = async (e: QueuedCheckIn): Promise<SendResult> => {
      order.push(e.client_event_id);
      return { ok: true };
    };

    await flushQueue(store, send);

    expect(order).toEqual(['earlier', 'later']);
  });

  it('keeps an entry the network could not deliver', async () => {
    const store = await seeded([entry('a', '2026-09-12T09:00:00Z')]);
    const send = async (): Promise<SendResult> => ({ ok: false, permanent: false });

    const outcome = await flushQueue(store, send);

    expect(outcome).toMatchObject({ sent: 0, remaining: 1 });
    expect((await store.list())[0].attempts).toBe(1);
  });

  it('drops an entry the server will never accept, and reports it', async () => {
    const store = await seeded([entry('a', '2026-09-12T09:00:00Z')]);
    const send = async (): Promise<SendResult> => ({ ok: false, permanent: true, error: 'day_not_purchased' });

    const outcome = await flushQueue(store, send);

    // Retrying forever would hide the entries that could still succeed.
    expect(outcome).toMatchObject({ sent: 0, remaining: 0 });
    expect(outcome.rejected).toEqual([
      expect.objectContaining({ error: 'day_not_purchased' }),
    ]);
  });

  it('does not let one bad entry block the rest', async () => {
    const store = await seeded([
      entry('bad', '2026-09-12T09:00:00Z'),
      entry('good', '2026-09-12T09:01:00Z'),
    ]);
    const send = async (e: QueuedCheckIn): Promise<SendResult> =>
      e.client_event_id === 'bad'
        ? { ok: false, permanent: true, error: 'attendee_not_found' }
        : { ok: true };

    const outcome = await flushQueue(store, send);

    expect(outcome).toMatchObject({ sent: 1, remaining: 0 });
    expect(outcome.rejected).toHaveLength(1);
  });

  it('reuses the same client id across attempts, so a replay deduplicates', async () => {
    const store = await seeded([entry('stable', '2026-09-12T09:00:00Z')]);
    const seen: string[] = [];
    const failing = async (e: QueuedCheckIn): Promise<SendResult> => {
      seen.push(e.client_event_id);
      return { ok: false, permanent: false };
    };

    await flushQueue(store, failing);
    await flushQueue(store, failing);

    // The id is generated once on the device and never regenerated; that is what
    // makes flushing twice safe.
    expect(seen).toEqual(['stable', 'stable']);
    expect((await store.list())[0].attempts).toBe(2);
  });

  it('handles an empty queue without calling out', async () => {
    const send = vi.fn<(entry: QueuedCheckIn) => Promise<SendResult>>();
    const outcome = await flushQueue(memoryStore(), send);
    expect(outcome).toMatchObject({ sent: 0, remaining: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('isPermanentFailure', () => {
  it.each([400, 404, 409, 422])('treats %i as permanent', (status) => {
    expect(isPermanentFailure(status)).toBe(true);
  });

  it.each([0, 500, 502, 503])('treats %i as worth retrying', (status) => {
    expect(isPermanentFailure(status)).toBe(false);
  });
});
