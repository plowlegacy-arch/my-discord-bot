import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { credit, getUser, getGuild } from './store.js';
import { addItem } from './marketplace.js';
import { ITEMS } from './items.js';

// Giveaway engine: creation, entry with requirements, timed draw, reroll.
// Entries are stored as a JSON array and winners are credited exactly once by
// flipping status open -> ended inside a single transaction.

export const ENTRY_REQUIREMENTS = {
  none: 'No requirement',
  level_5: 'Account level 5+',
  level_10: 'Account level 10+',
  bank_10k: 'At least 10,000 in bank',
};

export const createGiveaway = db.transaction((guildId, hostId, opts) => {
  const gid = String(guildId);
  const {
    prize = 'Prize', prizeKind = 'currency', prizeAmount = null, prizeItem = null,
    winners = 1, requirement = 'none', durationMs = 3600 * 1000, channelId = null,
  } = opts || {};
  if (prizeKind === 'item' && !ITEMS[prizeItem]) throw new Error('unknown prize item');
  const endsAt = now() + Math.max(30000, Math.min(durationMs, 30 * 24 * 3600 * 1000));
  const info = db.prepare(
    `INSERT INTO giveaways (guild_id, channel_id, host_id, prize, prize_kind, prize_amount, prize_item,
       winners, requirements, entries, ends_at, status, winner_ids, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,'[]',?,'open','[]',?)`,
  ).run(gid, channelId ? String(channelId) : null, String(hostId), String(prize).slice(0, 200), prizeKind,
    prizeAmount != null ? Math.trunc(prizeAmount) : null, prizeItem, Math.max(1, Math.min(20, Math.trunc(winners))),
    JSON.stringify({ requirement }), endsAt, now());
  return { ok: true, id: info.lastInsertRowid, ends_at: endsAt };
});

export function entryAllowed(guildId, userId, requirement) {
  if (!requirement || requirement === 'none') return { ok: true };
  const u = getUser(guildId, userId);
  if (requirement === 'level_5') return { ok: u.level >= 5, reason: 'Requires level 5' };
  if (requirement === 'level_10') return { ok: u.level >= 10, reason: 'Requires level 10' };
  if (requirement === 'bank_10k') return { ok: u.bank >= 10000, reason: 'Requires 10,000 in bank' };
  return { ok: true };
}

export const enterGiveaway = db.transaction((guildId, giveawayId, userId) => {
  const gid = String(guildId);
  const uid = String(userId);
  const g = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND id = ?').get(gid, Number(giveawayId));
  if (!g) return { ok: false, reason: 'not_found' };
  if (g.status !== 'open') return { ok: false, reason: 'closed' };
  if (g.ends_at <= now()) return { ok: false, reason: 'expired' };
  const req = safeJson(g.requirements)?.requirement || 'none';
  const allowed = entryAllowed(gid, uid, req);
  if (!allowed.ok) return { ok: false, reason: 'requirement', detail: allowed.reason };
  const entries = safeJson(g.entries) || [];
  if (entries.includes(uid)) return { ok: false, reason: 'already_entered', count: entries.length };
  entries.push(uid);
  db.prepare('UPDATE giveaways SET entries = ? WHERE id = ?').run(JSON.stringify(entries), g.id);
  return { ok: true, count: entries.length };
});

function safeJson(v, fallback = null) {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

/** Draw winners for one giveaway. Idempotent via the status guard. */
export const drawGiveaway = db.transaction((guildId, giveawayId, { force = false, exclude = [] } = {}) => {
  const gid = String(guildId);
  const g = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND id = ?').get(gid, Number(giveawayId));
  if (!g) return { ok: false, reason: 'not_found' };
  if (g.status !== 'open') return { ok: false, reason: 'not_open' };
  if (!force && g.ends_at > now()) return { ok: false, reason: 'not_ended', ends_at: g.ends_at };
  const entries = (safeJson(g.entries) || []).filter((e) => !exclude.includes(e));
  db.prepare("UPDATE giveaways SET status = 'ended', winner_ids = ?, drawn_at = ? WHERE id = ?").run('[]', now(), g.id);
  if (!entries.length) return { ok: true, winners: [], prize: g.prize };

  const pool = [...entries];
  const winners = [];
  const want = Math.min(g.winners, pool.length);
  for (let i = 0; i < want; i += 1) {
    const idx = crypto.randomInt(pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  for (const w of winners) {
    if (g.prize_kind === 'currency' && g.prize_amount) credit(gid, w, g.prize_amount, 'giveaway_win', { meta: { giveaway: g.id } });
    else if (g.prize_kind === 'item' && g.prize_item) addItem(gid, w, g.prize_item, 1);
  }
  db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify(winners), g.id);
  return { ok: true, winners, prize: g.prize, prize_kind: g.prize_kind, amount: g.prize_amount, item: g.prize_item };
});

export const rerollGiveaway = db.transaction((guildId, giveawayId) => {
  const gid = String(guildId);
  const g = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND id = ?').get(gid, Number(giveawayId));
  if (!g) return { ok: false, reason: 'not_found' };
  if (g.status !== 'ended') return { ok: false, reason: 'not_ended' };
  const previous = safeJson(g.winner_ids) || [];
  const entries = (safeJson(g.entries) || []).filter((e) => !previous.includes(e));
  if (!entries.length) return { ok: false, reason: 'no_eligible_entries' };
  const winner = entries[crypto.randomInt(entries.length)];
  if (g.prize_kind === 'currency' && g.prize_amount) credit(gid, winner, g.prize_amount, 'giveaway_reroll', { meta: { giveaway: g.id } });
  else if (g.prize_kind === 'item' && g.prize_item) addItem(gid, winner, g.prize_item, 1);
  db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify([winner]), g.id);
  return { ok: true, winner, previous };
});

export const listGiveaways = (guildId, status = null) => {
  const rows = status
    ? db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND status = ? ORDER BY created_at DESC LIMIT 30').all(String(guildId), status)
    : db.prepare('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY created_at DESC LIMIT 30').all(String(guildId));
  return rows.map((g) => ({
    ...g,
    entry_count: (safeJson(g.entries) || []).length,
    entries: undefined,
    winner_ids: safeJson(g.winner_ids) || [],
    requirements: safeJson(g.requirements) || {},
  }));
};

export const getGiveaway = (guildId, id) => {
  const g = db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND id = ?').get(String(guildId), Number(id));
  if (!g) return null;
  return { ...g, entries: safeJson(g.entries) || [], winner_ids: safeJson(g.winner_ids) || [], requirements: safeJson(g.requirements) || {} };
};

/** Called by the scheduler: close every expired open giveaway. */
export const dueGiveaways = () => db
  .prepare("SELECT guild_id, id FROM giveaways WHERE status = 'open' AND ends_at <= ? LIMIT 25")
  .all(now());

/** Restock a lottery round when it is drawn. */
export function ensureLotteryBot(guildId) {
  return getGuild(guildId);
}
