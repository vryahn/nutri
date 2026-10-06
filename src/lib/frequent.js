import { supabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

const WINDOW_DAYS = 30;
const MAX_ITEMS = 8;
const inflight = new Map();
const loaded = new Map();
let activeUserId = null;

supabase.auth.onAuthStateChange((_event, session) => {
  const userId = session?.user?.id || null;
  if (userId !== activeUserId) {
    activeUserId = userId;
    inflight.clear();
    loaded.clear();
  }
});

function addCalendarDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function historyKey(userId, date) {
  return `frequent:${userId}:${date}`;
}

async function isCurrentUser(userId) {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id === userId;
  } catch {
    return false;
  }
}

async function load(userId, date) {
  if (!userId || !date) return [];
  const key = historyKey(userId, date);
  if (!await isCurrentUser(userId)) return [];
  if (activeUserId !== userId) {
    activeUserId = userId;
    inflight.clear();
    loaded.clear();
  }
  if (loaded.has(key)) return loaded.get(key);
  const stored = cacheGet(`frequent:${userId}`);
  const cached = stored?.rows || [];
  if (!inflight.has(key)) {
    const request = (async () => {
      try {
        const { data, error } = await supabase
          .from('entry_nutrients')
          .select('id, day, food_id, recipe_id, item, brand, grams, meal_label_id')
          .gte('day', addCalendarDays(date, -WINDOW_DAYS))
          .lte('day', date);
        if (error) throw error;
        if (!await isCurrentUser(userId) || inflight.get(key) !== request) return [];
        const rows = data || [];
        cacheSet(`frequent:${userId}`, { date, rows });
        loaded.set(key, rows);
        return rows;
      } catch {
        if (!await isCurrentUser(userId) || inflight.get(key) !== request) return [];
        loaded.set(key, cached);
        return cached;
      } finally {
        if (inflight.get(key) === request) inflight.delete(key);
      }
    })();
    inflight.set(key, request);
  }
  return inflight.get(key) || cached;
}

export function prefetchFrequent(userId, date) {
  return load(userId, date);
}

export function refreshFrequent(userId, date) {
  loaded.delete(historyKey(userId, date));
  inflight.delete(historyKey(userId, date));
  return load(userId, date);
}

// Rank the closed 30-day history; grams stay an ordinary, editable mode suggestion.
export function rankFrequent(rows, { date, labelId, waterFoodId, dayEntries, dayEntriesReady = false } = {}) {
  if (!date) return [];
  const start = addCalendarDays(date, -WINDOW_DAYS);
  const selectedDayRows = (dayEntries || []).filter((row) => row.day === date);
  const currentDay = new Map(selectedDayRows.map((row) => [row.id, row]));
  const history = (rows || []).filter((row) => row.day >= start && row.day <= date && !(dayEntriesReady && row.day === date) && !currentDay.has(row.id));
  const candidates = [...history, ...selectedDayRows];
  const repeat = new Set(candidates
    .filter((row) => row.day === date && (!labelId || row.meal_label_id === labelId))
    .map((row) => `${row.food_id ? 'food' : 'recipe'}:${row.food_id || row.recipe_id}`));
  const byKey = new Map();

  for (const row of candidates) {
    if (labelId && row.meal_label_id !== labelId) continue;
    if (row.food_id && row.food_id === waterFoodId) continue;
    const type = row.food_id ? 'food' : 'recipe';
    const id = row.food_id || row.recipe_id;
    if (!id) continue;
    const key = `${type}:${id}`;
    let item = byKey.get(key);
    if (!item) {
      item = { food_id: row.food_id, recipe_id: row.recipe_id, item: row.item, brand: row.brand, score: 0, latestDay: row.day, counts: new Map() };
      byKey.set(key, item);
    }
    const ageDays = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${row.day}T00:00:00Z`)) / 86400000);
    item.score += 2 ** (-ageDays / 7);
    if (row.day > item.latestDay) item.latestDay = row.day;
    const grams = Number(row.grams);
    item.counts.set(grams, (item.counts.get(grams) || 0) + 1);
  }

  return [...byKey.entries()]
    .map(([key, item]) => ({ key, ...item, score: item.score * (repeat.has(key) ? 0.25 : 1) }))
    .sort((a, b) => b.score - a.score || (a.latestDay < b.latestDay ? 1 : a.latestDay > b.latestDay ? -1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, MAX_ITEMS)
    .map(({ food_id, recipe_id, item, brand, counts }) => {
      let grams = null;
      let bestCount = 0;
      for (const [amount, count] of counts) {
        if (count > bestCount) { grams = amount; bestCount = count; }
      }
      return { food_id, recipe_id, item, brand, grams };
    });
}

export async function getFrequent({ userId, date, labelId, waterFoodId, dayEntries, dayEntriesReady } = {}) {
  const rows = await load(userId, date);
  if (!await isCurrentUser(userId)) return [];
  return rankFrequent(rows, { date, labelId, waterFoodId, dayEntries, dayEntriesReady });
}
