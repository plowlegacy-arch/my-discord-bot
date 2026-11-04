import { db, now } from '../db.js';
import { getUser, credit, debit, addXp, audit } from './store.js';
import { ACHIEVEMENTS } from './activities.js';

// Social / roleplay layer: marriage, relationships, family, XP levels,
// achievements and challenge tracking.

export const MARRIAGE_COST = 25000;

export const propose = db.transaction((guildId, fromId, toId) => {
  const gid = String(guildId);
  const a = String(fromId);
  const b = String(toId);
  if (a === b) return { ok: false, reason: 'self' };
  const ua = getUser(gid, a);
  const ub = getUser(gid, b);
  if (ua.married_to) return { ok: false, reason: 'already_married' };
  if (ub.married_to) return { ok: false, reason: 'target_married' };
  db.prepare("INSERT INTO proposals (guild_id, from_id, to_id, status, created_at) VALUES (?,?,?,'pending',?)")
    .run(gid, a, b, now());
  return { ok: true, cost: MARRIAGE_COST };
});

export const acceptProposal = db.transaction((guildId, fromId, toId) => {
  const gid = String(guildId);
  const a = String(fromId);
  const b = String(toId);
  const prop = db.prepare("SELECT * FROM proposals WHERE guild_id = ? AND from_id = ? AND to_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
    .get(gid, a, b);
  if (!prop) return { ok: false, reason: 'no_proposal' };
  const ua = getUser(gid, a);
  if (ua.cash < MARRIAGE_COST) return { ok: false, reason: 'insufficient_cash', cost: MARRIAGE_COST };
  debit(gid, a, MARRIAGE_COST, 'wedding');
  db.prepare('UPDATE econ_users SET married_to = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?').run(b, now(), gid, a);
  db.prepare('UPDATE econ_users SET married_to = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?').run(a, now(), gid, b);
  db.prepare("UPDATE proposals SET status = 'accepted', resolved_at = ? WHERE id = ?").run(now(), prop.id);
  unlockAchievement(gid, a, 'married');
  unlockAchievement(gid, b, 'married');
  return { ok: true, cost: MARRIAGE_COST };
});

export const divorce = db.transaction((guildId, userId) => {
  const gid = String(guildId);
  const uid = String(userId);
  const u = getUser(gid, uid);
  if (!u.married_to) return { ok: false, reason: 'not_married' };
  const partner = u.married_to;
  db.prepare('UPDATE econ_users SET married_to = NULL, updated_at = ? WHERE guild_id = ? AND user_id = ?').run(now(), gid, uid);
  db.prepare('UPDATE econ_users SET married_to = NULL, updated_at = ? WHERE guild_id = ? AND user_id = ?').run(now(), gid, partner);
  return { ok: true, partner };
});

export function familyProfile(guildId, userId) {
  const gid = String(guildId);
  const uid = String(userId);
  const u = getUser(gid, uid);
  let spouse = null;
  if (u.married_to) {
    const s = getUser(gid, u.married_to);
    spouse = { user_id: s.user_id, level: s.level, cash: s.cash, bank: s.bank };
  }
  const children = db.prepare("SELECT * FROM family WHERE guild_id = ? AND (parent_a = ? OR parent_b = ?)")
    .all(gid, uid, uid);
  const house = u.house ? db.prepare('SELECT * FROM assets WHERE guild_id = ? AND user_id = ? AND kind = ?').get(gid, uid, 'house') : null;
  const garage = db.prepare("SELECT * FROM assets WHERE guild_id = ? AND user_id = ? AND kind = 'vehicle'").all(gid, uid);
  return { spouse, children, house, garage, married: !!u.married_to };
}

export const adopt = db.transaction((guildId, parentId, childId) => {
  const gid = String(guildId);
  const info = db.prepare('INSERT INTO family (guild_id, parent_a, child_id, created_at) VALUES (?,?,?,?)')
    .run(gid, String(parentId), String(childId), now());
  return { ok: true, id: info.lastInsertRowid };
});

export function unlockAchievement(guildId, userId, key) {
  const def = ACHIEVEMENTS[key];
  if (!def) return { unlocked: false };
  const gid = String(guildId);
  const uid = String(userId);
  const info = db.prepare(
    'INSERT INTO achievements (guild_id, user_id, key, unlocked_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING',
  ).run(gid, uid, key, now());
  if (info.changes === 1) {
    credit(gid, uid, def.reward, 'achievement', { meta: { key } });
    return { unlocked: true, key, reward: def.reward };
  }
  return { unlocked: false };
}

export const achievementsOf = (guildId, userId) => db
  .prepare('SELECT key, unlocked_at FROM achievements WHERE guild_id = ? AND user_id = ? ORDER BY unlocked_at DESC')
  .all(String(guildId), String(userId))
  .map((a) => ({ ...a, ...ACHIEVEMENTS[a.key], key: a.key }));

/** Check net-worth / level thresholds and unlock anything newly earned. */
export function evaluateAchievements(guildId, userId, netWorthValue, level) {
  const out = [];
  if (netWorthValue >= 100000) out.push(unlockAchievement(guildId, userId, 'rich_100k'));
  if (netWorthValue >= 1000000) out.push(unlockAchievement(guildId, userId, 'rich_1m'));
  if (level >= 10) out.push(unlockAchievement(guildId, userId, 'level_10'));
  return out.filter((x) => x.unlocked);
}

export function profile(guildId, userId, netWorthValue = 0) {
  const u = getUser(guildId, userId);
  return {
    user_id: u.user_id,
    cash: u.cash,
    bank: u.bank,
    xp: u.xp,
    level: u.level,
    career: u.career,
    career_level: u.career_level,
    career_xp: u.career_xp,
    streak: u.streak,
    married_to: u.married_to,
    net_worth: netWorthValue,
    achievements: achievementsOf(guildId, userId),
  };
}
