// Offline write queue for `entries`, persisted in localStorage.
//
// Why it exists: on a weak connection `await supabase.insert(...)` hangs for tens of
// seconds with no UI feedback, so the user taps "log" again — and again — and the three
// requests all land. Writes now go here first (synchronous, instant), the UI renders the
// row immediately and the network happens in the background.
//
// Idempotent by construction: the row's uuid is generated on the client and travels in
// the payload, so replaying an insert that already landed collides on the primary key
// (23505) and is dropped instead of duplicating. At most ONE pending op exists per id
// (a delete on a pending insert removes it, an update merges into it), which keeps the
// replay order irrelevant.
//
// ponytail: entries only, and no reordering. Bulk copy/paste, meal templates and
// sort_order live behind a desk with signal; queueing them would need multi-row ordering
// semantics for no real-world gain. They stay online-only and fail loudly as before.
import { supabase } from './supabase.js';

const KEY = 'nutri.outbox';
const listeners = new Set();
let owner = null; // uid stamped on each op; flush skips ops of another user (see below)
let inflight = null;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

let ops = read();

function write(next) {
  ops = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { /* quota/private mode: the queue still works for this session */ }
}

function emit(summary = {}) {
  for (const fn of listeners) fn(summary);
}

/** Current queue. Stable reference until it changes (safe as React state). */
export const outboxOps = () => ops;

/** Subscribe to queue changes. The callback receives { synced, dropped }. */
export function onOutbox(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The signed-in user's uid. Ops are stamped with it so a queue left behind by one
 *  account is never written under another's (entries.owner defaults to auth.uid()). */
export function setOutboxOwner(uid) {
  owner = uid;
}

export function queueInsert(payload, row) {
  write([...ops, { id: payload.id, op: 'insert', owner, payload, row }]);
  emit();
  flushOutbox();
}

/** Patches a row. On a still-pending insert it rewrites that insert in place, so the
 *  entry reaches the server once, already corrected. */
export function queueUpdate(id, patch, row) {
  const at = ops.findIndex((o) => o.id === id);
  if (at >= 0 && ops[at].op === 'insert') {
    const next = [...ops];
    next[at] = { ...next[at], payload: { ...next[at].payload, ...patch }, row };
    write(next);
  } else {
    write([...ops.filter((o) => o.id !== id), { id, op: 'update', owner, payload: patch, row }]);
  }
  emit();
  flushOutbox();
}

/** Deletes a row. A still-pending insert is dropped outright — the server never sees it. */
export function queueDelete(id) {
  const pendingInsert = ops.some((o) => o.id === id && o.op === 'insert');
  const rest = ops.filter((o) => o.id !== id);
  write(pendingInsert ? rest : [...rest, { id, op: 'delete', owner, payload: null, row: null }]);
  emit();
  flushOutbox();
}

/**
 * Server rows for `day` with the queue applied on top: pending inserts appended,
 * pending updates overlaid, pending deletes removed. Pending rows carry _pending so the
 * card can say so. A row already returned by the server wins over its queued insert
 * (the flush landed, the removal is a tick behind).
 */
export function applyOutbox(serverRows, day, queue = ops) {
  if (!queue.length) return serverRows;
  const serverIds = new Set(serverRows.map((r) => r.id));
  const byId = new Map(queue.map((o) => [o.id, o]));
  const merged = [];
  for (const r of serverRows) {
    const o = byId.get(r.id);
    if (o?.op === 'delete') continue;
    merged.push(o?.op === 'update' && o.row ? { ...o.row, _pending: true } : r);
  }
  for (const o of queue) {
    if (o.op !== 'insert' || serverIds.has(o.id) || o.row?.day !== day) continue;
    merged.push({ ...o.row, _pending: true });
  }
  return merged;
}

// A 5-character SQLSTATE means the server rejected the write on its merits: retrying
// cannot help, so the op is dropped and reported. Anything else (fetch failure, timeout,
// gateway) is transient and stays queued. Exceptions: 23505 is the idempotent replay of
// an insert that already landed (= done), and the RLS/JWT codes are transient because
// the session comes back after a refresh.
const DONE = '23505';
const TRANSIENT_CODES = new Set(['42501', 'PGRST301', 'PGRST302']);
const isPermanent = (error) => /^[0-9A-Z]{5}$/.test(error.code || '') && !TRANSIENT_CODES.has(error.code);

async function send(op) {
  if (op.op === 'insert') return supabase.from('entries').insert(op.payload);
  if (op.op === 'update') return supabase.from('entries').update(op.payload).eq('id', op.id);
  return supabase.from('entries').delete().eq('id', op.id);
}

// Drains the queue in order, stopping at the first transient failure (whatever is
// behind it is almost certainly offline too). Never throws.
async function drain() {
  let synced = 0;
  let dropped = 0;
  let stopped = false;
  while (ops.length) {
    const op = ops[0];
    // Not this user's queue: leave it untouched rather than writing it under the wrong
    // owner. Nothing behind it can be sent either (order is preserved).
    if (op.owner && owner && op.owner !== owner) { stopped = true; break; }
    let error;
    try {
      ({ error } = await send(op));
    } catch (e) {
      error = e; // network failure: no SQLSTATE, therefore transient
    }
    if (error && error.code !== DONE) {
      if (!isPermanent(error)) { stopped = true; break; }
      dropped += 1;
    } else {
      synced += 1;
    }
    write(ops.filter((o) => o !== op));
  }
  if (synced || dropped) emit({ synced, dropped });
  return stopped;
}

/** Sends the queue. Concurrent calls share the in-flight drain. Never throws. */
export function flushOutbox() {
  if (!inflight) {
    inflight = drain().then((stopped) => {
      inflight = null;
      // Queued while draining, right after the loop saw an empty queue.
      if (!stopped && ops.length) flushOutbox();
    });
  }
  return inflight;
}

// Retry points: regained connectivity and returning to the app. main.jsx already uses
// these same two events to check for a new service worker.
if (typeof window !== 'undefined') {
  window.addEventListener('online', flushOutbox);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushOutbox();
  });
}
