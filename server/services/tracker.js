import { EventEmitter } from 'node:events';
import { db, now } from '../db.js';
import { getTokenById } from './tokens.js';

// Central intelligence bus: every discovery/pricing event flows through here so the
// Discord alert engine, dashboard SSE stream and multiplier tracker stay in sync.
export const bus = new EventEmitter();
bus.setMaxListeners(50);

// ---------------------------------------------------------------------------
// Unlimited multiplier ladder. There is intentionally NO maximum: steps extend
// by x2 growth past 1000x, so 10,000x / 100,000x / 1,000,000x are all reachable.
// ---------------------------------------------------------------------------
const FIXED = [1.01, 1.02, 1.05, 1.1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000];

export function milestoneLadder(upTo) {
  const out = [...FIXED];
  let m = 2000;
  let guard = 0;
  while (m <= upTo + 1 && guard < 256) {
    out.push(m);
    m *= 2;
    guard += 1;
  }
  // include the exact crossing multiple so 1,234.5x is still recorded as a milestone
  if (Number.isFinite(upTo) && upTo > 1000) out.push(Number(upTo.toFixed(4)));
  return [...new Set(out)].sort((a, b) => a - b);
}

export function multiplierOf(price, baseline) {
  if (!price || !baseline || baseline <= 0 || price <= 0) return null;
  return price / baseline;
}

export function trackMultipliers(token) {
  if (!token) return [];
  const fresh = getTokenById(token.id);
  if (!fresh) return [];
  const events = [];
  const bases = [
    ['price', fresh.baseline_price, fresh.price],
    ['marketcap', fresh.baseline_market_cap, fresh.market_cap],
    ['liquidity', fresh.baseline_liquidity, fresh.liquidity_usd],
  ];
  for (const [basis, base, current] of bases) {
    if (!base || !current || base <= 0) continue;
    const multiple = current / base;
    if (!Number.isFinite(multiple) || multiple < 1.01) continue;
    const ladder = milestoneLadder(multiple);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO milestones (token_id, multiple, basis, price, market_cap, reached_at, seconds_since_baseline)
       VALUES (?,?,?,?,?,?,?)`,
    );
    for (const m of ladder) {
      if (m > multiple) continue;
      const info = insert.run(
        fresh.id, m, basis, fresh.price, fresh.market_cap, now(),
        fresh.baseline_at ? Math.floor((now() - fresh.baseline_at) / 1000) : null,
      );
      if (info.changes > 0 && m >= 2) {
        events.push({ token: fresh, multiple: m, basis, price: fresh.price, marketCap: fresh.market_cap });
      }
    }
  }
  return events;
}

// Baseline must never be reset: only ever set once, and only for the specific source.
export function ensureBaseline(tokenId, { price, source, at }) {
  const t = getTokenById(tokenId);
  if (!t || t.baseline_price || !price) return;
  db.prepare(
    `UPDATE tokens SET baseline_price = ?, baseline_source = ?, baseline_at = ? WHERE id = ?`,
  ).run(price, source, at ?? now(), tokenId);
}

export function onTokensUpdated({ token, chain }) {
  if (!token) return;
  const milestones = trackMultipliers(token);
  const updated = getTokenById(token.id);
  bus.emit('price', { token: updated, chain });
  for (const m of milestones) bus.emit('milestone', { ...m, chain });
}

export function onTokenEvent(payload) {
  bus.emit(payload.kind, payload);
  bus.emit('event', payload);
}

export function tokenDetail(id) {
  const token = getTokenById(id);
  if (!token) return null;
  const events = db.prepare('SELECT * FROM token_events WHERE token_id = ? ORDER BY ts DESC, id DESC LIMIT 40').all(id);
  const snaps = db.prepare('SELECT ts, price, market_cap, liquidity_usd, source FROM price_snapshots WHERE token_id = ? ORDER BY ts ASC LIMIT 400').all(id);
  const milestones = db.prepare('SELECT * FROM milestones WHERE token_id = ? ORDER BY multiple ASC').all(id);
  const creatorLaunches = token.creator
    ? db.prepare('SELECT chain, address, symbol, created_at, risk_level, risk_score FROM tokens WHERE chain = ? AND creator = ? ORDER BY created_at DESC LIMIT 25').all(token.chain, token.creator)
    : [];
  return {
    ...token,
    metadata: token.metadata ? safeJson(token.metadata) : null,
    risk_report: token.risk_report ? safeJson(token.risk_report) : null,
    events,
    snapshots: snaps,
    milestones,
    creator_launches: creatorLaunches,
    multiplier: multiplierOf(token.price, token.baseline_price),
    ath_multiple: multiplierOf(token.ath_price, token.baseline_price),
  };
}

export function safeJson(v) {
  try { return JSON.parse(v); } catch { return null; }
}

export function multiplierLeaders(limit = 30) {
  return db
    .prepare(
      `SELECT *, CASE WHEN baseline_price > 0 AND price > 0 THEN price / baseline_price ELSE NULL END AS multiplier
       FROM tokens WHERE baseline_price > 0 AND price > 0
       ORDER BY multiplier DESC LIMIT ?`,
    )
    .all(limit);
}

export function recentMilestoneFeed(limit = 40) {
  return db
    .prepare(
      `SELECT m.*, t.symbol, t.name, t.chain, t.address, t.market_cap FROM milestones m
       JOIN tokens t ON t.id = m.token_id ORDER BY m.reached_at DESC LIMIT ?`,
    )
    .all(limit);
}
