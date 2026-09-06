import { describe, it, expect, beforeEach, vi } from 'vitest';

// The queue is module state: each test re-imports it fresh with its own fake client.
const calls = [];
let responder = () => ({ error: null });

vi.mock('./supabase.js', () => {
  const chain = (op) => {
    const run = (payload) => {
      const p = Promise.resolve().then(() => {
        calls.push({ op, payload });
        return responder({ op, payload });
      });
      p.eq = (_col, id) => { payload.id = id; return p; };
      return p;
    };
    return run;
  };
  return {
    supabase: {
      from: () => ({
        insert: (row) => chain('insert')({ ...row }),
        update: (patch) => chain('update')({ ...patch }),
        delete: () => chain('delete')({}),
      }),
    },
  };
});

async function fresh() {
  calls.length = 0;
  responder = () => ({ error: null });
  vi.resetModules();
  return import('./outbox.js');
}

const row = (id, day = '2026-09-05') => ({ id, day, grams: 100, kcal: 50 });

describe('outbox queue', () => {
  beforeEach(() => { calls.length = 0; });

  it('collapses a delete on a still-pending insert: the server never sees it', async () => {
    const ob = await fresh();
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    ob.queueDelete('a');
    expect(ob.outboxOps()).toEqual([]);
  });

  it('merges an update into the pending insert instead of queueing a second op', async () => {
    const ob = await fresh();
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    ob.queueUpdate('a', { grams: 250 }, { ...row('a'), grams: 250 });
    const ops = ob.outboxOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('insert');
    expect(ops[0].payload.grams).toBe(250);
  });

  it('keeps at most one op per id', async () => {
    const ob = await fresh();
    ob.queueUpdate('b', { grams: 10 }, row('b'));
    ob.queueUpdate('b', { grams: 20 }, row('b'));
    ob.queueDelete('b');
    expect(ob.outboxOps().map((o) => o.op)).toEqual(['delete']);
  });

  it('applyOutbox adds pending inserts of the day, overlays updates and hides deletes', async () => {
    const ob = await fresh();
    const server = [row('s1'), row('s2')];
    const queue = [
      { id: 'p1', op: 'insert', row: row('p1'), payload: {} },
      { id: 'p2', op: 'insert', row: row('p2', '2026-09-04'), payload: {} },
      { id: 's1', op: 'update', row: { ...row('s1'), grams: 999 }, payload: {} },
      { id: 's2', op: 'delete', row: null, payload: null },
    ];
    const out = ob.applyOutbox(server, '2026-09-05', queue);
    expect(out.map((e) => e.id)).toEqual(['s1', 'p1']); // s2 deleted, p2 is another day
    expect(out[0].grams).toBe(999);
    expect(out[0]._pending).toBe(true);
    expect(out[1]._pending).toBe(true);
  });

  it('a server row already carrying the id wins over its pending insert (no duplicate)', async () => {
    const ob = await fresh();
    const queue = [{ id: 'a', op: 'insert', row: row('a'), payload: {} }];
    expect(ob.applyOutbox([row('a')], '2026-09-05', queue).map((e) => e.id)).toEqual(['a']);
  });
});

describe('outbox flush', () => {
  it('sends the ops in order and empties the queue', async () => {
    const ob = await fresh();
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    ob.queueDelete('z');
    await ob.flushOutbox();
    expect(calls.map((c) => c.op)).toEqual(['insert', 'delete']);
    expect(ob.outboxOps()).toEqual([]);
  });

  it('a duplicate primary key means the write already landed: the op is done, not retried', async () => {
    const ob = await fresh();
    responder = () => ({ error: { code: '23505', message: 'duplicate key' } });
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    await ob.flushOutbox();
    expect(ob.outboxOps()).toEqual([]);
  });

  it('replaying the queue is idempotent: the retried insert carries the same id', async () => {
    const ob = await fresh();
    responder = () => ({ error: new TypeError('Failed to fetch') }); // offline
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    await ob.flushOutbox();
    expect(ob.outboxOps()).toHaveLength(1); // still queued
    responder = () => ({ error: null });
    await ob.flushOutbox();
    expect(calls.map((c) => c.payload.id)).toEqual(['a', 'a']);
    expect(ob.outboxOps()).toEqual([]);
  });

  it('stops at the first transient failure and keeps everything behind it', async () => {
    const ob = await fresh();
    responder = () => ({ error: { message: 'timeout' } }); // no SQLSTATE = transient
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    ob.queueInsert({ id: 'b', day: '2026-09-05', grams: 100 }, row('b'));
    await ob.flushOutbox();
    expect(calls).toHaveLength(1);
    expect(ob.outboxOps().map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('drops an op the server rejected on its merits and reports it', async () => {
    const ob = await fresh();
    responder = () => ({ error: { code: '23503', message: 'foreign key violation' } });
    const seen = [];
    ob.onOutbox((s) => seen.push(s));
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    await ob.flushOutbox();
    expect(ob.outboxOps()).toEqual([]);
    expect(seen.at(-1)).toEqual({ synced: 0, dropped: 1 });
  });

  it('never writes a queue left behind by another account', async () => {
    const ob = await fresh();
    responder = () => ({ error: new TypeError('Failed to fetch') }); // offline: it stays queued
    ob.setOutboxOwner('user-1');
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    await ob.flushOutbox();
    // Another account signs in on the same device before the queue drained.
    responder = () => ({ error: null });
    ob.setOutboxOwner('user-2');
    calls.length = 0;
    await ob.flushOutbox();
    expect(calls).toEqual([]);
    expect(ob.outboxOps().map((o) => o.id)).toEqual(['a']);
  });
});
