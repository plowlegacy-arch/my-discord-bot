import { db, now } from '../db.js';

// Business portfolio: purchase, upgrade, hire, expand, collect income.
// Income accrues on the business clock and is only ever credited once.

export const BUSINESS_TYPES = {
  food_truck: { name: 'Food Truck', emoji: '🌮', cost: 25000, base_income: 900, cycle: 3600, upkeep: 120, max_level: 8 },
  barbershop: { name: 'Barbershop', emoji: '💈', cost: 60000, base_income: 1800, cycle: 5400, upkeep: 200, max_level: 8 },
  garage: { name: 'Auto Garage', emoji: '🔧', cost: 120000, base_income: 3400, cycle: 7200, upkeep: 420, max_level: 10 },
  arcade: { name: 'Arcade', emoji: '🕹', cost: 180000, base_income: 4600, cycle: 7200, upkeep: 600, max_level: 10 },
  nightclub: { name: 'Nightclub', emoji: '🎧', cost: 320000, base_income: 8200, cycle: 10800, upkeep: 1200, max_level: 12 },
  exchange: { name: 'Trench Exchange', emoji: '🏦', cost: 750000, base_income: 19000, cycle: 14400, upkeep: 2400, max_level: 14 },
  shipyard: { name: 'Shipyard', emoji: '🚢', cost: 1200000, base_income: 32000, cycle: 21600, upkeep: 4200, max_level: 15 },
};

export const PROPERTIES = {
  studio: { name: 'Studio Loft', kind: 'house', cost: 40000, income: 260 },
  cabin: { name: 'Timber Cabin', kind: 'house', cost: 90000, income: 480 },
  villa: { name: 'Coastal Villa', kind: 'house', cost: 260000, income: 1100 },
  penthouse: { name: 'Penthouse', kind: 'house', cost: 400000, income: 1900 },
  racer: { name: 'Cafe Racer', kind: 'vehicle', cost: 26000, income: 0 },
  coupe: { name: 'Coupe', kind: 'vehicle', cost: 62000, income: 0 },
  hypercar: { name: 'Hypercar', kind: 'vehicle', cost: 180000, income: 0 },
};

export const businessList = () => Object.entries(BUSINESS_TYPES).map(([key, b]) => ({
  key, ...b, upgrade_cost: upgradeCost(key, 1),
}));

export const upgradeCost = (key, level) => {
  const b = BUSINESS_TYPES[key];
  if (!b) return null;
  return Math.round(b.cost * 0.55 * level ** 1.45);
};

export function userBusinesses(guildId, userId) {
  return db.prepare('SELECT * FROM businesses WHERE guild_id = ? AND owner_id = ? ORDER BY created_at ASC')
    .all(String(guildId), String(userId))
    .map((b) => ({ ...b, meta: businessMeta(b) }));
}

export function businessMeta(b) {
  const type = BUSINESS_TYPES[b.type] || {};
  const level = b.level || 1;
  const income = Math.round((type.base_income || 0) * level ** 1.25 * (1 + b.staff * 0.12));
  const upkeep = Math.round((type.upkeep || 0) * level ** 1.1);
  const cycle = Math.round(((type.cycle || 3600) / 1000) * (1 + b.staff * 0.05)) * 1000;
  const elapsed = Math.max(0, now() - (b.last_collect || b.created_at));
  const cycles = Math.floor(elapsed / cycle);
  const pending = Math.max(0, cycles * (income - upkeep));
  const capacity = Math.round(income * 12);
  return { ...type, income, upkeep, net: income - upkeep, cycle, pending: Math.min(pending, capacity), capacity, cycles_ready: cycles, type_key: b.type };
}

export function portfolio(guildId, userId) {
  const rows = userBusinesses(guildId, userId);
  const assets = db.prepare('SELECT * FROM assets WHERE guild_id = ? AND user_id = ?').all(String(guildId), String(userId));
  const propertyIncome = assets.reduce((a, x) => a + (PROPERTIES[x.key]?.income || 0), 0);
  return {
    businesses: rows,
    assets: assets.map((a) => ({ ...a, meta: PROPERTIES[a.key] || null })),
    passive_income: rows.reduce((a, b) => a + b.meta.net, 0) + propertyIncome,
    pending_total: rows.reduce((a, b) => a + b.meta.pending, 0),
    business_count: rows.length,
  };
}

export function businessById(guildId, id) {
  const row = db.prepare('SELECT * FROM businesses WHERE guild_id = ? AND id = ?').get(String(guildId), Number(id));
  return row ? { ...row, meta: businessMeta(row) } : null;
}

export function businessLeaderboard(guildId, limit = 10) {
  const rows = db.prepare('SELECT owner_id, COUNT(*) c, SUM(level) levels FROM businesses WHERE guild_id = ? GROUP BY owner_id ORDER BY levels DESC LIMIT ?')
    .all(String(guildId), limit);
  return rows.map((r) => {
    const pending = userBusinesses(guildId, r.owner_id).reduce((a, b) => a + b.meta.pending, 0);
    return { owner_id: r.owner_id, businesses: r.c, levels: r.levels, pending };
  });
}

/* ------------------------------------------------------- transactions */

import { debit, credit, getUser } from './store.js';

/** Buy a business. Currency is debited atomically; failure means no row. */
export const buyBusiness = db.transaction((guildId, userId, type, name = null) => {
  const gid = String(guildId);
  const uid = String(userId);
  const t = BUSINESS_TYPES[type];
  if (!t) return { ok: false, reason: 'unknown_business' };
  const owned = db.prepare('SELECT COUNT(*) c FROM businesses WHERE guild_id = ? AND owner_id = ?').get(gid, uid).c;
  if (owned >= 12) return { ok: false, reason: 'business_limit' };
  const paid = debit(gid, uid, t.cost, 'business_purchase', { meta: { type } });
  if (!paid.ok) return { ok: false, reason: 'insufficient_cash' };
  const info = db.prepare(
    'INSERT INTO businesses (guild_id, owner_id, type, name, level, staff, last_collect, created_at) VALUES (?,?,?,?,1,0,?,?)',
  ).run(gid, uid, type, name || `${t.emoji} ${t.name}`, now(), now());
  return { ok: true, id: info.lastInsertRowid, business: businessById(gid, info.lastInsertRowid), cost: t.cost };
});

/** Upgrade one level. Cost scales with the current level. */
export const upgradeBusiness = db.transaction((guildId, userId, businessId) => {
  const gid = String(guildId);
  const uid = String(userId);
  const b = db.prepare('SELECT * FROM businesses WHERE guild_id = ? AND id = ?').get(gid, Number(businessId));
  if (!b) return { ok: false, reason: 'not_found' };
  if (String(b.owner_id) !== uid) return { ok: false, reason: 'not_owner' };
  const t = BUSINESS_TYPES[b.type];
  if (!t) return { ok: false, reason: 'unknown_business' };
  if (b.level >= t.max_level) return { ok: false, reason: 'max_level' };
  const cost = upgradeCost(b.type, b.level + 1);
  const paid = debit(gid, uid, cost, 'business_upgrade', { meta: { business: b.id } });
  if (!paid.ok) return { ok: false, reason: 'insufficient_cash', cost };
  db.prepare('UPDATE businesses SET level = level + 1 WHERE guild_id = ? AND id = ?').run(gid, b.id);
  return { ok: true, cost, business: businessById(gid, b.id) };
});

/** Hire staff: raises output and shortens the collection cycle. */
export const hireStaff = db.transaction((guildId, userId, businessId, count = 1) => {
  const gid = String(guildId);
  const uid = String(userId);
  const b = db.prepare('SELECT * FROM businesses WHERE guild_id = ? AND id = ?').get(gid, Number(businessId));
  if (!b) return { ok: false, reason: 'not_found' };
  if (String(b.owner_id) !== uid) return { ok: false, reason: 'not_owner' };
  const n = Math.max(1, Math.min(10, Math.trunc(Number(count) || 1)));
  if (b.staff >= 25) return { ok: false, reason: 'staff_full' };
  const t = BUSINESS_TYPES[b.type];
  const cost = Math.round((t.base_income || 100) * 2.5) * n;
  const paid = debit(gid, uid, cost, 'business_hire', { meta: { business: b.id, count: n } });
  if (!paid.ok) return { ok: false, reason: 'insufficient_cash', cost };
  db.prepare('UPDATE businesses SET staff = staff + ? WHERE guild_id = ? AND id = ?').run(n, gid, b.id);
  return { ok: true, cost, hired: n, business: businessById(gid, b.id) };
});

/** Collect accrued income exactly once (pending resets via last_collect). */
export const collectBusinessIncome = db.transaction((guildId, userId, businessId = null) => {
  const gid = String(guildId);
  const uid = String(userId);
  const rows = businessId
    ? db.prepare('SELECT * FROM businesses WHERE guild_id = ? AND id = ? AND owner_id = ?').all(gid, Number(businessId), uid)
    : db.prepare('SELECT * FROM businesses WHERE guild_id = ? AND owner_id = ?').all(gid, uid);
  if (!rows.length) return { ok: false, reason: 'not_found' };
  let total = 0;
  const collected = [];
  for (const row of rows) {
    const meta = businessMeta(row);
    if (meta.pending <= 0) continue;
    db.prepare('UPDATE businesses SET last_collect = ? WHERE guild_id = ? AND id = ?').run(now(), gid, row.id);
    total += meta.pending;
    collected.push({ id: row.id, name: row.name, amount: meta.pending });
  }
  if (total <= 0) return { ok: false, reason: 'nothing_to_collect' };
  credit(gid, uid, total, 'business_income', { meta: { businesses: collected.length } });
  return { ok: true, total, collected, cash: getUser(gid, uid).cash };
});

/** Buy a property or vehicle from the asset catalogue. */
export const buyAsset = db.transaction((guildId, userId, key) => {
  const gid = String(guildId);
  const uid = String(userId);
  const a = PROPERTIES[key];
  if (!a) return { ok: false, reason: 'unknown_asset' };
  const owned = db.prepare('SELECT * FROM assets WHERE guild_id = ? AND user_id = ? AND kind = ? AND key = ?').get(gid, uid, a.kind, key);
  if (owned) return { ok: false, reason: 'already_owned' };
  const paid = debit(gid, uid, a.cost, `asset_${a.kind}`, { meta: { key } });
  if (!paid.ok) return { ok: false, reason: 'insufficient_cash', cost: a.cost };
  db.prepare('INSERT INTO assets (guild_id, user_id, kind, key, level, acquired_at) VALUES (?,?,?,?,1,?)')
    .run(gid, uid, a.kind, key, now());
  return { ok: true, asset: { ...a, key } };
});

export const assetList = (kind = null) => Object.entries(PROPERTIES)
  .filter(([, a]) => !kind || a.kind === kind)
  .map(([key, a]) => ({ key, ...a }));
