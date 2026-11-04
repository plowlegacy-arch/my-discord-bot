import { db, now } from '../db.js';

// Atomic economy core. Every balance mutation happens inside a better-sqlite3
// transaction with a conditional UPDATE, so concurrent discord interactions can
// never double-spend or produce a negative balance.

const DEFAULTS = {
  currency_name: 'Trench Coin',
  currency_symbol: '⛏',
  starting_balance: 2500,
  daily_amount: 1000,
  weekly_amount: 5000,
  monthly_amount: 20000,
  work_cooldown: 3600,
  min_bet: 10,
  max_bet: 1000000,
};

export function getGuild(guildId) {
  const row = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(String(guildId));
  if (row) return row;
  db.prepare(
    `INSERT INTO guild_config (guild_id, updated_at) VALUES (?, ?) ON CONFLICT(guild_id) DO NOTHING`,
  ).run(String(guildId), now());
  return db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(String(guildId));
}

export function updateGuild(guildId, patch) {
  getGuild(guildId);
  const allowed = [
    'currency_name', 'currency_symbol', 'starting_balance', 'daily_amount', 'weekly_amount', 'monthly_amount',
    'work_cooldown', 'max_bet', 'min_bet', 'owner_role_ids', 'admin_role_ids', 'alert_channel',
    'min_alert_liquidity', 'min_alert_marketcap', 'multiplier_alerts', 'tracked_chains', 'theme',
  ];
  const fields = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!fields.length) return getGuild(guildId);
  const values = {};
  for (const f of fields) values[f] = typeof patch[f] === 'object' && patch[f] !== null ? JSON.stringify(patch[f]) : patch[f];
  db.prepare(`UPDATE guild_config SET ${fields.map((f) => `${f} = @${f}`).join(', ')}, updated_at = @ts WHERE guild_id = @gid`)
    .run({ ...values, ts: now(), gid: String(guildId) });
  return getGuild(guildId);
}

export function getUser(guildId, userId) {
  const gid = String(guildId);
  const uid = String(userId);
  let row = db.prepare('SELECT * FROM econ_users WHERE guild_id = ? AND user_id = ?').get(gid, uid);
  if (row) return row;
  const cfg = getGuild(gid);
  db.prepare(
    `INSERT INTO econ_users (guild_id, user_id, cash, created_at, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(guild_id, user_id) DO NOTHING`,
  ).run(gid, uid, cfg.starting_balance, now(), now());
  row = db.prepare('SELECT * FROM econ_users WHERE guild_id = ? AND user_id = ?').get(gid, uid);
  if (cfg.starting_balance > 0) logTx({ guildId: gid, userId: uid, amount: cfg.starting_balance, kind: 'starting_balance', balanceAfter: row.cash });
  return row;
}

export function logTx({ guildId, userId, amount, kind, balanceAfter, ref, meta }) {
  db.prepare(
    `INSERT INTO econ_tx (guild_id, user_id, amount, kind, balance_after, ref, meta, ts)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(String(guildId), String(userId), Math.trunc(amount), kind, balanceAfter ?? null, ref ?? null, meta ? JSON.stringify(meta) : null, now());
}

export const txHistory = (guildId, userId, limit = 20) =>
  db.prepare('SELECT * FROM econ_tx WHERE guild_id = ? AND user_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
    .all(String(guildId), String(userId), limit);

/** Deposit virtual currency. `mint: true` creates currency from nothing (admin). */
export const credit = db.transaction((guildId, userId, amount, kind = 'credit', opts = {}) => {
  const gid = String(guildId);
  const uid = String(userId);
  const amt = Math.trunc(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('credit amount must be positive');
  getUser(gid, uid);
  const info = db.prepare(
    'UPDATE econ_users SET cash = cash + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
  ).run(amt, now(), gid, uid);
  if (info.changes !== 1) throw new Error('credit target missing');
  const row = db.prepare('SELECT cash FROM econ_users WHERE guild_id = ? AND user_id = ?').get(gid, uid);
  logTx({ guildId: gid, userId: uid, amount: amt, kind, balanceAfter: row.cash, ref: opts.ref, meta: opts.meta });
  return row.cash;
});

/** Debit wallet atomically. Returns { ok, cash } and never goes negative. */
export const debit = db.transaction((guildId, userId, amount, kind = 'debit', opts = {}) => {
  const gid = String(guildId);
  const uid = String(userId);
  const amt = Math.trunc(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('debit amount must be positive');
  getUser(gid, uid);
  const info = db.prepare(
    'UPDATE econ_users SET cash = cash - ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND cash >= ?',
  ).run(amt, now(), gid, uid, amt);
  if (info.changes !== 1) return { ok: false, cash: db.prepare('SELECT cash FROM econ_users WHERE guild_id = ? AND user_id = ?').get(gid, uid).cash };
  const row = db.prepare('SELECT cash FROM econ_users WHERE guild_id = ? AND user_id = ?').get(gid, uid);
  logTx({ guildId: gid, userId: uid, amount: -amt, kind, balanceAfter: row.cash, ref: opts.ref, meta: opts.meta });
  return { ok: true, cash: row.cash };
});

export const depositBank = db.transaction((guildId, userId, amount) => {
  const gid = String(guildId);
  const uid = String(userId);
  const amt = Math.trunc(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('deposit must be positive');
  const u = getUser(gid, uid);
  if (u.cash < amt) return { ok: false, reason: 'insufficient_cash' };
  const room = u.bank_capacity - u.bank;
  if (room <= 0) return { ok: false, reason: 'bank_full' };
  const move = Math.min(amt, room);
  const res = debit(gid, uid, move, 'bank_deposit');
  if (!res.ok) return { ok: false, reason: 'insufficient_cash' };
  db.prepare('UPDATE econ_users SET bank = bank + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?').run(move, now(), gid, uid);
  return { ok: true, moved: move, user: getUser(gid, uid) };
});

export const withdrawBank = db.transaction((guildId, userId, amount) => {
  const gid = String(guildId);
  const uid = String(userId);
  const amt = Math.trunc(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('withdraw must be positive');
  getUser(gid, uid);
  const info = db.prepare(
    'UPDATE econ_users SET bank = bank - ?, cash = cash + ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND bank >= ?',
  ).run(amt, amt, now(), gid, uid, amt);
  if (info.changes !== 1) return { ok: false, reason: 'insufficient_bank' };
  const u = getUser(gid, uid);
  logTx({ guildId: gid, userId: uid, amount: amt, kind: 'bank_withdraw', balanceAfter: u.cash });
  return { ok: true, user: u };
});

/** Wallet-to-wallet transfer with a single atomic pair of updates. */
export const transfer = db.transaction((guildId, fromId, toId, amount, kind = 'transfer') => {
  const gid = String(guildId);
  const from = String(fromId);
  const to = String(toId);
  if (from === to) throw new Error('cannot pay yourself');
  const amt = Math.trunc(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('transfer must be positive');
  getUser(gid, from);
  getUser(gid, to);
  const info = db.prepare(
    'UPDATE econ_users SET cash = cash - ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND cash >= ?',
  ).run(amt, now(), gid, from, amt);
  if (info.changes !== 1) return { ok: false, reason: 'insufficient_cash' };
  db.prepare('UPDATE econ_users SET cash = cash + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?').run(amt, now(), gid, to);
  const a = getUser(gid, from);
  const b = getUser(gid, to);
  logTx({ guildId: gid, userId: from, amount: -amt, kind, balanceAfter: a.cash, meta: { to } });
  logTx({ guildId: gid, userId: to, amount: amt, kind, balanceAfter: b.cash, meta: { from } });
  return { ok: true, from: a, to: b };
});

export function addXp(guildId, userId, xp) {
  const u = getUser(guildId, userId);
  const total = u.xp + xp;
  const level = Math.max(1, Math.floor(Math.sqrt(total / 100)) + 1);
  db.prepare('UPDATE econ_users SET xp = ?, level = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?')
    .run(total, level, now(), String(guildId), String(userId));
  return { xp: total, level, leveled: level > u.level };
}

export function audit(guildId, actorId, action, targetId, amount, meta) {
  db.prepare('INSERT INTO audit_log (guild_id, actor_id, action, target_id, amount, meta, ts) VALUES (?,?,?,?,?,?,?)')
    .run(String(guildId), String(actorId), action, targetId != null ? String(targetId) : null, amount ?? null, meta ? JSON.stringify(meta) : null, now());
}

export const auditLog = (guildId, limit = 50) =>
  db.prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY ts DESC LIMIT ?').all(String(guildId), limit);

export function resetBalance(guildId, userId) {
  getUser(guildId, userId);
  const cfg = getGuild(guildId);
  db.prepare('UPDATE econ_users SET cash = ?, bank = 0, updated_at = ? WHERE guild_id = ? AND user_id = ?')
    .run(cfg.starting_balance, now(), String(guildId), String(userId));
  return getUser(guildId, userId);
}

export function setBalance(guildId, userId, field, value) {
  if (!['cash', 'bank'].includes(field)) throw new Error('invalid balance field');
  const amt = Math.trunc(Number(value));
  if (!Number.isFinite(amt) || amt < 0) throw new Error('balance must be >= 0');
  getUser(guildId, userId);
  db.prepare(`UPDATE econ_users SET ${field} = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?`)
    .run(amt, now(), String(guildId), String(userId));
  const row = getUser(guildId, userId);
  logTx({ guildId, userId, amount: amt, kind: `set_${field}`, balanceAfter: row.cash });
  return row;
}

export const netWorth = (guildId, userId) => {
  const u = getUser(guildId, userId);
  const biz = db.prepare('SELECT COALESCE(SUM(level * 5000),0) v FROM businesses WHERE guild_id = ? AND owner_id = ?')
    .get(String(guildId), String(userId)).v;
  return { cash: u.cash, bank: u.bank, businesses: biz, total: u.cash + u.bank + biz, user: u };
};

export function leaderboard(guildId, { by = 'total', limit = 10 } = {}) {
  const order = by === 'bank' ? 'bank DESC' : by === 'cash' ? 'cash DESC' : '(cash + bank) DESC';
  return db.prepare(`SELECT user_id, cash, bank, level, career, career_level, (cash + bank) AS total
    FROM econ_users WHERE guild_id = ? ORDER BY ${order} LIMIT ?`).all(String(guildId), limit);
}

export const ECONOMY_DEFAULTS = DEFAULTS;
