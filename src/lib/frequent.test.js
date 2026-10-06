import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ userId: 'user-a', response: { data: [], error: null }, queries: [], authCalls: 0, authListener: null }));
vi.mock('./supabase.js', () => ({
  supabase: {
    auth: {
      getSession: async () => { mock.authCalls += 1; return { data: { session: mock.userId ? { user: { id: mock.userId } } : null } }; },
      onAuthStateChange: (callback) => { mock.authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from: (table) => {
      const query = { table, columns: null, from: null, to: null };
      const chain = {
        select(columns) { query.columns = columns; return chain; },
        gte(_column, value) { query.from = value; return chain; },
        lte(_column, value) { query.to = value; mock.queries.push(query); return Promise.resolve(mock.response); },
      };
      return chain;
    },
  },
}));

function row(id, foodId, day, extra = {}) {
  return { id, food_id: foodId, recipe_id: null, item: foodId, brand: null, grams: 100, day, meal_label_id: null, ...extra };
}

async function fresh() {
  globalThis.localStorage = {
    data: new Map(),
    getItem(key) { return this.data.get(key) ?? null; },
    setItem(key, value) { this.data.set(key, String(value)); },
    removeItem(key) { this.data.delete(key); },
  };
  mock.userId = 'user-a';
  mock.response = { data: [], error: null };
  mock.queries = [];
  mock.authCalls = 0;
  mock.authListener = null;
  vi.resetModules();
  return import('./frequent.js');
}

function setAuthUser(userId) {
  mock.userId = userId;
  mock.authListener?.(userId ? 'SIGNED_IN' : 'SIGNED_OUT', userId ? { user: { id: userId } } : null);
}

describe('frequent item ranking', () => {
  it('returns empty for missing date/history and caps unique options at eight', async () => {
    const { rankFrequent } = await fresh();
    expect(rankFrequent([], {})).toEqual([]);
    const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, `f${i}`, '2026-10-05'));
    expect(rankFrequent(rows, { date: '2026-10-05' })).toHaveLength(8);
  });

  it('excludes configured water and keeps a food and recipe with the same id distinct', async () => {
    const { rankFrequent } = await fresh();
    const rows = [row('water', 'water-id', '2026-10-05'), row('food', 'same', '2026-10-05'), row('recipe', null, '2026-10-05', { recipe_id: 'same', item: 'recipe' })];
    expect(rankFrequent(rows, { date: '2026-10-05', waterFoodId: 'water-id' }).map((item) => [item.food_id, item.recipe_id])).toEqual([['same', null], [null, 'same']]);
  });

  it('uses seven-day half-life and balances repeated older rows against one recent row', async () => {
    const { rankFrequent } = await fresh();
    const rows = [
      row('recent', 'recent', '2026-10-05'),
      ...Array.from({ length: 2 }, (_, i) => row(`old${i}`, 'old', '2026-09-21')),
      row('half', 'half', '2026-09-28'),
    ];
    const ranked = rankFrequent(rows, { date: '2026-10-05' });
    expect(ranked.map((item) => item.food_id)).toEqual(['half', 'old', 'recent']);
    expect(ranked[1].grams).toBe(100);
  });

  it('ranks within the selected label, stays global when empty, and never fills a sparse label globally', async () => {
    const { rankFrequent } = await fresh();
    const rows = [
      row('a1', 'a', '2026-10-05', { meal_label_id: 'A' }),
      row('a2', 'a', '2026-10-04', { meal_label_id: 'A' }),
      row('b1', 'b', '2026-10-05', { meal_label_id: 'B' }),
      row('b2', 'b', '2026-10-04', { meal_label_id: 'B' }),
      row('b3', 'b', '2026-10-03', { meal_label_id: 'B' }),
    ];
    expect(rankFrequent(rows, { date: '2026-10-05', labelId: 'A' }).map((item) => item.food_id)).toEqual(['a']);
    expect(rankFrequent(rows, { date: '2026-10-05' })[0].food_id).toBe('b');
    expect(rankFrequent(rows, { date: '2026-10-05', labelId: 'missing' })).toEqual([]);
  });

  it('applies the 0.25 same-day penalty only in the chosen label and does not remove repeats', async () => {
    const { rankFrequent } = await fresh();
    const rows = [
      row('repeat', 'repeat', '2026-10-05', { meal_label_id: 'A' }),
      row('repeat-old', 'repeat', '2026-10-04', { meal_label_id: 'A' }),
      row('other-1', 'other', '2026-10-04', { meal_label_id: 'A' }),
      row('other-2', 'other', '2026-10-03', { meal_label_id: 'A' }),
      row('other-3', 'other', '2026-10-02', { meal_label_id: 'A' }),
      row('b-repeat', 'repeat', '2026-10-05', { meal_label_id: 'B' }),
    ];
    const inLabel = rankFrequent(rows, { date: '2026-10-05', labelId: 'A' });
    expect(inLabel.map((item) => item.food_id)).toContain('repeat');
    expect(inLabel[0].food_id).toBe('other');
    expect(rankFrequent(rows, { date: '2026-10-05', labelId: 'B' }).map((item) => item.food_id)).toEqual(['repeat']);
    expect(rankFrequent(rows, { date: '2026-10-05' })[0].food_id).toBe('other');
  });

  it('uses the closed date range, ignores future rows, and breaks ties deterministically', async () => {
    const { rankFrequent } = await fresh();
    const rows = [
      row('outside', 'outside', '2026-09-04'),
      row('future', 'future', '2026-10-06'),
      row('z1', 'z', '2026-10-04'),
      row('z2', 'z', '2026-10-04'),
      row('a1', 'a', '2026-10-04'),
      row('a2', 'a', '2026-10-04'),
    ];
    expect(rankFrequent(rows, { date: '2026-10-05' }).map((item) => item.food_id)).toEqual(['a', 'z']);
  });

  it('keeps grams mode unweighted and uses the first modal amount on ties', async () => {
    const { rankFrequent } = await fresh();
    const rows = [
      row('g1', 'f', '2026-10-05', { grams: 50 }),
      row('g2', 'f', '2026-10-04', { grams: 100 }),
      row('g3', 'f', '2026-10-03', { grams: 50 }),
      row('g4', 'f', '2026-10-02', { grams: 100 }),
    ];
    expect(rankFrequent(rows, { date: '2026-10-05' })[0].grams).toBe(50);
  });
});

describe('frequent history loading', () => {
  it('queries id/day over closed date bounds and caches by account/date', async () => {
    const frequent = await fresh();
    mock.response = { data: [row('1', 'f', '2026-10-05')], error: null };
    expect((await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' })).map((item) => item.food_id)).toEqual(['f']);
    expect(mock.queries[0]).toMatchObject({ table: 'entry_nutrients', columns: 'id, day, food_id, recipe_id, item, brand, grams, meal_label_id', from: '2026-09-05', to: '2026-10-05' });
    mock.response = { data: [], error: null };
    await frequent.getFrequent({ userId: 'user-a', date: '2026-10-04' });
    mock.userId = 'user-b';
    await frequent.getFrequent({ userId: 'user-b', date: '2026-10-05' });
    expect(mock.queries).toHaveLength(3);
  });

  it('reuses a completed account/date fetch when label or local rows change', async () => {
    const frequent = await fresh();
    mock.response = { data: [row('1', 'f', '2026-10-05', { meal_label_id: 'A' })], error: null };
    await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05', labelId: 'A' });
    await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05', labelId: 'B', dayEntries: [row('2', 'g', '2026-10-05')], dayEntriesReady: true });
    expect(mock.queries).toHaveLength(1);
  });

  it('falls back to the same account/date cache for returned errors and rejected offline fetches', async () => {
    const frequent = await fresh();
    mock.response = { data: [row('1', 'f', '2026-10-05'), row('2', 'past', '2026-10-04')], error: null };
    await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' });
    frequent.refreshFrequent('user-a', '2026-10-05');
    mock.response = { data: null, error: new Error('offline') };
    expect((await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' })).map((item) => item.food_id)).toEqual(['past', 'f']);
    expect(await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05', labelId: 'other' })).toEqual([]);
    frequent.refreshFrequent('user-a', '2026-10-05');
    mock.response = Promise.resolve().then(() => { throw new Error('fetch rejected'); });
    expect((await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' })).map((item) => item.food_id)).toEqual(['past', 'f']);
  });

  it('reuses the same-account persisted window on adjacent or past dates and clips future rows', async () => {
    const frequent = await fresh();
    mock.response = { data: [row('today', 'future-to-past', '2026-10-05'), row('yesterday', 'valid', '2026-10-04')], error: null };
    await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' });
    mock.response = { data: null, error: new Error('offline') };
    expect((await frequent.getFrequent({ userId: 'user-a', date: '2026-10-06' })).map((item) => item.food_id)).toEqual(['future-to-past', 'valid']);
    expect((await frequent.getFrequent({ userId: 'user-a', date: '2026-10-04' })).map((item) => item.food_id)).toEqual(['valid']);
  });

  it('rejects another account before reading its persisted history or offline fallback', async () => {
    const frequent = await fresh();
    mock.response = { data: [row('1', 'private-a', '2026-10-05')], error: null };
    await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' });
    mock.userId = 'user-b';
    expect(await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' })).toEqual([]);
    expect(await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05', dayEntries: [row('private', 'private-local', '2026-10-05')], dayEntriesReady: true })).toEqual([]);
  });

  it('clears loaded and inflight memory when the authenticated user changes', async () => {
    const frequent = await fresh();
    mock.response = { data: [row('1', 'f', '2026-10-05')], error: null };
    await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' });
    setAuthUser('user-b');
    setAuthUser(null);
    setAuthUser('user-a');
    await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' });
    expect(mock.queries).toHaveLength(2);
  });

  it('does not let an invalidated older refresh overwrite the newer result', async () => {
    const frequent = await fresh();
    let finishOld;
    let finishNew;
    mock.response = new Promise((resolve) => { finishOld = resolve; });
    const oldRequest = frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    mock.response = new Promise((resolve) => { finishNew = resolve; });
    const refreshed = frequent.refreshFrequent('user-a', '2026-10-05');
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishNew({ data: [row('new', 'fresh', '2026-10-05')], error: null });
    await refreshed;
    finishOld({ data: [row('old', 'stale', '2026-10-05')], error: null });
    expect(await oldRequest).toEqual([]);
    expect(await frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' })).toEqual([{ food_id: 'fresh', recipe_id: null, item: 'fresh', brand: null, grams: 100 }]);
    expect(mock.queries).toHaveLength(2);
  });

  it('does not cache or return an inflight response after the authenticated account changes', async () => {
    const frequent = await fresh();
    let finish;
    mock.response = new Promise((resolve) => { finish = resolve; });
    const pending = frequent.getFrequent({ userId: 'user-a', date: '2026-10-05' });
    await Promise.resolve();
    await Promise.resolve();
    mock.userId = 'user-b';
    finish({ data: [row('private', 'private', '2026-10-05')], error: null });
    expect(await pending).toEqual([]);
    mock.response = { data: [], error: null };
    expect(await frequent.getFrequent({ userId: 'user-b', date: '2026-10-05' })).toEqual([]);
  });

  it('merges the authoritative selected day by entry id and reflects pending insert/update/delete', async () => {
    const { rankFrequent } = await fresh();
    const history = [
      row('existing', 'old-food', '2026-10-05', { meal_label_id: 'A' }),
      row('deleted', 'deleted-food', '2026-10-05', { meal_label_id: 'A' }),
      row('previous', 'previous-food', '2026-10-04', { meal_label_id: 'A' }),
    ];
    const visible = [
      row('existing', 'new-food', '2026-10-05', { meal_label_id: 'A', grams: 200, _pending: true }),
      row('inserted', 'inserted-food', '2026-10-05', { meal_label_id: 'A', _pending: true }),
    ];
    const ranked = rankFrequent(history, { date: '2026-10-05', labelId: 'A', dayEntries: visible, dayEntriesReady: true });
    expect(ranked.map((item) => item.food_id)).toEqual(['previous-food', 'inserted-food', 'new-food']);
    expect(ranked.map((item) => item.food_id)).not.toContain('deleted-food');
  });

  it('does not let rows from a prior selected date replace current-day history while loading', async () => {
    const { rankFrequent } = await fresh();
    const history = [row('old', 'old', '2026-10-05')];
    const staleDay = [row('previous-view', 'stale', '2026-10-04')];
    expect(rankFrequent(history, { date: '2026-10-05', dayEntries: staleDay, dayEntriesReady: false }).map((item) => item.food_id)).toEqual(['old']);
  });

  it('includes a current-date pending insert when the day fetch has not completed', async () => {
    const { rankFrequent } = await fresh();
    const pending = row('pending', 'pending-food', '2026-10-05', { _pending: true });
    expect(rankFrequent([], { date: '2026-10-05', dayEntries: [pending], dayEntriesReady: false }).map((item) => item.food_id)).toEqual(['pending-food']);
  });
});
