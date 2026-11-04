import { db, now } from '../db.js';
import { applyQuote } from './market.js';
import { logLine } from '../chains/evm.js';

// SUPPLEMENTARY pricing for Solana tokens. Discovery never depends on this:
// the pipeline already knows the token exists from program logs. This only
// converts a discovered mint into a USD observation so multipliers can move.

const ENDPOINTS = [
  'https://lite-api.jup.ag/price/v3?ids=',
  'https://api.jup.ag/price/v2?ids=',
];

let failures = 0;
let lastRunAt = 0;

function parseV3(json) {
  const out = {};
  for (const [mint, v] of Object.entries(json || {})) {
    const price = Number(v?.usdPrice ?? v?.price);
    if (Number.isFinite(price) && price > 0) out[mint] = price;
  }
  return out;
}

function parseV2(json) {
  const out = {};
  for (const [mint, v] of Object.entries(json?.data || {})) {
    const price = Number(v?.price);
    if (Number.isFinite(price) && price > 0) out[mint] = price;
  }
  return out;
}

async function fetchPrices(mints) {
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}${mints.join(',')}`, {
        headers: { accept: 'application/json', 'user-agent': 'trench-scanner/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = await res.json();
      const parsed = endpoint.includes('v3') ? parseV3(json) : parseV2(json);
      if (Object.keys(parsed).length) return parsed;
    } catch (err) {
      logLine('solana', 'debug', 'supplementary price source failed', { endpoint, error: err.message });
    }
  }
  return {};
}

export async function priceSolanaTokens(limit = 30) {
  // Never hammer the price source on repeated failures.
  if (Date.now() - lastRunAt < 30000 && failures > 2) return { skipped: 'backoff' };
  lastRunAt = now();
  const rows = db
    .prepare(
      `SELECT id, address FROM tokens WHERE chain = 'solana' AND price IS NULL
       ORDER BY first_seen_at DESC LIMIT ?`,
    )
    .all(limit);
  if (!rows.length) return { updated: 0 };

  const prices = await fetchPrices(rows.map((r) => r.address));
  if (!Object.keys(prices).length) {
    failures += 1;
    return { updated: 0, unavailable: true };
  }
  failures = 0;
  let updated = 0;
  for (const row of rows) {
    const price = prices[row.address];
    if (!price) continue;
    applyQuote(row, { price, source: 'jupiter-price', ts: now() });
    updated += 1;
  }
  return { updated };
}
