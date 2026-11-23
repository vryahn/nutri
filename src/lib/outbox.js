// Offline write queue for `entries`, persisted in localStorage.
//
// Why it exists: on a weak connection `await supabase.insert(...)` hangs for tens of
// seconds with no UI feedback, so the user taps "log" again — and again — and the three
// requests all land. Writes now go here first (synchronous, instant), the UI renders the
// row immediately and the network happens in the background.
//
// Idempotent by construction: the row's uuid is generated on the client and travels in
// the payload, so replaying an insert that already landed collides on the primary key
// (23505) and is dropped instead of duplicating. An insert already in flight stays
// ahead of later edits/deletes, including across a reload.
//
// Bulk copy/paste, meal templates and sort_order stay online-only. Day deletion
// has one queue op with a fixed set of IDs, making remote retries idempotent.
import { supabase } from './supabase.js';

const KEY = 'nutri.outbox';
const listeners = new Set();
let owner = null; // uid stamped on each op; flush skips ops of another user (see below)
let inflight = null;
let sending = null;

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

/** Patches a row. Only an insert never attempted on the network can be rewritten. */
export function queueUpdate(id, patch, row) {
  const at = ops.findIndex((o) => o.id === id);
  if (at >= 0 && ops[at].op === 'insert' && !ops[at].attempted && ops[at] !== sending) {
    const next = [...ops];
    next[at] = { ...next[at], payload: { ...next[at].payload, ...patch }, row };
    write(next);
  } else {
    const patches = ops.filter((o) => o.id === id && o !== sending && o.op === 'update').map((o) => o.payload);
    const keep = ops.filter((o) => o.id !== id || o === sending || (o.op === 'insert' && o.attempted));
    write([...keep, { id, op: 'update', owner: ops[at]?.owner ?? owner,
      payload: Object.assign({}, ...patches, patch), row }]);
  }
  emit();
  flushOutbox();
}

/** Deletes a row. Only an insert never attempted on the network can be dropped. */
export function queueDelete(id) {
  const first = ops.find((o) => o.id === id);
  const rest = ops.filter((o) => o.id !== id || o === sending || (o.op === 'insert' && o.attempted));
  write(first?.op === 'insert' && !first.attempted && first !== sending ? rest
    : [...rest, { id, op: 'delete', owner: first?.owner ?? owner, payload: null, row: null }]);
  emit();
  flushOutbox();
}

// Keep attempted writes ahead of the batch so an insert cannot arrive after
// its delete. Keep untouched writes recoverable until the batch is confirmed.
export function queueDeleteDay(day, ids) {
  const pendingIds = new Set(ops.filter((o) => o.op === 'delete-many' && o.owner === owner && o.day === day).flatMap((o) => o.ids));
  const idsToDelete = [...new Set(ids)].filter((id) => !pendingIds.has(id));
  if (!idsToDelete.length) return;
  const at = ops.findIndex((o) => o !== sending && !o.attempted && o.op !== 'delete-many');
  const index = at === -1 ? ops.length : at;
  const batch = { op: 'delete-many', owner, day, ids: idsToDelete };
  write([...ops.slice(0, index), batch, ...ops.slice(index)]);
  emit();
  flushOutbox();
}

/**
 * Server rows for `day` with the queue applied on top: pending inserts appended,
 * pending updates overlaid, pending single or batch deletes removed. Pending rows carry _pending so the
 * card can say so. A later update/delete wins over an insert in flight.
 * With `uid`, ops stamped by another account are ignored (left intact in the queue).
 */
export function applyOutbox(serverRows, day, queue = ops, uid) {
  if (uid !== undefined) queue = queue.filter((o) => !o.owner || o.owner === uid);
  if (!queue.length) return serverRows;
  const serverIds = new Set(serverRows.map((r) => r.id));
  const deleting = new Set(queue.filter((o) => o.op === 'delete-many' && o.day === day).flatMap((o) => o.ids));
  const byId = new Map(queue.filter((o) => o.op !== 'delete-many').map((o) => [o.id, o]));
  const merged = [];
  for (const r of serverRows) {
    const o = byId.get(r.id);
    if (deleting.has(r.id) || o?.op === 'delete') continue;
    merged.push(o?.op === 'update' && o.row ? { ...o.row, _pending: true } : r);
  }
  for (const o of byId.values()) {
    if (deleting.has(o.id) || serverIds.has(o.id) || o.op === 'delete' || o.row?.day !== day) continue;
    if (o.op === 'update' && !queue.some((prior) => prior.id === o.id && prior.op === 'insert')) continue;
    merged.push({ ...o.row, _pending: true });
  }
  return merged;
}

// A 5-character SQLSTATE, or a PostgREST PGRSTnnn code, means the server rejected the
// write on its merits: retrying cannot help, so the op is dropped and reported. Anything
// else (fetch failure, timeout, gateway) is transient and stays queued. Exceptions: 23505
// is the idempotent replay of an insert that already landed (= done), and the RLS/JWT
// codes are transient because the session comes back after a refresh.
const DONE = '23505';
const TRANSIENT_CODES = new Set(['42501', 'PGRST301', 'PGRST302']);
const PERMANENT_CODE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;
const isPermanent = (error) => PERMANENT_CODE.test(error.code || '') && !TRANSIENT_CODES.has(error.code);

async function send(op) {
  if (op.op === 'insert') return supabase.from('entries').insert(op.payload);
  if (op.op === 'update') return supabase.from('entries').update(op.payload).eq('id', op.id);
  if (op.op === 'delete-many') {
    const request = supabase.from('entries').delete().in('id', op.ids).eq('day', op.day);
    return op.owner ? request.eq('owner', op.owner) : request;
  }
  return supabase.from('entries').delete().eq('id', op.id);
}

// Drains the queue in order, stopping at the first transient failure (whatever is
// behind it is almost certainly offline too). Never throws.
async function drain() {
  let synced = 0;
  let dropped = 0;
  let stopped = false;
  let failedBatches = 0;
  const deletedDays = [];
  while (ops.length) {
    const op = ops[0];
    // Not this user's queue: leave it untouched rather than writing it under the wrong
    // owner. Nothing behind it can be sent either (order is preserved).
    if (op.owner && op.owner !== owner) { stopped = true; break; }
    let error;
    sending = op;
    op.attempted = true; // a timeout may happen after the server committed this insert
    write([...ops]);
    try {
      ({ error } = await send(op));
    } catch (e) {
      error = e; // network failure: no SQLSTATE, therefore transient
    }
    sending = null;
    if (op.op === 'delete-many') {
      if (error && !isPermanent(error)) { stopped = true; break; }
      if (error) {
        failedBatches++;
        write(ops.filter((o) => o !== op));
      } else {
        deletedDays.push({ day: op.day, ids: op.ids });
        const ids = new Set(op.ids);
        write(ops.filter((o) => {
          const sameDay = !o.row?.day || o.row.day === op.day;
          return o !== op && !((!o.owner || o.owner === op.owner) && ids.has(o.id) && sameDay);
        }));
      }
      continue;
    }
    if (error && !(op.op === 'insert' && error.code === DONE)) {
      if (!isPermanent(error)) { stopped = true; break; }
      dropped += 1;
      if (op.op === 'insert') {
        const rest = ops.filter((o) => o.id !== op.id);
        dropped += ops.length - rest.length - 1; // dependent edits cannot succeed
        write(rest);
        continue;
      }
    } else {
      synced += 1;
    }
    write(ops.filter((o) => o !== op));
  }
  if (synced || dropped || failedBatches || deletedDays.length) {
    emit({ synced, dropped, ...(failedBatches ? { failedBatches } : {}), ...(deletedDays.length ? { deletedDays } : {}) });
  }
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
  // A connection can recover before the previous request reports its failure.
  // Retry after that drain rather than sharing only its failed promise.
  const retry = () => { if (inflight) void inflight.then(flushOutbox); else void flushOutbox(); };
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retry();
  });
}
