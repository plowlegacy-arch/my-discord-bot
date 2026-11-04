import { db, now } from '../db.js';
import { getTokenById, snapshotPrice, pruneSnapshots } from './tokens.js';
import { onTokensUpdated } from './tracker.js';

// Single place where an observed price is committed. Baselines are written once
// and never overwritten, so multipliers always compare against the first price
// the scanner could actually observe (labelled with its source).
export function applyQuote(tok, { price, liquidityUsd = null, source = 'onchain', ts = now() }) {
  const token = typeof tok === 'number' ? getTokenById(tok) : getTokenById(tok.id);
  if (!token || !(price > 0) || !Number.isFinite(price)) return null;
  const supply = token.total_supply ? Number(token.total_supply) / 10 ** (token.decimals ?? 18) : null;
  const marketCap = supply && Number.isFinite(supply) && supply > 0 ? supply * price : null;
  const isLiquidity = source === 'evm-reserves' || source === 'solana-pool';
  const baselineSource = isLiquidity ? 'first-liquidity' : 'first-observed';

  db.prepare(
    `UPDATE tokens SET
       price = @price,
       price_source = @source,
       market_cap = @mc,
       liquidity_usd = COALESCE(@liq, liquidity_usd),
       last_price_at = @ts,
       first_observed_price = COALESCE(first_observed_price, @price),
       first_liquidity_price = CASE WHEN @liq IS NOT NULL THEN COALESCE(first_liquidity_price, @price) ELSE first_liquidity_price END,
       baseline_price = COALESCE(baseline_price, @price),
       baseline_source = COALESCE(baseline_source, @baselineSource),
       baseline_at = COALESCE(baseline_at, @ts),
       baseline_market_cap = COALESCE(baseline_market_cap, CASE WHEN baseline_price IS NULL THEN @mc END),
       baseline_liquidity = COALESCE(baseline_liquidity, CASE WHEN @liq IS NOT NULL THEN @liq END),
       ath_price = CASE WHEN ath_price IS NULL OR @price > ath_price THEN @price ELSE ath_price END,
       ath_at = CASE WHEN ath_price IS NULL OR @price > ath_price THEN @ts ELSE ath_at END,
       low_price = CASE WHEN low_price IS NULL OR @price < low_price THEN @price ELSE low_price END,
       low_at = CASE WHEN low_price IS NULL OR @price < low_price THEN @ts ELSE low_at END,
       updated_at = @ts
     WHERE id = @id`,
  ).run({
    price,
    source,
    mc: marketCap,
    liq: liquidityUsd ?? null,
    ts,
    baselineSource,
    id: token.id,
  });

  snapshotPrice(token.id, { price, marketCap, liquidityUsd, source, ts });
  pruneSnapshots(token.id, 600);
  const fresh = getTokenById(token.id);
  onTokensUpdated({ token: fresh });
  return fresh;
}
