import { db } from '../db.js';
import { getToken } from './tokens.js';

// Wallet PNL is derived strictly from recorded on-chain swaps using average cost.
// Multiple buys, partial sells, fees and remaining holdings are all accounted for.

const EPS = 1e-12;

export function computePositions(chain, wallet) {
  const trades = db
    .prepare('SELECT * FROM wallet_trades WHERE chain = ? AND wallet = ? ORDER BY ts ASC, id ASC')
    .all(chain, wallet);
  const positions = new Map();
  for (const t of trades) {
    const key = t.token_id;
    if (!positions.has(key)) {
      positions.set(key, {
        token_id: key, buys: 0, sells: 0, qty: 0, cost: 0, realized: 0, fees: 0,
        invested: 0, proceeds: 0, first_trade_at: t.ts, last_trade_at: t.ts, trades: 0,
      });
    }
    const p = positions.get(key);
    p.trades += 1;
    p.fees += t.fee_quote || 0;
    p.last_trade_at = t.ts;
    const qty = Number(t.token_amount) || 0;
    if (t.side === 'buy') {
      p.buys += 1;
      p.qty += qty;
      const spent = t.quote_amount ?? (t.price ? qty * t.price : 0);
      p.cost += spent;
      p.invested += spent;
    } else {
      p.sells += 1;
      const sold = Math.min(qty, p.qty);
      const avg = p.qty > EPS ? p.cost / p.qty : 0;
      const received = t.quote_amount ?? (t.price ? qty * t.price : 0);
      p.realized += received - avg * sold;
      p.proceeds += received;
      p.cost = Math.max(0, p.cost - avg * sold);
      p.qty = Math.max(0, p.qty - sold);
    }
  }

  const rows = [];
  for (const p of positions.values()) {
    const token = db
      .prepare('SELECT id, chain, address, name, symbol, price, price_source, market_cap FROM tokens WHERE id = ?')
      .get(p.token_id);
    if (!token) continue;
    const mark = token.price ?? null;
    const unrealized = mark != null ? p.qty * mark - p.cost : null;
    const realized = p.realized - p.fees;
    rows.push({
      ...p,
      token,
      avg_entry: p.buys ? p.invested / Math.max(EPS, p.invested > 0 ? p.invested / (p.cost + p.realized || 1) : 1) : null,
      avg_cost: null,
      remaining: p.qty,
      cost_basis: p.cost,
      mark_price: mark,
      unrealized,
      realized,
      total_pnl: realized + (unrealized ?? 0),
      pnl_pct: p.invested > 0 ? ((realized + (unrealized ?? 0)) / p.invested) * 100 : null,
      priced: mark != null,
    });
  }
  // Recompute honest average entry from the ledger (weighted across buys).
  for (const row of rows) {
    const buys = trades.filter((t) => t.token_id === row.token_id && t.side === 'buy');
    const qtyBought = buys.reduce((a, t) => a + (Number(t.token_amount) || 0), 0);
    const spent = buys.reduce((a, t) => a + (t.quote_amount ?? 0), 0);
    row.avg_entry = qtyBought > 0 ? spent / qtyBought : null;
  }
  return { rows, trades: trades.length };
}

export function walletPnl(chain, wallet) {
  const { rows, trades } = computePositions(chain, wallet);
  const closed = rows.filter((r) => r.remaining <= EPS);
  const realized = rows.reduce((a, r) => a + (r.realized || 0), 0);
  const unrealized = rows.reduce((a, r) => a + (r.unrealized || 0), 0);
  const invested = rows.reduce((a, r) => a + r.invested, 0);
  const wins = rows.filter((r) => r.total_pnl > 0).length;
  const sorted = [...rows].sort((a, b) => b.total_pnl - a.total_pnl);
  const label = db.prepare('SELECT label, launch_count, first_seen_at FROM wallets WHERE chain = ? AND address = ?').get(chain, wallet);
  return {
    wallet,
    chain,
    label: label?.label ?? null,
    creator_launches: label?.launch_count ?? 0,
    trades,
    positions: rows.sort((a, b) => b.total_pnl - a.total_pnl),
    realized,
    unrealized,
    total_pnl: realized + unrealized,
    invested,
    win_rate: rows.length ? wins / rows.length : null,
    closed_positions: closed.length,
    best: sorted[0] || null,
    worst: sorted[sorted.length - 1] || null,
    method: 'average cost from recorded on-chain swaps; unrealized uses latest observed price',
    unpriced_positions: rows.filter((r) => !r.priced).length,
  };
}

export function pnlLeaderboard(limit = 20) {
  const wallets = db
    .prepare('SELECT chain, address FROM wallets ORDER BY first_seen_at DESC LIMIT 60')
    .all();
  const out = wallets
    .map((w) => {
      const p = walletPnl(w.chain, w.address);
      return p.trades ? p : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.total_pnl - a.total_pnl);
  return out.slice(0, limit).map((p) => ({
    chain: p.chain,
    wallet: p.wallet,
    total_pnl: p.total_pnl,
    realized: p.realized,
    unrealized: p.unrealized,
    win_rate: p.win_rate,
    trades: p.trades,
    invested: p.invested,
  }));
}

export function pnlOverview() {
  const tracked = db.prepare('SELECT COUNT(*) c FROM wallets').get().c;
  const trades = db.prepare('SELECT COUNT(*) c, COUNT(DISTINCT wallet) w FROM wallet_trades').get();
  return {
    tracked_wallets: tracked,
    wallets_with_trades: trades.w,
    recorded_trades: trades.c,
    priced_trade_share:
      db.prepare('SELECT COUNT(*) c FROM wallet_trades WHERE price IS NOT NULL').get().c / Math.max(1, trades.c),
  };
}

export function walletHistory(chain, wallet, limit = 100) {
  return db
    .prepare(
      `SELECT t.*, tk.symbol, tk.name FROM wallet_trades t LEFT JOIN tokens tk ON tk.id = t.token_id
       WHERE t.chain = ? AND t.wallet = ? ORDER BY t.ts DESC LIMIT ?`,
    )
    .all(chain, wallet, limit);
}

export function tokenWallets(chain, address, limit = 20) {
  const token = getToken(chain, address);
  if (!token) return [];
  return db
    .prepare(
      `SELECT wallet, SUM(CASE WHEN side='buy' THEN -quote_amount ELSE quote_amount END) net_usd,
        SUM(CASE WHEN side='buy' THEN 1 ELSE 0 END) buys, SUM(CASE WHEN side='sell' THEN 1 ELSE 0 END) sells,
        MAX(ts) last_ts
       FROM wallet_trades WHERE token_id = ? GROUP BY wallet ORDER BY net_usd ASC LIMIT ?`,
    )
    .all(token.id, limit);
}
