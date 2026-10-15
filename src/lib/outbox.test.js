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

  it('keeps delete after an attempted insert whose network response was lost', async () => {
    const ob = await fresh();
    responder = () => ({ error: new TypeError('offline') });
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    await ob.flushOutbox();
    ob.queueDelete('a');
    expect(ob.outboxOps().map((o) => o.op)).toEqual(['insert', 'delete']);
  });

  it('keeps update after an attempted insert whose network response was lost', async () => {
    const ob = await fresh();
    responder = () => ({ error: new TypeError('offline') });
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    await ob.flushOutbox();
    ob.queueUpdate('a', { grams: 250 }, { ...row('a'), grams: 250 });
    const ops = ob.outboxOps();
    expect(ops).toHaveLength(2);
    expect(ops[0].op).toBe('insert');
    expect(ops[0].payload.grams).toBe(100);
    expect(ops[1].payload.grams).toBe(250);
  });

  it('keeps an in-flight update before a later delete', async () => {
    const ob = await fresh();
    ob.queueUpdate('b', { grams: 10 }, row('b'));
    ob.queueUpdate('b', { grams: 20 }, row('b'));
    ob.queueDelete('b');
    expect(ob.outboxOps().map((o) => o.op)).toEqual(['update', 'delete']);
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
  for (const action of ['update', 'delete']) {
    it(`keeps an ${action} queued behind an insert already in flight`, async () => {
      const ob = await fresh();
      const server = new Map();
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      responder = async ({ op, payload }) => {
        if (op === 'insert') {
          await held;
          if (server.has(payload.id)) return { error: { code: '23505' } };
          server.set(payload.id, { ...payload });
        } else if (op === 'update') server.set(payload.id, { ...server.get(payload.id), ...payload });
        else server.delete(payload.id);
        return { error: null };
      };
      ob.setOutboxOwner('user-1');
      ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
      await Promise.resolve(); // insert entered the fake network
      if (action === 'update') ob.queueUpdate('a', { grams: 250 }, { ...row('a'), grams: 250 });
      else ob.queueDelete('a');
      expect(ob.outboxOps().map((o) => o.op)).toEqual(['insert', action]);
      expect(ob.outboxOps().every((o) => o.owner === 'user-1')).toBe(true);
      expect(ob.applyOutbox([], '2026-09-05').map((r) => r.grams)).toEqual(action === 'update' ? [250] : []);
      release();
      await ob.flushOutbox();
      expect(server.get('a')?.grams).toBe(action === 'update' ? 250 : undefined);
      expect(ob.outboxOps()).toEqual([]);
    });
  }

  for (const action of ['update', 'delete']) {
    it(`keeps the latest ${action} after reload and a 23505 insert replay`, async () => {
    const storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    });
    try {
      const ob = await fresh();
      responder = async () => new Promise(() => {}); // browser closes mid-insert
      ob.setOutboxOwner('user-1');
      ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
      await Promise.resolve();
      ob.queueUpdate('a', { grams: 250 }, { ...row('a'), grams: 250 });
      expect(JSON.parse(storage.get('nutri.outbox')).map((o) => o.op)).toEqual(['insert', 'update']);
      calls.length = 0;
      vi.resetModules();
      const reloaded = await import('./outbox.js');
      const server = new Map([['a', { id: 'a', grams: 100 }]]);
      responder = ({ op, payload }) => {
        if (op === 'insert') return { error: { code: '23505' } };
        if (op === 'update') server.set(payload.id, { ...server.get(payload.id), ...payload });
        if (op === 'delete') server.delete(payload.id);
        return { error: null };
      };
      if (action === 'update') reloaded.queueUpdate('a', { grams: 300 }, { ...row('a'), grams: 300 });
      else reloaded.queueDelete('a');
      await reloaded.flushOutbox(); // owner has not been restored: must not send
      expect(reloaded.outboxOps().map((o) => o.op)).toEqual(['insert', action]);
      expect(reloaded.outboxOps()[0].payload.grams).toBe(100);
      reloaded.setOutboxOwner('user-1');
      await reloaded.flushOutbox();
      expect(calls.map((c) => c.op)).toEqual(['insert', action]);
      expect(server.get('a')?.grams).toBe(action === 'update' ? 300 : undefined);
      expect(reloaded.outboxOps()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
    });
  }

  it('merges every queued update patch after a reload', async () => {
    const storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    });
    try {
      const ob = await fresh();
      responder = () => new Promise(() => {}); // first update attempted, response lost
      ob.setOutboxOwner('user-1');
      ob.queueUpdate('a', { food_id: 'food-1' }, row('a'));
      await Promise.resolve();
      ob.queueUpdate('a', { grams: 250 }, { ...row('a'), grams: 250 });
      vi.resetModules();
      const reloaded = await import('./outbox.js');
      reloaded.queueUpdate('a', { meal_label_id: 'label-1' }, { ...row('a'), grams: 250 });
      await reloaded.flushOutbox(); // signed-in owner is not restored yet
      expect(reloaded.outboxOps()).toHaveLength(1);
      expect(reloaded.outboxOps()[0].payload).toEqual({ food_id: 'food-1', grams: 250, meal_label_id: 'label-1' });
      reloaded.setOutboxOwner('user-1');
      responder = () => ({ error: null });
      await reloaded.flushOutbox();
      expect(reloaded.outboxOps()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not send an edit queued during insert after the account changes', async () => {
    const ob = await fresh();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    responder = ({ op }) => op === 'insert' ? held : { error: null };
    ob.setOutboxOwner('user-1');
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    await Promise.resolve();
    ob.queueUpdate('a', { grams: 250 }, { ...row('a'), grams: 250 });
    ob.setOutboxOwner('user-2');
    release({ error: null });
    await ob.flushOutbox();
    expect(calls.map((c) => c.op)).toEqual(['insert']);
    expect(ob.outboxOps().map((o) => [o.op, o.owner])).toEqual([['update', 'user-1']]);
  });

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

  it('does not treat a 23505 update error as a successful insert replay', async () => {
    const ob = await fresh();
    responder = () => ({ error: { code: '23505', message: 'conflict' } });
    const seen = [];
    ob.onOutbox((summary) => seen.push(summary));
    ob.queueUpdate('a', { grams: 250 }, { ...row('a'), grams: 250 });
    await ob.flushOutbox();
    expect(seen.at(-1)).toEqual({ synced: 0, dropped: 1 });
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

  it('reports a rejected insert and its dependent edit as dropped', async () => {
    const ob = await fresh();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    responder = ({ op }) => op === 'insert' ? held : { error: null };
    const seen = [];
    ob.onOutbox((s) => seen.push(s));
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    await Promise.resolve();
    ob.queueUpdate('a', { grams: 250 }, { ...row('a'), grams: 250 });
    release({ error: { code: '23503' } });
    await ob.flushOutbox();
    expect(calls.map((c) => c.op)).toEqual(['insert']);
    expect(ob.outboxOps()).toEqual([]);
    expect(seen.at(-1)).toEqual({ synced: 0, dropped: 2 });
  });

  it('drops a PostgREST rejection instead of jamming the queue behind it', async () => {
    const ob = await fresh();
    // 8 characters, so the SQLSTATE shape alone would have read it as transient.
    responder = () => ({ error: { code: 'PGRST204', message: "column 'x' not found" } });
    ob.queueInsert({ id: 'a', day: '2026-09-05', grams: 100 }, row('a'));
    ob.queueInsert({ id: 'b', day: '2026-09-05', grams: 100 }, row('b'));
    await ob.flushOutbox();
    expect(ob.outboxOps()).toEqual([]);
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
