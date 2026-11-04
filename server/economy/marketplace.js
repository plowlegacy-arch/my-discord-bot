import { db, now } from '../db.js';
import { getUser, credit, debit, logTx, transfer } from './store.js';
import { ITEMS, itemValue, rarityOf } from './items.js';

// Marketplace: fixed-price listings, player auctions and direct secure trades.
// Item custody is enforced: listing removes the item from inventory, cancelling
// returns it, and buying moves it to the buyer atomically.

export function addItem(guildId, userId, key, qty = 1, meta = null) {
  if (!ITEMS[key]) throw new Error('unknown item');
  db.prepare(
    `INSERT INTO inventory (guild_id, user_id, item_key, qty, meta, acquired_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(guild_id, user_id, item_key) DO UPDATE SET qty = qty + excluded.qty`,
  ).run(String(guildId), String(userId), key, Math.max(1, Math.trunc(qty)), meta ? JSON.stringify(meta) : null, now());
}

export function removeItem(guildId, userId, key, qty = 1) {
  const amt = Math.max(1, Math.trunc(qty));
  const row = db.prepare('SELECT qty FROM inventory WHERE guild_id = ? AND user_id = ? AND item_key = ?')
    .get(String(guildId), String(userId), key);
  if (!row || row.qty < amt) return false;
  if (row.qty === amt) {
    db.prepare('DELETE FROM inventory WHERE guild_id = ? AND user_id = ? AND item_key = ?')
      .run(String(guildId), String(userId), key);
  } else {
    db.prepare('UPDATE inventory SET qty = qty - ? WHERE guild_id = ? AND user_id = ? AND item_key = ?')
      .run(amt, String(guildId), String(userId), key);
  }
  return true;
}

export const inventory = (guildId, userId) => db
  .prepare('SELECT * FROM inventory WHERE guild_id = ? AND user_id = ? ORDER BY item_key ASC')
  .all(String(guildId), String(userId))
  .map((r) => {
    const item = ITEMS[r.item_key] || {};
    return {
      ...r,
      name: item.name || r.item_key,
      emoji: item.emoji || '📦',
      rarity: item.rarity || 'common',
      rarity_meta: rarityOf(r.item_key),
      unit_value: itemValue(r.item_key),
      total_value: itemValue(r.item_key, r.qty),
      kind: item.kind || 'material',
    };
  });

export const inventoryValue = (guildId, userId) =>
  inventory(guildId, userId).reduce((a, i) => a + i.total_value, 0);

export const createListing = db.transaction((guildId, sellerId, itemKey, qty, price, { kind = 'fixed', durationMs = null } = {}) => {
  const gid = String(guildId);
  const sid = String(sellerId);
  const amount = Math.max(1, Math.trunc(qty));
  const cost = Math.trunc(Number(price));
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('price must be positive');
  if (!ITEMS[itemKey]) throw new Error('unknown item');
  const user = getUser(gid, sid);
  const fee = Math.max(1, Math.round(cost * 0.02));
  if (user.cash < fee) return { ok: false, reason: 'listing_fee' };
  if (!removeItem(gid, sid, itemKey, amount)) return { ok: false, reason: 'insufficient_items' };
  debit(gid, sid, fee, 'market_listing_fee');
  const info = db.prepare(
    `INSERT INTO market_listings (guild_id, seller_id, item_key, qty, price, kind, status, ends_at, created_at)
     VALUES (?,?,?,?,?,?,'open',?,?)`,
  ).run(gid, sid, itemKey, amount, cost, kind, durationMs ? now() + durationMs : null, now());
  logTx({ guildId: gid, userId: sid, amount: -fee, kind: 'market_listing_fee', meta: { listing: info.lastInsertRowid } });
  return { ok: true, id: info.lastInsertRowid, fee };
});

export const cancelListing = db.transaction((guildId, listingId, actorId) => {
  const gid = String(guildId);
  const row = db.prepare('SELECT * FROM market_listings WHERE guild_id = ? AND id = ?').get(gid, Number(listingId));
  if (!row || row.status !== 'open') return { ok: false, reason: 'not_open' };
  db.prepare("UPDATE market_listings SET status = 'cancelled', closed_at = ? WHERE id = ?").run(now(), row.id);
  addItem(gid, row.seller_id, row.item_key, row.qty);
  return { ok: true, listing: row };
});

export const buyListing = db.transaction((guildId, listingId, buyerId) => {
  const gid = String(guildId);
  const bid = String(buyerId);
  const row = db.prepare('SELECT * FROM market_listings WHERE guild_id = ? AND id = ?').get(gid, Number(listingId));
  if (!row || row.status !== 'open') return { ok: false, reason: 'not_open' };
  if (row.seller_id === bid) return { ok: false, reason: 'own_listing' };
  if (row.kind === 'auction') return { ok: false, reason: 'auction_use_bid' };
  const pay = debit(gid, bid, row.price, 'market_purchase', { meta: { listing: row.id } });
  if (!pay.ok) return { ok: false, reason: 'insufficient_cash' };
  const net = row.price; // buyer pays full price; seller receives it in full
  credit(gid, row.seller_id, net, 'market_sale', { meta: { listing: row.id, buyer: bid } });
  db.prepare("UPDATE market_listings SET status = 'sold', buyer_id = ?, closed_at = ? WHERE id = ?").run(bid, now(), row.id);
  addItem(gid, bid, row.item_key, row.qty);
  return { ok: true, listing: row, total: row.price };
});

/** Auctions reuse the listings table: price is the current highest bid. */
export const bidAuction = db.transaction((guildId, listingId, bidderId, amount) => {
  const gid = String(guildId);
  const bid = String(bidderId);
  const amt = Math.trunc(Number(amount));
  const row = db.prepare('SELECT * FROM market_listings WHERE guild_id = ? AND id = ?').get(gid, Number(listingId));
  if (!row || row.status !== 'open' || row.kind !== 'auction') return { ok: false, reason: 'not_auction' };
  if (row.seller_id === bid) return { ok: false, reason: 'own_listing' };
  if (!row.ends_at || row.ends_at < now()) return { ok: false, reason: 'ended' };
  if (amt <= row.price) return { ok: false, reason: 'bid_too_low', current: row.price };
  const pay = debit(gid, bid, amt, 'auction_bid', { meta: { listing: row.id } });
  if (!pay.ok) return { ok: false, reason: 'insufficient_cash' };
  if (row.buyer_id) credit(gid, row.buyer_id, row.price, 'auction_refund', { meta: { listing: row.id } });
  db.prepare('UPDATE market_listings SET price = ?, buyer_id = ? WHERE id = ?').run(amt, bid, row.id);
  return { ok: true, current: amt };
});

export const settleAuction = db.transaction((guildId, listingId) => {
  const gid = String(guildId);
  const row = db.prepare('SELECT * FROM market_listings WHERE guild_id = ? AND id = ?').get(gid, Number(listingId));
  if (!row || row.kind !== 'auction' || row.status !== 'open') return { ok: false, reason: 'not_open' };
  if (row.ends_at && row.ends_at > now()) return { ok: false, reason: 'running' };
  db.prepare("UPDATE market_listings SET status = 'settled', closed_at = ? WHERE id = ?").run(now(), row.id);
  if (!row.buyer_id) {
    addItem(gid, row.seller_id, row.item_key, row.qty);
    return { ok: true, sold: false, listing: row };
  }
  credit(gid, row.seller_id, row.price, 'auction_sale', { meta: { listing: row.id, buyer: row.buyer_id } });
  addItem(gid, row.buyer_id, row.item_key, row.qty);
  return { ok: true, sold: true, listing: row };
});

export const listings = (guildId, { status = 'open', limit = 25 } = {}) => db
  .prepare('SELECT * FROM market_listings WHERE guild_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?')
  .all(String(guildId), status, limit)
  .map((r) => {
    const item = ITEMS[r.item_key] || {};
    return { ...r, name: item.name || r.item_key, emoji: item.emoji || '📦', rarity: item.rarity || 'common' };
  });

export const userListings = (guildId, userId) => db
  .prepare("SELECT * FROM market_listings WHERE guild_id = ? AND seller_id = ? AND status = 'open' ORDER BY created_at DESC")
  .all(String(guildId), String(userId));

/** Secure two-step player trade. Both sides must confirm before anything moves. */
const tradeSessions = new Map();

export function openTrade(guildId, aId, bId) {
  const key = `${guildId}:${[aId, bId].sort().join(':')}`;
  const session = {
    key, guildId: String(guildId), parties: [String(aId), String(bId)],
    offers: { [aId]: { cash: 0, items: [] }, [bId]: { cash: 0, items: [] } },
    confirmed: {}, createdAt: now(),
  };
  tradeSessions.set(key, session);
  return session;
}

export const getTrade = (guildId, aId, bId) =>
  tradeSessions.get(`${guildId}:${[aId, bId].sort().join(':')}`) || null;

export function setTradeOffer(guildId, aId, bId, actorId, { cash = 0, items = [] }) {
  const s = getTrade(guildId, aId, bId);
  if (!s) throw new Error('no active trade');
  if (!s.parties.includes(String(actorId))) throw new Error('not a party');
  s.offers[actorId] = { cash: Math.max(0, Math.trunc(cash)), items };
  s.confirmed = {};
  return s;
}

export const confirmTrade = db.transaction((guildId, aId, bId, actorId) => {
  const s = getTrade(guildId, aId, bId);
  if (!s) return { ok: false, reason: 'no_trade' };
  s.confirmed[actorId] = true;
  if (s.parties.length !== 2 || !s.parties.every((p) => s.confirmed[p])) return { ok: true, executed: false, session: s };

  // Validate everything before mutating anything.
  for (const p of s.parties) {
    const offer = s.offers[p];
    const u = getUser(s.guildId, p);
    if (offer.cash > u.cash) return { ok: false, reason: 'insufficient_cash', party: p };
    for (const it of offer.items) {
      const row = db.prepare('SELECT qty FROM inventory WHERE guild_id = ? AND user_id = ? AND item_key = ?')
        .get(s.guildId, p, it.key);
      if (!row || row.qty < (it.qty || 1)) return { ok: false, reason: 'insufficient_items', party: p, item: it.key };
    }
  }
  const [a, b] = s.parties;
  for (const p of s.parties) {
    const other = p === a ? b : a;
    const offer = s.offers[p];
    if (offer.cash > 0) transfer(s.guildId, p, other, offer.cash, 'trade');
    for (const it of offer.items) {
      const qty = it.qty || 1;
      if (removeItem(s.guildId, p, it.key, qty)) addItem(s.guildId, other, it.key, qty);
    }
  }
  tradeSessions.delete(s.key);
  return { ok: true, executed: true, session: s };
});

export function cancelTrade(guildId, aId, bId) {
  const key = `${guildId}:${[aId, bId].sort().join(':')}`;
  const s = tradeSessions.get(key);
  tradeSessions.delete(key);
  return s || null;
}
