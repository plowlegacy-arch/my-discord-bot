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
